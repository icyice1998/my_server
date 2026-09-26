"""Smart Money Concepts: market structure (BOS / CHoCH), order blocks, fair value gaps,
liquidity pools and sweeps, premium / discount zones."""

import numpy as np
import pandas as pd

from .context import event_history
from .technical import atr


def swings(df: pd.DataFrame, length: int = 5):
    """Fractal swing highs/lows. Returns lists of (pos, price, confirm_pos)."""
    high, low = df["High"].values, df["Low"].values
    sh, sl = [], []
    for i in range(length, len(df) - length):
        win = slice(i - length, i + length + 1)
        if high[i] == high[win].max() and (not sh or i - sh[-1][0] > length):
            sh.append((i, float(high[i]), i + length))
        if low[i] == low[win].min() and (not sl or i - sl[-1][0] > length):
            sl.append((i, float(low[i]), i + length))
    return sh, sl


def _order_block(df, start, end, bullish):
    """Last opposite-colour candle at the origin of the leg that broke structure."""
    o, c, h, l = (df[k].values for k in ("Open", "Close", "High", "Low"))
    seg = range(start, end + 1)
    origin = min(seg, key=lambda j: l[j]) if bullish else max(seg, key=lambda j: h[j])
    for j in range(origin, max(origin - 10, -1), -1):
        if (bullish and c[j] < o[j]) or (not bullish and c[j] > o[j]):
            return j
    return origin


def structure(df: pd.DataFrame, length: int = 5):
    """Walk bars in order; a close beyond the last unbroken swing is a break of structure.
    A break against the prevailing trend is a change of character (CHoCH)."""
    sh, sl = swings(df, length)
    close = df["Close"].values
    events, obs = [], []
    trend = 0
    hi_i = lo_i = 0
    last_hi = last_lo = None
    for t in range(len(df)):
        while hi_i < len(sh) and sh[hi_i][2] <= t:
            last_hi, hi_i = sh[hi_i], hi_i + 1
        while lo_i < len(sl) and sl[lo_i][2] <= t:
            last_lo, lo_i = sl[lo_i], lo_i + 1
        if last_hi and close[t] > last_hi[1]:
            kind = "CHoCH" if trend == -1 else "BOS"
            events.append({"pos": t, "type": kind, "direction": "bullish", "level": last_hi[1],
                           "swing_pos": last_hi[0]})
            j = _order_block(df, last_hi[0], t, True)
            obs.append({"pos": j, "formed": t, "direction": "bullish",
                        "bottom": float(df["Low"].iat[j]), "top": float(df["High"].iat[j])})
            trend, last_hi = 1, None
        elif last_lo and close[t] < last_lo[1]:
            kind = "CHoCH" if trend == 1 else "BOS"
            events.append({"pos": t, "type": kind, "direction": "bearish", "level": last_lo[1],
                           "swing_pos": last_lo[0]})
            j = _order_block(df, last_lo[0], t, False)
            obs.append({"pos": j, "formed": t, "direction": "bearish",
                        "bottom": float(df["Low"].iat[j]), "top": float(df["High"].iat[j])})
            trend, last_lo = -1, None
    return events, obs, trend, sh, sl


def _ob_status(df, ob):
    after = df.iloc[ob["formed"] + 1:]
    if ob["direction"] == "bullish":
        if (after["Close"] < ob["bottom"]).any():
            return "broken"
        return "mitigated" if (after["Low"] <= ob["top"]).any() else "fresh"
    if (after["Close"] > ob["top"]).any():
        return "broken"
    return "mitigated" if (after["High"] >= ob["bottom"]).any() else "fresh"


def fair_value_gaps(df: pd.DataFrame, min_atr: float = 0.25, lookback: int = 150) -> list:
    h, l = df["High"].values, df["Low"].values
    a = atr(df).values
    gaps = []
    for i in range(max(2, len(df) - lookback), len(df)):
        if l[i] - h[i - 2] > min_atr * a[i]:
            gaps.append({"pos": i - 1, "direction": "bullish", "bottom": float(h[i - 2]), "top": float(l[i])})
        elif l[i - 2] - h[i] > min_atr * a[i]:
            gaps.append({"pos": i - 1, "direction": "bearish", "bottom": float(h[i]), "top": float(l[i - 2])})
    for g in gaps:
        after = df.iloc[g["pos"] + 2:]
        if g["direction"] == "bullish":
            filled, touched = (after["Low"] <= g["bottom"]).any(), (after["Low"] < g["top"]).any()
        else:
            filled, touched = (after["High"] >= g["top"]).any(), (after["High"] > g["bottom"]).any()
        g["status"] = "filled" if filled else "partial" if touched else "open"
    return gaps


def liquidity(df: pd.DataFrame, sh, sl, tol_atr: float = 0.15, lookback: int = 150):
    """Equal highs/lows not yet taken (resting liquidity) and recent sweeps (wick through, close back)."""
    a = float(atr(df).iloc[-1])
    n = len(df)
    high, low, close = df["High"].values, df["Low"].values, df["Close"].values
    pools = []
    for pts, side in ((sh, "buy-side"), (sl, "sell-side")):
        pts = [p for p in pts if p[0] >= n - lookback]
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                if abs(pts[i][1] - pts[j][1]) <= tol_atr * a:
                    level = max(pts[i][1], pts[j][1]) if side == "buy-side" else min(pts[i][1], pts[j][1])
                    later = slice(pts[j][0] + 1, n)
                    taken = (high[later] > level).any() if side == "buy-side" else (low[later] < level).any()
                    if not taken:
                        pools.append({"side": side, "level": float(level), "touches": 2,
                                      "pos": pts[j][0]})
    sweeps = []
    for pts, side in ((sh, "buy-side"), (sl, "sell-side")):
        for pos, level, conf in pts:
            for t in range(max(conf, n - 20), n):
                if side == "buy-side" and high[t] > level and close[t] < level:
                    sweeps.append({"pos": t, "side": side, "level": level})
                    break
                if side == "sell-side" and low[t] < level and close[t] > level:
                    sweeps.append({"pos": t, "side": side, "level": level})
                    break
    # merge near-duplicate pools
    merged = []
    for p in sorted(pools, key=lambda p: p["level"]):
        if merged and merged[-1]["side"] == p["side"] and abs(merged[-1]["level"] - p["level"]) <= tol_atr * a:
            merged[-1]["touches"] += 1
        else:
            merged.append(p)
    unique = {(s["pos"], s["side"], round(s["level"], 6)): s for s in sweeps}
    return merged, sorted(unique.values(), key=lambda s: s["pos"])


