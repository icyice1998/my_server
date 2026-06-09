#!/usr/bin/env python3
"""
Elliott Wave Analysis using Claude AI
Analyzes stock price data across multiple timeframes to identify Elliott wave patterns
"""

import json
import sys
import os
import yfinance as yf
import numpy as np
from datetime import datetime, timedelta
import anthropic

def fetch_stock_data(symbol: str, period: int = 250) -> list:
    """Fetch stock data from Yahoo Finance"""
    try:
        end_date = datetime.now()
        start_date = end_date - timedelta(days=period)

        data = yf.download(symbol, start=start_date, end=end_date, progress=False)
        prices = data['Adj Close'].values.tolist()

        return prices
    except Exception as e:
        print(f"Error fetching data for {symbol}: {e}")
        return []

def calculate_indicators(prices: list) -> dict:
    """Calculate technical indicators for Elliott wave analysis"""
    if len(prices) < 20:
        return {}

    prices_array = np.array(prices)

    # Calculate simple moving averages
    sma_20 = np.mean(prices_array[-20:])
    sma_50 = np.mean(prices_array[-50:]) if len(prices_array) >= 50 else sma_20
    sma_200 = np.mean(prices_array[-200:]) if len(prices_array) >= 200 else sma_20

    # Calculate volatility
    returns = np.diff(prices_array) / prices_array[:-1]
    volatility = np.std(returns) * 100

    # Find local peaks and troughs
    peaks = []
    troughs = []

    for i in range(1, len(prices_array) - 1):
        if prices_array[i] > prices_array[i-1] and prices_array[i] > prices_array[i+1]:
            peaks.append((i, prices_array[i]))
        elif prices_array[i] < prices_array[i-1] and prices_array[i] < prices_array[i+1]:
            troughs.append((i, prices_array[i]))

    current_price = prices_array[-1]
    price_change = ((current_price - prices_array[0]) / prices_array[0]) * 100

    return {
        'current_price': float(current_price),
        'sma_20': float(sma_20),
        'sma_50': float(sma_50),
        'sma_200': float(sma_200),
        'volatility': float(volatility),
        'price_change_percent': float(price_change),
        'num_peaks': len(peaks),
        'num_troughs': len(troughs),
        'min_price': float(np.min(prices_array)),
        'max_price': float(np.max(prices_array))
    }

def analyze_with_claude(symbol: str, timeframe: str, indicators: dict, prices: list) -> dict:
    """Use Claude AI to analyze Elliott wave patterns"""

    if not os.getenv('ANTHROPIC_API_KEY'):
        print("Warning: ANTHROPIC_API_KEY not set, using mock analysis")
        return generate_mock_analysis(symbol, timeframe)

    try:
        client = anthropic.Anthropic()

        # Prepare context for analysis
        analysis_context = f"""
Analyze the Elliott Wave pattern for {symbol} on the {timeframe} timeframe.

Technical Indicators:
- Current Price: ${indicators['current_price']:.2f}
- 20-day MA: ${indicators['sma_20']:.2f}
- 50-day MA: ${indicators['sma_50']:.2f}
- 200-day MA: ${indicators['sma_200']:.2f}
- Volatility: {indicators['volatility']:.2f}%
- Price Change: {indicators['price_change_percent']:.2f}%
- Local Peaks Detected: {indicators['num_peaks']}
- Local Troughs Detected: {indicators['num_troughs']}
- Range: ${indicators['min_price']:.2f} - ${indicators['max_price']:.2f}

Price Data (last 20 closes): {[f"${p:.2f}" for p in prices[-20:]]}

Based on this data, provide:
1. The most likely Elliott Wave pattern (5-wave impulse, 3-wave corrective, triangle, wedge, etc.)
2. Current wave count (which wave we're likely in)
3. Confidence level (0-100%)
4. Direction (Bullish/Bearish)
5. Next potential price target
6. Support and resistance levels
7. Brief rationale for your analysis

Format as JSON.
"""

        message = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": analysis_context
                }
            ]
        )

        response_text = message.content[0].text

        # Try to parse JSON from response
        try:
            # Find JSON in response
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            if json_start >= 0 and json_end > json_start:
                json_str = response_text[json_start:json_end]
                result = json.loads(json_str)
                return result
        except json.JSONDecodeError:
            pass

        # If JSON parsing fails, structure the response
        return {
            'pattern': extract_field(response_text, 'pattern', 'Elliott Wave Pattern'),
            'wave_count': extract_field(response_text, 'wave', 'Wave 3'),
            'confidence': extract_percentage(response_text),
            'direction': 'Bullish' if 'bullish' in response_text.lower() else 'Bearish',
            'next_target': extract_price(response_text, indicators['current_price']),
            'support': float(indicators['min_price']),
            'resistance': float(indicators['max_price']),
            'analysis': response_text
        }

    except Exception as e:
        print(f"Error in Claude analysis: {e}")
        return generate_mock_analysis(symbol, timeframe)

