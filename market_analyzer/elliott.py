"""Rule-based Elliott Wave counting on ZigZag swings.

Hard rules (a count that breaks one is rejected):
  R1  Wave 2 never retraces beyond the start of wave 1.
  R2  Wave 3 is never the shortest of waves 1, 3, 5.
  R3  Wave 4 never enters wave 1's price territory.
Guidelines (scored, not required): wave 2 retraces 38.2-78.6% of wave 1, wave 3 ~1.618 x wave 1,
wave 4 retraces 23.6-50% of wave 3, wave 5 ~ wave 1, wave B retraces 38.2-88.6% of A, C ~ A.
"""

import numpy as np
import pandas as pd

from .technical import atr

DEGREE_ATR_MULT = {"minor": 3.0, "intermediate": 5.0, "primary": 8.0}


def zigzag(df: pd.DataFrame, threshold: float) -> list:
    """Alternating swing pivots [(pos, price, 'H'|'L')] with reversal >= threshold (price units).
    The last pivot is the running extreme of the current, unconfirmed leg."""
    high, low = df["High"].values, df["Low"].values
    pivots = []
    direction = 0
    ext_pos, ext_hi, ext_lo = 0, high[0], low[0]
    lo_pos = hi_pos = 0
    for i in range(1, len(df)):
        if direction >= 0 and high[i] >= ext_hi:
            ext_hi, hi_pos = high[i], i
        if direction <= 0 and low[i] <= ext_lo:
            ext_lo, lo_pos = low[i], i
        if direction >= 0 and ext_hi - low[i] >= threshold and (direction == 1 or hi_pos > lo_pos):
            pivots.append((hi_pos, float(ext_hi), "H"))
            direction, ext_lo, lo_pos = -1, low[i], i
        elif direction <= 0 and high[i] - ext_lo >= threshold and (direction == -1 or lo_pos > hi_pos):
            pivots.append((lo_pos, float(ext_lo), "L"))
            direction, ext_hi, hi_pos = 1, high[i], i
    if direction == 1:
        pivots.append((hi_pos, float(ext_hi), "H"))
    elif direction == -1:
        pivots.append((lo_pos, float(ext_lo), "L"))
    if pivots:  # the opposite extreme before the first pivot is where the first leg began
        first = pivots[0][0]
        if pivots[0][2] == "H":
            j = int(np.argmin(low[:first + 1]))
            if j < first:
                pivots.insert(0, (j, float(low[j]), "L"))
        else:
            j = int(np.argmax(high[:first + 1]))
            if j < first:
                pivots.insert(0, (j, float(high[j]), "H"))
    return pivots


def _near(ratio, ideal, tol):
    """1.0 at the ideal ratio, falling linearly to 0 at +/- tol."""
    return max(0.0, 1 - abs(ratio - ideal) / tol)


def _impulse(p: list, sign: int):
    """Validate and score waves on pivot prices p[0..n] (n = 2..5). sign=+1 up, -1 down.
    Returns (score 0-1, notes) or None if a hard rule breaks."""
    x = [sign * v for v in p]  # normalise so the impulse always points up
    legs = [x[i + 1] - x[i] for i in range(len(x) - 1)]
    w = dict(zip((1, 2, 3, 4, 5), legs))
    if w[1] <= 0:
        return None
    notes, fits = [], []
    if 2 in w:
        if x[2] <= x[0]:
            return None  # R1
        r2 = -w[2] / w[1]
        fits.append(max(_near(r2, 0.618, 0.3), _near(r2, 0.5, 0.25)))
        notes.append(f"W2 retrace {r2:.1%} of W1")
    if 3 in w:
        if x[3] <= x[1]:
            return None  # wave 3 must exceed the end of wave 1
        r3 = w[3] / w[1]
        fits.append(max(_near(r3, 1.618, 0.8), _near(r3, 2.618, 0.8), _near(r3, 1.0, 0.3) * 0.6))
        notes.append(f"W3 = {r3:.2f} x W1")
    if 4 in w:
        if x[4] <= x[1]:
            return None  # R3
        r4 = -w[4] / w[3]
        fits.append(max(_near(r4, 0.382, 0.2), _near(r4, 0.236, 0.15)))
        notes.append(f"W4 retrace {r4:.1%} of W3")
    if 5 in w:
        if w[5] <= 0:
            return None
        if w[3] < w[1] and w[3] < w[5]:
            return None  # R2
        r5 = w[5] / w[1]
        fits.append(max(_near(r5, 1.0, 0.4), _near(r5, 0.618, 0.3), _near(r5, 1.618, 0.5)))
        notes.append(f"W5 = {r5:.2f} x W1")
    return float(np.mean(fits)) if fits else 0.5, notes


def _abc(p: list, sign: int):
    """Score a correction A-B-C on pivots p[0..n] (n = 1..3) against an impulse of direction sign."""
    x = [sign * v for v in p]
    a = x[0] - x[1]
    if a <= 0:
        return None
    notes, fits = [], []
    if len(x) > 2:
        b = x[2] - x[1]
        if b <= 0 or b >= a * 1.382:
            return None
        rb = b / a
        fits.append(max(_near(rb, 0.5, 0.2), _near(rb, 0.618, 0.25), _near(rb, 0.786, 0.2)))
        notes.append(f"B retrace {rb:.1%} of A")
    if len(x) > 3:
        c = x[2] - x[3]
        if c <= 0:
            return None
        rc = c / a
        fits.append(max(_near(rc, 1.0, 0.4), _near(rc, 1.618, 0.5), _near(rc, 0.618, 0.25)))
        notes.append(f"C = {rc:.2f} x A")
    return float(np.mean(fits)) if fits else 0.5, notes


