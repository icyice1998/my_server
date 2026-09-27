"""Publish compact daily price files for the browser engine (engine.js).

One file per asset: {"s": symbol, "d0": first date, "dt": [day gaps], "o","h","l","c": prices, "v": volume}.
Prices are rounded to 6 significant digits, which keeps ~630 bars per asset around 25 KB.
"""

import json
import os

import pandas as pd

BARS = 630  # ~2.5 years: 252 bars of feature warm-up plus a year of history for the charts and context


def filename(symbol: str) -> str:
    return symbol.replace(".", "_") + ".json"


def _r(x: float) -> float:
    return float(f"{x:.6g}")


def encode(symbol: str, df: pd.DataFrame, bars: int = BARS) -> dict:
    df = df.tail(bars)
    days = pd.DatetimeIndex(df.index).normalize()
    gaps = [0] + [int(d) for d in (days[1:] - days[:-1]).days]
    return {
        "s": symbol,
        "d0": days[0].strftime("%Y-%m-%d"),
        "dt": gaps,
        "o": [_r(x) for x in df["Open"]], "h": [_r(x) for x in df["High"]],
        "l": [_r(x) for x in df["Low"]], "c": [_r(x) for x in df["Close"]],
        "v": [int(x) if x == x else 0 for x in df["Volume"]],
    }


def decode(j: dict) -> pd.DataFrame:
    """Inverse of encode (used by tests and the Python/JS parity check)."""
    dates = pd.Timestamp(j["d0"]) + pd.to_timedelta(pd.Series(j["dt"]).cumsum(), unit="D")
    return pd.DataFrame({"Open": j["o"], "High": j["h"], "Low": j["l"], "Close": j["c"], "Volume": j["v"]},
                        index=pd.DatetimeIndex(dates))


def export_prices(prices: dict, out_dir: str, bars: int = BARS) -> list:
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for sym, df in prices.items():
        with open(os.path.join(out_dir, filename(sym)), "w", encoding="utf-8") as f:
            json.dump(encode(sym, df, bars), f, separators=(",", ":"))
        written.append(sym)
    keep = {filename(s) for s in written}
    for old in os.listdir(out_dir):  # drop assets that left the universe
        if old.endswith(".json") and old not in keep:
            os.remove(os.path.join(out_dir, old))
    return written