def extract_field(text: str, field: str, default: str) -> str:
    """Extract field value from text"""
    import re
    pattern = rf'{field}["\'\s:]+([^"\'\n,}}]+)'
    match = re.search(pattern, text, re.IGNORECASE)
    return match.group(1).strip() if match else default

def extract_percentage(text: str) -> float:
    """Extract confidence percentage from text"""
    import re
    match = re.search(r'(\d+)\s*%', text)
    return float(match.group(1)) if match else 75.0

def extract_price(text: str, current_price: float) -> float:
    """Extract next target price from text"""
    import re
    matches = re.findall(r'\$(\d+\.?\d*)', text)
    if matches:
        return float(matches[-1])
    return current_price * 1.05

def generate_mock_analysis(symbol: str, timeframe: str) -> dict:
    """Generate realistic mock analysis for demonstration"""
    import random

    patterns = ['Impulse Wave (5-3-5-3-5)', 'Corrective Wave (Zigzag)', 'Triangle', 'Wedge Formation']
    waves = ['Wave 1', 'Wave 2', 'Wave 3', 'Wave 4', 'Wave 5', 'Wave A', 'Wave B', 'Wave C']

    return {
        'pattern': random.choice(patterns),
        'wave_count': random.choice(waves),
        'confidence': random.uniform(60, 95),
        'direction': random.choice(['Bullish', 'Bearish']),
        'next_target': f"{random.uniform(100, 200):.2f}",
        'support': f"{random.uniform(50, 100):.2f}",
        'resistance': f"{random.uniform(150, 250):.2f}",
        'waves': [
            {
                'name': random.choice(waves),
                'start': random.uniform(0, 50),
                'end': random.uniform(50, 100)
            }
        ]
    }

def analyze_stock(symbol: str, timeframes: list = None, period: int = 250) -> dict:
    """Main analysis function"""

    if timeframes is None:
        timeframes = ['1d', '4h', '1h', '15m', '5m', '1m']

    print(f"Analyzing {symbol}...")

    # Fetch data
    prices = fetch_stock_data(symbol, period)
    if not prices:
        return {'error': f'Could not fetch data for {symbol}'}

    # Calculate indicators
    indicators = calculate_indicators(prices)
    print(f"Indicators calculated for {symbol}")

    # Analyze each timeframe
    results = {
        'symbol': symbol,
        'timestamp': datetime.now().isoformat(),
        'analysis': {}
    }

    for timeframe in timeframes:
        print(f"Analyzing {timeframe} timeframe...")
        analysis = analyze_with_claude(symbol, timeframe, indicators, prices)
        results['analysis'][timeframe] = analysis

    return results

def main():
    if len(sys.argv) < 2:
        print("Usage: python elliott_wave_analyzer.py SYMBOL [timeframe1 timeframe2 ...]")
        sys.exit(1)

    symbol = sys.argv[1].upper()
    timeframes = sys.argv[2:] if len(sys.argv) > 2 else ['1d', '4h', '1h']

    results = analyze_stock(symbol, timeframes)

    # Save results
    output_file = f'analysis_results_{symbol}.json'
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\nAnalysis saved to {output_file}")
    print(json.dumps(results, indent=2))

if __name__ == '__main__':
    main()
