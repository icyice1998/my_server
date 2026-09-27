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

### Web dashboard

The site (https://icyice1998.github.io/my_server/market/) has three views:

- **Overview**: KPI tiles (bullish / neutral / bearish counts, average 3-month return, oversold count), market breadth
  for SET / US / ETFs, top bullish and bearish assets, screener shortcuts and the list of full reports.
- **Screener**: 177 assets (SET large caps, US large caps, popular ETFs) with presets (momentum leaders, oversold,
  value + dividend, quality at a fair price, Elliott wave 2 → 3 up, SMC bullish CHoCH, SMC bullish + discount,
  near 52-week high, analyst upside ≥ 20%), text / market / outlook filters and sortable columns.
- **Asset**: KPI tiles, the chart with Elliott waves, SMC zones and the projection cone, and every analysis card.

Type a **name or ticker** in the search box ("PTT", "CP All", "Kasikorn", "Apple", "S&P 500 ETF"). An existing
report or screener row opens at once; anything else starts a GitHub Actions run. With a token saved in settings
the page starts the run itself; without one it opens a pre-filled GitHub issue, and submitting
it starts the run (`market analyze: <name>`). Only issues opened by the repository owner are accepted.

All commands run from this folder (`cd market`).

```bash
pip install -r requirements.txt
python -m market_analyzer PTT KBANK --market TH          # SET stocks (.BK added automatically)
python -m market_analyzer AAPL NVDA                      # US stocks
python -m market_analyzer --query "CP All, Apple" --market AUTO   # names are resolved via Yahoo search
python -m market_analyzer --screen TH,US,ETF             # screener -> reports/screener.json
python -m market_analyzer VOO VFIAX --type fund          # US ETF / mutual fund
python -m market_analyzer MYFUND --market TH --nav nav.csv --factsheet sheet.json   # any fund, local data
SEC_API_KEY=... python -m market_analyzer K-USA --market TH --sec                  # Thai mutual fund via SEC API
python -m pytest -q tests
```

Every parameter also gets a **reason compared with its own past**: its percentile rank over the last ~5 years
and what price did over the next 1 and 3 months on past days with a similar reading ("tailwind", "headwind"
or "no clear edge" vs the all-days base rate). Elliott counts are re-run weekly on past data to report their
own hit rate, SMC structure events report what followed past BOS/CHoCH on the same chart, and accounts are
compared year by year.

### Run it from the web (GitHub Pages + Actions)

The dashboard (`market/index.html`, i.e. https://icyice1998.github.io/my_server/market/) lists all reports, and
**Run a new analysis on GitHub** starts the *Market Analysis* workflow, waits for it and opens the new report.

1. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
2. Create a fine-grained token (GitHub → Settings → Developer settings → Fine-grained tokens):
   repository access *Only select repositories* → `my_server`; permissions *Actions: Read and write*.
   Paste it into the page once; it is kept only in that browser's local storage.
   Without a token the button opens a pre-filled `market analyze: <name>` issue; submitting it does the same thing.
3. Optional: add the `SEC_API_KEY` repository secret for Thai mutual funds.

The workflow commits `market/reports/*.json`, Pages republishes (about 1 minute), and the page picks up the new file.

## Project structure

```
market/
├── index.html                    # Web dashboard (published at /my_server/market/)
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
│   ├── resolve.py                # Name / ticker -> Yahoo symbol and market
│   ├── screener.py               # One row of key metrics per asset
│   └── universe.py               # Screener universe (SET, US, ETF)
├── reports/                      # Generated reports + index.json (read by the web app)
├── tests/                        # Offline unit tests (pytest)
└── README.md

.github/workflows/                # at the repository root
├── market_analysis.yml           # Analyze on demand (dispatch or "market analyze:" issue) + weekday watchlist
└── market_screener.yml           # Weekday screener refresh (dispatch or "market screen:" issue)
```

Data: Yahoo Finance via `yfinance`. Thai mutual funds are not on Yahoo; use the SEC Thailand open API
(free key from api-portal.sec.or.th) or a local NAV CSV (`Date,Close`) plus a fact-sheet JSON.
Statistical and rule-based analysis for education only; not investment advice.
