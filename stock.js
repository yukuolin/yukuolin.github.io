/* 個股查詢頁：讀取 data/stocks.json（每日更新），渲染盤後資訊 + TradingView 線圖 + 新聞 */
(function () {
    "use strict";

    // stocks.json 每檔欄位順序
    var F = { name: 0, market: 1, close: 2, change: 3, open: 4, high: 5, low: 6,
              volume: 7, trades: 8, value: 9, pe: 10, pb: 11, yield: 12,
              foreign: 13, trust: 14, dealer: 15 };

    var DB = null;          // { date, updatedAt, stocks: {code: [...] } }
    var currentCode = null;

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

    function card(label, value, note, cls) {
        return '<div class="summary-item"><span class="summary-label">' + esc(label) +
            '</span><span class="summary-value ' + (cls || "") + '">' + value +
            '</span><span class="summary-note">' + esc(note || "") + "</span></div>";
    }

    /* ---------- 搜尋與建議 ---------- */

    function suggest(q) {
        var box = document.getElementById("stockSuggest");
        q = q.trim().toUpperCase();
        if (!DB || !q) { box.style.display = "none"; return; }
        var hits = [];
        for (var code in DB.stocks) {
            var name = DB.stocks[code][F.name];
            var score = -1;
            if (code === q) score = 0;
            else if (code.indexOf(q) === 0) score = 1;
            else if (name.toUpperCase().indexOf(q) !== -1) score = 2;
            if (score >= 0) hits.push([score, code, name]);
            if (hits.length > 200) break;
        }
        hits.sort(function (a, b) { return a[0] - b[0] || (a[1] < b[1] ? -1 : 1); });
        hits = hits.slice(0, 10);
        if (!hits.length) { box.style.display = "none"; return; }
        box.innerHTML = hits.map(function (h) {
            var mk = DB.stocks[h[1]][F.market] === "otc" ? "上櫃" : "上市";
            return '<button type="button" class="suggest-item" data-code="' + esc(h[1]) + '">' +
                "<strong>" + esc(h[1]) + "</strong> " + esc(h[2]) +
                '<span class="suggest-mk">' + mk + "</span></button>";
        }).join("");
        box.style.display = "block";
    }

    function doSearch(q) {
        if (!DB) return;
        q = (q || document.getElementById("stockInput").value).trim().toUpperCase();
        if (!q) return;
        var code = null;
        var lead = q.match(/^([0-9][0-9A-Z]{3,5})\b/); // 「2330 台積電」形式取開頭代號
        if (DB.stocks[q]) {
            code = q;
        } else if (lead && DB.stocks[lead[1]]) {
            code = lead[1];
        } else {
            for (var c in DB.stocks) {
                if (DB.stocks[c][F.name].toUpperCase() === q) { code = c; break; }
            }
            if (!code) {
                for (var c2 in DB.stocks) {
                    if (DB.stocks[c2][F.name].toUpperCase().indexOf(q) !== -1) { code = c2; break; }
                }
            }
        }
        var status = document.getElementById("stockStatus");
        if (!code) {
            status.textContent = "找不到「" + q + "」，請確認代號或名稱（支援上市／上櫃）。";
            return;
        }
        render(code);
    }

    /* ---------- 渲染 ---------- */

    function render(code) {
        var s = DB.stocks[code];
        if (!s) return;
        currentCode = code;
        document.getElementById("stockSuggest").style.display = "none";
        document.getElementById("stockInput").value = code + " " + s[F.name];
        document.getElementById("stockIntro").style.display = "none";
        document.getElementById("stockResult").style.display = "block";
        document.getElementById("stockStatus").textContent =
            "資料日期：" + dateLabel(DB.date) + "（每個交易日收盤後更新）";

        var isOtc = s[F.market] === "otc";
        document.getElementById("stockTitle").textContent = s[F.name] + "（" + code + "）";
        document.getElementById("stockMarket").textContent = isOtc ? "上櫃" : "上市";

        var close = s[F.close], change = s[F.change];
        var prev = (close !== null && change !== null) ? close - change : null;
        var pct = prev ? change / prev * 100 : null;
        var cls = colorClass(change);
        document.getElementById("stockPrice").textContent = fmt(close, 2);
        document.getElementById("stockPrice").className = "stock-price " + cls;
        document.getElementById("stockChange").textContent =
            signed(change, 2) + "（" + signed(pct, 2) + "%）";
        document.getElementById("stockChange").className = "stock-change " + cls;

        document.getElementById("stockOhlc").innerHTML =
            card("開盤", fmt(s[F.open], 2), "") +
            card("最高", fmt(s[F.high], 2), "", "val-up") +
            card("最低", fmt(s[F.low], 2), "", "val-down") +
            card("成交量", fmt(Math.round((s[F.volume] || 0) / 1000), 0), "張") +
            card("成交金額", fmt((s[F.value] || 0) / 1e8, 2), "億元") +
            card("成交筆數", fmt(s[F.trades], 0), "筆");

        document.getElementById("stockValuation").innerHTML =
            card("本益比", s[F.pe] ? fmt(s[F.pe], 2) : "—", "PE") +
            card("股價淨值比", s[F.pb] ? fmt(s[F.pb], 2) : "—", "PB") +
            card("殖利率", s[F.yield] ? fmt(s[F.yield], 2) + "%" : "—", "現金股利");

        var instEl = document.getElementById("stockInst");
        var noteEl = document.getElementById("stockInstNote");
        if (s[F.foreign] === null && s[F.trust] === null && s[F.dealer] === null) {
            instEl.innerHTML = "";
            noteEl.textContent = isOtc
                ? "上櫃個股法人買賣超請至櫃買中心查詢。"
                : "本檔今日無三大法人買賣超資料。";
        } else {
            instEl.innerHTML =
                card("外資", signed((s[F.foreign] || 0) / 1000, 0), "買賣超（張）", colorClass(s[F.foreign])) +
                card("投信", signed((s[F.trust] || 0) / 1000, 0), "買賣超（張）", colorClass(s[F.trust])) +
                card("自營商", signed((s[F.dealer] || 0) / 1000, 0), "買賣超（張）", colorClass(s[F.dealer]));
            noteEl.textContent = "正數（紅）為法人買超、負數（綠）為賣超；單位為張，未滿一張以四捨五入計。";
        }

        renderChart(code, isOtc);
        renderNews(code, s[F.name], isOtc);

        try {
            history.replaceState(null, "", "?code=" + encodeURIComponent(code));
        } catch (e) { /* file:// 等環境忽略 */ }
        document.title = s[F.name] + "（" + code + "）盤後資訊、技術線圖與新聞 | 台股個股查詢";
    }

    /* ---------- 技術線圖（Lightweight Charts + Yahoo Finance 日線） ----------
       台股符號不開放 TradingView 內嵌 widget，改用其開源圖表庫自繪。 */

    var UP = "#d6414b", DOWN = "#1d9e6f";           // 台股慣例：紅漲綠跌
    var chartRange = "6mo";
    var chartObj = null;

    function chartMsg(html) {
        var el = document.getElementById("tvChartMsg");
        el.innerHTML = html || "";
        el.style.display = html ? "flex" : "none";
    }

    function destroyChart() {
        if (chartObj) { try { chartObj.remove(); } catch (e) {} chartObj = null; }
        document.getElementById("tvChart").innerHTML = "";
    }

    function yahooSymbol(code, isOtc) {
        return code + (isOtc ? ".TWO" : ".TW");
    }

    function fetchCandles(code, isOtc, range) {
        var url = "https://query1.finance.yahoo.com/v8/finance/chart/" +
            encodeURIComponent(yahooSymbol(code, isOtc)) +
            "?range=" + range + "&interval=1d&events=div";
        // 先直連（若對方有開 CORS），失敗再走公共代理
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        }).catch(function () {
            return fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(url))
                .then(function (r) {
                    if (!r.ok) throw new Error("HTTP " + r.status);
                    return r.json();
                });
        }).then(function (d) {
            var res = d && d.chart && d.chart.result && d.chart.result[0];
            if (!res || !res.timestamp) throw new Error("no data");
            var q = res.indicators.quote[0];
            var candles = [], volumes = [];
            for (var i = 0; i < res.timestamp.length; i++) {
                if (q.close[i] == null || q.open[i] == null || q.high[i] == null || q.low[i] == null) continue;
                var t = res.timestamp[i];
                candles.push({ time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] });
                volumes.push({
                    time: t, value: q.volume[i] || 0,
                    color: q.close[i] >= q.open[i] ? "rgba(214,65,75,0.35)" : "rgba(29,158,111,0.35)"
                });
            }
            return { candles: candles, volumes: volumes };
        });
    }

    function movingAvg(candles, n) {
        var out = [], sum = 0;
        for (var i = 0; i < candles.length; i++) {
            sum += candles[i].close;
            if (i >= n) sum -= candles[i - n].close;
            if (i >= n - 1) out.push({ time: candles[i].time, value: sum / n });
        }
        return out;
    }

    function renderChart(code, isOtc) {
        var link = document.getElementById("tvExternalLink");
        link.href = "https://tw.tradingview.com/chart/?symbol=" +
            encodeURIComponent((isOtc ? "TPEX:" : "TWSE:") + code);

        destroyChart();
        if (typeof LightweightCharts === "undefined") {
            chartMsg('<span>圖表元件載入失敗，請重新整理頁面。</span>');
            return;
        }
        chartMsg('<span class="text-muted">線圖載入中…</span>');

        var myCode = code;
        fetchCandles(code, isOtc, chartRange).then(function (data) {
            if (currentCode !== myCode) return;
            chartMsg("");
            destroyChart();
            var el = document.getElementById("tvChart");
            chartObj = LightweightCharts.createChart(el, {
                autoSize: true,
                layout: { background: { color: "transparent" }, textColor: "#6b7486",
                          fontFamily: "'Noto Sans TC', Arial, sans-serif" },
                grid: { vertLines: { color: "#eef1f7" }, horzLines: { color: "#eef1f7" } },
                rightPriceScale: { borderColor: "#e3e8f0" },
                timeScale: { borderColor: "#e3e8f0", timeVisible: false },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
                localization: { locale: "zh-TW" }
            });
            var candleSeries = chartObj.addCandlestickSeries({
                upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false
            });
            candleSeries.setData(data.candles);
            var volSeries = chartObj.addHistogramSeries({
                priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false
            });
            chartObj.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
            volSeries.setData(data.volumes);
            chartObj.addLineSeries({ color: "#f5b301", lineWidth: 2, priceLineVisible: false, lastValueVisible: false })
                .setData(movingAvg(data.candles, 5));
            chartObj.addLineSeries({ color: "#1e3a5f", lineWidth: 2, priceLineVisible: false, lastValueVisible: false })
                .setData(movingAvg(data.candles, 20));
            chartObj.timeScale().fitContent();
        }).catch(function () {
            if (currentCode !== myCode) return;
            chartMsg('<span>線圖資料暫時無法取得。<a target="_blank" rel="noopener" href="' +
                esc(link.href) + '">改在 TradingView 查看 →</a></span>');
        });
    }

    function initChartRangeButtons() {
        var group = document.querySelector(".chart-ranges");
        if (!group) return;
        group.addEventListener("click", function (e) {
            var btn = e.target.closest("[data-range]");
            if (!btn || !currentCode) return;
            chartRange = btn.getAttribute("data-range");
            group.querySelectorAll(".btn").forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            renderChart(currentCode, DB.stocks[currentCode][F.market] === "otc");
        });
    }

    /* ---------- 新聞（Google News RSS，經 CORS 代理） ---------- */

    function newsFallbackLinks(code, name, isOtc) {
        var yahooSuffix = isOtc ? ".TWO" : ".TW";
        return '<a class="btn btn-success btn-sm mr-2 mb-2" target="_blank" rel="noopener" href="https://news.google.com/search?q=' +
            encodeURIComponent(name) + '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant">Google 新聞</a>' +
            '<a class="btn btn-success btn-sm mr-2 mb-2" target="_blank" rel="noopener" href="https://tw.stock.yahoo.com/quote/' +
            encodeURIComponent(code + yahooSuffix) + '/news">Yahoo 股市新聞</a>' +
            '<a class="btn btn-success btn-sm mb-2" target="_blank" rel="noopener" href="https://www.cnyes.com/search/news?keyword=' +
            encodeURIComponent(name) + '">鉅亨網</a>';
    }

    function timeAgo(dateStr) {
        var t = new Date(dateStr).getTime();
        if (isNaN(t)) return "";
        var mins = Math.round((Date.now() - t) / 60000);
        if (mins < 60) return mins + " 分鐘前";
        var hrs = Math.round(mins / 60);
        if (hrs < 24) return hrs + " 小時前";
        return Math.round(hrs / 24) + " 天前";
    }

    function renderNews(code, name, isOtc) {
        var box = document.getElementById("stockNews");
        var links = document.getElementById("stockNewsLinks");
        box.innerHTML = '<p class="text-muted">新聞載入中…</p>';
        links.innerHTML = newsFallbackLinks(code, name, isOtc);

        var myCode = code;
        var rss = "https://news.google.com/rss/search?q=" + encodeURIComponent('"' + name + '"') +
            "&hl=zh-TW&gl=TW&ceid=TW:zh-Hant";
        var proxied = "https://api.allorigins.win/raw?url=" + encodeURIComponent(rss);

        var timer = setTimeout(function () {
            if (currentCode === myCode) {
                box.innerHTML = '<p class="text-muted">新聞載入逾時，請改用下方連結查看。</p>';
            }
        }, 12000);

        fetch(proxied).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.text();
        }).then(function (xml) {
            clearTimeout(timer);
            if (currentCode !== myCode) return; // 使用者已查別檔
            var doc = new DOMParser().parseFromString(xml, "text/xml");
            var items = doc.querySelectorAll("item");
            if (!items.length) {
                box.innerHTML = '<p class="text-muted">目前沒有找到相關新聞，請改用下方連結搜尋。</p>';
                return;
            }
            var html = "";
            for (var i = 0; i < Math.min(items.length, 8); i++) {
                var it = items[i];
                var title = (it.querySelector("title") || {}).textContent || "";
                var link = (it.querySelector("link") || {}).textContent || "#";
                var pub = (it.querySelector("pubDate") || {}).textContent || "";
                var srcEl = it.getElementsByTagName("source")[0];
                var src = srcEl ? srcEl.textContent : "";
                html += '<a class="news-item" target="_blank" rel="noopener" href="' + esc(link) + '">' +
                    '<span class="news-title">' + esc(title) + "</span>" +
                    '<span class="news-meta">' + esc(src) + (pub ? "・" + timeAgo(pub) : "") + "</span></a>";
            }
            box.innerHTML = html;
        }).catch(function () {
            clearTimeout(timer);
            if (currentCode !== myCode) return;
            box.innerHTML = '<p class="text-muted">新聞來源暫時無法連線，請改用下方連結查看。</p>';
        });
    }

    /* ---------- 初始化 ---------- */

    function init() {
        var input = document.getElementById("stockInput");
        var status = document.getElementById("stockStatus");

        fetch("./data/stocks.json").then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        }).then(function (db) {
            DB = db;
            status.textContent = "共 " + Object.keys(db.stocks).length +
                " 檔上市／上櫃證券，資料日期：" + dateLabel(db.date);
            var params = new URLSearchParams(location.search);
            var code = (params.get("code") || "").trim().toUpperCase();
            if (code && DB.stocks[code]) render(code);
            else if (code) status.textContent = "找不到代號「" + code + "」。";
        }).catch(function (e) {
            status.textContent = "股票清單載入失敗，請稍後再試。（" + e.message + "）";
        });

        input.addEventListener("input", function () { suggest(input.value); });
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); doSearch(); }
        });
        document.getElementById("stockSearchBtn").addEventListener("click", function () { doSearch(); });
        document.getElementById("stockSuggest").addEventListener("click", function (e) {
            var btn = e.target.closest(".suggest-item");
            if (btn) render(btn.getAttribute("data-code"));
        });
        document.addEventListener("click", function (e) {
            if (!e.target.closest(".stock-search-wrap")) {
                document.getElementById("stockSuggest").style.display = "none";
            }
        });
        initChartRangeButtons();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
