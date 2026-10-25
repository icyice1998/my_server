import json

import numpy as np
import pandas as pd

from pipeline import build


def fake_prices(symbols, n=400):
    idx = pd.bdate_range("2024-01-01", periods=n)
    out = {}
    for k, s in enumerate(symbols):
        c = 100 * np.exp(np.cumsum(np.random.default_rng(k).normal(0, 0.01, n)))
        out[s] = pd.DataFrame({"Open": c, "High": c * 1.01, "Low": c * 0.99, "Close": c, "Volume": 1000.0}, index=idx)
    return out


def test_equal_weight_index_is_mean_return():
    closes = pd.DataFrame({"A": [10.0, 11.0, 12.1], "B": [20.0, 20.0, 18.0]})
    ix = build.equal_weight_index(closes, base=100)
    assert ix.round(6).tolist() == [100.0, 105.0, 100.0 * 1.05 * (1 + (0.1 - 0.1) / 2)]


def test_build_writes_panels_meta_and_ohlc(tmp_path, monkeypatch):
    stocks = [{"s": "AAA", "n": "A Co", "sec": "Tech", "m": "US"}, {"s": "BBB.BK", "n": "B Co", "sec": "Energy", "m": "TH"},
              {"s": "CCC.BK", "n": "C Co", "sec": "Energy", "m": "TH"}]
    monkeypatch.setattr(build, "load_stocks", lambda: stocks)
    prices = fake_prices(["AAA", "BBB.BK", "CCC.BK", build.US_INDEX])
    meta = build.build(str(tmp_path), prices)
    assert [x["s"] for x in meta["stocks"]] == ["AAA", "BBB.BK", "CCC.BK"] and meta["missing"] == []
    us = json.loads((tmp_path / "panel_US.json").read_text())
    th = json.loads((tmp_path / "panel_TH.json").read_text())
    assert us["s"] == ["AAA"] and len(us["c"][0]) == len(us["dt"]) == len(us["index"]["c"]) == 400
    assert th["s"] == ["BBB.BK", "CCC.BK"] and th["index"]["c"][0] == 1000.0
    o = json.loads((tmp_path / "ohlc" / "BBB_BK.json").read_text())
    assert len(o["c"]) == build.OHLC_BARS
    assert abs(o["c"][-1] - prices["BBB.BK"]["Close"].iloc[-1]) < 1e-3 * o["c"][-1]
