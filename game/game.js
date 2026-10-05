// 股海盲測（遊戲頁 game.html）：主程式（Vue 3 + Lightweight Charts）
const { createApp, ref, reactive, computed, nextTick, onMounted } = Vue;

// ===== 遊戲參數 =====
const START_CASH = 1_000_000;
const FEE_RATE = 0.001425; // 券商手續費（買賣都收）
const TAX_RATE = 0.003; // 證券交易稅（只有賣出收）
const AUTO_SPEED_MS = 200;
const UP = '#ef4444'; // 台股習慣：紅漲
const DOWN = '#22a06b'; // 綠跌
const MA_LIST = [
  { n: 5, color: '#f5b83d' },
  { n: 20, color: '#a78bfa' },
  { n: 60, color: '#38bdf8' },
];

const GLOSSARY = [
  ['K 線', '一根 K 線代表一天的價格：實體的上下緣是開盤價與收盤價，上下的細線是最高價與最低價。紅色代表收盤比開盤高（上漲），綠色代表下跌。'],
  ['均線（MA）', '過去 N 天收盤價的平均。MA5 約一週、MA20 約一個月、MA60 約一季。股價在均線之上通常代表趨勢偏多。'],
  ['成交量', '圖表下方的柱狀圖，代表當天交易了多少股。大漲或大跌時常伴隨爆量，代表市場情緒激烈。'],
  ['手續費', '每次買或賣都要付給券商的費用，台股約為成交金額的 0.1425%。'],
  ['證券交易稅', '賣出股票時要繳的稅，台股為成交金額的 0.3%。頻繁買賣會讓這些成本累積得很快。'],
  ['平均成本', '你手上持股平均每股花了多少錢買進（含手續費）。'],
  ['未實現損益', '如果現在用收盤價賣掉持股，相對成本會賺或賠多少（還沒賣出所以叫「未實現」）。'],
  ['買入持有', '第一天全部買進、之後完全不操作的策略。很多研究顯示，大多數頻繁交易的人報酬率都輸給它。'],
  ['最大回撤', '資產從某個最高點往下跌到最低點的最大跌幅，用來衡量你承受過多大的風險。'],
  ['停損／停利', '事先決定跌到多少就賣出認賠（停損），或漲到多少就賣出獲利了結（停利），避免被情緒左右。'],
  ['還原權息', '公司發放股利時股價會下修（除權息）。本遊戲的價格已把股利加回去，所以不會出現因配息造成的假跌幅。'],
];

// ===== 小工具 =====
const fmtMoney = (x) => (x < -0.5 ? '-$' : '$') + Math.abs(Math.round(x)).toLocaleString('zh-TW');
const fmtPct = (x) => (x > 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
const pnlClass = (x) => (x > 0.00001 ? 'sg-up' : x < -0.00001 ? 'sg-down' : '');

function movingAverage(closes, n) {
  const out = [];
  let sum = 0;
  closes.forEach((c, i) => {
    sum += c;
    if (i >= n) sum -= closes[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  });
  return out;
}

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem('stockgame.records')) || {};
  } catch {
    return {};
  }
}
function saveRecords(records) {
  try {
    localStorage.setItem('stockgame.records', JSON.stringify(records));
  } catch {
    // 無痕模式等情況可能無法寫入，忽略即可
  }
}

