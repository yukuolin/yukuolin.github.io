# -*- coding: utf-8 -*-
"""把共用的導覽列與頁尾同步到全站 HTML 頁面。

導覽列與頁尾只在這支腳本裡維護一份；各頁以下列標記包住要被取代的區塊：
    <!-- NAV:START --> ... <!-- NAV:END -->
    <!-- FOOTER:START --> ... <!-- FOOTER:END -->
產生的仍是純靜態 HTML（不依賴 Jekyll 或前端 JS），Live Server 預覽與搜尋引擎爬取都不受影響。

用法：
    python scripts/sync_layout.py           # 改完下方的選單設定後執行，更新所有頁面
    python scripts/sync_layout.py --check   # 只檢查是否有頁面未同步（有則以非零狀態結束）
新增頁面時，在 PAGES 加上檔名，並在該頁 <body> 內放入上述兩組標記。
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 頁面檔名 → 導覽列中要標示為 active 的項目（對應 NAV_ITEMS 的 key）
PAGES = {
    "index.html": "index",
    "futures.html": "futures",
    "position.html": "position",
    "market.html": "market",
    "chips.html": "chips",
    "stock.html": "stock",
    "game.html": "game",
    "freshmen.html": "freshmen",
    "risk.html": "risk",
    "caculation.html": "caculation",
    "privacy.html": None,  # 不在導覽列中，只由頁尾連結
}

# 一般連結：(key, href, 文字)；下拉選單：(key, href, 文字, 下拉設定)
# 下拉設定的 "other" 是其他頁面看到的選單，"self" 是在該頁本身看到的頁內錨點選單；None 代表分隔線
NAV_ITEMS = [
    ("index", "./", "當沖計算機"),
    ("futures", "./futures.html", "期貨計算機"),
    ("position", "./position.html", "部位大小"),
    ("market", "./market.html", "市場焦點", {
        "id": "marketMenu",
        "other": [
            ("./market.html", "📊 市場焦點總覽"),
            None,
            ("./market.html#market-summary", "大盤摘要卡"),
            ("./market.html#sectors", "當日熱門族群"),
            ("./market.html#hot-stocks", "成交量前二十熱門股"),
            ("./market.html#fx", "台幣匯率變化"),
            ("./market.html#events", "經濟事件日曆"),
        ],
        "self": [
            ("#market-summary", "📊 大盤摘要卡"),
            ("#sectors", "當日熱門族群"),
            ("#hot-stocks", "成交量前二十熱門股"),
            ("#fx", "台幣匯率變化"),
            ("#events", "國內外經濟事件日曆"),
        ],
    }),
    ("chips", "./chips.html", "籌碼分析", {
        "id": "chipsMenu",
        "other": [
            ("./chips.html", "📊 籌碼分析總覽"),
            None,
            ("./chips.html#institutional", "三大法人買賣金額"),
            ("./chips.html#ranking", "外資／投信買賣超 Top 10"),
            ("./chips.html#margin", "融資槓桿與當沖占比"),
            ("./chips.html#futures-options", "期貨與選擇權法人籌碼"),
            ("./chips.html#foreign-holding", "外資持股比重"),
        ],
        "self": [
            ("#chip-summary", "📊 籌碼摘要卡"),
            ("#institutional", "三大法人買賣金額"),
            ("#ranking", "外資／投信買賣超 Top 10"),
            ("#margin", "融資槓桿與當沖占比"),
            ("#futures-options", "期貨與選擇權法人籌碼"),
            ("#foreign-holding", "外資持股比重"),
        ],
    }),
    ("stock", "./stock.html", "個股查詢"),
    ("game", "./game.html", "股海盲測"),
    ("freshmen", "./freshmen.html", "新手投資建議"),
    ("risk", "./risk.html", "投資風險"),
    ("caculation", "./caculation.html", "手續費與證交稅"),
]

FOOTER = """    <footer class="footer">
        <p>Design by <a href="#">Yukuo Lin</a> Copyright© YukuoLin All Rights Reserved.</p>
        <p>免責聲明：本網站僅供試算用，實際成本及損益應以政府、券商公告之價格為準，本網站不構成任何投資建議</p>
        <p><a href="./privacy.html">隱私權政策</a></p>
    </footer>"""


def render_nav(active):
    lines = [
        '    <nav class="navbar navbar-expand-lg navbar-dark bg-dark sticky-top">',
        '        <a class="navbar-brand" href="./">股票當沖計算機</a>',
        '        <button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbarNav"',
        '            aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">',
        '            <span class="navbar-toggler-icon"></span>',
        '        </button>',
        '        <div class="collapse navbar-collapse" id="navbarNav">',
        '            <ul class="navbar-nav ml-auto">',
    ]
    for item in NAV_ITEMS:
        key, href, text = item[:3]
        on = " active" if key == active else ""
        if len(item) == 3:
            lines += [
                '                <li class="nav-item">',
                f'                    <a class="nav-link{on}" href="{href}">{text}</a>',
                '                </li>',
            ]
            continue
        menu = item[3]
        lines += [
            '                <li class="nav-item dropdown">',
            f'                    <a class="nav-link dropdown-toggle{on}" href="{href}" id="{menu["id"]}" role="button"',
            f'                        data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">{text}</a>',
            f'                    <div class="dropdown-menu market-menu" aria-labelledby="{menu["id"]}">',
        ]
        for entry in menu["self" if on else "other"]:
            if entry is None:
                lines.append('                        <div class="dropdown-divider"></div>')
            else:
                lines.append(f'                        <a class="dropdown-item" href="{entry[0]}">{entry[1]}</a>')
        lines += ['                    </div>', '                </li>']
    lines += ['            </ul>', '        </div>', '    </nav>']
    return "\n".join(lines)


def replace_block(html, name, body, nl):
    pattern = re.compile(rf"(<!-- {name}:START -->)\r?\n.*?\n([ \t]*<!-- {name}:END -->)", re.S)
    if not pattern.search(html):
        raise ValueError(f"找不到 <!-- {name}:START/END --> 標記")
    return pattern.sub(lambda m: m.group(1) + nl + body.replace("\n", nl) + nl + m.group(2), html, count=1)


def main():
    check = "--check" in sys.argv
    stale = []
    for page, active in PAGES.items():
        path = ROOT / page
        with open(path, encoding="utf-8", newline="") as f:
            html = f.read()
        nl = "\r\n" if "\r\n" in html else "\n"
        try:
            new = replace_block(html, "NAV", render_nav(active), nl)
            new = replace_block(new, "FOOTER", FOOTER, nl)
        except ValueError as e:
            sys.exit(f"{page}: {e}")
        if new != html:
            stale.append(page)
            if not check:
                with open(path, "w", encoding="utf-8", newline="") as f:
                    f.write(new)
    if check and stale:
        sys.exit("導覽列／頁尾未同步，請執行 python scripts/sync_layout.py：" + ", ".join(stale))
    print(("未同步：" if check else "已更新：") + (", ".join(stale) if stale else "無"))


if __name__ == "__main__":
    main()
