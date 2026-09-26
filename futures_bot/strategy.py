from dataclasses import dataclass

from indicators import atr, ema, rsi


@dataclass
class Signal:
    side: str | None  # "BUY", "SELL" or None
    price: float
    atr: float
    reason: str = ""


def generate_signal(candles, cfg):
    """EMA crossover in the direction of the long-term trend, filtered by RSI.

    candles: list of closed klines [open_time, open, high, low, close, volume, ...]
    """
    highs = [float(c[2]) for c in candles]
    lows = [float(c[3]) for c in candles]
    closes = [float(c[4]) for c in candles]
    if len(closes) < cfg.trend_ema + 2:
        return Signal(None, closes[-1] if closes else 0.0, 0.0, "not enough data")

    fast, slow, trend = ema(closes, cfg.fast_ema), ema(closes, cfg.slow_ema), ema(closes, cfg.trend_ema)
    r = rsi(closes, cfg.rsi_period)[-1]
    a = atr(highs, lows, closes, cfg.atr_period)[-1]
    price = closes[-1]

    crossed_up = fast[-2] <= slow[-2] and fast[-1] > slow[-1]
    crossed_down = fast[-2] >= slow[-2] and fast[-1] < slow[-1]

    if crossed_up and price > trend[-1] and 50 < r < 70:
        return Signal("BUY", price, a, f"EMA cross up, RSI {r:.1f}")
    if crossed_down and price < trend[-1] and 30 < r < 50:
        return Signal("SELL", price, a, f"EMA cross down, RSI {r:.1f}")
    return Signal(None, price, a, f"no setup, RSI {r:.1f}")
