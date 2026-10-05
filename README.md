# SLS vs SOL bet tracker

This is a live page for the bet that **SLS (ASX: Solstice Minerals)** 🚀 outperforms **Solana (SOL/AUD)** 💩, made on 12 Sep 2026. There are two checkpoints:

- **19 Nov 2026**: checkpoint
- **12 Sep 2027**: final. The loser owes the winner a case of beers.

At each checkpoint, a side's score is its % return from the agreed start prices. SOL is priced at 4:00pm Sydney time. SLS uses its last ASX close on or before the checkpoint date:

| | Start price (agreed) |
|---|---|
| SLS | A$2.37 |
| SOL | A$141.94 |

## How it works

- `.github/workflows/update.yml` runs every 15 minutes (and on each push). It runs `scripts/fetch-prices.mjs`, which writes `site/data.json`, then deploys `site/` to GitHub Pages.
- Price sources: Yahoo Finance (`SLS.AX`, `SOL-AUD`) first. If Yahoo fails, it falls back to the ASX quote API for SLS and CoinGecko for SOL. If every source fails, the page keeps the last good price and marks it stale.
- In the browser, the page also polls CoinGecko every 60 s for a live SOL price.
- After each checkpoint passes, its prices are locked in and the page shows who won it.
- `keepalive.yml` makes a small commit once a month. Without it, GitHub turns off scheduled workflows in a public repo after 60 days with no activity.

The bet terms (start prices, checkpoints, stakes, emojis) all live in `bet.json`.

## One-time setup

In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Then re-run the workflow (Actions tab → *Update prices and deploy* → *Run workflow*).

The page will be live at https://liamharper34.github.io/Bet-Tracker/
