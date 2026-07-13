/* 台股市場焦點頁：讀取 data/market.json（由 GitHub Actions 每日更新）並渲染 */
(function () {
    "use strict";

    var FX_LIVE_URL = "https://open.er-api.com/v6/latest/USD";
    var FX_CURRENCIES = [
        { key: "USDTWD", label: "美元 USD", digits: 3 },
        { key: "JPYTWD", label: "日圓 JPY", digits: 4 },
        { key: "EURTWD", label: "歐元 EUR", digits: 3 },
        { key: "CNYTWD", label: "人民幣 CNY", digits: 3 },
        { key: "HKDTWD", label: "港幣 HKD", digits: 3 }
    ];

    function fmt(n, digits) {
        if (n === null || n === undefined || isNaN(n)) return "—";
        return n.toLocaleString("zh-Hant-TW", {
            minimumFractionDigits: digits || 0,
            maximumFractionDigits: digits === undefined ? 2 : digits
        });
    }

    function signed(n, digits) {
        if (n === null || n === undefined || isNaN(n)) return "—";
        return (n > 0 ? "+" : "") + fmt(n, digits);
    }

    // 台股慣例：漲（正值）紅、跌（負值）綠
    function colorClass(n) {
        if (n > 0) return "val-up";
        if (n < 0) return "val-down";
        return "";
    }

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function dateLabel(yyyymmdd) {
        if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || "—";
        return yyyymmdd.slice(0, 4) + "/" + yyyymmdd.slice(4, 6) + "/" + yyyymmdd.slice(6, 8);
    }

    // 代號連到個股查詢頁
    function stockLink(code) {
        return '<a class="code-link" href="./stock.html?code=' + encodeURIComponent(code) + '">' + esc(code) + "</a>";
    }

    function findInst(rows, keyword) {
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].name.indexOf(keyword) === 0) return rows[i];
        }
        return null;
    }

    function renderSummary(m) {
        var el = document.getElementById("marketSummary");
        var cards = [];

        if (m.taiex) {
            cards.push({
                label: "加權指數",
                value: fmt(m.taiex.close, 2),
                note: signed(m.taiex.change, 2) + "（" + signed(m.taiex.changePct, 2) + "%）",
                cls: colorClass(m.taiex.change)
            });
        }
        var total = findInst(m.institutional, "合計");
        var foreign = findInst(m.institutional, "外資及陸資");
        var trust = findInst(m.institutional, "投信");
        if (total) cards.push({ label: "三大法人買賣超", value: signed(total.net / 1e8, 1), note: "億元", cls: colorClass(total.net) });
        if (foreign) cards.push({ label: "外資買賣超", value: signed(foreign.net / 1e8, 1), note: "億元", cls: colorClass(foreign.net) });
        if (trust) cards.push({ label: "投信買賣超", value: signed(trust.net / 1e8, 1), note: "億元", cls: colorClass(trust.net) });
        if (m.fx && m.fx.latest) {
            cards.push({ label: "美元兌台幣", value: fmt(m.fx.latest.USDTWD, 3), note: "USD/TWD 參考價", cls: "" });
        }

        el.innerHTML = cards.map(function (c) {
            return '<div class="summary-item"><span class="summary-label">' + esc(c.label) +
                '</span><span class="summary-value ' + c.cls + '">' + c.value +
                '</span><span class="summary-note">' + esc(c.note) + "</span></div>";
        }).join("");
        el.style.display = "flex";
    }

    function renderInstitutional(rows) {
        var tbody = document.querySelector("#instTable tbody");
        tbody.innerHTML = rows.map(function (r) {
            var isTotal = r.name.indexOf("合計") === 0;
            return "<tr" + (isTotal ? ' class="highlight"' : "") + "><td class='text-left'>" + esc(r.name) + "</td>" +
                "<td>" + fmt(r.buy / 1e8, 1) + "</td>" +
                "<td>" + fmt(r.sell / 1e8, 1) + "</td>" +
                '<td class="' + colorClass(r.net) + '">' + signed(r.net / 1e8, 1) + "</td></tr>";
        }).join("");
    }

    function sectorItem(s) {
        return '<li class="list-group-item d-flex justify-content-between align-items-center">' +
            "<span>" + esc(s.name.replace("類指數", "")) + "</span>" +
            '<span class="' + colorClass(s.changePct) + '">' + signed(s.changePct, 2) + "%</span></li>";
    }

    function renderSectors(sectors) {
        var up = sectors.filter(function (s) { return s.changePct > 0; }).slice(0, 6);
        var down = sectors.filter(function (s) { return s.changePct < 0; }).slice(-6).reverse();
        document.getElementById("sectorUp").innerHTML =
            up.length ? up.map(sectorItem).join("") : '<li class="list-group-item text-muted">今日無上漲類股</li>';
        document.getElementById("sectorDown").innerHTML =
            down.length ? down.map(sectorItem).join("") : '<li class="list-group-item text-muted">今日無下跌類股</li>';
    }

    function renderRank(tableId, rows, cls) {
        var tbody = document.querySelector("#" + tableId + " tbody");
        if (!rows || !rows.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-muted text-center">尚無資料</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(function (r) {
            return "<tr><td>" + stockLink(r.code) + "</td><td class='text-left'>" + esc(r.name) + "</td>" +
                '<td class="text-right ' + cls + '">' + fmt(Math.abs(r.net) / 1000, 0) + "</td></tr>";
        }).join("");
    }

    function renderHot(stocks) {
        var tbody = document.querySelector("#hotTable tbody");
        tbody.innerHTML = stocks.map(function (s) {
            var cls = colorClass(s.change);
            return "<tr><td>" + s.rank + "</td><td>" + stockLink(s.code) + "</td><td>" + esc(s.name) + "</td>" +
                "<td>" + fmt(s.close, 2) + "</td>" +
                '<td class="' + cls + '">' + signed(s.change, 2) + "</td>" +
                '<td class="' + cls + '">' + signed(s.changePct, 2) + "%</td>" +
                "<td>" + fmt(Math.round((s.volume || 0) / 1000), 0) + "</td>" +
                "<td>" + fmt(s.trades, 0) + "</td></tr>";
        }).join("");
    }

    /* ---------- 籌碼乾淨度 ---------- */

    // 融資增減對照大盤漲跌的簡易判讀（僅供參考的經驗法則）
    function chipVerdict(idxPct, finChg, finChgPct) {
        if (idxPct === null || idxPct === undefined || finChg === null) return null;
        if (idxPct > 0 && finChg <= 0) {
            return { label: "乾淨 ✨", note: "指數上漲、融資反減：上漲不靠散戶槓桿，籌碼安定" };
        }
        if (idxPct > 0 && finChgPct <= idxPct) {
            return { label: "中性偏乾淨 🙂", note: "融資增幅低於指數漲幅，槓桿追價不明顯" };
        }
        if (idxPct > 0) {
            return { label: "偏髒 ⚠️", note: "融資增速超過指數漲幅：散戶追價開槓桿，留意回檔賣壓" };
        }
        if (finChg <= 0) {
            return { label: "降溫中 🧹", note: "指數下跌、融資同步退場：槓桿籌碼正在清洗" };
        }
        return { label: "警戒 🚨", note: "指數下跌、融資逆勢增加：留意融資斷頭引發多殺多" };
    }

    function renderChips(chips, taiex, dataDate) {
        var margin = chips && chips.margin;
        var fut = (chips && chips.futures) || {};
        var history = (chips && chips.history) || [];
        var el = document.getElementById("chipSummary");
        var cards = [];

        if (margin && margin.finValue !== null) {
            var finChg = margin.finValuePrev ? margin.finValue - margin.finValuePrev : null;   // 仟元
            var finChgPct = margin.finValuePrev ? finChg / margin.finValuePrev * 100 : null;
            var verdict = chipVerdict(taiex ? taiex.changePct : null, finChg, finChgPct);
            if (verdict) {
                cards.push({ label: "籌碼乾淨度判讀", value: verdict.label, note: verdict.note, cls: "" });
            }
            cards.push({
                label: "融資餘額（散戶槓桿水位）",
                value: fmt(margin.finValue / 1e5, 0) + " 億",
                note: finChg === null ? "—" : "較前日 " + signed(finChg / 1e5, 1) + " 億（" + signed(finChgPct, 2) + "%）",
                cls: colorClass(finChg)
            });
            var shortChg = margin.shortUnitsPrev !== null && margin.shortUnits !== null
                ? margin.shortUnits - margin.shortUnitsPrev : null;
            cards.push({
                label: "融券餘額（借券放空）",
                value: fmt(margin.shortUnits, 0) + " 張",
                note: shortChg === null ? "—" : "較前日 " + signed(shortChg, 0) + " 張",
                cls: colorClass(shortChg)
            });
        }

        // 外資台指期（大台）淨未平倉
        var rows = fut.rows || [];
        var fBig = null;
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].contract === "臺股期貨" && rows[i].item.indexOf("外資") === 0) { fBig = rows[i]; break; }
        }
        if (fBig) {
            cards.push({
                label: "外資台指期淨未平倉",
                value: signed(fBig.netOI, 0) + " 口",
                note: "做多 " + fmt(fBig.longOI, 0) + " 口／做空 " + fmt(fBig.shortOI, 0) + " 口",
                cls: colorClass(fBig.netOI)
            });
        }

        if (cards.length) {
            el.innerHTML = cards.map(function (c) {
                return '<div class="summary-item"><span class="summary-label">' + esc(c.label) +
                    '</span><span class="summary-value ' + c.cls + '">' + esc(c.value) +
                    '</span><span class="summary-note">' + esc(c.note) + "</span></div>";
            }).join("");
            el.style.display = "flex";
        }

        // 融資餘額近期趨勢（5 / 20 日增減，資料不足就顯示可用區間）
        var noteEl = document.getElementById("chipTrendNote");
        if (noteEl && history.length > 1) {
            var last = history[history.length - 1];
            var parts = [];
            [[5, "近 5 日"], [20, "近 20 日"]].forEach(function (p) {
                if (history.length > p[0]) {
                    var base = history[history.length - 1 - p[0]];
                    parts.push(p[1] + "融資 " + signed((last.fin - base.fin) / 1e5, 1) + " 億");
                }
            });
            var vals = history.map(function (h) { return h.fin / 1e5; });
            parts.push("近 " + history.length + " 個交易日區間 " +
                fmt(Math.min.apply(null, vals), 0) + " ～ " + fmt(Math.max.apply(null, vals), 0) + " 億");
            noteEl.textContent = "融資餘額趨勢：" + parts.join("；") + "。";
        }

        // 期貨未平倉表
        var tbody = document.querySelector("#futOiTable tbody");
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center">尚無期貨部位資料</td></tr>';
            return;
        }
        var CONTRACT_ORDER = ["臺股期貨", "小型臺指期貨", "微型臺指期貨"];
        var ITEM_ORDER = ["外資及陸資", "外資", "投信", "自營商"];
        rows = rows.slice().sort(function (a, b) {
            var c = CONTRACT_ORDER.indexOf(a.contract) - CONTRACT_ORDER.indexOf(b.contract);
            return c !== 0 ? c : ITEM_ORDER.indexOf(a.item) - ITEM_ORDER.indexOf(b.item);
        });
        var prevContract = null;
        tbody.innerHTML = rows.map(function (r) {
            var first = r.contract !== prevContract;
            prevContract = r.contract;
            var isForeign = r.item.indexOf("外資") === 0;
            return "<tr" + (isForeign ? ' class="highlight"' : "") + ">" +
                "<td class='text-left'>" + (first ? esc(r.contract) : "") + "</td>" +
                "<td>" + esc(r.item) + "</td>" +
                "<td>" + fmt(r.longOI, 0) + "</td>" +
                "<td>" + fmt(r.shortOI, 0) + "</td>" +
                '<td class="' + colorClass(r.netOI) + '">' + signed(r.netOI, 0) + "</td>" +
                '<td class="' + colorClass(r.netTrade) + '">' + signed(r.netTrade, 0) + "</td></tr>";
        }).join("");

        var futNote = document.getElementById("futNote");
        if (futNote && fut.date && fut.date !== dataDate) {
            futNote.textContent = "期貨部位資料日期：" + dateLabel(fut.date) + "（期交所公布時間與證交所不同）。資料來源：臺灣期貨交易所 OpenAPI。";
        }
    }

    function renderFx(fx) {
        var tbody = document.querySelector("#fxTable tbody");
        var history = (fx && fx.history) || [];
        var latest = fx && fx.latest;
        if (!latest) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center">尚無匯率資料</td></tr>';
            return;
        }
        var prev = null;
        for (var i = history.length - 1; i >= 0; i--) {
            if (history[i].date !== latest.date) { prev = history[i]; break; }
        }
        var recent = history.slice(-30);

        tbody.innerHTML = FX_CURRENCIES.map(function (c) {
            var cur = latest[c.key];
            var diff = prev && prev[c.key] ? cur - prev[c.key] : null;
            var vals = recent.map(function (h) { return h[c.key]; }).filter(function (v) { return v; });
            var range = vals.length > 1
                ? fmt(Math.min.apply(null, vals), c.digits) + " ～ " + fmt(Math.max.apply(null, vals), c.digits)
                : "—";
            return "<tr><td class='text-left'>" + esc(c.label) + "</td>" +
                "<td>" + fmt(cur, c.digits) + "</td>" +
                '<td class="' + colorClass(diff) + '">' + (diff === null ? "—" : signed(diff, c.digits)) + "</td>" +
                "<td>" + range + "</td></tr>";
        }).join("");

        var noteEl = document.getElementById("fxNote");
        if (noteEl && latest.date) noteEl.textContent = "匯率資料日期：" + latest.date + "。";
    }

    // 頁面載入時再抓一次即時匯率，比每日排程更新鮮（失敗就沿用檔案資料）
    function refreshFxLive(fx) {
        fetch(FX_LIVE_URL).then(function (r) { return r.json(); }).then(function (d) {
            if (!d || d.result !== "success" || !d.rates || !d.rates.TWD) return;
            var r = d.rates, twd = r.TWD;
            // 以台北時間（UTC+8）為準，避免下午時段誤判日期
            var taipeiDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
            fx.latest = {
                date: taipeiDate,
                USDTWD: twd,
                JPYTWD: twd / r.JPY,
                EURTWD: twd / r.EUR,
                CNYTWD: twd / r.CNY,
                HKDTWD: twd / r.HKD
            };
            renderFx(fx);
        }).catch(function () { /* 保留原資料 */ });
    }

    function init() {
        var status = document.getElementById("marketStatus");
        fetch("./data/market.json").then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        }).then(function (m) {
            status.textContent = "資料日期：" + dateLabel(m.dataDate) +
                "（每個交易日收盤後自動更新，最後更新 " + (m.updatedAt || "").replace("T", " ").slice(0, 16) + "）";
            renderSummary(m);
            renderInstitutional(m.institutional || []);
            renderSectors(m.sectors || []);
            renderRank("foreignBuyTable", m.foreignBuy, "val-up");
            renderRank("foreignSellTable", m.foreignSell, "val-down");
            renderRank("trustBuyTable", m.trustBuy, "val-up");
            renderChips(m.chips || {}, m.taiex, m.dataDate);
            renderHot(m.hotStocks || []);
            renderFx(m.fx || {});
            if (m.fx) refreshFxLive(m.fx);
            // 資料渲染後版面高度改變，帶錨點進來時重新定位
            if (location.hash) {
                var target = document.getElementById(location.hash.slice(1));
                if (target) target.scrollIntoView();
            }
        }).catch(function (e) {
            status.textContent = "資料載入失敗，請稍後再試。（" + e.message + "）";
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
