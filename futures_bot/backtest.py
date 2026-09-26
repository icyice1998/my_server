"""Backtest the strategy on historical klines before risking money.

Usage: python backtest.py BTCUSDT 15m 1500
"""
import sys

from client import FuturesClient
from config import Config
from risk import stop_and_target
from strategy import generate_signal

FEE = 0.0005  # taker fee per side


def backtest(candles, cfg, equity=1000.0):
    trades, pos = [], None
    for i in range(cfg.trend_ema + 2, len(candles)):
        high, low = float(candles[i][2]), float(candles[i][3])
        if pos:
            side, entry, sl, tp, qty = pos
            hit_sl = low <= sl if side == "BUY" else high >= sl
            hit_tp = high >= tp if side == "BUY" else low <= tp
            if hit_sl or hit_tp:
                exit_px = sl if hit_sl else tp  # assume worst case when both touched
                pnl = (exit_px - entry) * qty * (1 if side == "BUY" else -1)
                pnl -= (entry + exit_px) * qty * FEE
                equity += pnl
                trades.append(pnl)
                pos = None
            continue
        sig = generate_signal(candles[:i + 1], cfg)
        if sig.side:
            sl, tp = stop_and_target(sig.side, sig.price, sig.atr, cfg)
            qty = min(equity * cfg.risk_per_trade / abs(sig.price - sl),
                      equity * min(cfg.max_notional_x, cfg.leverage) / sig.price)
            pos = (sig.side, sig.price, sl, tp, qty)
    return equity, trades


def main():
    symbol = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
    interval = sys.argv[2] if len(sys.argv) > 2 else "15m"
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else 1500
    cfg = Config()
    client = FuturesClient("", "", cfg.base_url)
    candles = client.klines(symbol, interval, limit=min(limit, 1500))
    final, trades = backtest(candles, cfg)
    wins = [t for t in trades if t > 0]
    print(f"{symbol} {interval}  candles={len(candles)}")
    print(f"Trades: {len(trades)}  Win rate: {len(wins) / len(trades) * 100 if trades else 0:.1f}%")
    print(f"Equity: 1000.00 -> {final:.2f} USDT  ({(final / 1000 - 1) * 100:+.2f}%)")


if __name__ == "__main__":
    main()
