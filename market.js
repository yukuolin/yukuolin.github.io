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
            return "<tr><td>" + esc(r.code) + "</td><td class='text-left'>" + esc(r.name) + "</td>" +
                '<td class="text-right ' + cls + '">' + fmt(Math.abs(r.net) / 1000, 0) + "</td></tr>";
        }).join("");
    }

    function renderHot(stocks) {
        var tbody = document.querySelector("#hotTable tbody");
        tbody.innerHTML = stocks.map(function (s) {
            var cls = colorClass(s.change);
            return "<tr><td>" + s.rank + "</td><td>" + esc(s.code) + "</td><td>" + esc(s.name) + "</td>" +
                "<td>" + fmt(s.close, 2) + "</td>" +
                '<td class="' + cls + '">' + signed(s.change, 2) + "</td>" +
                '<td class="' + cls + '">' + signed(s.changePct, 2) + "%</td>" +
                "<td>" + fmt(Math.round((s.volume || 0) / 1000), 0) + "</td>" +
                "<td>" + fmt(s.trades, 0) + "</td></tr>";
        }).join("");
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
            renderHot(m.hotStocks || []);
            renderFx(m.fx || {});
            if (m.fx) refreshFxLive(m.fx);
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
