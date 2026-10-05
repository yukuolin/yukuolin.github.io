// 從 Yahoo Finance 下載歷史股價，產生 game/scenarios.js
// 使用方式：node scripts/game/fetch-data.mjs
import { writeFile } from 'node:fs/promises';
import { scenarios } from './scenarios.config.mjs';

const WARMUP_BARS = 60; // 遊戲開始前先顯示的歷史 K 線數量

async function fetchDaily(symbol, from, to) {
  // 往前多抓 120 天，給開局的歷史 K 線使用
  const p1 = Math.floor(new Date(from).getTime() / 1000) - 120 * 86400;
  const p2 = Math.floor(new Date(to).getTime() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${symbol} HTTP ${res.status}`);
  const json = await res.json();
  const r = json.chart.result[0];
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const offset = r.meta.gmtoffset || 0;
  const bars = [];
  r.timestamp.forEach((t, i) => {
    const c = q.close[i], v = q.volume[i];
    if ([q.open[i], q.high[i], q.low[i], c].some((x) => x == null || x <= 0)) return; // 略過停牌或缺值
    // 還原權值：用調整後收盤價等比例調整開高低收，讓除權息不會造成假跌幅
    const k = adj?.[i] ? adj[i] / c : 1;
    const date = new Date((t + offset) * 1000).toISOString().slice(0, 10);
    bars.push({ date, o: q.open[i] * k, h: q.high[i] * k, l: q.low[i] * k, c: c * k, v: v || 0 });
  });
  return { bars, currency: r.meta.currency };
}

const round = (x) => Math.round(x * 100) / 100;

const out = [];
for (const s of scenarios) {
  const { bars, currency } = await fetchDaily(s.symbol, s.from, s.to);
  const startIdx = bars.findIndex((b) => b.date >= s.from);
  const begin = Math.max(0, startIdx - WARMUP_BARS);
  const used = bars.slice(begin).filter((b) => b.date <= s.to);
  const warmup = startIdx - begin;

  // Yahoo 舊資料偶有成交量錯誤（大上千倍），超過中位數 30 倍的改用中位數
  const sorted = used.map((b) => b.v).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  for (const b of used) if (b.v > median * 30) b.v = median;

  // 把價格縮放成「開局第一天收盤 = 100」，避免玩家從價位猜出是哪檔股票
  const scale = 100 / used[warmup - 1].c;
  out.push({
    ...s,
    currency,
    warmup,
    scale,
    dates: used.map((b) => b.date),
    bars: used.map((b) => [round(b.o * scale), round(b.h * scale), round(b.l * scale), round(b.c * scale), b.v]),
  });
  console.log(`${s.id}: ${used.length} 根 K 線（暖身 ${warmup}），${used[0].date} ~ ${used.at(-1).date}`);
}

const js = `// 由 scripts/game/fetch-data.mjs 自動產生，請勿手動修改\n// bars 格式：[開, 高, 低, 收, 成交量]（已縮放，開局收盤 = 100）\nwindow.SCENARIOS = ${JSON.stringify(out)};\n`;
await writeFile(new URL('../../game/scenarios.js', import.meta.url), js);
console.log('已寫入 game/scenarios.js');
