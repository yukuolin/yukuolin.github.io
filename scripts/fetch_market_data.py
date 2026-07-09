# -*- coding: utf-8 -*-
"""抓取台股每日市場資料與台幣匯率，輸出 data/market.json 供前端讀取。

資料來源：
- 臺灣證券交易所 rwd JSON 端點（大盤/類股指數、成交量前二十、三大法人）
- open.er-api.com（台幣匯率，中間價參考）

由 GitHub Actions 於台股收盤後排程執行（見 .github/workflows/market-data.yml）。
"""

import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

TWSE = "https://www.twse.com.tw/rwd/zh"
HEADERS = {"User-Agent": "Mozilla/5.0 (market-data-bot; +https://yukuolin.github.io)"}
TAIPEI = timezone(timedelta(hours=8))
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FX_HISTORY_MAX = 60  # 保留最近 60 筆（約三個月）匯率紀錄


def fetch_json(url, retries=2):
    """抓 JSON。證交所 rwd 有 5 秒 5 次的流量限制，每次請求後強制間隔。"""
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if "twse.com.tw" in url:
                time.sleep(3)
            # rwd 被限流時會回 stat 非 OK 或空資料
            if isinstance(data, dict) and data.get("stat") not in (None, "OK"):
                raise ValueError(f"stat={data.get('stat')}")
            return data
        except Exception:
            if attempt == retries:
                raise
            time.sleep(5 * (attempt + 1))


def num(s):
    """'1,234.56' -> 1234.56；空值或 '--' 回傳 None。"""
    if s is None:
        return None
    s = str(s).replace(",", "").strip()
    if s in ("", "--", "-", "None"):
        return None
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return None


def parse_sign(html_sign):
    """TWSE 漲跌欄位是 '<p style=color:red>+</p>' 之類的 HTML，取出 +/-。"""
    text = re.sub(r"<[^>]*>", "", str(html_sign)).strip()
    return -1 if text == "-" else (1 if text == "+" else 0)


def get_indices():
    """大盤指數 + 類股指數（熱門族群用）。"""
    d = fetch_json(f"{TWSE}/afterTrading/MI_INDEX?response=json&type=IND")
    rows = d["tables"][0]["data"]
    taiex = None
    sectors = []
    for r in rows:
        name = r[0].strip()
        close, change_pt, change_pct = num(r[1]), num(r[3]), num(r[4])
        if close is None:
            continue
        sign = parse_sign(r[2])
        change = (change_pt or 0) * (sign if sign else (1 if (change_pct or 0) >= 0 else -1))
        item = {"name": name, "close": close, "change": change, "changePct": change_pct}
        if name == "發行量加權股價指數":
            taiex = item
        elif name.endswith("類指數") and "報酬" not in name:
            sectors.append(item)
    sectors.sort(key=lambda x: x["changePct"] if x["changePct"] is not None else 0, reverse=True)
    return d.get("date"), taiex, sectors


def get_institutional():
    """三大法人買賣金額統計表（BFI82U），金額單位：元。"""
    d = fetch_json(f"{TWSE}/fund/BFI82U?response=json")
    rows = []
    for r in d["data"]:
        rows.append({
            "name": r[0].strip(),
            "buy": num(r[1]),
            "sell": num(r[2]),
            "net": num(r[3]),
        })
    return d.get("date"), rows


def get_hot_stocks():
    """集中市場成交量前二十名證券（MI_INDEX20）。"""
    d = fetch_json(f"{TWSE}/afterTrading/MI_INDEX20?response=json")
    stocks = []
    for r in d["data"]:
        close = num(r[8])
        sign = parse_sign(r[9])
        diff = num(r[10]) or 0
        change = diff * (sign if sign else 0)
        prev = close - change if close is not None else None
        stocks.append({
            "rank": r[0],
            "code": r[1].strip(),
            "name": r[2].strip(),
            "volume": num(r[3]),      # 成交股數
            "trades": num(r[4]),      # 成交筆數
            "close": close,
            "change": change,
            "changePct": round(change / prev * 100, 2) if prev else None,
        })
    return d.get("date"), stocks


