import json

import numpy as np
import pandas as pd
import pytest

from market_analyzer import forecast, fund, fundamental, report, technical
from market_analyzer.data import Instrument, load_local, resolve_symbol


def make_prices(drift=0.0008, vol=0.01, n=800, seed=1):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(drift, vol, n)))
    idx = pd.bdate_range("2023-01-02", periods=n)
    return pd.DataFrame({"Open": close, "High": close * 1.01, "Low": close * 0.99,
                         "Close": close, "Volume": 1e6}, index=idx)


def test_resolve_symbol():
    assert resolve_symbol("ptt", "TH") == "PTT.BK"
    assert resolve_symbol("PTT.BK", "TH") == "PTT.BK"
    assert resolve_symbol("aapl", "US") == "AAPL"


def test_trend_direction():
    up = technical.analyze(make_prices(drift=0.002))
    down = technical.analyze(make_prices(drift=-0.002))
    assert up["trend_score"] > 15 and "uptrend" in up["trend"].lower()
    assert down["trend_score"] < -15 and "downtrend" in down["trend"].lower()


def test_rsi_bounds():
    r = technical.rsi(make_prices()["Close"])
    assert r.between(0, 100).all()


def test_double_bottom_detected():
    seg = [np.linspace(120, 100, 20), np.linspace(100, 112, 15), np.linspace(112, 100.5, 15),
           np.linspace(100.5, 115, 20)]
    close = np.concatenate(seg)
    df = pd.DataFrame({"Open": close, "High": close, "Low": close, "Close": close, "Volume": 0},
                      index=pd.bdate_range("2024-01-01", periods=len(close)))
    assert any("Double bottom" in p for p in technical.detect_patterns(df, window=5))


def test_monte_carlo_ordering():
    mc = forecast.monte_carlo(make_prices()["Close"], n_paths=2000)
    for h in mc.values():
        assert h["p5"] < h["p25"] < h["median"] < h["p75"] < h["p95"]
        assert 0 <= h["prob_up_pct"] <= 100


def test_fundamental_score():
    years = pd.to_datetime(["2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31"])
    income = pd.DataFrame({y: {"Total Revenue": 100 + 10 * i, "Net Income": 15 + 2 * i,
                               "Diluted EPS": 1.5 + 0.2 * i} for i, y in enumerate(years)})
    balance = pd.DataFrame({y: {"Stockholders Equity": 80.0, "Total Assets": 150.0, "Total Debt": 20.0,
                                "Current Assets": 60.0, "Current Liabilities": 30.0} for y in years})
    cash = pd.DataFrame({y: {"Operating Cash Flow": 25.0, "Free Cash Flow": 18.0} for y in years})
    fa = fundamental.analyze(income, balance, cash, {"trailingPE": 12, "priceToBook": 1.2,
                                                     "trailingEps": 2.1, "bookValue": 10})
    assert fa["revenue_trend"] == "rising every year"
    assert fa["score"] >= 80
    assert fa["fair_value"]["graham_number"] == pytest.approx(np.sqrt(22.5 * 2.1 * 10))


def test_fund_flags():
    sheet = {"expense_ratio_pct": 0.05, "category_expense_ratio_pct": 0.8,
             "top_holdings": [{"symbol": "X", "name": "X", "weight_pct": 70}]}
    fa = fund.analyze(make_prices()["Close"], sheet)
    assert any(f.startswith("+ Expense") for f in fa["flags"])
    assert any(f.startswith("- Concentrated") for f in fa["flags"])


def test_full_report_local_nav(tmp_path):
    nav = make_prices()["Close"].rename("Close")
    csv = tmp_path / "nav.csv"
    nav.rename_axis("Date").reset_index().to_csv(csv, index=False)
    sheet = tmp_path / "sheet.json"
    sheet.write_text(json.dumps({"name": "Test Thai Fund", "expense_ratio_pct": 1.6, "currency": "THB"}))

    inst = load_local(str(csv), "tfund", "TH", str(sheet))
    r = report.run(inst)
    json.dumps(r, allow_nan=False)  # must be strict-JSON safe
    assert r["asset_type"] == "fund" and r["outlook"]["signal"] in {"Bullish", "Neutral", "Bearish"}
    assert "PRICE PROJECTION" in report.to_text(r)


def test_full_report_stock():
    inst = Instrument("TEST", "US", "stock", make_prices(), info={"currency": "USD"})
    r = report.run(inst)
    json.dumps(r, allow_nan=False)
    assert "fundamental" in r and len(r["chart"]["close"]) == 500


def path_frame(points, bars_per_leg=12, noise=0.0, seed=0):
    """OHLC frame that walks linearly through the given turning points."""
    rng = np.random.default_rng(seed)
    close = np.concatenate([np.linspace(a, b, bars_per_leg, endpoint=False) for a, b in zip(points, points[1:])]
                           + [[points[-1]]])
    close = close * (1 + rng.normal(0, noise, len(close)))
    idx = pd.bdate_range("2024-01-01", periods=len(close))
    return pd.DataFrame({"Open": close, "High": close * 1.002, "Low": close * 0.998,
                         "Close": close, "Volume": 0.0}, index=idx)


def test_elliott_zigzag_alternates():
    from market_analyzer import elliott
    df = path_frame([100, 120, 110, 140, 125, 150])
    piv = elliott.zigzag(df, 5)
    kinds = [k for _, _, k in piv]
    assert all(a != b for a, b in zip(kinds, kinds[1:]))
    assert [round(p) for _, p, _ in piv][-5:] == [120, 110, 140, 125, 150]


def test_elliott_rules():
    from market_analyzer import elliott
    assert elliott._impulse([100, 120, 108, 140, 128, 150], 1) is not None
    assert elliott._impulse([100, 120, 98, 140], 1) is None           # W2 below W1 start
    assert elliott._impulse([100, 120, 110, 140, 118, 150], 1) is None  # W4 overlaps W1
    assert elliott._impulse([100, 130, 115, 135, 128, 170], 1) is None  # W3 shortest
    assert elliott._impulse([150, 130, 142, 110, 122, 100], -1) is not None  # down impulse


def test_elliott_detects_wave5_and_abc():
    from market_analyzer import elliott
    p = elliott.analyze(path_frame([100, 120, 110, 145, 132, 152]))["primary"]
    assert (p["current_wave"], p["trend"]) == ("W5", "up")
    assert [x["label"] for x in p["pivots"]] == ["0", "1", "2", "3", "4", "5"]
    assert p["invalidation"] == pytest.approx(132, rel=0.01)

    e = elliott.analyze(path_frame([100, 120, 110, 145, 132, 152, 140, 146, 130]))
    assert e["primary"]["current_wave"] == "C" and e["bias_score"] < 0
    json.dumps(e, allow_nan=False)


def test_smc_choch_and_fvg():
    from market_analyzer import smc
    df = path_frame([130, 110, 120, 100, 108, 125, 118, 140], bars_per_leg=10)
    m = smc.analyze(df, length=3)
    types = [(e["type"], e["direction"]) for e in m["events"]]
    assert ("CHoCH", "bullish") in types
    assert m["trend"] == "bullish" and m["bias_score"] > 0
    gap = df.copy()
    gap.iloc[40:, :4] *= 1.05  # 5% gap up leaves a bullish FVG
    assert any(g["direction"] == "bullish" for g in smc.fair_value_gaps(gap))
