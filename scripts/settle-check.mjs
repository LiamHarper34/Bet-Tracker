// Dry run of the settlement lookup for any past moment. Prints what the page would lock in; saves nothing.
// Usage: node scripts/settle-check.mjs <settlement ISO time> <SLS close date YYYY-MM-DD>
import { readFile } from "node:fs/promises";
import { yahoo, yahooAt, coingeckoAt, solAtMoment, closeOnOrBefore } from "./fetch-prices.mjs";

const [iso, date] = process.argv.slice(2);
const bet = JSON.parse(await readFile(new URL("../bet.json", import.meta.url), "utf8"));
const show = (label, x) => console.log(`${label}: ${x.price} at ${new Date(x.priceTime).toISOString()} (${x.source})`);
const tryIt = async (label, fn) => { try { show(label, await fn()); } catch (e) { console.log(`${label}: FAILED ${e.message}`); } };

console.log(`Settlement dry run for ${iso} (SLS close on or before ${date})`);
await tryIt("SOL Yahoo    ", () => yahooAt(bet.assets.sol.yahoo, iso));
await tryIt("SOL CoinGecko", () => coingeckoAt(bet.assets.sol.coingecko, iso));
await tryIt("SOL chosen   ", async () => { const r = await solAtMoment(bet.assets.sol, iso); if (r.error) throw new Error(r.error); return r; });
await tryIt("SLS close    ", async () => {
  const h = await yahoo(bet.assets.sls.yahoo, bet.madeOn);
  const c = closeOnOrBefore(h.history, date);
  if (!c) throw new Error("no close found");
  return { price: c.p, priceTime: c.t, source: h.source };
});