def _targets(p: list, sign: int, phase: str) -> tuple:
    """Fibonacci projections for the wave now developing, plus the invalidation price."""
    s = sign
    w1 = abs(p[1] - p[0]) if len(p) > 1 else 0
    t = {}
    if phase == "W2":
        t = {"W2 50%": p[1] - s * 0.5 * w1, "W2 61.8%": p[1] - s * 0.618 * w1}
        inv = p[0]
    elif phase == "W3":
        t = {"W3 1.618": p[2] + s * 1.618 * w1, "W3 2.618": p[2] + s * 2.618 * w1}
        inv = p[2]
    elif phase == "W4":
        w3 = abs(p[3] - p[2])
        t = {"W4 23.6%": p[3] - s * 0.236 * w3, "W4 38.2%": p[3] - s * 0.382 * w3}
        inv = p[1]
    elif phase == "W5":
        t = {"W5 = W1": p[4] + s * w1, "W5 0.618 x (W1..W3)": p[4] + s * 0.618 * abs(p[3] - p[0])}
        inv = p[4]
    else:  # correction after a completed impulse p[0..5]
        span = abs(p[5] - p[0])
        t = {"ABC 38.2%": p[5] - s * 0.382 * span, "ABC 50%": p[5] - s * 0.5 * span,
             "ABC 61.8%": p[5] - s * 0.618 * span}
        if len(p) >= 8:  # in wave C: C = A projected from B
            a = abs(p[6] - p[5])
            t["C = A"] = p[7] - s * a
            t["C = 1.618 A"] = p[7] - s * 1.618 * a
        inv = p[5]
    return {k: float(v) for k, v in t.items()}, float(inv)


PHASES = {  # pivots used -> (label of developing wave, pattern kind)
    3: ("W2", "impulse"), 4: ("W3", "impulse"), 5: ("W4", "impulse"), 6: ("W5", "impulse"),
    7: ("A", "abc"), 8: ("B", "abc"), 9: ("C", "abc"),
}
EXPECT = {
    "W2": "correction of wave 1, then wave 3 in the trend direction",
    "W3": "strongest leg in the trend direction",
    "W4": "sideways/counter-trend pullback, then a final wave 5",
    "W5": "final push; watch for exhaustion and an A-B-C correction",
    "A": "first leg of a correction against the prior impulse",
    "B": "counter-move inside the correction (often a trap)",
    "C": "final leg of the correction; the prior trend may resume after it",
}


def count_waves(df: pd.DataFrame) -> list:
    """All valid counts that end at the latest swing, across three wave degrees, best first."""
    a = float(atr(df).iloc[-1])
    price = float(df["Close"].iloc[-1])
    counts = []
    for degree, mult in DEGREE_ATR_MULT.items():
        piv = zigzag(df, a * mult)
        for n, (phase, kind) in PHASES.items():
            if len(piv) < n:
                continue
            seg = piv[-n:]
            prices = [v for _, v, _ in seg]
            sign = 1 if seg[0][2] == "L" else -1
            if kind == "impulse":
                res = _impulse(prices, sign)
            else:
                imp = _impulse(prices[:6], sign)
                abc = _abc(prices[5:], sign)
                res = None if imp is None or abc is None else (
                    (imp[0] + abc[0]) / 2, imp[1] + abc[1])
            if res is None:
                continue
            fit, notes = res
            # Prefer fuller counts slightly; a 2-wave count is weak evidence.
            score = fit * (0.6 + 0.4 * min(n, 6) / 6)
            targets, inv = _targets(prices, sign, phase if kind == "impulse" else "ABC")
            labels = (["0", "1", "2", "3", "4", "5", "A", "B", "C"])[:n]
            trend = "up" if sign == 1 else "down"
            now_dir = sign if phase in ("W3", "W5", "B") else -sign
            counts.append({
                "degree": degree,
                "trend": trend,
                "current_wave": phase,
                "pattern": ("Impulse" if kind == "impulse" else "Impulse + ABC correction") + f" ({trend})",
                "expectation": EXPECT[phase],
                "next_bias": "up" if now_dir == 1 else "down",
                "confidence_pct": round(score * 100, 1),
                "fib_notes": notes,
                "targets": targets,
                "targets_reached": [k for k, v in targets.items() if (v - price) * now_dir <= 0],
                "invalidation": inv,
                "pivots": [{"date": df.index[pos].strftime("%Y-%m-%d"), "price": price, "label": lab}
                           for (pos, price, _), lab in zip(seg, labels)],
            })
    counts.sort(key=lambda c: -c["confidence_pct"])
    return counts


def analyze(df: pd.DataFrame, max_alternates: int = 2) -> dict:
    counts = count_waves(df)
    if not counts:
        return {"primary": None, "alternates": [], "bias_score": 0.0,
                "note": "No count satisfies the Elliott rules on the current swings."}
    primary = counts[0]
    seen = {(primary["degree"], primary["current_wave"], primary["trend"])}
    alternates = []
    for c in counts[1:]:
        key = (c["degree"], c["current_wave"], c["trend"])
        if key not in seen and len(alternates) < max_alternates:
            alternates.append(c)
            seen.add(key)
    # The developing wave's direction is what matters for the next move.
    direction = 1 if primary["current_wave"] in ("W3", "W5", "B") else -1
    direction *= 1 if primary["trend"] == "up" else -1
    return {"primary": primary, "alternates": alternates,
            "bias_score": round(direction * primary["confidence_pct"], 1)}
