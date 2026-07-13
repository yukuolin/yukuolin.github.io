# -*- coding: utf-8 -*-
"""抓取台股每日市場資料與台幣匯率，輸出 data/market.json 供前端讀取。

資料來源（商業使用合規優先，盡量採官方 OpenAPI 開放資料）：
- 臺灣證券交易所 OpenAPI（openapi.twse.com.tw）：大盤/類股指數、成交量前二十、
  個股日成交資訊、本益比/淨值比/殖利率
- 臺灣證券交易所 rwd JSON（三大法人 BFI82U/T86、信用交易統計 MI_MARGN，
  OpenAPI 未提供整體市場數字，帶明確日期參數）
- 臺灣期貨交易所 OpenAPI（openapi.taifex.com.tw）：三大法人期貨未平倉部位
- 證券櫃檯買賣中心 OpenAPI（www.tpex.org.tw/openapi）：上櫃行情與本益比
- open.er-api.com（台幣匯率，中間價參考；頁面須標示 Rates By Exchange Rate API）

注意：TWSE OpenAPI 為夜間更新（收盤當晚至次日清晨），排程見
.github/workflows/market-data.yml。所有來源的資料日期必須一致，否則整批放棄
（保留前一份完整資料，等下一次排程重試）。
"""

import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

TWSE_OPENAPI = "https://openapi.twse.com.tw/v1"
TWSE_RWD = "https://www.twse.com.tw/rwd/zh"
TPEX_OPENAPI = "https://www.tpex.org.tw/openapi/v1"
TAIFEX_OPENAPI = "https://openapi.taifex.com.tw/v1"
HEADERS = {"User-Agent": "Mozilla/5.0 (market-data-bot; +https://yukuolin.github.io)"}
TAIPEI = timezone(timedelta(hours=8))
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FX_HISTORY_MAX = 60  # 保留最近 60 筆（約三個月）匯率紀錄
CHIP_HISTORY_MAX = 60  # 保留最近 60 個交易日的籌碼紀錄
# 籌碼區塊追蹤的台指期貨契約（大台／小台／微台）
FUT_CONTRACTS = ("臺股期貨", "小型臺指期貨", "微型臺指期貨")


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


def skip_run(msg):
    """來源尚未同步更新屬預期情況：印出原因後以成功狀態結束，不更新任何檔案。"""
    print(f"SKIP {msg}")
    sys.exit(0)


def roc_date(s):
    """OpenAPI 的民國日期 '1150709' -> '20260709'；已是西元或空值則原樣回傳。"""
    s = str(s or "").strip()
    if re.fullmatch(r"1\d{6}", s):
        return str(int(s[:3]) + 1911) + s[3:]
    return s


def sign_of(s):
    """漲跌欄位 '+'/'-'（OpenAPI 為純文字）→ 1/-1/0。"""
    text = re.sub(r"<[^>]*>", "", str(s or "")).strip()
    return -1 if text == "-" else (1 if text == "+" else 0)


def get_indices():
    """大盤指數 + 類股指數（熱門族群用）。OpenAPI 每日收盤行情-大盤統計資訊。"""
    rows = fetch_json(f"{TWSE_OPENAPI}/exchangeReport/MI_INDEX")
    date = roc_date(rows[0].get("日期")) if rows else None
    taiex = None
    sectors = []
    for r in rows:
        name = r.get("指數", "").strip()
        close = num(r.get("收盤指數"))
        if close is None:
            continue
        sign = sign_of(r.get("漲跌"))
        change = (num(r.get("漲跌點數")) or 0) * sign
        change_pct = num(r.get("漲跌百分比"))  # 此欄位本身已帶正負號
        item = {"name": name, "close": close, "change": change, "changePct": change_pct}
        if name == "發行量加權股價指數":
            taiex = item
        elif name.endswith("類指數") and "報酬" not in name:
            sectors.append(item)
    sectors.sort(key=lambda x: x["changePct"] if x["changePct"] is not None else 0, reverse=True)
    return date, taiex, sectors


def get_institutional(date_str):
    """三大法人買賣金額統計表（BFI82U，OpenAPI 未提供，走 rwd 並指定日期）。金額單位：元。"""
    d = fetch_json(f"{TWSE_RWD}/fund/BFI82U?response=json&dayDate={date_str}&type=day")
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
    """集中市場成交量前二十名證券（OpenAPI MI_INDEX20）。"""
    rows = fetch_json(f"{TWSE_OPENAPI}/exchangeReport/MI_INDEX20")
    date = rows[0].get("Date") if rows else None  # 此端點已是西元格式
    stocks = []
    for r in rows:
        close = num(r.get("ClosingPrice"))
        sign = sign_of(r.get("Dir"))
        diff = num(r.get("Change")) or 0
        change = diff * (sign if sign else 0)
        prev = close - change if close is not None else None
        stocks.append({
            "rank": num(r.get("Rank")),
            "code": r.get("Code", "").strip(),
            "name": r.get("Name", "").strip(),
            "volume": num(r.get("TradeVolume")),      # 成交股數
            "trades": num(r.get("Transaction")),      # 成交筆數
            "close": close,
            "change": change,
            "changePct": round(change / prev * 100, 2) if prev else None,
        })
    return roc_date(date), stocks


