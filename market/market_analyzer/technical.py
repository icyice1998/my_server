"""Price-pattern analysis: indicators, trend, support/resistance, chart patterns."""

import numpy as np
import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(100)


def macd(close: pd.Series, fast=12, slow=26, signal=9):
    line = ema(close, fast) - ema(close, slow)
    sig = ema(line, signal)
    return line, sig, line - sig


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    prev = df["Close"].shift()
    tr = pd.concat([df["High"] - df["Low"], (df["High"] - prev).abs(), (df["Low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False).mean()


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    up = df["High"].diff()
    down = -df["Low"].diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=df.index)
    tr = atr(df, n).replace(0, np.nan)
    plus_di = 100 * plus_dm.ewm(alpha=1 / n, adjust=False).mean() / tr
    minus_di = 100 * minus_dm.ewm(alpha=1 / n, adjust=False).mean() / tr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return dx.ewm(alpha=1 / n, adjust=False).mean()


def regression_slope(close: pd.Series, n: int) -> tuple:
    """Annualised log-price slope (%) and R^2 over the last n bars."""
    y = np.log(close.tail(n).values)
    if len(y) < 10:
        return 0.0, 0.0
    x = np.arange(len(y))
    slope, intercept = np.polyfit(x, y, 1)
    fitted = slope * x + intercept
    ss_res = ((y - fitted) ** 2).sum()
    ss_tot = ((y - y.mean()) ** 2).sum()
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return float((np.exp(slope * 252) - 1) * 100), float(r2)


def find_pivots(series: pd.Series, window: int = 5):
    """Swing highs/lows: points that are the extreme of +/- window bars."""
    roll_max = series.rolling(2 * window + 1, center=True).max()
    roll_min = series.rolling(2 * window + 1, center=True).min()
    highs = _dedupe(series[series == roll_max].dropna(), series.index, window)
    lows = _dedupe(series[series == roll_min].dropna(), series.index, window)
    return highs, lows


def _dedupe(pivots: pd.Series, index: pd.Index, window: int) -> pd.Series:
    """Collapse flat tops/bottoms: pivots within `window` bars of each other count once."""
    keep, last_pos = [], -window - 1
    for ts in pivots.index:
        pos = index.get_loc(ts)
        if pos - last_pos > window:
            keep.append(ts)
        last_pos = pos
    return pivots.loc[keep]


def support_resistance(df: pd.DataFrame, window: int = 5, tolerance: float = 0.02, max_levels: int = 3):
    """Cluster pivot prices into levels; rank by number of touches."""
    highs, lows = find_pivots(df["Close"].tail(250), window)
    levels = sorted(list(highs.values) + list(lows.values))
    clusters = []
    for p in levels:
        if clusters and abs(p - np.mean(clusters[-1])) / np.mean(clusters[-1]) <= tolerance:
            clusters[-1].append(p)
        else:
            clusters.append([p])
    price = float(df["Close"].iloc[-1])
    ranked = sorted(clusters, key=len, reverse=True)
    sup = sorted([float(np.mean(c)) for c in ranked if np.mean(c) < price], reverse=True)[:max_levels]
    res = sorted([float(np.mean(c)) for c in ranked if np.mean(c) > price])[:max_levels]
    if not res:  # at a new high: nearest reference is the 52-week high itself
        res = [float(df["High"].tail(252).max())]
    if not sup:
        sup = [float(df["Low"].tail(252).min())]
    return sup, res


def detect_patterns(df: pd.DataFrame, window: int = 5, tolerance: float = 0.03) -> list:
    close = df["Close"]
    found = []
    highs, lows = find_pivots(close.tail(250), window)

    if len(highs) >= 2 and len(lows) >= 2:
        hh = highs.iloc[-1] > highs.iloc[-2]
        hl = lows.iloc[-1] > lows.iloc[-2]
        if hh and hl:
            found.append("Recent swings: higher highs & higher lows")
        elif not hh and not hl:
            found.append("Recent swings: lower highs & lower lows")
        else:
            found.append("Recent swings: mixed (range / consolidation)")

    if len(highs) >= 2:
        h1, h2 = highs.iloc[-2], highs.iloc[-1]
        trough = close[highs.index[-2]:highs.index[-1]].min()
        if abs(h1 - h2) / h1 <= tolerance and trough < min(h1, h2) * (1 - 2 * tolerance):
            state = "confirmed" if close.iloc[-1] < trough else "watch neckline"
            found.append(f"Double top near {max(h1, h2):.2f} ({state}, neckline {trough:.2f})")

    if len(lows) >= 2:
        l1, l2 = lows.iloc[-2], lows.iloc[-1]
        peak = close[lows.index[-2]:lows.index[-1]].max()
        if abs(l1 - l2) / l1 <= tolerance and peak > max(l1, l2) * (1 + 2 * tolerance):
            state = "confirmed" if close.iloc[-1] > peak else "watch neckline"
            found.append(f"Double bottom near {min(l1, l2):.2f} ({state}, neckline {peak:.2f})")

    if len(close) >= 201:
        s50, s200 = sma(close, 50), sma(close, 200)
        diff = (s50 - s200).tail(21)
        if (diff.iloc[0] < 0) and (diff.iloc[-1] > 0):
            found.append("Golden cross (SMA50 crossed above SMA200, last 20 bars)")
        elif (diff.iloc[0] > 0) and (diff.iloc[-1] < 0):
            found.append("Death cross (SMA50 crossed below SMA200, last 20 bars)")

    if len(close) >= 60:
        prior = close.iloc[-56:-1]
        if close.iloc[-1] > prior.max():
            found.append("Breakout above 55-bar high")
        elif close.iloc[-1] < prior.min():
            found.append("Breakdown below 55-bar low")

    return found


def analyze(df: pd.DataFrame) -> dict:
    close = df["Close"]
    price = float(close.iloc[-1])
    s20, s50, s200 = (float(sma(close, n).iloc[-1]) if len(close) >= n else np.nan for n in (20, 50, 200))
    r = float(rsi(close).iloc[-1])
    m_line, m_sig, m_hist = macd(close)
    a = float(atr(df).iloc[-1])
    ad = float(adx(df).iloc[-1]) if (df["High"] != df["Low"]).any() else np.nan
    slope_3m, r2_3m = regression_slope(close, 63)
    slope_1y, r2_1y = regression_slope(close, 252)
    sup, res = support_resistance(df)

    # Trend score in [-100, 100]: MA alignment + regression slope + momentum.
    score = 0.0
    for ma in (s20, s50, s200):
        if not np.isnan(ma):
            score += 15 if price > ma else -15
    if not (np.isnan(s50) or np.isnan(s200)):
        score += 10 if s50 > s200 else -10
    score += np.clip(slope_3m / 2, -20, 20) * max(r2_3m, 0.3)
    score += 10 if m_hist.iloc[-1] > 0 else -10
    score = float(np.clip(score, -100, 100))

    if score >= 40:
        trend = "Strong uptrend"
    elif score >= 15:
        trend = "Uptrend"
    elif score > -15:
        trend = "Sideways"
    elif score > -40:
        trend = "Downtrend"
    else:
        trend = "Strong downtrend"

    returns = close.pct_change().dropna()
    return {
        "price": price,
        "sma20": s20, "sma50": s50, "sma200": s200,
        "rsi14": r,
        "rsi_state": "overbought" if r >= 70 else "oversold" if r <= 30 else "neutral",
        "macd": float(m_line.iloc[-1]), "macd_signal": float(m_sig.iloc[-1]), "macd_hist": float(m_hist.iloc[-1]),
        "atr14": a, "atr_pct": a / price * 100,
        "adx14": ad,
        "trend_strength": "strong" if ad >= 25 else "weak" if not np.isnan(ad) else "n/a",
        "slope_3m_ann_pct": slope_3m, "r2_3m": r2_3m,
        "slope_1y_ann_pct": slope_1y, "r2_1y": r2_1y,
        "volatility_ann_pct": float(returns.tail(252).std() * np.sqrt(252) * 100),
        "support": sup, "resistance": res,
        "patterns": detect_patterns(df),
        "trend_score": score,
        "trend": trend,
    }
