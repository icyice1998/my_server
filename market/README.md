# 📊 Market Analyzer: Thai stocks, US stocks, funds

`market_analyzer/` analyzes a stock or fund from three angles and combines them into one outlook:

| Angle | Stocks | Funds |
|---|---|---|
| Price pattern | SMA 20/50/200, RSI, MACD, ADX, regression slope, support/resistance, swing structure, double top/bottom, golden/death cross, 55-bar breakout | same, on price or NAV |
| Accounts / fact sheet | Income statement, balance sheet, cash flow → growth CAGR, margins, ROE/ROA, D/E, current ratio, cash conversion, P/E, P/BV, fair-value anchors | Expense ratio vs category, turnover, top-10 concentration, sector tilt, Sharpe/Sortino, drawdown |
| Elliott Wave | ZigZag swings at 3 degrees (3, 5, 8 x ATR); counts checked against the 3 hard rules (W2 < 100% of W1, W3 not shortest, W4 no overlap with W1) and scored on Fibonacci ratios; current wave, targets, invalidation, alternates | same |
| Smart Money Concepts | Swing structure, BOS / CHoCH, order blocks (fresh / mitigated / broken), fair value gaps, equal highs/lows liquidity, sweeps, premium / discount and OTE zones | same |
| Prediction | Bootstrap Monte Carlo of daily returns (drift shrunk 50%) → p5/p25/median/p75/p95 and P(up) at 1m/3m/6m, plus a walk-forward hit-rate check | same |

Outlook score (−100…+100) = weighted trend 0.4, Monte-Carlo P(up) 0.2, fundamentals or fact sheet 0.3,
SMC bias 0.15, Elliott bias 0.1, valuation 0.1 (weights re-normalised over the parts available).
The weights are in `forecast.composite_outlook`.

### Web dashboard: everything runs in your browser

The site (https://icyice1998.github.io/my_server/market/) needs no server, token or GitHub round trip.
Type a **name or ticker** ("PTT", "thai oil", "Kasikorn", "Apple", "S&P 500") and the page finds it in the
769-asset universe (SET stocks, the S&P 500, popular ETFs), loads that asset's published daily prices and
runs the whole analysis locally in `engine.js`: trend and patterns, Elliott Wave, Smart Money Concepts,
the history comparison of every parameter, the Monte Carlo projection and the prediction model.
`engine.js` is a line-by-line port of the Python modules; a test checks both give identical results.

- **Overview**: KPI tiles, market breadth, top bullish / bearish, the model's top picks and its out-of-sample check.
- **Screener**: every asset with presets (model top picks, momentum, oversold, value + dividend, quality,
  Elliott wave 2 → 3 up, SMC CHoCH / discount, near 52-week high, analyst upside), filters and sortable columns.
- **Asset**: KPI tiles, chart with Elliott waves / SMC zones / projection cone, prediction model with its drivers,
  and every analysis card.

### Prediction model (`market_analyzer/model.py`)

Own logistic regression (Newton / IRLS) and ridge regression on 18 price-only features (returns 1 week to 1 year,
RSI, distance from SMA 20/50/200, volatility, drawdown, range position, MACD, ATR, volume, market). Target:
**will the asset beat the median of its own market (SET or US) over the next 21 trading days**, and by how much.
Absolute direction was tested first and had no out-of-sample skill (AUC 0.50), because most of a month's move is
the whole market's; relative performance is predictable to a small degree.

Walk-forward check on the last year, never seen in training: AUC 0.522, well calibrated, and the top-ranked tenth
beat its market by about +2.6% a month vs -0.1% for the bottom tenth. The numbers are republished with every
retrain in `model/model.json` and shown on the dashboard. It ranks assets; it cannot time the market.

### Command line (local only)

The deep per-asset report (4 years of financial statements, fund fact sheets, Thai mutual funds via the SEC API)
is kept as a local command-line tool. It is no longer run on GitHub, so it uses no Actions minutes.
All commands run from this folder (`cd market`); reports are written to `reports/` on your machine.

```bash
pip install -r requirements.txt
python -m market_analyzer PTT KBANK --market TH          # SET stocks (.BK added automatically)
python -m market_analyzer AAPL NVDA                      # US stocks
python -m market_analyzer --query "CP All, Apple" --market AUTO   # names are resolved via Yahoo search
python -m market_analyzer --screen ALL --export-data data # screener + browser price files
python -m market_analyzer --train model/model.json       # retrain the prediction model
python -m market_analyzer VOO VFIAX --type fund          # US ETF / mutual fund
python -m market_analyzer MYFUND --market TH --nav nav.csv --factsheet sheet.json   # any fund, local data
SEC_API_KEY=... python -m market_analyzer K-USA --market TH --sec                  # Thai mutual fund via SEC API
python -m pytest -q tests
```

Every parameter also gets a **reason compared with its own past**: its percentile rank over the last ~5 years
and what price did over the next 1 and 3 months on past days with a similar reading ("tailwind", "headwind"
or "no clear edge" vs the all-days base rate). Elliott counts are re-run weekly on past data to report their
own hit rate, and SMC structure events report what followed past BOS/CHoCH on the same chart. The local
command-line report also compares the accounts year by year.

### How the site stays current (GitHub Actions, no user action)

| Workflow | When | What it writes |
|---|---|---|
| `market_screener.yml` | weekdays 18:40 Bangkok | `reports/screener.json` (with model scores) and `data/prices/*.json` for the browser |
| `market_model.yml` | Sundays | retrained `model/model.json` with fresh validation numbers |

Only these two jobs run on GitHub: about one short run per weekday and one per week. Nothing is started per
asset or per visitor. GitHub Pages must deploy from branch `main`, folder `/ (root)`.

## Project structure

```
market/
├── index.html                    # Web dashboard (published at /my_server/market/)
├── engine.js                     # Browser port of the analysis + model scoring
├── data/prices/                  # Daily prices per asset (~630 bars), refreshed on weekdays
├── model/model.json              # Model coefficients + validation
├── requirements.txt
├── market_analyzer/
│   ├── __main__.py               # CLI
│   ├── data.py                   # Yahoo Finance, SEC Thailand API, local NAV CSV
│   ├── technical.py              # Indicators, trend, support/resistance, chart patterns
│   ├── context.py                # Each parameter vs its own history
│   ├── elliott.py                # Elliott Wave counting + walk-forward check
│   ├── smc.py                    # Smart Money Concepts
│   ├── fundamental.py            # Financial statements, year-by-year history
│   ├── fund.py                   # Fund fact sheet and NAV statistics
│   ├── forecast.py               # Monte Carlo projection, composite outlook
│   ├── report.py                 # JSON and plain-text reports
│   ├── resolve.py                # Name / ticker -> Yahoo symbol and market (CLI)
│   ├── screener.py               # One row of key metrics per asset
│   ├── model.py                  # Own prediction model: features, training, validation
│   ├── export.py                 # Compact daily price files for the browser
│   ├── names.json                # Asset names and types for search
│   └── universe.py               # 769 assets: SET, S&P 500, ETFs
├── reports/screener.json         # Screener rows + model scores (read by the web app)
├── tests/                        # Offline unit tests (pytest)
└── README.md

.github/workflows/                # at the repository root
├── market_screener.yml           # Weekday screener + browser price data
└── market_model.yml              # Weekly model retraining
```

Data: Yahoo Finance via `yfinance`. Thai mutual funds are not on Yahoo; use the SEC Thailand open API
(free key from api-portal.sec.or.th) or a local NAV CSV (`Date,Close`) plus a fact-sheet JSON.
Statistical and rule-based analysis for education only; not investment advice.
