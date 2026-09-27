"""Own prediction model: will the price be higher in 21 trading days (~1 month), and by how much?

Two linear models on 18 price-only features, trained on the whole universe:
  * logistic regression (Newton / IRLS with L2)  -> probability of a rise
  * ridge regression                              -> expected 1-month log return
Linear models on standardised features can be evaluated anywhere, so the browser engine (engine.js) loads
the same coefficients from model.json and scores any asset in the universe without a server.

Validation is a walk-forward split: train on everything before the last year (with a 21-day purge gap so
no label overlaps the test period), test on the last year. The metrics are published with the model.
"""

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HORIZON = 21
FEATURES = [
    "ret_5", "ret_21", "ret_63", "ret_126", "ret_252",
    "rsi14", "dist_sma20", "dist_sma50", "dist_sma200", "sma50_vs_200",
    "vol_20", "vol_63", "drawdown_252", "range_pos_63", "macd_hist_pct", "atr_pct",
    "volume_ratio", "is_th",
]
LABELS = {
    "ret_5": "1-week return", "ret_21": "1-month return", "ret_63": "3-month return",
    "ret_126": "6-month return", "ret_252": "1-year return", "rsi14": "RSI 14",
    "dist_sma20": "Price vs SMA 20", "dist_sma50": "Price vs SMA 50", "dist_sma200": "Price vs SMA 200",
    "sma50_vs_200": "SMA 50 vs SMA 200", "vol_20": "1-month volatility", "vol_63": "3-month volatility",
    "drawdown_252": "Drop from 1-year high", "range_pos_63": "Position in 3-month range",
    "macd_hist_pct": "MACD histogram", "atr_pct": "ATR (% of price)", "volume_ratio": "Volume vs 50-day average",
    "is_th": "Thai market",
}
CLIP = 5.0


def _wilder(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(alpha=1 / n, adjust=False).mean()


def features(df: pd.DataFrame, market: str = "US") -> pd.DataFrame:
    """Feature matrix, one row per day. engine.js implements the identical formulas."""
    c, h, l = df["Close"].astype(float), df["High"].astype(float), df["Low"].astype(float)
    v = df["Volume"].astype(float).fillna(0)
    lr = np.log(c).diff()
    d = c.diff()
    rsi = 100 - 100 / (1 + _wilder(d.clip(lower=0), 14) / _wilder((-d).clip(lower=0), 14))
    ema = lambda s, n: s.ewm(span=n, adjust=False).mean()
    macd = ema(c, 12) - ema(c, 26)
    prev = c.shift()
    tr = pd.concat([h - l, (h - prev).abs(), (l - prev).abs()], axis=1).max(axis=1)
    sma = lambda n: c.rolling(n).mean()
    vavg = v.rolling(50).mean()
    lo63, hi63 = l.rolling(63).min(), h.rolling(63).max()
    f = pd.DataFrame({
        "ret_5": c / c.shift(5) - 1,
        "ret_21": c / c.shift(21) - 1,
        "ret_63": c / c.shift(63) - 1,
        "ret_126": c / c.shift(126) - 1,
        "ret_252": c / c.shift(252) - 1,
        "rsi14": rsi.fillna(100) / 100,
        "dist_sma20": c / sma(20) - 1,
        "dist_sma50": c / sma(50) - 1,
        "dist_sma200": c / sma(200) - 1,
        "sma50_vs_200": sma(50) / sma(200) - 1,
        "vol_20": lr.rolling(20).std() * np.sqrt(252),
        "vol_63": lr.rolling(63).std() * np.sqrt(252),
        "drawdown_252": c / c.rolling(252).max() - 1,
        "range_pos_63": ((c - lo63) / (hi63 - lo63).replace(0, np.nan)).fillna(0.5),
        "macd_hist_pct": (macd - ema(macd, 9)) / c,
        "atr_pct": _wilder(tr, 14) / c,
        "volume_ratio": (v / vavg.replace(0, np.nan)).clip(0, 5).fillna(1.0),
        "is_th": 1.0 if market == "TH" else 0.0,
    }, index=df.index)
    return f[FEATURES].replace([np.inf, -np.inf], np.nan)


def labels(df: pd.DataFrame, horizon: int = HORIZON) -> pd.DataFrame:
    c = df["Close"].astype(float)
    return pd.DataFrame({"ret": np.log(c.shift(-horizon) / c).clip(-0.3, 0.3)})


def dataset(prices: dict) -> pd.DataFrame:
    """Stack features and forward returns for every asset on a common weekly grid (Wednesdays), then
    express each forward return relative to the median of its market on the same date."""
    frames = []
    for sym, df in prices.items():
        if len(df) < 300:
            continue
        mkt = "TH" if sym.endswith(".BK") else "US"
        x = features(df, mkt).join(labels(df))
        x = x.iloc[252:]
        x = x[x.index.dayofweek == 2].dropna(subset=FEATURES)
        x["symbol"], x["market"] = sym, mkt
        frames.append(x)
    data = pd.concat(frames)
    data["date"] = data.index
    med = data.groupby(["date", "market"])["ret"].transform("median")
    data["rel"] = (data["ret"] - med).clip(-0.3, 0.3)
    data["beat"] = (data["rel"] > 0).astype(float).where(data["ret"].notna())
    return data.drop(columns="date").sort_index()


# ---------- own estimators ----------

def fit_logistic(X: np.ndarray, y: np.ndarray, l2: float = 1.0, iters: int = 25) -> np.ndarray:
    """Newton-Raphson / IRLS; returns [bias, w1..wk]."""
    Xb = np.hstack([np.ones((len(X), 1)), X])
    w = np.zeros(Xb.shape[1])
    reg = np.eye(Xb.shape[1]) * l2
    reg[0, 0] = 0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(Xb @ w)))
        g = Xb.T @ (p - y) + reg @ w
        H = (Xb * (p * (1 - p))[:, None]).T @ Xb + reg
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    return w