def get_t86(date_str):
    """三大法人買賣超日報（個股，單位：股，OpenAPI 未提供，走 rwd）→ 排行榜與個股查詢用的對照表。"""
    d = fetch_json(f"{TWSE_RWD}/fund/T86?response=json&date={date_str}&selectType=ALL")
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


def get_margin(date_str):
    """信用交易統計彙總（MI_MARGN，OpenAPI 僅有個股明細，整體市場數字走 rwd 並指定日期）。

    融資金額單位：仟元；融資／融券張數單位：交易單位（張）。
    """
    d = fetch_json(f"{TWSE_RWD}/marginTrading/MI_MARGN?response=json&date={date_str}&selectType=MS")
    margin = {}
    for row in d["tables"][0]["data"]:
        item, prev, today = row[0], num(row[4]), num(row[5])
        if item.startswith("融資金額"):
            margin["finValue"], margin["finValuePrev"] = today, prev
        elif item.startswith("融資"):
            margin["finUnits"], margin["finUnitsPrev"] = today, prev
        elif item.startswith("融券"):
            margin["shortUnits"], margin["shortUnitsPrev"] = today, prev
    if "finValue" not in margin:
        raise ValueError(f"MI_MARGN 找不到融資金額欄位: {d['tables'][0]['data']}")
    return margin


def get_futures_positions():
    """期交所三大法人-區分各期貨契約（OpenAPI，僅提供最新交易日）。單位：口。"""
    rows = fetch_json(
        f"{TAIFEX_OPENAPI}/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate"
    )
    date = rows[0].get("Date") if rows else None
    out = []
    for r in rows:
        if r.get("ContractCode") not in FUT_CONTRACTS:
            continue
        out.append({
            "contract": r["ContractCode"],
            "item": r["Item"],
            "longOI": num(r["OpenInterest(Long)"]),
            "shortOI": num(r["OpenInterest(Short)"]),
            "netOI": num(r["OpenInterest(Net)"]),
            "netTrade": num(r["TradingVolume(Net)"]),
        })
    return date, out


