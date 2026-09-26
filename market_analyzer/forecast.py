"""Statistical price projection: Monte Carlo on historical returns plus a walk-forward check."""

import numpy as np
import pandas as pd

HORIZONS = {"1m": 21, "3m": 63, "6m": 126}


def _drift_vol(close: pd.Series, lookback: int = 504, shrink: float = 0.5):
    """Daily log drift and vol. Drift is shrunk toward zero: past trend is a weak predictor."""
    lr = np.log(close).diff().dropna().tail(lookback)
    return float(lr.mean() * (1 - shrink)), float(lr.std())


def monte_carlo(close: pd.Series, horizons=HORIZONS, n_paths: int = 5000, seed: int = 42,
                shrink: float = 0.5) -> dict:
    """Bootstrap daily log returns (demeaned, then re-centred on the shrunk drift)."""
    rng = np.random.default_rng(seed)
    lr = np.log(close).diff().dropna().tail(504).values
    mu, _ = _drift_vol(close, shrink=shrink)
    resid = lr - lr.mean()
    price = float(close.iloc[-1])
    out = {}
    for label, days in horizons.items():
        draws = rng.choice(resid, size=(n_paths, days), replace=True).sum(axis=1) + mu * days
        end = price * np.exp(draws)
        p5, p25, p50, p75, p95 = np.percentile(end, [5, 25, 50, 75, 95])
        out[label] = {
            "days": days,
            "p5": float(p5), "p25": float(p25), "median": float(p50), "p75": float(p75), "p95": float(p95),
            "prob_up_pct": float((end > price).mean() * 100),
            "expected_return_pct": float((end.mean() / price - 1) * 100),
        }
    return out


def walk_forward_accuracy(close: pd.Series, horizon: int = 21, lookback: int = 126, step: int = 5) -> dict:
    """How often did 'sign of recent trend' predict the next-horizon direction on this instrument?"""
    lr = np.log(close.values)
    hits, n = 0, 0
    for t in range(lookback, len(lr) - horizon, step):
        past = lr[t] - lr[t - lookback]
        future = lr[t + horizon] - lr[t]
        if past == 0 or future == 0:
            continue
        hits += np.sign(past) == np.sign(future)
        n += 1
    base_up = float(np.mean(np.diff(lr[::horizon]) > 0) * 100) if len(lr) > horizon * 2 else np.nan
    return {
        "samples": n,
        "trend_following_hit_rate_pct": float(hits / n * 100) if n else np.nan,
        "base_rate_up_pct": base_up,
    }


def composite_outlook(tech: dict, mc: dict, fundamental_score=None, fund_score=None,
                      valuation_gap_pct=None, elliott_score=None, smc_score=None) -> dict:
    """Blend the views into one signal. Weights are transparent and editable."""
    parts = {"trend": (tech["trend_score"], 0.4)}
    parts["momentum_prob"] = ((mc["3m"]["prob_up_pct"] - 50) * 2, 0.2)
    if fundamental_score is not None and not np.isnan(fundamental_score):
        parts["fundamentals"] = ((fundamental_score - 50) * 2, 0.3)
    if fund_score is not None:
        parts["factsheet"] = ((fund_score - 50) * 2, 0.3)
    if valuation_gap_pct is not None and not np.isnan(valuation_gap_pct):
        parts["valuation"] = (float(np.clip(valuation_gap_pct * 2, -100, 100)), 0.1)
    if elliott_score is not None:
        parts["elliott"] = (float(elliott_score), 0.1)
    if smc_score is not None:
        parts["smc"] = (float(smc_score), 0.15)

    total_w = sum(w for _, w in parts.values())
    score = sum(v * w for v, w in parts.values()) / total_w
    if score >= 25:
        signal = "Bullish"
    elif score <= -25:
        signal = "Bearish"
    else:
        signal = "Neutral"
    agreement = np.mean([np.sign(v) == np.sign(score) for v, _ in parts.values()]) if score else 0
    return {
        "score": round(float(score), 1),
        "signal": signal,
        "agreement_pct": round(float(agreement * 100), 0),
        "components": {k: round(float(v), 1) for k, (v, _) in parts.items()},
    }
