# STRATA Markets — Trading Rules Review (v0.3)

This document records the rules reviewed from the discontinued reference project and how they are treated in STRATA. The reference is used for strategy/rule ideas only; its product design, UI, architecture, workflows, and branding are not imported.

## Adopted in this implementation

1. **Data gate:** required core indicators and a minimum set of fundamental fields are required before a scored signal is published. Impossible OHLC rows and negative volume are filtered before indicator calculation. Symbols with a bar date older than the snapshot date are blocked.
2. **Market regime:** a deterministic heuristic combines benchmark 20-session return, breadth above SMA50/SMA200, average RSI and ADX. It returns one of Strong Risk-On, Risk-On, Neutral, Risk-Off, Strong Risk-Off, or Insufficient Data. Missing evidence is listed; insufficient evidence must not be labelled neutral.
3. **Setup taxonomy:** breakout, trend continuation, relative-strength leader, and oversold recovery are descriptive labels generated from observable conditions. They are not forecasts and are not success probabilities.
4. **Relative strength:** stock 20-session return is compared with the Nifty 50 benchmark return when both histories are available.
5. **Sector/industry rotation:** sector summaries show average available score, one-day return, breadth above SMA50, and counts of Strong Buy/Buy versus Sell/Strong Sell candidates. This is a heuristic summary, not a predictive claim.
6. **Risk planning utility:** pure position sizing and risk/reward calculations are available for future use. It estimates quantity from capital and risk budget and explicitly excludes fees, slippage, gaps and liquidity constraints.
7. **Indicator additions:** volume ratio, Bollinger Bands, ADX, +DI/-DI and 1-day return join existing SMA, RSI, MACD, ATR and 20-day return calculations.
8. **Five-level signals:** `STRONG BUY`, `BUY`, `HOLD`, `SELL`, and `STRONG SELL` are derived from deterministic score gates and bearish-condition checks. `DATA BLOCKED` remains a separate data-quality state.
9. **Paper execution:** Strong Buy/Buy may open an eligible long cash-equity position; Sell/Strong Sell may exit held shares; Hold does not trade. Sell signals never open short positions.
10. **Transparency:** setup strength remains a heuristic score, not a probability. Risk warnings are surfaced in the signal payload.

## Not treated as validated alpha

- Thresholds, score weights, market-regime cutoffs and sector-rotation coefficients remain hypotheses.
- Setup labels are classifications, not evidence of profitability.
- Market regime currently uses the available custom universe for breadth, so it is only representative of the supplied universe. A proper, maintained Nifty 500 constituent file is required for Nifty 500 breadth.
- India VIX (^INDIAVIX via yfinance) now feeds the regime's volatility penalty (20-session change) when a value is available; if the feed is missing the penalty is omitted rather than assumed. Unvalidated, like every other coefficient.
- The risk planner is a pure utility and does not itself place orders or alter the existing model ledger sizing policy.

## Deferred until a credible backtest exists

- Reweighting scores based on historical setup expectancy.
- Using regime labels to veto entries rather than warn.
- Additional setup families such as value + momentum and multi-timeframe alignment; current data contract does not consistently provide the inputs needed to implement these honestly.
- Rule attribution, robust walk-forward evaluation and strategy parameter calibration. These require adjusted-price/corporate-action review, realistic transaction costs, slippage and no-lookahead execution assumptions.
- Automated live alerts until a reliable refresh schedule and current-data validation are in place.

## Versioning and safety

Ruleset version: `strata-rules-0.3.0`.

Signals are research outputs only, not guaranteed outcomes or personalized financial advice. `yfinance` is an unofficial data interface; provider coverage, exchange-calendar freshness, symbol mapping, corporate actions and terms must be validated before relying on results.

---
## v2.0 changes (ruleset `strata-rules-0.4.0`)
- **Financials:** debt/equity skipped and weights rescaled for banks/NBFCs/insurers.
- **Exit hysteresis:** Sell/Strong Sell need close < 98% of SMA50 (reduces whipsaw).
- **Paper bot:** 3×ATR chandelier trailing stop, 14-day re-entry cooldown, liquidity gate (₹2 Cr/day 20d traded value).
- **Backtester** (`engine/backtest.py`): technical rules only, next-open fills, 20 bps costs, vs Nifty buy-and-hold. Output shown on the Backtest page.
- **Still unvalidated:** every threshold and weight. Treat the backtest as a smoke test, not proof of edge.

---
## v3.0 changes (terminal v3.0, ruleset `strata-rules-0.4.0`)
- **UI Architecture:** Complete 5-module workspace architecture with state stack router, unified 6-tab stock view, and dual Graphite/Ivory design system.
- **Chart Performance:** Per-symbol chart sharding (`app/charts/<SYM>.json`), Bollinger Bands, and interactive timeframe slicing.
- **Data Integrity:** Strict schema validation step in daily GitHub Actions pipeline before publishing; static NSE holiday awareness.
- **Constraints Maintained:** 100% free-tier, zero-build, no broker connection, no serverless functions, no fabricated data.