createApp({
  setup() {
    const scenarios = window.SCENARIOS;
    const screen = ref('menu');
    const scenario = ref(null);
    const records = reactive(loadRecords());
    const showGlossary = ref(false);

    // 遊戲狀態
    const cursor = ref(0); // 目前看到的最後一根 K 線索引
    const cash = ref(START_CASH);
    const shares = ref(0);
    const costBasis = ref(0); // 持股總成本（含手續費）
    const totalCosts = ref(0); // 累計手續費＋稅
    const trades = ref([]);
    const news = ref([]);
    const toast = ref(null);
    const autoTimer = ref(null);
    const maOn = reactive({ 5: true, 20: true, 60: false });
    const equityHistory = []; // 每天收盤時的資產，結算畫圖用
    const result = ref(null);

    // 圖表物件不需要被 Vue 追蹤，放在一般變數即可
    const chartEl = ref(null);
    const resultChartEl = ref(null);
    let chart = null, candleSeries = null, volumeSeries = null, resultChart = null;
    let maSeries = {}, maData = {}, eventsByIndex = {};

    // ===== 衍生數值 =====
    const startIdx = computed(() => scenario.value.warmup - 1); // 開局日（收盤 = 100）
    const bars = computed(() => scenario.value.bars);
    const totalDays = computed(() => bars.value.length - 1 - startIdx.value);
    const dayNum = computed(() => cursor.value - startIdx.value);
    const isEnd = computed(() => cursor.value >= bars.value.length - 1);
    const price = computed(() => bars.value[cursor.value][3]);
    const dayChange = computed(() => price.value / bars.value[cursor.value - 1][3] - 1);
    const changeClass = computed(() => pnlClass(dayChange.value));
    const equity = computed(() => cash.value + shares.value * price.value);
    const returnPct = computed(() => equity.value / START_CASH - 1);
    const avgCost = computed(() => (shares.value ? costBasis.value / shares.value : 0));
    const unrealized = computed(() => shares.value * price.value - costBasis.value);

    // 買入持有：開局日用全部資金買進後不動
    const holdEquityAt = (i) => {
      const p0 = bars.value[startIdx.value][3];
      const n = Math.floor(START_CASH / (p0 * (1 + FEE_RATE)));
      return START_CASH - n * p0 * (1 + FEE_RATE) + n * bars.value[i][3];
    };
    const holdReturn = computed(() => holdEquityAt(cursor.value) / START_CASH - 1);

    // ===== 遊戲流程 =====
    function startGame(s) {
      stopAuto();
      scenario.value = s;
      cursor.value = s.warmup - 1;
      cash.value = START_CASH;
      shares.value = 0;
      costBasis.value = 0;
      totalCosts.value = 0;
      trades.value = [];
      news.value = [];
      toast.value = null;
      result.value = null;
      equityHistory.length = 0;
      equityHistory.push(START_CASH);

      // 把新聞對應到「日期 >= 新聞日期」的第一根 K 線
      eventsByIndex = {};
      for (const e of s.events) {
        const i = s.dates.findIndex((d, idx) => idx >= s.warmup && d >= e.date);
        if (i >= 0) eventsByIndex[i] = e.text;
      }

      screen.value = 'play';
      nextTick(() => {
        initChart();
        document.getElementById('stock-game').scrollIntoView({ behavior: 'smooth' });
      });
    }

    function nextDay(n) {
      for (let k = 0; k < n && !isEnd.value; k++) {
        cursor.value++;
        const i = cursor.value;
        pushBar(i);
        equityHistory.push(equity.value);
        if (eventsByIndex[i]) {
          news.value.unshift({ day: dayNum.value, text: eventsByIndex[i] });
          toast.value = eventsByIndex[i];
          stopAuto(); // 有新聞就暫停，讓玩家思考
          break;
        }
      }
      if (isEnd.value) stopAuto();
    }

    function toggleAuto() {
      if (autoTimer.value) return stopAuto();
      toast.value = null;
      autoTimer.value = setInterval(() => nextDay(1), AUTO_SPEED_MS);
    }
    function stopAuto() {
      clearInterval(autoTimer.value);
      autoTimer.value = null;
    }

    // ===== 交易 =====
    const maxBuyShares = (ratio) => Math.floor((cash.value * ratio) / (price.value * (1 + FEE_RATE)));

    function buy(ratio) {
      const n = maxBuyShares(ratio);
      if (n <= 0) return;
      const amount = n * price.value;
      const fee = amount * FEE_RATE;
      cash.value -= amount + fee;
      shares.value += n;
      costBasis.value += amount + fee;
      totalCosts.value += fee;
      recordTrade('buy', n);
    }

    function sell(ratio) {
      const n = ratio === 1 ? shares.value : Math.floor(shares.value * ratio);
      if (n <= 0) return;
      const amount = n * price.value;
      const fee = amount * FEE_RATE;
      const tax = amount * TAX_RATE;
      costBasis.value -= costBasis.value * (n / shares.value);
      cash.value += amount - fee - tax;
      shares.value -= n;
      totalCosts.value += fee + tax;
      recordTrade('sell', n);
    }

    function recordTrade(type, n) {
      trades.value.push({ type, shares: n, price: price.value, day: dayNum.value, index: cursor.value });
      equityHistory[equityHistory.length - 1] = equity.value; // 手續費會讓當天資產略減
      updateMarkers();
    }

    // ===== 結算 =====
    function finish() {
      stopAuto();
      const s = scenario.value;
      const ret = returnPct.value;
      const hold = holdReturn.value;

      let peak = -Infinity, mdd = 0;
      for (const v of equityHistory) {
        peak = Math.max(peak, v);
        mdd = Math.max(mdd, 1 - v / peak);
      }

      const diff = ret - hold;
      let grade, comment;
      if (!trades.value.length) [grade, comment] = ['—', '你這次完全沒有交易。投資的第一步，就是敢於做出決定！'];
      else if (ret > 0 && diff > 0.2) [grade, comment] = ['S', '股神再世！大幅打敗買入持有。'];
      else if (ret > 0 && diff >= 0) [grade, comment] = ['A', '有賺錢，還打敗了買入持有，非常好！'];
      else if (ret > 0) [grade, comment] = ['B', '有賺錢，但其實抱著不動會賺更多。'];
      else if (diff >= 0) [grade, comment] = ['B', '雖然虧損，但比抱著不動好，成功控制了風險。'];
      else [grade, comment] = ['C', '這次繳了點學費，看看下面的故事，再挑戰一次吧！'];

      const real = (i) => (bars.value[i][3] / s.scale).toFixed(2);
      result.value = {
        ret, hold, mdd, grade, comment,
        costs: totalCosts.value,
        startDate: s.dates[startIdx.value],
        endDate: s.dates[cursor.value],
        realStart: real(startIdx.value),
        realEnd: real(cursor.value),
      };

      if (records[s.id] === undefined || ret > records[s.id]) {
        records[s.id] = ret;
        saveRecords(records);
      }

      destroyCharts();
      screen.value = 'result';
      nextTick(initResultChart);
    }

    function backToMenu() {
      stopAuto();
      destroyCharts();
      screen.value = 'menu';
    }

    // ===== 圖表 =====
    const dayLabel = (time) => {
      const day = time - 1 - startIdx.value;
      return day > 0 ? `第${day}天` : day === 0 ? '開局' : `前${-day}天`;
    };

    function baseChartOptions() {
      return {
        autoSize: true,
        layout: { background: { color: 'transparent' }, textColor: '#9aa4b2', fontFamily: 'inherit' },
        grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.06)' } },
        rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
        timeScale: { borderColor: 'rgba(255,255,255,0.1)', tickMarkFormatter: dayLabel, rightOffset: 4 },
        localization: { timeFormatter: dayLabel },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      };
    }

    const toCandle = (b, i) => ({ time: i + 1, open: b[0], high: b[1], low: b[2], close: b[3] });
    const toVolume = (b, i) => ({ time: i + 1, value: b[4], color: b[3] >= b[0] ? 'rgba(239,68,68,0.35)' : 'rgba(34,160,107,0.35)' });

    function initChart() {
      chart = LightweightCharts.createChart(chartEl.value, baseChartOptions());
      candleSeries = chart.addCandlestickSeries({
        upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
      });
      candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.25 } });

      volumeSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      const visible = bars.value.slice(0, cursor.value + 1);
      candleSeries.setData(visible.map(toCandle));
      volumeSeries.setData(visible.map(toVolume));

      const closes = bars.value.map((b) => b[3]);
      maSeries = {};
      for (const m of MA_LIST) {
        maData[m.n] = movingAverage(closes, m.n);
        maSeries[m.n] = chart.addLineSeries({
          color: m.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
      }
      refreshMA();
      chart.timeScale().fitContent();
    }

    // 均線資料只顯示到目前這一天，關閉的均線清空
    function refreshMA() {
      for (const m of MA_LIST) {
        const data = maOn[m.n]
          ? maData[m.n].slice(0, cursor.value + 1).map((v, i) => (v === null ? null : { time: i + 1, value: v })).filter(Boolean)
          : [];
        maSeries[m.n].setData(data);
      }
    }

    function pushBar(i) {
      if (!chart) return;
      const b = bars.value[i];
      candleSeries.update(toCandle(b, i));
      volumeSeries.update(toVolume(b, i));
      for (const m of MA_LIST) {
        if (maOn[m.n] && maData[m.n][i] !== null) maSeries[m.n].update({ time: i + 1, value: maData[m.n][i] });
      }
    }

    function updateMarkers() {
      // 同一天多筆交易只標一次，避免重疊
      const byTime = new Map();
      for (const t of trades.value) byTime.set(t.index + 1 + t.type, t);
      const markers = [...byTime.values()]
        .map((t) => t.type === 'buy'
          ? { time: t.index + 1, position: 'belowBar', color: '#fca5a5', shape: 'arrowUp', text: '買' }
          : { time: t.index + 1, position: 'aboveBar', color: '#86efac', shape: 'arrowDown', text: '賣' })
        .sort((a, b) => a.time - b.time);
      candleSeries.setMarkers(markers);
    }

    function initResultChart() {
      resultChart = LightweightCharts.createChart(resultChartEl.value, {
        ...baseChartOptions(),
        handleScroll: false,
        handleScale: false,
        localization: { timeFormatter: dayLabel, priceFormatter: fmtMoney },
      });
      const you = resultChart.addLineSeries({ color: '#f5b301', lineWidth: 2, priceLineVisible: false });
      const hold = resultChart.addLineSeries({ color: '#64748b', lineWidth: 2, priceLineVisible: false });
      you.setData(equityHistory.map((v, d) => ({ time: startIdx.value + d + 1, value: v })));
      hold.setData(equityHistory.map((_, d) => ({ time: startIdx.value + d + 1, value: holdEquityAt(startIdx.value + d) })));
      resultChart.timeScale().fitContent();
    }

    function destroyCharts() {
      chart?.remove();
      resultChart?.remove();
      chart = resultChart = null;
    }

    // 空白鍵 = 下一天
    onMounted(() => {
      window.addEventListener('keydown', (e) => {
        if (screen.value !== 'play' || e.code !== 'Space' || e.target.tagName === 'INPUT') return;
        e.preventDefault();
        toast.value = null;
        nextDay(1);
      });
    });

    return {
      START_CASH, MA_LIST, GLOSSARY, scenarios, screen, scenario, records, showGlossary,
      cash, shares, trades, news, toast, autoTimer, maOn, result, chartEl, resultChartEl,
      totalDays, dayNum, isEnd, price, dayChange, changeClass, equity, returnPct, avgCost, unrealized, holdReturn,
      startGame, nextDay, toggleAuto, buy, sell, maxBuyShares, finish, backToMenu, refreshMA,
      fmtMoney, fmtPct, pnlClass,
    };
  },
}).mount('#stock-game');