def build_stocks(inst_map):
    """整理全部上市＋上櫃個股盤後資料，供個股查詢頁使用。

    每檔格式：[名稱, 市場, 收盤, 漲跌, 開盤, 最高, 最低, 成交股數, 成交筆數,
               成交金額, 本益比, 股價淨值比, 殖利率(%), 外資買賣超股, 投信買賣超股, 自營商買賣超股]
    """
    stocks = {}

    # 上市：個股日成交資訊（OpenAPI，Change 欄位自帶正負號）
    rows = fetch_json(f"{TWSE_OPENAPI}/exchangeReport/STOCK_DAY_ALL")
    date = roc_date(rows[0].get("Date")) if rows else None
    for r in rows:
        code = r["Code"].strip()
        inst = inst_map.get(code, (None, None, None))
        stocks[code] = [
            r["Name"].strip(), "tse", num(r["ClosingPrice"]), num(r["Change"]) or 0,
            num(r["OpeningPrice"]), num(r["HighestPrice"]), num(r["LowestPrice"]),
            num(r["TradeVolume"]), num(r["Transaction"]), num(r["TradeValue"]),
            None, None, None,
            inst[0], inst[1], inst[2],
        ]

    # 上市：本益比、殖利率與股價淨值比（OpenAPI）
    try:
        rows = fetch_json(f"{TWSE_OPENAPI}/exchangeReport/BWIBBU_ALL")
        for r in rows:
            code = r["Code"].strip()
            if code in stocks:
                stocks[code][10] = num(r["PEratio"])
                stocks[code][11] = num(r["PBratio"])
                stocks[code][12] = num(r["DividendYield"])
    except Exception as e:
        print(f"BWIBBU_ALL fetch failed: {e}", file=sys.stderr)

    # 上櫃：每日收盤 + 本益比/淨值比/殖利率（過濾權證，只留個股/特別股/ETF/ETN）
    code_ok = re.compile(r"^\d{4}[A-Z]?$|^0[02]\d{2,4}[A-Z]?$")
    rows = fetch_json(f"{TPEX_OPENAPI}/tpex_mainboard_daily_close_quotes")
    tpex_date = roc_date(rows[0].get("Date")) if rows else None
    if tpex_date != date:
        # 兩市場資料日期不同步（TPEX 當日更新、TWSE OpenAPI 夜間更新），
        # 整批放棄以免混合不同交易日的資料
        skip_run(f"日期不一致：TWSE={date} TPEX={tpex_date}，本次不更新")
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
    try:
        rows = fetch_json(f"{TPEX_OPENAPI}/tpex_mainboard_peratio_analysis")
        for r in rows:
            code = r["SecuritiesCompanyCode"].strip()
            if code in stocks and stocks[code][1] == "otc":
                stocks[code][10] = num(r["PriceEarningRatio"])
                stocks[code][11] = num(r["PriceBookRatio"])
                stocks[code][12] = num(r["YieldRatio"])
    except Exception as e:
        print(f"TPEX peratio fetch failed: {e}", file=sys.stderr)

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

    # 先抓個股行情取得 OpenAPI 目前的資料日期，其餘來源都對齊這一天
    stocks_date, stocks_raw = build_stocks({})

    idx_date, taiex, sectors = get_indices()
    hot_date, hot_stocks = get_hot_stocks()
    if not (stocks_date == idx_date == hot_date):
        skip_run(
            f"日期不一致：STOCK_DAY_ALL={stocks_date} MI_INDEX={idx_date} "
            f"MI_INDEX20={hot_date}，本次不更新"
        )

    inst_date, institutional = get_institutional(stocks_date)
    foreign_buy, foreign_sell, trust_buy, inst_map = get_t86(stocks_date)

    # 籌碼面：信用交易彙總與期貨法人部位，任一來源失敗不應讓主要資料也失敗
    margin = None
    try:
        margin = get_margin(stocks_date)
    except Exception as e:
        print(f"MI_MARGN fetch failed: {e}", file=sys.stderr)
    fut_date, fut_rows = None, []
    try:
        fut_date, fut_rows = get_futures_positions()
    except Exception as e:
        print(f"TAIFEX fetch failed: {e}", file=sys.stderr)

    chip_path = DATA_DIR / "chip_history.json"
    try:
        chip_history = json.loads(chip_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        chip_history = []
    if margin:
        # 外資大台淨未平倉一併留存（期交所資料日期不同步時記 None）
        f_net = next(
            (r["netOI"] for r in fut_rows
             if fut_date == stocks_date and r["contract"] == "臺股期貨" and r["item"].startswith("外資")),
            None,
        )
        chip_history = [h for h in chip_history if h["date"] != stocks_date]
        chip_history.append({
            "date": stocks_date,
            "fin": margin["finValue"],
            "shortU": margin["shortUnits"],
            "fNet": f_net,
        })
        chip_history.sort(key=lambda h: h["date"])
        chip_history = chip_history[-CHIP_HISTORY_MAX:]

    # 把法人買賣超併回個股資料
    for code, inst in inst_map.items():
        if code in stocks_raw and stocks_raw[code][1] == "tse":
            stocks_raw[code][13], stocks_raw[code][14], stocks_raw[code][15] = inst

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
        "dataDate": stocks_date,
        "taiex": taiex,
        "sectors": sectors,
        "institutional": institutional,
        "hotStocks": hot_stocks,
        "foreignBuy": foreign_buy,
        "foreignSell": foreign_sell,
        "trustBuy": trust_buy,
        "chips": {
            "margin": margin,
            "futures": {"date": fut_date, "rows": fut_rows},
            "history": chip_history,
        },
        "fx": {"latest": fx_today, "history": fx_history},
    }

    (DATA_DIR / "market.json").write_text(
        json.dumps(market, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    fx_path.write_text(
        json.dumps(fx_history, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    if chip_history:
        chip_path.write_text(
            json.dumps(chip_history, ensure_ascii=False, indent=1), encoding="utf-8"
        )

    (DATA_DIR / "stocks.json").write_text(
        json.dumps(
            {"date": stocks_date, "updatedAt": market["updatedAt"], "stocks": stocks_raw},
            ensure_ascii=False, separators=(",", ":"),
        ),
        encoding="utf-8",
    )

    print(f"OK dataDate={market['dataDate']} sectors={len(sectors)} "
          f"hot={len(hot_stocks)} fBuy={len(foreign_buy)} fSell={len(foreign_sell)} "
          f"stocks={len(stocks_raw)} margin={'Y' if margin else 'N'} "
          f"futDate={fut_date} futRows={len(fut_rows)}")


if __name__ == "__main__":
    main()
