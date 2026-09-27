"""Historical context: where each indicator sits versus its own past, and what price did next
the last times it was in a similar state (analog days)."""

import numpy as np
import pandas as pd

from .technical import adx, macd, rsi, sma

HORIZONS = {"1m": 21, "3m": 63}
BAND = 10  # analog days = percentile within +/- BAND points of today's


def indicator_series(df: pd.DataFrame) -> dict:
    """Full-history series for each parameter, so today can be ranked against the past."""
    close = df["Close"]
    s = {
        "rsi14": ("RSI 14", rsi(close)),
        "dist_sma50_pct": ("Price vs SMA 50 (%)", (close / sma(close, 50) - 1) * 100),
        "dist_sma200_pct": ("Price vs SMA 200 (%)", (close / sma(close, 200) - 1) * 100),
        "momentum_3m_pct": ("3-month return (%)", close.pct_change(63) * 100),
        "macd_hist_pct": ("MACD histogram (% of price)", macd(close)[2] / close * 100),
        "volatility_20d_pct": ("20-day volatility (ann. %)", np.log(close).diff().rolling(20).std() * np.sqrt(252) * 100),
        "drawdown_52w_pct": ("Drop from 52-week high (%)", (close / close.rolling(252, min_periods=60).max() - 1) * 100),
        "range_pos_3m_pct": ("Position in 3-month range (%)",
                             (close - df["Low"].rolling(63).min())
                             / (df["High"].rolling(63).max() - df["Low"].rolling(63).min()) * 100),
    }
    if (df["High"] != df["Low"]).any():
        s["adx14"] = ("ADX 14 (trend strength)", adx(df))
    if df["Volume"].fillna(0).gt(0).mean() > 0.8:
        s["volume_ratio"] = ("Volume vs 50-day avg (x)", df["Volume"] / df["Volume"].rolling(50).mean())
    return s


def _forward(close: pd.Series) -> dict:
    return {k: (close.shift(-n) / close - 1) * 100 for k, n in HORIZONS.items()}


def _read(edge_up: float, n: int) -> str:
    if n < 30:
        return "too few past cases"
    if edge_up >= 8:
        return "historically a tailwind"
    if edge_up >= 4:
        return "mild tailwind"
    if edge_up <= -8:
        return "historically a headwind"
    if edge_up <= -4:
        return "mild headwind"
    return "no clear edge"


def _describe(key: str, pct: float) -> str:
    """Plain-language level of the reading versus its own history."""
    if pct >= 90:
        lvl = "unusually high"
    elif pct >= 70:
        lvl = "high"
    elif pct > 30:
        lvl = "typical"
    elif pct > 10:
        lvl = "low"
    else:
        lvl = "unusually low"
    if key == "drawdown_52w_pct":  # values are negative: high percentile = close to the high
        lvl = {"unusually high": "at/near the 52-week high", "high": "close to the 52-week high",
               "typical": "a typical distance from the high", "low": "a deep pullback",
               "unusually low": "one of the deepest pullbacks"}[lvl]
    return lvl


def analyze(df: pd.DataFrame, years: int = 5) -> dict:
    df = df.tail(252 * years)
    close = df["Close"]
    fwd = _forward(close)
    base = {k: v.dropna() for k, v in fwd.items()}
    base_stats = {k: {"median_pct": float(v.median()), "up_pct": float((v > 0).mean() * 100), "n": int(len(v))}
                  for k, v in base.items() if len(v)}
    out = {"lookback_years": round(len(df) / 252, 1), "base": base_stats, "parameters": {}}

    for key, (label, series) in indicator_series(df).items():
        series = series.replace([np.inf, -np.inf], np.nan)
        hist = series.dropna()
        if len(hist) < 120 or pd.isna(series.iloc[-1]):
            continue
        now = float(series.iloc[-1])
        pct_rank = hist.rank(pct=True) * 100
        today_pct = float((hist < now).mean() * 100)
        analog = pct_rank[(pct_rank - today_pct).abs() <= BAND].index[:-1]  # exclude today
        stats = {}
        for h, f in fwd.items():
            vals = f.reindex(analog).dropna()
            if len(vals):
                stats[h] = {"n": int(len(vals)), "median_pct": float(vals.median()),
                            "up_pct": float((vals > 0).mean() * 100)}
        lo, hi = float(hist.quantile(0.1)), float(hist.quantile(0.9))
        one = stats.get("1m")
        edge = one["up_pct"] - base_stats["1m"]["up_pct"] if one and "1m" in base_stats else 0.0
        read = _read(edge, one["n"] if one else 0)
        reason = (f"{label} {now:,.2f} is {_describe(key, today_pct)} (higher than {today_pct:.0f}% of the last "
                  f"{out['lookback_years']:g}y; usual range {lo:,.2f} to {hi:,.2f}).")
        if one:
            reason += (f" On {one['n']} similar past days the next month's median move was {one['median_pct']:+.1f}%, "
                       f"up {one['up_pct']:.0f}% of the time vs {base_stats['1m']['up_pct']:.0f}% on all days: {read}.")
        out["parameters"][key] = {"label": label, "value": now, "percentile": today_pct,
                                  "p10": lo, "p90": hi, "median": float(hist.median()),
                                  "forward": stats, "edge_up_pct": edge, "read": read, "reason": reason}
    return out


def event_history(df: pd.DataFrame, events: list) -> dict:
    """What price did after past SMC structure events of each kind on this instrument."""
    close = df["Close"]
    fwd = _forward(close)
    groups = {}
    for e in events:
        groups.setdefault(f"{e['direction']} {e['type']}", []).append(e["pos"])
    out = {}
    for name, positions in groups.items():
        idx = close.index[positions]
        stats = {}
        for h, f in fwd.items():
            vals = f.reindex(idx).dropna()
            if len(vals):
                stats[h] = {"n": int(len(vals)), "median_pct": float(vals.median()),
                            "up_pct": float((vals > 0).mean() * 100)}
        out[name] = stats
    return out
