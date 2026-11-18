// Momentum snapshot for both sides, plus the odds of the leader changing by the next checkpoint.
// Run manually (Actions -> Update prices and deploy -> Run workflow); it only logs.
// Usage: node scripts/momentum.mjs

import { readFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (compatible; bet-tracker/1.0; +https://github.com/LiamHarper34/Bet-Tracker)";

async function daily(symbol, days) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - days * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} for ${symbol}`);
  const r = (await res.json()).chart.result[0];
  const q = r.indicators.quote[0];
  const bars = r.timestamp.map((t, i) => ({ t: t * 1000, c: q.close[i], v: q.volume[i] })).filter((b) => Number.isFinite(b.c));
  return { bars, last: r.meta.regularMarketPrice, lastTime: r.meta.regularMarketTime * 1000 };
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const sma = (c, n) => mean(c.slice(-n));
const pct = (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
const chg = (c, n) => c.at(-1) / c.at(-1 - n) - 1;

function rsi(c, n = 14) { // Wilder's RSI
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d > 0 ? (g += d) : (l -= d); }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function report(label, d) {
  const c = d.bars.map((b) => b.c);
  c[c.length - 1] = d.last; // use the latest quote for today's bar
  const rets = c.slice(1).map((v, i) => v / c[i] - 1);
  const hi = Math.max(...c.slice(-252)), lo = Math.min(...c.slice(-252));
  console.log(`\n== ${label}: last ${d.last} at ${new Date(d.lastTime).toISOString()}`);
  console.log(`   change: 1 bar ${pct(chg(c, 1))} | 5 bars ${pct(chg(c, 5))} | 20 bars ${pct(chg(c, 20))} | 60 bars ${pct(chg(c, 60))}`);
  console.log(`   vs 20-bar avg ${sma(c, 20).toFixed(4)} (${pct(d.last / sma(c, 20) - 1)}) | vs 50-bar avg ${sma(c, 50).toFixed(4)} (${pct(d.last / sma(c, 50) - 1)}) | 20 avg vs 50 avg ${pct(sma(c, 20) / sma(c, 50) - 1)}`);
  console.log(`   RSI(14) ${rsi(c).toFixed(1)} | 12-month high ${hi} (${pct(d.last / hi - 1)}) low ${lo} (${pct(d.last / lo - 1)})`);
  console.log(`   daily move sd: last 20 bars ${(sd(rets.slice(-20)) * 100).toFixed(2)}% | last 60 bars ${(sd(rets.slice(-60)) * 100).toFixed(2)}%`);
  const v = d.bars.map((b) => b.v).filter(Number.isFinite);
  if (v.length > 21 && v.at(-1) > 0) console.log(`   volume: last bar ${v.at(-1)} vs 20-bar avg ${Math.round(mean(v.slice(-21, -1)))} (${(v.at(-1) / mean(v.slice(-21, -1))).toFixed(2)}x; today's bar may be partial)`);
  console.log(`   last 10 closes: ${c.slice(-10).map((x) => +x.toFixed(4)).join(", ")}`);
  return { c, rets };
}

const bet = JSON.parse(await readFile(new URL("../bet.json", import.meta.url), "utf8"));
const A = bet.assets;
const [slsD, solD] = await Promise.all([daily(A.sls.yahoo, 400), daily(A.sol.yahoo, 400)]);
const S = report("SLS", slsD), O = report("SOL", solD);

// Odds of SLS finishing ahead at the next checkpoint, assuming no drift (a coin-flip on direction),
// each side's recent daily volatility, and independent moves (their measured correlation is ~0).
const cp = bet.checkpoints.find((c) => Date.now() < Date.parse(c.settlementUtc));
if (cp) {
  const hours = (Date.parse(cp.settlementUtc) - Date.now()) / 3.6e6;
  const ws = slsD.last / A.sls.startPrice, wo = solD.last / A.sol.startPrice; // cumulative growth so far
  const gap = (ws - wo) * 100; // SLS minus SOL, in percentage points
  // SLS can only move in ASX sessions; count the remaining sessions roughly as trading days to settlement.
  const sessions = Math.max(1, Math.round(hours / 24));
  const solDays = hours / 24;
  let line = "";
  for (const win of [20, 60]) {
    const sS = sd(S.rets.slice(-win)) * Math.sqrt(sessions), sO = sd(O.rets.slice(-win)) * Math.sqrt(solDays);
    const sdGap = Math.sqrt((ws * sS) ** 2 + (wo * sO) ** 2) * 100;
    const z = gap / sdGap;
    const pSls = 0.5 * (1 + erf(z / Math.SQRT2));
    line += `\n   using ${win}-bar volatility: sd of the gap's move ${sdGap.toFixed(2)} pts -> P(SLS ahead) ${(pSls * 100).toFixed(0)}%`;
  }
  console.log(`\n== Odds for ${cp.id} (${hours.toFixed(1)} h away, ~${sessions} ASX session(s))`);
  console.log(`   now: SLS ${pct(ws - 1)} vs SOL ${pct(wo - 1)} -> gap ${gap.toFixed(2)} pts (positive = SLS ahead)`);
  console.log(`   SLS price that ties at today's SOL price: ${(A.sls.startPrice * wo).toFixed(3)}${line}`);
}

function erf(x) { // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
