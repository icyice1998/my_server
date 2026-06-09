# Multi-Timeframe Elliott Wave Analysis Agent

A sophisticated agent that analyzes Elliott Wave patterns across multiple timeframes (5m, 15m, 1H, 4H, D) to determine overall trend direction and trading signals.

## Features

- **Multi-Timeframe Analysis**: Simultaneously analyzes 5 timeframes (5m, 15m, 1H, 4H, Daily)
- **Overall Trend Detection**: Consensus voting across timeframes to determine market bias
- **Strength Assessment**: Evaluates pattern strength and volatility context
- **Confidence Scoring**: HIGH/MEDIUM/LOW confidence based on agreement across timeframes
- **Trading Recommendations**: STRONG_BUY, BUY, HOLD, SELL, STRONG_SELL
- **Visual Output**: Color-coded with emoji indicators for easy interpretation
- **JSON Export**: Full data export for programmatic access

## Installation

Already included in requirements.txt (numpy, requests)

## Usage

```bash
python multiframe_agent.py <SYMBOL>
python multiframe_agent.py <SYMBOL> --json
```

### Examples

```bash
# Crypto analysis with visual output
python multiframe_agent.py BTC/USD
python multiframe_agent.py ETH/USD

# Stock analysis
python multiframe_agent.py AAPL
python multiframe_agent.py MSFT

# Get raw JSON output
python multiframe_agent.py BTC/USD --json
```

## Output Format

### Console Output

**Overall Trend Section:**
```
📈 OVERALL TREND: STRONG_BULLISH
   Confidence: HIGH | Strength: VERY_STRONG
   Bullish: 5/5 | Bearish: 0/5
   📊 STRONG_BUY - Bullish trend confirmed across all timeframes
```

**Timeframe Breakdown:**
```
📈 D     | Pattern: IMPULSE_WAVE_5     | Trajectory: BULLISH    🔥
        Wave Count: 14 | Change: +42.43% | Vol: 3.82%
        Price: 147.53 | High: 152.65 | Low: 134.0
```

### JSON Output (with --json flag)

```json
{
  "symbol": "BTC/USD",
  "timestamp": "2026-06-09T07:34:26.407737",
  "timeframes": {
    "5m": {
      "pattern": "IMPULSE_WAVE_5",
      "trajectory": "BULLISH",
      "wave_count": 14,
      "strength": "VERY_STRONG",
      "price_change_pct": 42.43,
      "volatility_pct": 3.82,
      "current_price": 147.53,
      "high": 152.65,
      "low": 134.0
    },
    ...
  },
  "overall_analysis": {
    "overall_trend": "STRONG_BULLISH",
    "bullish_votes": 5,
    "bearish_votes": 0,
    "bullish_percentage": 100.0,
    "bearish_percentage": 0.0,
    "confidence": "HIGH",
    "strength_consensus": "VERY_STRONG",
    "recommendation": "STRONG_BUY - Bullish trend confirmed across all timeframes"
  }
}
```

## Timeframes Analyzed

| Timeframe | Purpose | Best For |
|-----------|---------|----------|
| **5m** | Short-term micro moves | Scalping, entry refinement |
| **15m** | Intra-hour trends | Short-term trading |
| **1H** | Short-term trend | Swing trading signals |
| **4H** | Medium-term trend | Position trading entry |
| **D** | Long-term trend | Overall market direction |

## Trend Interpretation

### Overall Trend Types

- **STRONG_BULLISH**: 4-5 timeframes showing bullish patterns
- **BULLISH**: 3 timeframes showing bullish patterns
- **NEUTRAL**: Evenly split between bullish and bearish
- **BEARISH**: 3 timeframes showing bearish patterns
- **STRONG_BEARISH**: 4-5 timeframes showing bearish patterns

### Confidence Levels

- **HIGH**: ≥80% agreement on direction
- **MEDIUM**: 60-79% agreement on direction
- **LOW**: <60% agreement or conflicting signals

### Strength Indicators

- 🔥 **VERY_STRONG**: Impulse Wave 5 confirmed
- 💪 **STRONG**: Clear impulse or correction pattern
- ⚡ **MEDIUM**: Pattern forming with moderate strength
- ⚠️ **WEAK**: Early stage or unformed pattern

## Trading Recommendations

| Signal | Action | Confidence |
|--------|--------|-----------|
| **STRONG_BUY** | Go Long | Very High |
| **BUY** | Cautious Long Entry | Medium-High |
| **HOLD** | Wait for Clarity | Low-Medium |
| **SELL** | Short Position | Medium-High |
| **STRONG_SELL** | Strong Short | Very High |

## Key Metrics Provided

For each timeframe:
- **Pattern**: Elliott Wave pattern identified
- **Trajectory**: BULLISH or BEARISH direction
- **Wave Count**: Number of identified peaks/troughs
- **Strength**: Pattern strength classification
- **Price Change %**: Percentage change over analyzed period
- **Volatility %**: Standard deviation of recent price action
- **Current Price**: Latest closing price
- **High/Low**: 20-period high and low

## Consensus Voting System

The agent uses a voting system across timeframes:
- Each timeframe votes BULLISH or BEARISH
- Majority vote determines overall trend
- Vote percentage shows agreement level

**Example:**
```
Bullish: 4/5 timeframes (80%)
Bearish: 1/5 timeframe  (20%)
Result: STRONG_BULLISH with HIGH confidence
```

## Use Cases

1. **Confirm Trade Direction**: Use high-timeframe analysis (D, 4H) to confirm directional bias
2. **Find Entry Points**: Use lower timeframes (15m, 5m) for precise entries within the larger trend
3. **Risk Management**: Higher confidence readings allow larger position sizes
4. **Trend Reversal Detection**: Watch for sudden shifts in consensus across timeframes
5. **Multi-Timeframe Strategy**: Combine with other indicators for robust trading system

## Limitations

- Uses simplified wave detection algorithm
- Requires minimum 20 data points for analysis
- Data sourced from CoinGecko API (crypto) or simulated data
- For production use, integrate with more advanced technical libraries
- Not financial advice; use alongside other analysis

## Example Scenarios

### Scenario 1: Strong Bullish Setup
```
All 5 timeframes showing IMPULSE_WAVE_5 with BULLISH trajectory
→ STRONG_BUY signal with HIGH confidence
→ Suitable for: New long positions with high conviction
```

### Scenario 2: Mixed Signals
```
Higher timeframes (D, 4H): BULLISH
Lower timeframes (15m, 5m): BEARISH or NEUTRAL
→ BUY signal with MEDIUM confidence
→ Suitable for: Cautious entries, wait for lower timeframe confirmation
```

### Scenario 3: Consensus Breakdown
```
No clear trend agreement across timeframes
→ HOLD signal with LOW confidence
→ Suitable for: Wait on sidelines for clarity
```

## Integration

Use the agent in your trading system:

```python
from multiframe_agent import MultiTimeframeAnalyzer
import json

analyzer = MultiTimeframeAnalyzer("BTC/USD")
result = analyzer.analyze()
recommendation = result['overall_analysis']['recommendation']
```

Or call as CLI and parse JSON output for automation.
