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
node --test tests/strategy.test.js       # strategy engine tests (no look-ahead, caps, lots, sizing)
```

The stock list is `pipeline/stocks.json` (S&P 500 with GICS sectors, plus SET stocks with Yahoo sectors).
