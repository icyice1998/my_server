import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config
from indicators import atr, ema, rsi
from risk import position_size, round_step, round_tick, stop_and_target
from strategy import generate_signal

FILTERS = {"step": 0.001, "min_qty": 0.001, "tick": 0.1, "min_notional": 100}


class IndicatorTests(unittest.TestCase):
    def test_ema_constant(self):
        self.assertAlmostEqual(ema([5.0] * 30, 10)[-1], 5.0)

    def test_rsi_extremes(self):
        self.assertEqual(rsi(list(range(1, 40)), 14)[-1], 100.0)
        self.assertLess(rsi(list(range(40, 1, -1)), 14)[-1], 1.0)

    def test_atr_constant_range(self):
        n = 50
        self.assertAlmostEqual(atr([11.0] * n, [9.0] * n, [10.0] * n, 14)[-1], 2.0)


class RiskTests(unittest.TestCase):
    def test_rounding(self):
        self.assertEqual(round_step(0.12345, 0.001), "0.123")
        self.assertEqual(round_step(7.9, 1), "7")
        self.assertEqual(round_tick(64321.26, 0.1), "64321.3")

    def test_position_size_risk(self):
        cfg = Config()
        # 1% of 1000 = 10 USDT risk / 500 stop distance = 0.02 BTC
        self.assertEqual(position_size(1000, 60000, 500, cfg, FILTERS), "0.02")

    def test_position_size_capped_by_notional(self):
        cfg = Config()
        # tiny stop would imply huge size; cap = 2x equity notional
        self.assertEqual(position_size(1000, 60000, 1, cfg, FILTERS), "0.033")

    def test_position_below_min_notional(self):
        self.assertIsNone(position_size(50, 60000, 500, Config(), FILTERS))

    def test_stop_target_directions(self):
        cfg = Config()
        sl, tp = stop_and_target("BUY", 100, 2, cfg)
        self.assertLess(sl, 100)
        self.assertGreater(tp, 100)
        sl, tp = stop_and_target("SELL", 100, 2, cfg)
        self.assertGreater(sl, 100)
        self.assertLess(tp, 100)


class StrategyTests(unittest.TestCase):
    def _candles(self, closes):
        return [[i, c, c + 1, c - 1, c, 0] for i, c in enumerate(closes)]

    def test_not_enough_data(self):
        self.assertIsNone(generate_signal(self._candles([100] * 50), Config()).side)

    def test_long_signal_on_cross_in_uptrend(self):
        # long uptrend, short pullback, then bounce -> fast EMA crosses back above slow
        closes = [100 + i * 0.5 for i in range(250)]
        closes += [closes[-1] - i * 0.8 for i in range(1, 15)]
        cfg = Config()
        found = None
        for j in range(1, 30):
            series = closes + [closes[-1] + k * 0.9 for k in range(1, j + 1)]
            sig = generate_signal(self._candles(series), cfg)
            if sig.side:
                found = sig.side
                break
        self.assertEqual(found, "BUY")


if __name__ == "__main__":
    unittest.main()
