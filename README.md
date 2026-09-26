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

```bash
pip install -r requirements.txt
python -m market_analyzer PTT KBANK --market TH          # SET stocks (.BK added automatically)
python -m market_analyzer AAPL NVDA                      # US stocks
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

The site home page (`index.html`, i.e. https://icyice1998.github.io/my_server/) lists all reports, and
**Run a new analysis on GitHub** starts the *Market Analysis* workflow, waits for it and opens the new report.

1. Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
2. Create a fine-grained token (GitHub → Settings → Developer settings → Fine-grained tokens):
   repository access *Only select repositories* → `my_server`; permissions *Actions: Read and write*.
   Paste it into the page once; it is kept only in that browser's local storage.
   Without a token the button opens the workflow page, where *Run workflow* does the same thing.
3. Optional: add the `SEC_API_KEY` repository secret for Thai mutual funds.

The workflow commits `reports/*.json`, Pages republishes (about 1 minute), and the page picks up the new file.
The earlier AI Elliott-wave page is kept as `elliott_legacy.html`.

Data: Yahoo Finance via `yfinance`. Thai mutual funds are not on Yahoo; use the SEC Thailand open API
(free key from api-portal.sec.or.th) or a local NAV CSV (`Date,Close`) plus a fact-sheet JSON.
Statistical and rule-based analysis for education only; not investment advice.

---

# 🌊 Elliott Wave Analysis AI

A web-based application that uses AI to analyze stock price data and identify Elliott wave patterns across multiple timeframes.

## Features

✨ **AI-Powered Analysis**: Uses Claude AI to identify Elliott wave patterns and provide analysis  
📊 **Multi-Timeframe Support**: Analyze stocks on 1m, 5m, 15m, 1h, 4h, 1d, weekly, and monthly timeframes  
💰 **Live Stock Data**: Automatically fetches current stock data from Yahoo Finance  
🎯 **Price Targets**: AI generates potential price targets, support, and resistance levels  
📈 **Interactive Charts**: Visual representation of price action and analysis results  
🚀 **Serverless Architecture**: Uses GitHub Actions for processing, GitHub Pages for hosting  

## Access the App

Visit: **[https://icyice1998.github.io/my_server/](https://icyice1998.github.io/my_server/)**

## How It Works

1. **Enter Stock Symbol**: Input any valid stock ticker (e.g., AAPL, MSFT, TSLA)
2. **Select Timeframes**: Choose which timeframes to analyze
3. **Run Analysis**: Click "Analyze" button
4. **View Results**: See AI-generated Elliott wave analysis with price targets and confidence levels

## Elliott Wave Theory

Elliott Wave Theory suggests that price movements follow a natural rhythm:
- **Impulse Waves**: 5 waves moving in the direction of the main trend
- **Corrective Waves**: 3 waves moving against the main trend

This application uses AI to:
- Identify these wave patterns across multiple timeframes
- Detect potential turning points
- Calculate price targets
- Determine trend direction (Bullish/Bearish)

## Setup & Deployment

### Prerequisites
- Python 3.9+
- GitHub account (for Actions and Pages)
- Anthropic API key (for Claude AI analysis)

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Set your API key
export ANTHROPIC_API_KEY=your_api_key_here

# Run analysis manually
python elliott_wave_analyzer.py AAPL 1d 4h 1h
```

### GitHub Setup

1. **Enable GitHub Pages**:
   - Go to Settings → Pages
   - Set source to `main` branch, root directory
   - Visit your site at `https://yourusername.github.io/my_server/`

2. **Add API Key to Secrets**:
   - Go to Settings → Secrets and variables → Actions
   - Create new secret: `ANTHROPIC_API_KEY` with your Claude API key
   - Get your key from [console.anthropic.com](https://console.anthropic.com)

3. **Run Analysis via GitHub Actions**:
   - Go to Actions tab
   - Select "Elliott Wave Analysis" workflow
   - Click "Run workflow"
   - Input stock symbol and timeframes
   - Results are saved and accessible to the web app

## Project Structure

```
.
├── index.html                          # Main web application
├── elliott_wave_analyzer.py            # AI analysis script
├── requirements.txt                    # Python dependencies
├── _config.yml                         # GitHub Pages config
├── README.md                          # This file
└── .github/
    └── workflows/
        └── elliott_wave_analysis.yml  # GitHub Actions workflow
```

## Technical Stack

- **Frontend**: HTML5, CSS3, JavaScript
- **Data Source**: Yahoo Finance API
- **AI Analysis**: Claude 3.5 Sonnet (Anthropic)
- **Processing**: Python, NumPy
- **Hosting**: GitHub Pages (static)
- **Compute**: GitHub Actions (serverless)

## API Integration

### Stock Data
- **Source**: Yahoo Finance
- **Endpoint**: `https://query1.finance.yahoo.com/v7/finance/download/`
- **Rate Limit**: ~2000 requests/day per IP

### AI Analysis
- **Model**: Claude 3.5 Sonnet
- **Provider**: Anthropic
- **Max Tokens**: 1024 per analysis

## Features & Limitations

### What Works Well
✅ Identifies common Elliott wave patterns  
✅ Analyzes multiple timeframes simultaneously  
✅ Generates price targets based on wave theory  
✅ Works with any publicly traded stock  
✅ No installation required (web-based)  

### Limitations
⚠️ Educational purposes only - not financial advice  
⚠️ Historical data analysis - past patterns don't guarantee future results  
⚠️ Best used with other technical analysis tools  
⚠️ Real-time intraday data may have delays  
⚠️ AI analysis depends on model quality and market conditions  

## Disclaimer

**This application is for educational purposes only.** Elliott Wave analysis is subjective and past performance does not guarantee future results. Always do your own research and consult with a financial advisor before making trading decisions.

## Security & Privacy

- ✅ No data is stored (analysis results cached temporarily)
- ✅ Your API key stored only in GitHub Secrets
- ✅ No tracking or analytics
- ✅ Open source - code is transparent

## Contributing

Feel free to fork this project and submit pull requests with improvements!

### Ideas for Enhancement
- Add more technical indicators
- Implement additional chart patterns
- Add portfolio tracking
- Create trading alerts
- Support for options analysis
- Dark/light theme toggle

## Resources

- [Elliott Wave Principle](https://www.investopedia.com/terms/e/elliottwavetheory.asp)
- [Claude AI Documentation](https://docs.anthropic.com/)
- [Yahoo Finance API](https://finance.yahoo.com/)
- [GitHub Pages Docs](https://docs.github.com/en/pages)
- [GitHub Actions Docs](https://docs.github.com/en/actions)

## License

MIT License - Feel free to use and modify as needed.

## Support

For issues, questions, or suggestions, please create an issue on GitHub.

---

**Last Updated**: June 2026  
**Status**: Active Development  
**Version**: 1.0.0