def fit_ridge(X: np.ndarray, y: np.ndarray, l2: float = 10.0) -> np.ndarray:
    Xb = np.hstack([np.ones((len(X), 1)), X])
    reg = np.eye(Xb.shape[1]) * l2
    reg[0, 0] = 0
    return np.linalg.solve(Xb.T @ Xb + reg, Xb.T @ y)


def _auc(y, p):
    order = np.argsort(p)
    ranks = np.empty(len(p))
    ranks[order] = np.arange(1, len(p) + 1)
    pos = y == 1
    n1, n0 = pos.sum(), (~pos).sum()
    return float((ranks[pos].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)) if n1 and n0 else float("nan")


def _standardise(X, mean, std):
    return np.clip((X - mean) / std, -CLIP, CLIP)


def evaluate(p, r_hat, y, ret) -> dict:
    base = float(y.mean())
    eps = 1e-9
    logloss = float(-np.mean(y * np.log(p + eps) + (1 - y) * np.log(1 - p + eps)))
    base_ll = float(-(base * np.log(base) + (1 - base) * np.log(1 - base)))
    dec = pd.qcut(p, 10, labels=False, duplicates="drop")
    calib = [{"pred_up_pct": float(p[dec == k].mean() * 100), "actual_up_pct": float(y[dec == k].mean() * 100),
              "avg_return_pct": float((np.exp(ret[dec == k]) - 1).mean() * 100), "n": int((dec == k).sum())}
             for k in sorted(set(dec))]
    rq = pd.qcut(r_hat, 10, labels=False, duplicates="drop")
    top, bottom = ret[rq == rq.max()], ret[rq == rq.min()]
    return {
        "samples": int(len(y)),
        "base_rate_up_pct": base * 100,
        "accuracy_pct": float(((p > 0.5) == (y == 1)).mean() * 100),
        "majority_guess_pct": max(base, 1 - base) * 100,
        "auc": _auc(y, p),
        "log_loss": logloss, "base_log_loss": base_ll,
        "return_corr": float(np.corrcoef(r_hat, ret)[0, 1]),
        "top_decile_avg_return_pct": float((np.exp(top) - 1).mean() * 100),
        "bottom_decile_avg_return_pct": float((np.exp(bottom) - 1).mean() * 100),
        "calibration": calib,
    }


def train(prices: dict, test_days: int = 365) -> dict:
    data = dataset(prices).dropna(subset=["beat", "rel"])  # the last month has no outcome yet
    last = data.index.max()
    test_start = last - pd.Timedelta(days=test_days)
    purge = pd.Timedelta(days=int(HORIZON * 7 / 5) + 1)
    tr = data[data.index < test_start - purge]
    te = data[data.index >= test_start]

    def fit(frame):
        X = frame[FEATURES].to_numpy(float)
        mean, std = X.mean(0), X.std(0)
        std[std == 0] = 1
        Z = _standardise(X, mean, std)
        return mean, std, fit_logistic(Z, frame["beat"].to_numpy()), fit_ridge(Z, frame["rel"].to_numpy())

    mean, std, wl, wr = fit(tr)
    Zt = _standardise(te[FEATURES].to_numpy(float), mean, std)
    Zb = np.hstack([np.ones((len(Zt), 1)), Zt])
    metrics = evaluate(1 / (1 + np.exp(-(Zb @ wl))), Zb @ wr, te["beat"].to_numpy(), te["rel"].to_numpy())
    metrics.update({"train_rows": int(len(tr)), "train_from": str(tr.index.min().date()),
                    "train_to": str(tr.index.max().date()), "test_from": str(te.index.min().date()),
                    "test_to": str(te.index.max().date()), "assets": int(data["symbol"].nunique())})

    # Production model: refit on everything, including the test year.
    mean, std, wl, wr = fit(data)
    return {
        "version": 1,
        "trained": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "horizon_days": HORIZON,
        "features": FEATURES,
        "labels": LABELS,
        "clip": CLIP,
        "mean": mean.tolist(), "std": std.tolist(),
        "logistic": wl.tolist(), "ridge": wr.tolist(),
        "validation": metrics,
    }


def predict(model: dict, df: pd.DataFrame, market: str) -> dict:
    """Score the latest bar; also return each feature's contribution to the log-odds."""
    f = features(df, market).iloc[-1]
    if f.isna().any():
        return {}
    x = f.to_numpy(float)
    z = _standardise(x, np.array(model["mean"]), np.array(model["std"]))
    wl, wr = np.array(model["logistic"]), np.array(model["ridge"])
    logit = wl[0] + z @ wl[1:]
    contrib = sorted(({"feature": k, "label": model["labels"][k], "value": float(v), "effect": float(e)}
                      for k, v, e in zip(model["features"], x, z * wl[1:])), key=lambda d: -abs(d["effect"]))
    return {
        "beat_prob_pct": float(100 / (1 + np.exp(-logit))),
        "expected_rel_return_pct": float((np.exp(wr[0] + z @ wr[1:]) - 1) * 100),
        "drivers": contrib[:6],
        "horizon_days": model["horizon_days"],
    }


def score(pred: dict):
    """Outlook component in [-100, 100]; engine.js modelScore uses the same mapping."""
    if not pred:
        return None
    return float(np.clip((pred["beat_prob_pct"] - 50) * 12, -100, 100))


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(model: dict, path: str):
    from .report import _clean
    with open(path, "w", encoding="utf-8") as f:
        json.dump(_clean(model), f, indent=1)
