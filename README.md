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
