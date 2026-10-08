// Prints how closely SLS and SOL/AUD prices move together.
// Run manually (Actions -> Update prices and deploy -> Run workflow); it only logs, it never affects the page.
// Usage: node scripts/correlation.mjs

import { readFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (compatible; bet-tracker/1.0; +https://github.com/LiamHarper34/Bet-Tracker)";
const DAY = 86400000;

async function closes(symbol, days) {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = p2 - days * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} for ${symbol}`);
  const r = (await res.json()).chart.result[0];
  const c = r.indicators.quote[0].close;
  return r.timestamp.map((t, i) => ({ t: t * 1000, p: c[i] })).filter((x) => Number.isFinite(x.p));
}

const sydneyDate = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

function pearson(a, b) {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
}

// 95% confidence interval for r (Fisher z-transform)
function ci(r, n) {
  const z = Math.atanh(r), se = 1 / Math.sqrt(n - 3);
  return [Math.tanh(z - 1.96 * se), Math.tanh(z + 1.96 * se)];
}

function report(label, sls, solAt, fromDate, stepDays) {
  // SLS closes ~4:10pm Sydney (~05:10-06:10 UTC). The nearest SOL daily close is 00:00 UTC that same day,
  // i.e. the close of the previous UTC day, so pair SLS on Sydney date D with SOL's close at 00:00 UTC on D.
  let pts = sls.filter((h) => sydneyDate(h.t) >= fromDate).map((h) => ({ d: sydneyDate(h.t), sls: h.p, sol: solAt.get(sydneyDate(h.t)) }))
    .filter((x) => x.sol != null);
  if (stepDays === 7) { // keep the last trading day of each week
    const weeks = new Map();
    for (const x of pts) { const d = new Date(x.d + "T00:00:00Z"); weeks.set(new Date(d - ((d.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10), x); }
    pts = [...weeks.values()];
  }
  const rs = [], ro = [];
  for (let i = 1; i < pts.length; i++) { rs.push(pts[i].sls / pts[i - 1].sls - 1); ro.push(pts[i].sol / pts[i - 1].sol - 1); }
  if (rs.length < 5) return console.log(`${label}: not enough data (${rs.length} returns)`);
  const r = pearson(rs, ro), [lo, hi] = ci(r, rs.length);
  const sd = (x) => Math.sqrt(x.reduce((s, v, _, a) => s + (v - a.reduce((t, w) => t + w, 0) / a.length) ** 2, 0) / (x.length - 1));
  console.log(`${label}: r = ${r.toFixed(3)} (95% CI ${lo.toFixed(2)} to ${hi.toFixed(2)}), n = ${rs.length} returns, ${pts[0].d} to ${pts.at(-1).d}`);
  console.log(`   r^2 = ${(r * r * 100).toFixed(1)}% | SLS sd ${(sd(rs) * 100).toFixed(2)}% | SOL sd ${(sd(ro) * 100).toFixed(2)}% per period`);
}

const bet = JSON.parse(await readFile(new URL("../bet.json", import.meta.url), "utf8"));
const [sls, sol] = await Promise.all([closes(bet.assets.sls.yahoo, 380), closes(bet.assets.sol.yahoo, 380)]);
// SOL bar dated UTC day U closes at 00:00 UTC on U+1
const solAt = new Map(sol.map((h) => [utcDate(h.t + DAY), h.p]));
const ago = (d) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);

console.log(`SLS bars: ${sls.length} (${sydneyDate(sls[0].t)} to ${sydneyDate(sls.at(-1).t)}), SOL bars: ${sol.length}`);
console.log(`SLS last ${sls.at(-1).p} | SOL last ${sol.at(-1).p}`);
report("Daily, since bet start ", sls, solAt, bet.madeOn, 1);
report("Daily, last 90 days    ", sls, solAt, ago(90), 1);
report("Daily, last 12 months  ", sls, solAt, ago(365), 1);
report("Weekly, last 12 months ", sls, solAt, ago(365), 7);