def premium_discount(df: pd.DataFrame, sh, sl) -> dict:
    """Dealing range = latest swing high and swing low (extended by any newer extreme)."""
    if not sh or not sl:
        return {}
    start = min(sh[-1][0], sl[-1][0])
    hi = float(df["High"].iloc[start:].max())
    lo = float(df["Low"].iloc[start:].min())
    price = float(df["Close"].iloc[-1])
    if hi <= lo:
        return {}
    pos = (price - lo) / (hi - lo) * 100
    zone = "premium" if pos > 55 else "discount" if pos < 45 else "equilibrium"
    rng = hi - lo
    return {"range_high": hi, "range_low": lo, "equilibrium": lo + rng / 2,
            "position_pct": pos, "zone": zone,
            "ote_long": [hi - 0.79 * rng, hi - 0.62 * rng],
            "ote_short": [lo + 0.62 * rng, lo + 0.79 * rng]}


def analyze(df: pd.DataFrame, length: int = 5) -> dict:
    events, obs, trend, sh, sl = structure(df, length)
    price = float(df["Close"].iloc[-1])
    date = lambda p: df.index[p].strftime("%Y-%m-%d")

    for ob in obs:
        ob["status"] = _ob_status(df, ob)
    active_obs = [ob for ob in obs if ob["status"] != "broken"]
    demand = sorted([o for o in active_obs if o["direction"] == "bullish" and o["top"] <= price * 1.001],
                    key=lambda o: -o["top"])[:3]
    supply = sorted([o for o in active_obs if o["direction"] == "bearish" and o["bottom"] >= price * 0.999],
                    key=lambda o: o["bottom"])[:3]
    inside = [o for o in active_obs if o["bottom"] <= price <= o["top"]]

    gaps = [g for g in fair_value_gaps(df) if g["status"] != "filled"]
    gaps = sorted(gaps, key=lambda g: abs((g["top"] + g["bottom"]) / 2 - price))[:4]
    pools, sweeps = liquidity(df, sh, sl)
    buy_side = sorted([p for p in pools if p["side"] == "buy-side" and p["level"] > price], key=lambda p: p["level"])[:2]
    sell_side = sorted([p for p in pools if p["side"] == "sell-side" and p["level"] < price], key=lambda p: -p["level"])[:2]
    pd_zone = premium_discount(df, sh, sl)

    # Bias: last structure event, adjusted by location and fresh liquidity grabs.
    score = 0.0
    last = events[-1] if events else None
    if last:
        d = 1 if last["direction"] == "bullish" else -1
        score += d * (60 if last["type"] == "BOS" else 45)
        zone = pd_zone.get("zone")
        if zone == ("discount" if d == 1 else "premium"):
            score += d * 20
        elif zone == ("premium" if d == 1 else "discount"):
            score -= d * 10
    recent = [s for s in sweeps if s["pos"] >= len(df) - 5]
    for s in recent:
        score += 15 if s["side"] == "sell-side" else -15
    for o in inside:
        score += 15 if o["direction"] == "bullish" else -15
    score = float(np.clip(score, -100, 100))

    history = event_history(df, events)
    reason = None
    if last:
        name = f"{last['direction']} {last['type']}"
        h = history.get(name, {}).get("1m")
        if h:
            reason = (f"After the {h['n']} past {name} events on this chart, the next month's median move was "
                      f"{h['median_pct']:+.1f}% and price was higher {h['up_pct']:.0f}% of the time.")

    fmt_ob = lambda o: {"date": date(o["pos"]), "formed": date(o["formed"]), "direction": o["direction"],
                        "bottom": o["bottom"], "top": o["top"], "status": o["status"]}
    return {
        "trend": {1: "bullish", -1: "bearish", 0: "undefined"}[trend],
        "last_event": None if not last else {
            "type": last["type"], "direction": last["direction"], "level": last["level"],
            "date": date(last["pos"])},
        "events": [{"type": e["type"], "direction": e["direction"], "level": e["level"],
                    "date": date(e["pos"]), "swing_date": date(e["swing_pos"])} for e in events[-8:]],
        "demand_zones": [fmt_ob(o) for o in demand],
        "supply_zones": [fmt_ob(o) for o in supply],
        "price_in_order_block": [fmt_ob(o) for o in inside],
        "fair_value_gaps": [{"date": date(g["pos"]), "direction": g["direction"], "bottom": g["bottom"],
                             "top": g["top"], "status": g["status"]} for g in gaps],
        "buy_side_liquidity": [{"level": p["level"], "touches": p["touches"]} for p in buy_side],
        "sell_side_liquidity": [{"level": p["level"], "touches": p["touches"]} for p in sell_side],
        "recent_sweeps": [{"date": date(s["pos"]), "side": s["side"], "level": s["level"]} for s in sweeps[-3:]],
        "premium_discount": pd_zone,
        "event_history": history,
        "reason": reason,
        "bias_score": round(score, 1),
    }
