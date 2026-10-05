# SLS vs SOL bet tracker

This is a live page for the bet that **SLS (ASX: Solstice Minerals)** outperforms **Solana (SOL/AUD)** between 12 Sep 2026 and 19 Nov 2026. Each side is scored by its % return from the agreed start prices:

| | Start price (agreed) |
|---|---|
| SLS | A$2.70 |
| SOL | A$141.94 |

## How it works

- `.github/workflows/update.yml` runs every 15 minutes (and on each push). It runs `scripts/fetch-prices.mjs`, which writes `site/data.json`, then deploys `site/` to GitHub Pages.
- Price sources: Yahoo Finance (`SLS.AX`, `SOL-AUD`) first. If Yahoo fails, it falls back to the ASX quote API for SLS and CoinGecko for SOL. If every source fails, the page keeps the last good price and marks it stale.
- In the browser, the page also polls CoinGecko every 60 s for a live SOL price.
- After 19 Nov 2026 the settlement prices are locked in, and from then on the page shows the winner.

The bet terms (start prices, dates, settlement rule) all live in `bet.json`.

## One-time setup

In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Then re-run the workflow (Actions tab → *Update prices and deploy* → *Run workflow*).

The page will be live at https://liamharper34.github.io/Bet-Tracker/
