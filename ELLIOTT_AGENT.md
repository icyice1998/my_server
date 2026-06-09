# Elliott Wave Analysis Agent

A simple agent that analyzes Elliott Wave patterns for cryptocurrencies and stocks.

## Features

- **Pattern Detection**: Identifies Elliott Wave patterns (Impulse, Correction, etc.)
- **Trajectory Analysis**: Determines the direction and momentum of the pattern
- **Support/Resistance**: Calculates key price levels
- **Multiple Assets**: Works with cryptocurrencies (BTC/USD, ETH/USD) and stocks (AAPL, MSFT, etc.)
- **Flexible Timeframes**: Accepts any timeframe (15m, 5m, 4H, 1D, etc.)

## Installation

```bash
pip install -r requirements.txt
```

## Usage

```bash
python elliott_agent.py <SYMBOL> <TIMEFRAME>
```

### Examples

```bash
# Crypto analysis
python elliott_agent.py BTC/USD 15m
python elliott_agent.py ETH/USD 5m
python elliott_agent.py BTC/USD 4H

# Stock analysis
python elliott_agent.py AAPL 15m
python elliott_agent.py MSFT 4H
python elliott_agent.py GOOGL 1D
```

## Output

The agent returns a JSON object with:
- `symbol`: The analyzed asset
- `timeframe`: The specified timeframe
- `pattern`: The detected Elliott Wave pattern (IMPULSE_WAVE_1, IMPULSE_WAVE_3, IMPULSE_WAVE_5, CORRECTION_WAVE, etc.)
- `trajectory`: The direction and status (BULLISH_CONTINUATION, BEARISH_REVERSAL, PATTERN_FORMING, etc.)
- `levels`: Support, resistance, midpoint, and current price
- `data_points`: Number of data points analyzed
- `timestamp`: Analysis timestamp

### Example Output

```json
{
  "symbol": "BTC/USD",
  "timeframe": "15m",
  "timestamp": "2026-06-09T07:29:39.362139",
  "pattern": "IMPULSE_WAVE_5",
  "trajectory": "BULLISH_COMPLETION (HIGH_VOLATILITY)",
  "levels": {
    "support": 42500.25,
    "resistance": 44800.75,
    "midpoint": 43650.50,
    "current_price": 44200.00
  },
  "data_points": 100
}
```

## Patterns

- **IMPULSE_WAVE_1**: Initial upward movement
- **IMPULSE_WAVE_3**: Strongest impulse movement
- **IMPULSE_WAVE_5**: Final impulse movement before correction
- **CORRECTION_WAVE**: Corrective price movement
- **UNKNOWN**: Pattern not yet identified

## Trajectories

- **BULLISH_CONTINUATION**: Price expected to continue rising
- **BULLISH_COMPLETION**: Impulse wave 5 complete, correction expected
- **BEARISH_REVERSAL**: Price expected to decline
- **BEARISH_DECLINE**: Initial bearish impulse
- **PATTERN_FORMING**: Pattern still developing

## Data Sources

- **Crypto**: CoinGecko API (free, no API key required)
- **Stocks**: Simulated data (for demo purposes)

## Supported Timeframes

- Minutes: 1m, 5m, 15m, 30m
- Hours: 1H, 4H, 12H
- Days: 1D, 1W, 1M

## Limitations

- Uses simplified wave detection algorithm
- Requires minimum 20 data points for analysis
- Volatility context is qualitative
- For production use, consider integrating with more advanced technical analysis libraries
