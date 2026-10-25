# V3 Bull: bull-run signals, position sizing and auto-backtest

Live page: https://icyice1998.github.io/my_server/market/

A static dashboard for **S&P 500** and **SET** stocks. Everything (signals, price plans, sizing, backtests) runs in
the visitor's browser from published data; nothing is computed per request on a server or on GitHub.

## Views

- **Live signals**: macro gate, positions / slots, unit size, signal counts, breadth, model-portfolio value,
  sector usage against the per-sector cap, and every stock with its five checks, fire date, 6-month momentum and
  status. Selecting a stock shows a candle chart (EMA 12/26, SMA 50/200, RSI) with the stop and 2R/3R targets, the
  price plan (buy zone, stop, targets, shares, position value, loss if stopped) and the model position if held.
- **Backtest**: runs the current strategy over 1–4 years: CAGR, total return, max drawdown, Sharpe, win rate,
  trades, exposure vs the index; equity curve, year-by-year table, exit reasons and the trade list.
  **Auto backtest** grid-searches 108 combinations (slots, trailing stop, RSI min, distance from the 52-week high)
  on the first 70% of the period and reports how the best ones did on the unseen last 30%; any row can be applied.
- **Strategy**: the plan and position sizing (account size, equal slots or risk-based sizing, sector cap, risk %,
  volatility stop, max position, macro gate, entry and exit rules, fees). Saved per market in the browser.

## Mode 2 · Algo Lab (`algo.js`, `lab.js`)

Build your own algorithm from rules and test how good its decisions are.

- **Entry rules** `indicator · operator · indicator or number`, joined with ALL or ANY. Indicators: close, SMA(n), EMA(n),
  RSI(n), return % over n days, volatility %, % from n-day high / low, MACD histogram %, index close, index SMA(n).
  Operators: above, below, at or above, at or below, crosses above, crosses below.
- **Exit rules** (any of them), stop loss %, take profit %, max holding days; **ranking** indicator for full slots.
- **Decision test**: every sampled stock-day gets a buy / no-buy decision and a score (share of entry rules met + a
  small tie-break from the ranking indicator), compared with whether the stock beat the index (or rose) over the next
  5–63 days. Reported: **ROC AUC** with a 95% interval (Hanley–McNeil) and the ROC curve, in-sample vs out-of-sample
  AUC (last 30% of dates), decision AUC (balanced accuracy), confusion matrix, precision vs base rate, lift, recall,
  specificity, F1, MCC, information coefficient, average forward return with vs without a signal, and score deciles.
- **Portfolio backtest** of the same algorithm with the account, slots, sector cap, sizing and fees from the Strategy
  tab. Algorithms are saved in the browser; four presets are included (none of them shows a real edge: AUC ≈ 0.49–0.50).

## Machine learning · improve the AUC (`ml.js`)

Below the Algo Lab, **Train ML model** learns a better score than "share of entry rules met", entirely in the browser.

- **Features** (known at day *t*'s close): 18 price features of each stock ranked across all stocks that day (returns 5d–12m,
  12-1 momentum, volatility, RSI 5/14, % vs SMA 20/50/200, SMA50 vs SMA200, distance to 20-day / 52-week high and 52-week low,
  MACD histogram), the share of your entry rules met, and 4 index-regime features (only for the "rose" outcome; for "beat the
  index" they only let a model memorise periods).
- **Models**: L2 logistic regression (IRLS, penalty chosen on validation) and gradient-boosted trees (depth 3, 32-bin histograms,
  rate 0.1, row subsampling, early stopping on validation AUC). The model with the higher validation AUC is chosen.
- **Validation**: test = the same last 30% of dates as the rules test, never seen in training; train = dates whose outcome window
  ends before the test starts; validation = last 20% of the training dates (purged by the horizon again).
- **Reported**: train / validation / test AUC for rules, logistic and trees, the test ROC curves, the AUC gain with a 95%
  day-block bootstrap interval, precision / lift / MCC of buying the top 10–30% by ML score each day, feature importance, score
  deciles, and a portfolio backtest of the unseen period (ML only, or ML + rules) against rules only and the index.
- On S&P 500 data the presets go from test AUC ≈ 0.48–0.51 (rules) to ≈ 0.52–0.53 (ML). SET results are noisier
  (validation AUC < 0.5). A better AUC does not guarantee a better portfolio.

## Strategy (`strategy.js`)

1. **Macro gate**: new buys only while the index is above its 200-day average (option: also SMA50 > SMA200).
   The SET gate uses an equal-weight index of the tracked SET stocks, because Yahoo has no history for `^SET.BK`.
2. **Bull-run checks**: close above SMA50 and SMA200, SMA50 > SMA200, EMA12 > EMA26, RSI 14 inside the band,
   close within X% of the 52-week high.
3. **Ranking**: qualifying stocks by 6-month return; the strongest fill free slots, at most N per sector.
4. **Exits**: trailing stop from the highest close since entry, or a close below SMA50.
5. **Sizing**: equal slots (equity ÷ slots) or risk-based (risk % of equity with the stop at k × 20-day volatility,
   capped per position). SET orders round down to 100-share lots.

Signals use data up to each close and fill at the next close (tested: changing later prices never changes earlier
decisions). Backtests use today's index members, so they carry **survivorship bias** and look better than real
trading would have. Education only, not investment advice.

## Data and the one GitHub job

`.github/workflows/market_data.yml` runs once per weekday (05:30 Bangkok, after the US close) and runs
`python -m pipeline.build --out data` from this folder:

| File | Content |
|---|---|
| `data/meta.json` | stock list (symbol, name, sector, market) and build time |
| `data/panel_US.json`, `data/panel_TH.json` | 5 years of daily closes per stock + the market index |
| `data/ohlc/*.json` | ~400 daily candles per stock for the chart |

```bash
cd market
pip install -r requirements.txt
python -m pipeline.build --out data      # rebuild the data locally
python -m pytest -q tests                # pipeline tests
node --test tests/strategy.test.js tests/algo.test.js tests/ml.test.js   # engine + Algo Lab tests (no look-ahead, AUC, caps)
```

The stock list is `pipeline/stocks.json` (S&P 500 with GICS sectors, plus SET stocks with Yahoo sectors).
