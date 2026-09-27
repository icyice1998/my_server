"""Asset screener: one row of key metrics per asset across a universe, for filtering and ranking.

Prices come in one batched download; fundamentals / fact sheets from each ticker's info (threaded).
Each row reuses the same trend, Elliott, SMC and Monte Carlo logic as the full report, so a screener
score and a full report agree."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import elliott, forecast, fundamental, model as pmodel, smc, technical
from .universe import symbols as universe_symbols


def _pct(a, b):
    return float((a / b - 1) * 100) if b else None


def _num(v, scale=1.0):
    try:
        v = float(v)
        return None if not np.isfinite(v) else v * scale
    except (TypeError, ValueError):
        return None


def _info(symbol: str, attempts: int = 3) -> dict:
    """Ticker fundamentals; Yahoo rate-limits bursts, so back off and retry before giving up."""
    import time
    import yfinance as yf
    for i in range(attempts):
        try:
            info = yf.Ticker(symbol).info or {}
            if info.get("quoteType"):
                return info
        except Exception:
            pass
        time.sleep(2 * (i + 1))
    return {}


def _names() -> dict:
    import json
    import os
    path = os.path.join(os.path.dirname(__file__), "names.json")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except OSError:
        return {}


FUNDAMENTAL_KEYS = ("pe", "pbv", "dividend_yield_pct", "roe_pct", "net_margin_pct", "revenue_growth_pct",
                    "earnings_growth_pct", "debt_to_equity", "expense_ratio_pct", "market_cap", "sector", "currency")


def _prices(symbols: list, period: str) -> dict:
    import yfinance as yf
    raw = yf.download(symbols, period=period, auto_adjust=True, progress=False, group_by="ticker", threads=True)
    out = {}
    for s in symbols:
        try:
            df = raw[s] if isinstance(raw.columns, pd.MultiIndex) else raw
            df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
        except KeyError:
            continue
        if len(df) >= 120:
            df.index = pd.DatetimeIndex(df.index).tz_localize(None)
            out[s] = df
    return out


def row(symbol: str, df: pd.DataFrame, info: dict, model: dict = None) -> dict:
    close = df["Close"]
    price = float(close.iloc[-1])
    tech = technical.analyze(df)
    mc = forecast.monte_carlo(close, n_paths=2000)
    ew = elliott.analyze(df)
    sm = smc.analyze(df)

    kind = (info.get("quoteType") or "EQUITY").upper()
    asset_type = "fund" if kind in ("ETF", "MUTUALFUND") else "stock"
    f = {
        "pe": _num(info.get("trailingPE")),
        "pbv": _num(info.get("priceToBook")),
        "dividend_yield_pct": _num(info.get("dividendYield")),
        "roe_pct": _num(info.get("returnOnEquity"), 100),
        "net_margin_pct": _num(info.get("profitMargins"), 100),
        "revenue_growth_pct": _num(info.get("revenueGrowth"), 100),
        "earnings_growth_pct": _num(info.get("earningsGrowth"), 100),
        "debt_to_equity": (_num(info.get("debtToEquity"), 0.01)),  # Yahoo reports D/E in percent
    }
    fscore = None
    if asset_type == "stock":
        m = {k: f[k] for k in ("roe_pct", "net_margin_pct", "debt_to_equity", "pe", "pbv")}
        m["revenue_cagr_pct"] = f["revenue_growth_pct"]
        m["net_income_cagr_pct"] = f["earnings_growth_pct"]
        s, _ = fundamental._score({k: (np.nan if v is None else v) for k, v in m.items()})
        fscore = None if np.isnan(s) else s
    target = _num(info.get("targetMeanPrice"))
    upside = _pct(target, price) if target and asset_type == "stock" else None
    mkt = "TH" if symbol.endswith(".BK") else "US"
    pred = pmodel.predict(model, df, mkt) if model else {}
    outlook = forecast.composite_outlook(tech, mc, fscore, None, upside,
                                         ew["bias_score"], sm["bias_score"], pmodel.score(pred))

    p = ew["primary"]
    le = sm["last_event"]
    return {
        "symbol": symbol,
        "name": info.get("longName") or info.get("shortName") or symbol,
        "market": "TH" if symbol.endswith(".BK") else "US",
        "asset_type": asset_type,
        "sector": info.get("sector") or info.get("category"),
        "currency": info.get("currency"),
        "market_cap": _num(info.get("marketCap") or info.get("totalAssets")),
        "as_of": df.index[-1].strftime("%Y-%m-%d"),
        "price": price,
        "chg_1d_pct": _pct(price, close.iloc[-2]),
        "ret_1m_pct": _pct(price, close.iloc[-22]) if len(close) > 22 else None,
        "ret_3m_pct": _pct(price, close.iloc[-64]) if len(close) > 64 else None,
        "ret_1y_pct": _pct(price, close.iloc[-253]) if len(close) > 253 else None,
        "from_52w_high_pct": _pct(price, df["High"].tail(252).max()),
        "rsi14": tech["rsi14"],
        "dist_sma200_pct": _pct(price, tech["sma200"]) if tech["sma200"] == tech["sma200"] else None,
        "volatility_pct": tech["volatility_ann_pct"],
        "adx14": tech["adx14"],
        "trend": tech["trend"],
        "trend_score": tech["trend_score"],
        "patterns": tech["patterns"],
        "elliott_wave": p["current_wave"] if p else None,
        "elliott_trend": p["trend"] if p else None,
        "elliott_fit_pct": p["confidence_pct"] if p else None,
        "elliott_bias": ew["bias_score"],
        "smc_trend": sm["trend"],
        "smc_event": f"{le['direction']} {le['type']}" if le else None,
        "smc_event_date": le["date"] if le else None,
        "smc_zone": (sm["premium_discount"] or {}).get("zone"),
        "smc_bias": sm["bias_score"],
        "prob_up_3m_pct": mc["3m"]["prob_up_pct"],
        "model_beat_pct": pred.get("beat_prob_pct"),
        "model_rel_return_pct": pred.get("expected_rel_return_pct"),
        "median_3m": mc["3m"]["median"],
        **f,
        "expense_ratio_pct": _num(info.get("netExpenseRatio")),
        "analyst_upside_pct": upside,
        "fundamental_score": fscore,
        "score": outlook["score"],
        "signal": outlook["signal"],
    }


def run(universes: str = "TH,US,ETF", period: str = "3y", workers: int = 4, model_path: str = None,
        export_dir: str = None, previous: str = None) -> dict:
    import json
    import os
    syms = universe_symbols(universes)
    names = _names()
    prev = {}
    if previous and os.path.exists(previous):
        with open(previous, encoding="utf-8") as f:
            prev = {r["symbol"]: r for r in json.load(f).get("rows", [])}
    prices = _prices(syms, period)
    model = pmodel.load(model_path) if model_path and os.path.exists(model_path) else None
    if export_dir:
        from .export import export_prices
        export_prices(prices, os.path.join(export_dir, "prices"))
    with ThreadPoolExecutor(workers) as pool:
        infos = dict(zip(prices, pool.map(_info, list(prices))))
    rows, failed = [], [s for s in syms if s not in prices]
    for s, df in prices.items():
        info = infos.get(s, {})
        if not info.get("quoteType") and s in names:  # fetch failed: keep the asset type and name we know
            info = {"quoteType": "ETF" if names[s].get("k") == "fund" else "EQUITY", "longName": names[s].get("n")}
        try:
            r = row(s, df, info, model)
            if not infos.get(s, {}).get("quoteType") and s in prev:  # carry last known fundamentals forward
                for k in FUNDAMENTAL_KEYS:
                    if r.get(k) is None and prev[s].get(k) is not None:
                        r[k] = prev[s][k]
                r["fundamentals_stale"] = True
            if (not r["name"] or r["name"] == s) and s in names:
                r["name"] = names[s]["n"]
            if not r.get("sector") and s in names:
                r["sector"] = names[s].get("sec")
            rows.append(r)
        except Exception as e:  # one bad ticker must not sink the screen
            failed.append(f"{s}: {e}")
    rows.sort(key=lambda r: -r["score"])
    from .report import _clean
    return _clean({"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "universes": universes.upper(), "count": len(rows), "failed": failed, "rows": rows})
