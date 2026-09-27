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


def test_context_percentiles_and_reasons():
    from market_analyzer import context
    c = context.analyze(make_prices(n=1000))
    assert c["parameters"] and "1m" in c["base"]
    for p in c["parameters"].values():
        assert 0 <= p["percentile"] <= 100
        assert p["reason"].startswith(p["label"])
        assert p["read"] in {"historically a tailwind", "mild tailwind", "no clear edge",
                             "mild headwind", "historically a headwind", "too few past cases"}


def test_context_ranks_extreme_rsi_high():
    from market_analyzer import context
    df = make_prices(drift=0.0, n=900)
    df.iloc[-15:, :4] = df.iloc[-16, 3] * np.linspace(1.01, 1.25, 15)[:, None]  # 15 straight up days
    c = context.analyze(df)
    assert c["parameters"]["rsi14"]["percentile"] > 95


def test_fundamental_year_history():
    years = pd.to_datetime(["2022-12-31", "2023-12-31", "2024-12-31"])
    income = pd.DataFrame({y: {"Total Revenue": 100.0 + i, "Net Income": 10.0 - 3 * i} for i, y in enumerate(years)})
    balance = pd.DataFrame({y: {"Stockholders Equity": 50.0, "Total Debt": 10.0} for y in years})
    fa = fundamental.analyze(income, balance, pd.DataFrame(), {})
    assert [h["year"] for h in fa["history"]] == ["2022", "2023", "2024"]
    assert any("Net margin" in r and "worse than" in r for r in fa["reasons"])
    assert "Revenue rose in 2 of the last 2 years." in fa["reasons"]


FAKE_QUOTES = {
    "PTT": [{"symbol": "PTTRX", "quoteType": "MUTUALFUND", "exchange": "NAS"},
            {"symbol": "PTT.BK", "quoteType": "EQUITY", "exchange": "SET", "longname": "PTT Public Company Limited"},
            {"symbol": "PTT-R.BK", "quoteType": "EQUITY", "exchange": "SET"}],
    "CP All": [{"symbol": "CPALL.BK", "quoteType": "EQUITY", "exchange": "SET", "longname": "CP ALL"},
               {"symbol": "CVPUF", "quoteType": "EQUITY", "exchange": "PNK"}],
    "apple": [{"symbol": "SAAPL=F", "quoteType": "FUTURE", "exchange": "CME"},
              {"symbol": "AAPL", "quoteType": "EQUITY", "exchange": "NMS", "longname": "Apple Inc."}],
    "nothing": [{"symbol": "X.DE", "quoteType": "EQUITY", "exchange": "GER"}],
}


def test_resolve_names_and_tickers():
    from market_analyzer.resolve import resolve
    search = FAKE_QUOTES.get
    assert resolve("PTT", search=search)["symbol"] == "PTT.BK"          # exact ticker beats Yahoo's first hit
    assert resolve("CP All", search=search)["market"] == "TH"
    assert resolve("apple", search=search)["symbol"] == "AAPL"          # futures skipped
    assert "PTT-R.BK" not in resolve("PTT", search=search)["alternatives"]  # NVDR skipped
    with pytest.raises(ValueError):
        resolve("nothing", search=search)                                # foreign listings only


def test_split_query():
    from market_analyzer.resolve import split_query
    assert split_query("CP All") == ["CP All"]
    assert split_query("PTT KBANK") == ["PTT", "KBANK"]
    assert split_query("CP All, apple") == ["CP All", "apple"]


def test_screener_row_offline():
    from market_analyzer import screener
    df = make_prices(n=600)
    info = {"quoteType": "EQUITY", "longName": "Test Co", "trailingPE": 12, "priceToBook": 1.1,
            "returnOnEquity": 0.18, "profitMargins": 0.12, "debtToEquity": 40, "dividendYield": 3.5,
            "targetMeanPrice": float(df["Close"].iloc[-1]) * 1.2}
    r = screener.row("TEST.BK", df, info)
    json.dumps(report._clean(r), allow_nan=False)
    assert r["market"] == "TH" and r["asset_type"] == "stock"
    assert r["roe_pct"] == pytest.approx(18) and r["debt_to_equity"] == pytest.approx(0.4)
    assert r["analyst_upside_pct"] == pytest.approx(20, rel=1e-6)
    assert r["signal"] in {"Bullish", "Neutral", "Bearish"} and -100 <= r["score"] <= 100


