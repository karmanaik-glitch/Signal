# STRATA Markets v3.0

Free-tier, rules-based **end-of-day** research terminal for Indian equities, with a **paper-traded** model portfolio.
Python on GitHub Actions computes signals daily; a static, build-free frontend is served by **Vercel**.

> Research output, not investment advice. No broker connection, no real orders. Data comes from an unofficial provider (`yfinance`).

## Architecture (all free)

| Layer | Tech | Notes |
|---|---|---|
| Compute | GitHub Actions cron (weekdays 18:15 IST) | Fetch → score → paper-trade → backtest → validate → commit |
| Hosting | Vercel Hobby, static `app/` | Redeploys on every bot commit. No functions, no build |
| Storage | JSON in git | `app/snapshot.json`, `app/charts/<SYM>.json` shards, `backtest.json` |
| Alerts | Telegram bot (optional) | Sent from the Action; no server |

## Deploy on Vercel

1. Import the GitHub repo in Vercel. Framework **Other**; `vercel.json` already sets output directory `app` and no build command.
2. Do **not** add `[skip ci]` to bot commits so each data commit deploys.
3. Put your permitted universe CSV at `data/universe_source.csv`, then `python engine/import_universe.py data/universe_source.csv` and commit `data/universe.csv`.
4. Optional Telegram alerts: add repo secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; list symbols in `data/watchlist.txt` (model holdings are always included).

**Hobby plan is non-commercial.** Ads, subscriptions or paid features require Vercel Pro. Publishing buy/sell signals publicly in India may fall under SEBI research-analyst rules; get advice before opening it up.

## Run locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
python engine/make_demo.py            # synthetic demo data & chart shards (no network)
python -m http.server 8000 --directory app   # http://localhost:8000
python engine/run_pipeline.py --universe data/universe.csv   # live run (first run is slow)
python -m unittest discover -s tests -v
```

## What the terminal contains

5 primary modules:
- **Home** (`#/home`): market cockpit, benchmark indices, market regime gauge, sector rotation, breadth, top movers.
- **Signals** (`#/signals`): 3 tabs (Screener, Changes, History), named saved filters (localStorage), CSV export.
- **Watchlist** (`#/watchlist`): multi-list support, notes, JSON import/export, direct navigation to stock view.
- **Rulebot** (`#/rulebot`): model portfolio ledger, open positions, chandelier trailing stops, order history, equity curve vs Nifty 50.
- **More** (`#/more`): 4 tabs (System health, Backtest results, Methodology, Settings/Preferences).
- **Stock View** (`#/stock/<SYM>`): unified 6-tab deep dive (Overview, Chart with Bollinger Bands and timeframe controls, Technicals, Fundamentals, Financials, News).

Command palette via `/` or `Ctrl+K`. Jump between modules via `g` then `h/s/w/b/m`. Component design system kit at `/#/__kit`.

## Rules (ruleset 0.4)

Score = 60% technical + 40% fundamental. Strong Buy ≥85; Buy ≥70 above SMA50. Sell/Strong Sell require the close **2% below SMA50** plus bearish confirmation. Banks/NBFCs skip the debt/equity test and are rescaled. Paper bot: next-open fills, 20 bps/side, ≤15 positions, ≤10%/stock, ≤25%/sector, **3×ATR trailing stop**, **14-day cooldown**, and stocks under ₹2 Cr/day average traded value are never bought.

## Honest limits

- Thresholds are heuristics. The backtest covers **technical rules only** (fundamentals are current values, so testing them historically would look ahead), uses today's constituents (survivorship bias) and no tax/impact model. A random-walk test in `tests/` guards against look-ahead bugs.
- Dividends and splits-while-holding are not credited to the paper ledger (prices are split-adjusted; dividends are ignored). Holiday calendar is not modelled; staleness uses calendar days.
- Watchlists live in one browser; export JSON to move them.

See `RULES_REVIEW.md` and `docs/` for history.