def get_t86(date_str):
    """三大法人買賣超日報（個股，單位：股）→ 排行榜與個股查詢用的對照表。"""
    d = fetch_json(f"{TWSE}/fund/T86?response=json&date={date_str}&selectType=ALL")
    if d.get("stat") != "OK":
        return [], [], [], {}
    fields = d["fields"]

    def find_field(*keywords, exclude=()):
        for i, f in enumerate(fields):
            if all(k in f for k in keywords) and not any(x in f for x in exclude):
                return i
        raise ValueError(f"T86 欄位找不到 {keywords}: {fields}")

    i_code = find_field("證券代號")
    i_name = find_field("證券名稱")
    # 歷年欄位名稱有「外資買賣超股數」與「外陸資買賣超股數(不含外資自營商)」兩種寫法
    i_foreign = find_field("資買賣超股數", exclude=("自營商買賣超", "投信"))
    i_trust = find_field("投信買賣超股數")
    i_dealer = find_field("自營商買賣超股數", exclude=("自行", "避險", "外資"))
    rows = []
    inst_map = {}
    for r in d["data"]:
        row = {
            "code": r[i_code].strip(),
            "name": r[i_name].strip(),
            "foreign": num(r[i_foreign]) or 0,
            "trust": num(r[i_trust]) or 0,
            "dealer": num(r[i_dealer]) or 0,
        }
        rows.append(row)
        inst_map[row["code"]] = (row["foreign"], row["trust"], row["dealer"])

    def top(key, reverse, n=10):
        ranked = sorted(rows, key=lambda x: x[key], reverse=reverse)[:n]
        return [
            {"code": x["code"], "name": x["name"], "net": x[key]}
            for x in ranked
            if (x[key] > 0) == reverse and x[key] != 0
        ]

    return top("foreign", True), top("foreign", False), top("trust", True), inst_map


def build_stocks(inst_map):
    """整理全部上市＋上櫃個股盤後資料，供個股查詢頁使用。

    每檔格式：[名稱, 市場, 收盤, 漲跌, 開盤, 最高, 最低, 成交股數, 成交筆數,
               成交金額, 本益比, 股價淨值比, 殖利率(%), 外資買賣超股, 投信買賣超股, 自營商買賣超股]
    """
    stocks = {}

    # 上市：每日收盤行情（含本益比與漲跌符號）
    d = fetch_json(f"{TWSE}/afterTrading/MI_INDEX?response=json&type=ALLBUT0999")
    quote_table = next(t for t in d["tables"] if "每日收盤行情" in t.get("title", ""))
    date = d.get("date")
    for r in quote_table["data"]:
        code = r[0].strip()
        close = num(r[8])
        sign = parse_sign(r[9])
        change = (num(r[10]) or 0) * sign
        inst = inst_map.get(code, (None, None, None))
        stocks[code] = [
            r[1].strip(), "tse", close, change,
            num(r[5]), num(r[6]), num(r[7]),
            num(r[2]), num(r[3]), num(r[4]),
            num(r[15]), None, None,
            inst[0], inst[1], inst[2],
        ]

    # 上市：殖利率與股價淨值比
    try:
        d = fetch_json(f"{TWSE}/afterTrading/BWIBBU_d?response=json&selectType=ALL")
        fields = d["fields"]
        i_yield = fields.index("殖利率(%)")
        i_pb = fields.index("股價淨值比")
        for r in d["data"]:
            code = r[0].strip()
            if code in stocks:
                stocks[code][12] = num(r[i_yield])
                stocks[code][11] = num(r[i_pb])
    except Exception as e:
        print(f"BWIBBU_d fetch failed: {e}", file=sys.stderr)

    # 上櫃：每日收盤 + 本益比/淨值比/殖利率（過濾權證，只留個股/特別股/ETF/ETN）
    code_ok = re.compile(r"^\d{4}[A-Z]?$|^0[02]\d{2,4}[A-Z]?$")
    try:
        rows = fetch_json("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes")
        for r in rows:
            code = r["SecuritiesCompanyCode"].strip()
            if not code_ok.match(code):
                continue
            stocks.setdefault(code, [
                r["CompanyName"].strip(), "otc", num(r["Close"]), num(r["Change"]),
                num(r["Open"]), num(r["High"]), num(r["Low"]),
                num(r["TradingShares"]), num(r["TransactionNumber"]), num(r["TransactionAmount"]),
                None, None, None, None, None, None,
            ])
        rows = fetch_json("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis")
        for r in rows:
            code = r["SecuritiesCompanyCode"].strip()
            if code in stocks and stocks[code][1] == "otc":
                stocks[code][10] = num(r["PriceEarningRatio"])
                stocks[code][11] = num(r["PriceBookRatio"])
                stocks[code][12] = num(r["YieldRatio"])
    except Exception as e:
        print(f"TPEX fetch failed: {e}", file=sys.stderr)

    return date, stocks