@pytest.mark.skipif(__import__("shutil").which("node") is None, reason="node not installed")
def test_browser_engine_matches_python():
    """engine.js must give the same answers as the Python modules on the same published data."""
    import subprocess
    from pathlib import Path
    from market_analyzer import context, elliott, export, model, smc, technical
    root = Path(__file__).resolve().parents[1]
    df = make_prices(drift=0.0006, vol=0.015, n=700, seed=7)
    df["Open"] = df["Close"].shift().fillna(df["Close"])
    df["High"] = df[["Open", "Close"]].max(axis=1) * 1.004
    df["Low"] = df[["Open", "Close"]].min(axis=1) * 0.996
    j = export.encode("TEST.BK", df)
    df = export.decode(j)
    rng = np.random.default_rng(0)
    m = {"features": model.FEATURES, "labels": model.LABELS, "clip": model.CLIP, "horizon_days": 21,
         "mean": [0.0] * len(model.FEATURES), "std": [0.1] * len(model.FEATURES),
         "logistic": list(rng.normal(0, 0.1, len(model.FEATURES) + 1)), "ridge": list(rng.normal(0, 0.01, len(model.FEATURES) + 1))}
    t, e, s, c = technical.analyze(df), elliott.analyze(df), smc.analyze(df), context.analyze(df)
    py = {"trend_score": t["trend_score"], "rsi": t["rsi14"], "adx": t["adx14"], "patterns": t["patterns"],
          "support": t["support"], "ew": (e["primary"] or {}).get("current_wave"), "ew_bias": e["bias_score"],
          "smc": s["trend"], "smc_bias": s["bias_score"], "zones": len(s["demand_zones"]) + len(s["supply_zones"]),
          "ctx": {k: round(v["percentile"], 6) for k, v in c["parameters"].items()},
          "beat": model.predict(m, df, "TH")["beat_prob_pct"]}
    script = f"""
      const E = require({json.dumps(str(root / 'engine.js'))});
      const b = E.decode({json.dumps(j)}), m = {json.dumps(m)};
      const t = E.technical(b), e = E.elliott(b), s = E.smc(b), c = E.context(b);
      const ctx = {{}}; for (const [k, v] of Object.entries(c.parameters)) ctx[k] = Math.round(v.percentile * 1e6) / 1e6;
      console.log(JSON.stringify({{trend_score: t.trend_score, rsi: t.rsi14, adx: t.adx14, patterns: t.patterns,
        support: t.support, ew: e.primary && e.primary.current_wave, ew_bias: e.bias_score, smc: s.trend,
        smc_bias: s.bias_score, zones: s.demand_zones.length + s.supply_zones.length, ctx,
        beat: E.predict(m, b, "TH").beat_prob_pct}}));"""
    js = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
    for k, v in py.items():
        if isinstance(v, float):
            assert js[k] == pytest.approx(v, rel=1e-9, abs=1e-9), k
        elif isinstance(v, list) and v and isinstance(v[0], float):
            assert js[k] == pytest.approx(v, rel=1e-9), k
        else:
            assert js[k] == v, k


def test_model_training_offline():
    from market_analyzer import model
    prices = {}
    for i in range(12):
        df = make_prices(n=900, seed=i, drift=0.0003 * (i % 3))
        df.index = pd.bdate_range("2021-01-04", periods=900)
        prices[f"S{i}.BK" if i % 2 else f"S{i}"] = df
    m = model.train(prices, test_days=180)
    assert len(m["logistic"]) == len(model.FEATURES) + 1 and np.isfinite(m["logistic"]).all()
    v = m["validation"]
    assert 0 <= v["auc"] <= 1 and v["samples"] > 0 and len(v["calibration"]) >= 5
    p = model.predict(m, prices["S1.BK"], "TH")
    assert 0 < p["beat_prob_pct"] < 100 and len(p["drivers"]) == 6


def test_export_roundtrip():
    from market_analyzer import export
    df = make_prices(n=700)
    j = export.encode("X.BK", df)
    back = export.decode(j)
    assert len(back) == export.BARS and (back.index == df.index[-export.BARS:]).all()
    assert back["Close"].iloc[-1] == pytest.approx(df["Close"].iloc[-1], rel=1e-5)
