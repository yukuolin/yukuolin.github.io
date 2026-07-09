/* 個股查詢頁：讀取 data/stocks.json（每日更新），渲染盤後資訊 + 技術線圖 + 新聞連結 */
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
        renderTA(code);
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

    // range 代碼 → 往回推的月數
    var RANGE_MONTHS = { "3mo": 3, "6mo": 6, "1y": 12, "3y": 36 };
    var candleCache = {};   // code|range → 資料（技術分析與線圖共用，切換區間不重抓）

    function fetchCandles(code, range) {
        var key = code + "|" + range;
        if (candleCache[key]) return Promise.resolve(candleCache[key]);
        return fetchCandlesRemote(code, range).then(function (data) {
            candleCache[key] = data;
            return data;
        });
    }

    function fetchCandlesRemote(code, range) {
        var d = new Date();
        d.setMonth(d.getMonth() - (RANGE_MONTHS[range] || 6));
        var start = d.toISOString().slice(0, 10);
        // FinMind 開放 API：台股（上市＋上櫃）日線，有開 CORS 可直連
        var url = "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice" +
            "&data_id=" + encodeURIComponent(code) + "&start_date=" + start;
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        }).then(function (d) {
            var rows = d && d.data;
            if (!rows || !rows.length) throw new Error("no data");
            var candles = [], volumes = [];
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                if (r.close == null || r.open == null || !r.close) continue;
                candles.push({ time: r.date, open: r.open, high: r.max, low: r.min, close: r.close });
                volumes.push({
                    time: r.date, value: r.Trading_Volume || 0,
                    color: r.close >= r.open ? "rgba(214,65,75,0.35)" : "rgba(29,158,111,0.35)"
                });
            }
            if (!candles.length) throw new Error("empty");
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
        fetchCandles(code, chartRange).then(function (data) {
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

    /* ---------- 技術分析結論 ---------- */

    function sma(vals, n, endIdx) {
        if (endIdx === undefined) endIdx = vals.length - 1;
        if (endIdx + 1 < n) return null;
        var sum = 0;
        for (var i = endIdx - n + 1; i <= endIdx; i++) sum += vals[i];
        return sum / n;
    }

    function emaSeries(vals, n) {
        var k = 2 / (n + 1), out = [], prev;
        for (var i = 0; i < vals.length; i++) {
            prev = (i === 0) ? vals[0] : vals[i] * k + prev * (1 - k);
            out.push(prev);
        }
        return out;
    }

    function calcRSI(closes, n) {
        if (closes.length < n + 1) return null;
        var avgG = 0, avgL = 0, i, diff;
        for (i = 1; i <= n; i++) {
            diff = closes[i] - closes[i - 1];
            if (diff > 0) avgG += diff; else avgL -= diff;
        }
        avgG /= n; avgL /= n;
        for (i = n + 1; i < closes.length; i++) {
            diff = closes[i] - closes[i - 1];
            avgG = (avgG * (n - 1) + Math.max(diff, 0)) / n;
            avgL = (avgL * (n - 1) + Math.max(-diff, 0)) / n;
        }
        if (avgL === 0) return 100;
        return 100 - 100 / (1 + avgG / avgL);
    }

    function calcKD(candles) {
        if (candles.length < 9) return null;
        var K = 50, D = 50;
        for (var i = 8; i < candles.length; i++) {
            var hi = -Infinity, lo = Infinity;
            for (var j = i - 8; j <= i; j++) {
                if (candles[j].high > hi) hi = candles[j].high;
                if (candles[j].low < lo) lo = candles[j].low;
            }
            var rsv = (hi === lo) ? 50 : (candles[i].close - lo) / (hi - lo) * 100;
            K = K * 2 / 3 + rsv / 3;
            D = D * 2 / 3 + K / 3;
        }
        return { k: K, d: D };
    }

    function stddev(vals, n) {
        var m = sma(vals, n);
        if (m === null) return null;
        var s = 0;
        for (var i = vals.length - n; i < vals.length; i++) s += (vals[i] - m) * (vals[i] - m);
        return Math.sqrt(s / n);
    }

    // 每列：{name, value, judge, score(-1/0/1), cls}
    function computeTA(candles) {
        var rows = [];
        var closes = candles.map(function (c) { return c.close; });
        var n = closes.length;
        var last = closes[n - 1];
        var prevClose = n > 1 ? closes[n - 2] : last;
        var priceUp = last >= prevClose;

        function row(name, value, judge, score) {
            rows.push({ name: name, value: value, judge: judge, score: score,
                        cls: score > 0 ? "ta-bull" : (score < 0 ? "ta-bear" : "ta-flat") });
        }

        // 1. 均線排列
        var ma5 = sma(closes, 5), ma20 = sma(closes, 20), ma60 = sma(closes, 60);
        if (ma5 !== null && ma20 !== null && ma60 !== null) {
            var v = "MA5 " + fmt(ma5, 2) + "｜MA20 " + fmt(ma20, 2) + "｜MA60 " + fmt(ma60, 2);
            if (ma5 > ma20 && ma20 > ma60) row("均線排列", v, "多頭排列（短中長期均線向上）", 1);
            else if (ma5 < ma20 && ma20 < ma60) row("均線排列", v, "空頭排列（短中長期均線向下）", -1);
            else row("均線排列", v, "均線糾結，方向未明", 0);
        } else {
            row("均線排列", "資料不足", "上市時間較短，無法計算 60 日均線", 0);
        }

        // 2. 月線（MA20）位置
        if (ma20 !== null) {
            row("月線位置", "收盤 " + fmt(last, 2) + " vs MA20 " + fmt(ma20, 2),
                last >= ma20 ? "站上月線，短波段偏多" : "跌破月線，短波段偏空",
                last >= ma20 ? 1 : -1);
        }

        // 3. KD
        var kd = calcKD(candles);
        if (kd) {
            var kdNote = kd.k > kd.d ? "K 在 D 之上（偏多）" : "K 在 D 之下（偏空）";
            if (kd.k >= 80) kdNote += "，高檔過熱留意鈍化";
            else if (kd.k <= 20) kdNote += "，低檔超賣留意反彈";
            row("KD（9,3,3）", "K " + fmt(kd.k, 1) + "／D " + fmt(kd.d, 1), kdNote, kd.k > kd.d ? 1 : -1);
        }

        // 4. RSI
        var rsi = calcRSI(closes, 14);
        if (rsi !== null) {
            var rsiNote = rsi >= 50 ? "位於 50 之上（偏多）" : "位於 50 之下（偏空）";
            if (rsi >= 70) rsiNote += "，已達過熱區";
            else if (rsi <= 30) rsiNote += "，已達超賣區";
            row("RSI（14）", fmt(rsi, 1), rsiNote, rsi >= 50 ? 1 : -1);
        }

        // 5. MACD
        if (n >= 35) {
            var e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
            var dif = closes.map(function (_, i) { return e12[i] - e26[i]; });
            var sig = emaSeries(dif, 9);
            var difV = dif[n - 1], sigV = sig[n - 1], osc = difV - sigV;
            var macdNote = (difV > sigV ? "DIF 在訊號線上（偏多）" : "DIF 在訊號線下（偏空）") +
                (difV >= 0 ? "，零軸之上多方主導" : "，零軸之下空方主導");
            row("MACD（12,26,9）",
                "DIF " + fmt(difV, 2) + "／訊號 " + fmt(sigV, 2) + "／柱 " + signed(osc, 2),
                macdNote, difV > sigV ? 1 : -1);
        }

        // 6. 布林通道
        var sd = stddev(closes, 20);
        if (ma20 !== null && sd !== null) {
            var upper = ma20 + 2 * sd, lower = ma20 - 2 * sd;
            var pos = (upper === lower) ? 50 : (last - lower) / (upper - lower) * 100;
            var bbNote;
            if (pos > 100) bbNote = "突破上緣，強勢但過熱";
            else if (pos >= 50) bbNote = "位於中軌之上（偏多）";
            else if (pos >= 0) bbNote = "位於中軌之下（偏空）";
            else bbNote = "跌破下緣，弱勢但超跌";
            row("布林通道（20,2）",
                fmt(lower, 2) + " ～ " + fmt(upper, 2) + "，價格位於 " + fmt(pos, 0) + "%",
                bbNote, pos >= 50 ? 1 : -1);
        }

        // 7. 20 日乖離率（過熱/超跌警示，不計分）
        if (ma20 !== null) {
            var bias = (last - ma20) / ma20 * 100;
            var biasNote;
            if (bias >= 8) biasNote = "正乖離過大，短線留意回檔";
            else if (bias <= -8) biasNote = "負乖離過大，短線可能反彈";
            else biasNote = "乖離正常範圍（±8% 內）";
            row("20 日乖離率", signed(bias, 2) + "%", biasNote, 0);
        }

        // 8. 量能（價量配合）
        if (n >= 7) {
            var vols = candles.map(function (c) { return c.volume; });
            var avg5 = 0;
            for (var i = n - 6; i <= n - 2; i++) avg5 += vols[i];
            avg5 /= 5;
            var vRatio = avg5 ? vols[n - 1] / avg5 : 1;
            var vLabel = vRatio >= 1.5 ? "爆量" : (vRatio >= 1.1 ? "量增" : (vRatio <= 0.7 ? "量縮" : "量平"));
            var vScore = 0, vNote;
            if (vRatio >= 1.1 && priceUp) { vScore = 1; vNote = vLabel + "上漲，價量配合偏多"; }
            else if (vRatio >= 1.1 && !priceUp) { vScore = -1; vNote = vLabel + "下跌，賣壓沉重偏空"; }
            else if (vRatio <= 0.7 && !priceUp) { vNote = "量縮下跌，觀望氣氛濃"; }
            else if (vRatio <= 0.7 && priceUp) { vNote = "量縮上漲，追價意願不足"; }
            else { vNote = "量能持平，無明顯訊號"; }
            row("量能", "今日量為 5 日均量的 " + fmt(vRatio * 100, 0) + "%", vNote, vScore);
        }

        // 9. 一年高低點位置（參考，不計分）
        var hi52 = -Infinity, lo52 = Infinity;
        for (var h = 0; h < candles.length; h++) {
            if (candles[h].high > hi52) hi52 = candles[h].high;
            if (candles[h].low < lo52) lo52 = candles[h].low;
        }
        if (isFinite(hi52) && isFinite(lo52)) {
            row("一年區間位置",
                "高 " + fmt(hi52, 2) + "／低 " + fmt(lo52, 2),
                "距高點 " + fmt((last - hi52) / hi52 * 100, 1) + "%，距低點 +" +
                fmt((last - lo52) / lo52 * 100, 1) + "%", 0);
        }

        return rows;
    }

    function taVerdict(rows) {
        var bull = 0, bear = 0, scored = 0;
        rows.forEach(function (r) {
            if (r.score > 0) bull++;
            else if (r.score < 0) bear++;
            if (r.name !== "20 日乖離率" && r.name !== "一年區間位置") scored++;
        });
        var s = bull - bear;
        var label, cls;
        if (s >= 4) { label = "強勢偏多"; cls = "ta-bull"; }
        else if (s >= 2) { label = "偏多"; cls = "ta-bull"; }
        else if (s <= -4) { label = "弱勢偏空"; cls = "ta-bear"; }
        else if (s <= -2) { label = "偏空"; cls = "ta-bear"; }
        else { label = "中性"; cls = "ta-flat"; }
        return { label: label, cls: cls, bull: bull, bear: bear, total: scored };
    }

    function renderTA(code) {
        var tbody = document.querySelector("#taTable tbody");
        var verdictEl = document.getElementById("taVerdict");
        tbody.innerHTML = '<tr><td colspan="3" class="text-muted text-center">技術指標計算中…</td></tr>';
        verdictEl.style.display = "none";

        var myCode = code;
        fetchCandles(code, "1y").then(function (data) {
            if (currentCode !== myCode) return;
            if (!data.candles || data.candles.length < 10) throw new Error("insufficient");
            // 補上成交量（computeTA 用）
            var candles = data.candles.map(function (c, i) {
                return { close: c.close, high: c.high, low: c.low, volume: data.volumes[i] ? data.volumes[i].value : 0 };
            });
            var rows = computeTA(candles);
            var v = taVerdict(rows);

            verdictEl.innerHTML =
                '<span class="ta-verdict-badge ' + v.cls + '">' + v.label + "</span>" +
                '<span class="ta-verdict-text">計分指標 ' + v.total + " 項中：" +
                '<span class="val-up">' + v.bull + " 項偏多</span>、" +
                '<span class="val-down">' + v.bear + " 項偏空</span>（依最新日線收盤計算）</span>";
            verdictEl.style.display = "flex";

            tbody.innerHTML = rows.map(function (r) {
                return "<tr><td class='text-left font-weight-bold'>" + esc(r.name) + "</td>" +
                    "<td class='text-left'>" + r.value + "</td>" +
                    "<td class='text-left'><span class='ta-badge " + r.cls + "'>" +
                    (r.score > 0 ? "偏多" : (r.score < 0 ? "偏空" : "參考")) + "</span> " +
                    esc(r.judge) + "</td></tr>";
            }).join("");
        }).catch(function () {
            if (currentCode !== myCode) return;
            tbody.innerHTML = '<tr><td colspan="3" class="text-muted text-center">技術指標資料暫時無法取得，請稍後再試。</td></tr>';
        });
    }

    /* ---------- 新聞（僅提供外部網站連結；不內嵌第三方新聞內容，
       Google News RSS 僅授權非商業使用，本站有廣告屬商業用途） ---------- */

    function newsLinks(code, name, isOtc) {
        var yahooSuffix = isOtc ? ".TWO" : ".TW";
        return '<a class="btn btn-success btn-sm mr-2 mb-2" target="_blank" rel="noopener" href="https://news.google.com/search?q=' +
            encodeURIComponent(name) + '&hl=zh-TW&gl=TW&ceid=TW:zh-Hant">Google 新聞</a>' +
            '<a class="btn btn-success btn-sm mr-2 mb-2" target="_blank" rel="noopener" href="https://tw.stock.yahoo.com/quote/' +
            encodeURIComponent(code + yahooSuffix) + '/news">Yahoo 股市新聞</a>' +
            '<a class="btn btn-success btn-sm mb-2" target="_blank" rel="noopener" href="https://www.cnyes.com/search/news?keyword=' +
            encodeURIComponent(name) + '">鉅亨網</a>';
    }

    function renderNews(code, name, isOtc) {
        document.getElementById("stockNews").innerHTML =
            '<p class="text-muted mb-0">點選下方按鈕，前往各新聞網站查看「' + esc(name) + '」的最新報導（另開新視窗）。</p>';
        document.getElementById("stockNewsLinks").innerHTML = newsLinks(code, name, isOtc);
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