def get_fx(history):
    """USD 基準匯率 → 各幣別對台幣，附上一筆歷史供比較。"""
    d = fetch_json("https://open.er-api.com/v6/latest/USD")
    if d.get("result") != "success":
        return history, None
    r = d["rates"]
    twd = r["TWD"]
    today = {
        "date": datetime.now(TAIPEI).strftime("%Y-%m-%d"),
        "USDTWD": round(twd, 4),
        "JPYTWD": round(twd / r["JPY"], 4),
        "EURTWD": round(twd / r["EUR"], 4),
        "CNYTWD": round(twd / r["CNY"], 4),
        "HKDTWD": round(twd / r["HKD"], 4),
    }
    history = [h for h in history if h["date"] != today["date"]]
    history.append(today)
    history = history[-FX_HISTORY_MAX:]
    return history, today


def main():
    DATA_DIR.mkdir(exist_ok=True)

    idx_date, taiex, sectors = get_indices()
    inst_date, institutional = get_institutional()
    hot_date, hot_stocks = get_hot_stocks()
    foreign_buy, foreign_sell, trust_buy, inst_map = get_t86(inst_date)

    fx_path = DATA_DIR / "fx_history.json"
    try:
        fx_history = json.loads(fx_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        fx_history = []
    try:
        fx_history, fx_today = get_fx(fx_history)
    except Exception as e:  # 匯率來源掛掉不應讓台股資料也失敗
        print(f"FX fetch failed: {e}", file=sys.stderr)
        fx_today = fx_history[-1] if fx_history else None

    market = {
        "updatedAt": datetime.now(TAIPEI).isoformat(timespec="seconds"),
        "dataDate": inst_date or idx_date or hot_date,
        "taiex": taiex,
        "sectors": sectors,
        "institutional": institutional,
        "hotStocks": hot_stocks,
        "foreignBuy": foreign_buy,
        "foreignSell": foreign_sell,
        "trustBuy": trust_buy,
        "fx": {"latest": fx_today, "history": fx_history},
    }

    (DATA_DIR / "market.json").write_text(
        json.dumps(market, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    fx_path.write_text(
        json.dumps(fx_history, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    stocks_date, stocks = build_stocks(inst_map)
    (DATA_DIR / "stocks.json").write_text(
        json.dumps(
            {"date": stocks_date, "updatedAt": market["updatedAt"], "stocks": stocks},
            ensure_ascii=False, separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    print(f"OK dataDate={market['dataDate']} sectors={len(sectors)} "
          f"hot={len(hot_stocks)} fBuy={len(foreign_buy)} fSell={len(foreign_sell)} "
          f"stocks={len(stocks)}")


if __name__ == "__main__":
    main()
