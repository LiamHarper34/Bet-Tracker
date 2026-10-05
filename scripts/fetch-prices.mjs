// Fetches SLS (ASX) and SOL (AUD) prices server-side and writes site/data.json.
// Runs in GitHub Actions; the browser page reads the JSON from the same origin,
// which avoids the CORS restrictions on Yahoo Finance and the ASX endpoints.
// Usage: node scripts/fetch-prices.mjs [outFile]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const UA = "Mozilla/5.0 (compatible; bet-tracker/1.0; +https://github.com/LiamHarper34/Bet-Tracker)";
const DAY = 86400;

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const toUnix = (iso) => Math.floor(Date.parse(iso) / 1000);

// Daily closes + latest price from Yahoo's chart endpoint.
export async function yahoo(symbol, fromIso) {
  const p1 = toUnix(fromIso) - 3 * DAY; // include the last trading day before the start
  const p2 = Math.floor(Date.now() / 1000) + DAY;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  const r = (await getJson(url))?.chart?.result?.[0];
  if (!r?.meta?.regularMarketPrice) throw new Error(`Yahoo: no price for ${symbol}`);
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  const history = (r.timestamp ?? [])
    .map((t, i) => ({ t: t * 1000, p: closes[i] }))
    .filter((x) => Number.isFinite(x.p));
  return {
    price: r.meta.regularMarketPrice,
    priceTime: r.meta.regularMarketTime * 1000,
    currency: r.meta.currency,
    source: "Yahoo Finance",
    history,
  };
}

// Fallback for SLS: ASX's own quote API (latest price only).
export async function asx(code) {
  const j = await getJson(`https://asx.api.markitdigital.com/asx-research/1.0/companies/${code.toLowerCase()}/header`);
  const d = j?.data ?? {};
  const price = d.priceLast ?? d.lastPrice;
  if (!Number.isFinite(price)) throw new Error(`ASX: no price for ${code}`);
  return { price, priceTime: Date.now(), currency: "AUD", source: "ASX", history: [] };
}

// Fallback for SOL: CoinGecko (latest + daily history in AUD).
export async function coingecko(id, fromIso) {
  const now = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=aud&include_last_updated_at=true`);
  const price = now?.[id]?.aud;
  if (!Number.isFinite(price)) throw new Error(`CoinGecko: no price for ${id}`);
  const days = Math.ceil((Date.now() / 1000 - toUnix(fromIso)) / DAY) + 3;
  const hist = await getJson(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=aud&days=${days}&interval=daily`);
  return {
    price,
    priceTime: (now[id].last_updated_at ?? Date.now() / 1000) * 1000,
    currency: "AUD",
    source: "CoinGecko",
    history: (hist?.prices ?? []).map(([t, p]) => ({ t, p })),
  };
}

// SOL/AUD at a specific moment (settlement), from CoinGecko's hourly range data.
export async function coingeckoAt(id, iso) {
  const t = toUnix(iso);
  const j = await getJson(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=aud&from=${t - 3 * 3600}&to=${t + 3 * 3600}`);
  const pts = j?.prices ?? [];
  if (!pts.length) throw new Error("CoinGecko: no settlement data");
  const [ts, p] = pts.reduce((a, b) => (Math.abs(b[0] / 1000 - t) < Math.abs(a[0] / 1000 - t) ? b : a));
  return { price: p, priceTime: ts, source: "CoinGecko" };
}

async function firstOk(label, ...attempts) {
  const errors = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      errors.push(e.message);
      console.warn(`[${label}] ${e.message}`);
    }
  }
  return { error: errors.join(" | ") };
}

// SLS settlement: the last ASX close on or before the checkpoint date (Sydney time).
function closeOnOrBefore(history, dateIso) {
  const sydneyDate = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  return history.filter((h) => sydneyDate(h.t) <= dateIso).at(-1) ?? null;
}

export async function build(bet, previous = null) {
  const { sls, sol } = bet.assets;
  const data = {
    generatedAt: Date.now(),
    bet,
    sls: await firstOk("SLS", () => yahoo(sls.yahoo, bet.madeOn), () => asx(sls.asxCode)),
    sol: await firstOk("SOL", () => yahoo(sol.yahoo, bet.madeOn), () => coingecko(sol.coingecko, bet.madeOn)),
    settlements: { ...(previous?.settlements ?? {}) },
  };

  // Keep the last good quote if a source fails, so the page never goes blank.
  for (const k of ["sls", "sol"]) {
    if (data[k].error && previous?.[k]?.price) data[k] = { ...previous[k], stale: true, error: data[k].error };
  }

  // Lock in each checkpoint's prices once they exist (2h after 4pm Sydney, so the ASX close is final).
  for (const cp of bet.checkpoints) {
    if (data.settlements[cp.id] || Date.now() < Date.parse(cp.settlementUtc) + 2 * 3600 * 1000) continue;
    const slsClose = data.sls.history ? closeOnOrBefore(data.sls.history, cp.endDate) : null;
    const solAt = await firstOk(`SOL settle ${cp.id}`, () => coingeckoAt(sol.coingecko, cp.settlementUtc));
    if (slsClose && solAt.price) {
      data.settlements[cp.id] = {
        sls: { price: slsClose.p, priceTime: slsClose.t, source: data.sls.source },
        sol: solAt,
      };
    }
  }
  return data;
}

async function main() {
  const out = process.argv[2] ?? "site/data.json";
  const bet = JSON.parse(await readFile(new URL("../bet.json", import.meta.url), "utf8"));
  let previous = null;
  if (process.env.PREVIOUS_URL) {
    try { previous = await getJson(process.env.PREVIOUS_URL); } catch (e) { console.warn(`No previous data: ${e.message}`); }
  }
  const data = await build(bet, previous);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(data));
  console.log(`SLS ${data.sls.price ?? "n/a"} (${data.sls.source ?? data.sls.error}) | SOL ${data.sol.price ?? "n/a"} (${data.sol.source ?? data.sol.error})`);
  if (!data.sls.price && !data.sol.price) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
