"""Build the static data the V3 Bull dashboard reads.

  python -m pipeline.build --out data            # run from market/

Writes
  data/meta.json           markets, index names, stock list (symbol, name, sector, market), build time
  data/panel_US.json       5 years of daily closes for every S&P 500 stock + the S&P 500 index
  data/panel_TH.json       the same for SET stocks + an equal-weight SET index built from them
  data/ohlc/<SYM>.json     ~400 daily OHLCV bars per stock, for the candle chart

Yahoo has no usable history for Thai indices (^SET.BK returns a single bar), so the Thai macro gate uses an
equal-weight index of the tracked SET stocks: each day's index return is the mean of the stocks' daily returns.
"""

import argparse
import json
import math
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(__file__)
YEARS = 5
OHLC_BARS = 400
US_INDEX = "^GSPC"


def load_stocks() -> list:
    with open(os.path.join(HERE, "stocks.json"), encoding="utf-8") as f:
        return json.load(f)


def _r(x, sig: int = 6):
    if x is None or not math.isfinite(x):
        return None
    return float(f"{x:.{sig}g}")


def download(symbols: list, period: str) -> dict:
    import yfinance as yf
    raw = yf.download(symbols, period=period, auto_adjust=True, progress=False, group_by="ticker", threads=True)
    out = {}
    for s in symbols:
        try:
            df = raw[s] if isinstance(raw.columns, pd.MultiIndex) else raw
            df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
        except KeyError:
            continue
        if len(df):
            df.index = pd.DatetimeIndex(df.index).tz_localize(None).normalize()
            out[s] = df
    return out


def equal_weight_index(closes: pd.DataFrame, base: float = 1000.0) -> pd.Series:
    """Daily mean of constituent returns, chained from `base`. Missing stocks simply drop out that day."""
    rets = closes.pct_change(fill_method=None).clip(-0.5, 1.0)
    mean = rets.mean(axis=1, skipna=True).fillna(0.0)
    mean.iloc[0] = 0.0
    return base * (1 + mean).cumprod()


def encode_dates(index: pd.DatetimeIndex) -> dict:
    gaps = [0] + [int(g) for g in (index[1:] - index[:-1]).days]
    return {"d0": index[0].strftime("%Y-%m-%d"), "dt": gaps}


def panel(prices: dict, symbols: list, index_close: pd.Series, index_name: str) -> dict:
    closes = pd.DataFrame({s: prices[s]["Close"] for s in symbols if s in prices})
    dates = closes.index.union(index_close.dropna().index).sort_values()
    closes = closes.reindex(dates)
    idx = index_close.reindex(dates).ffill()
    keep = idx.notna()
    closes, idx, dates = closes[keep], idx[keep], dates[keep]
    return {
        **encode_dates(dates),
        "index": {"name": index_name, "c": [_r(x) for x in idx]},
        "s": list(closes.columns),
        "c": [[_r(x) for x in closes[s]] for s in closes.columns],
    }


def ohlc(df: pd.DataFrame, bars: int = OHLC_BARS) -> dict:
    df = df.tail(bars)
    return {**encode_dates(df.index), "o": [_r(x) for x in df["Open"]], "h": [_r(x) for x in df["High"]],
            "l": [_r(x) for x in df["Low"]], "c": [_r(x) for x in df["Close"]],
            "v": [int(x) if x == x else 0 for x in df["Volume"]]}


def filename(symbol: str) -> str:
    return symbol.replace(".", "_").replace("^", "") + ".json"


def write_json(path: str, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)


def build(out: str, prices: dict = None) -> dict:
    stocks = load_stocks()
    syms = [x["s"] for x in stocks]
    if prices is None:
        prices = download(syms + [US_INDEX], f"{YEARS}y")
    os.makedirs(os.path.join(out, "ohlc"), exist_ok=True)
    have = [x for x in stocks if x["s"] in prices and len(prices[x["s"]]) >= 60]

    us = [x["s"] for x in have if x["m"] == "US"]
    th = [x["s"] for x in have if x["m"] == "TH"]
    th_closes = pd.DataFrame({s: prices[s]["Close"] for s in th})
    panels = {
        "US": panel(prices, us, prices[US_INDEX]["Close"], "S&P 500"),
        "TH": panel(prices, th, equal_weight_index(th_closes), "SET equal-weight (tracked stocks)"),
    }
    for m, p in panels.items():
        write_json(os.path.join(out, f"panel_{m}.json"), p)

    keep = set()
    for x in have:
        write_json(os.path.join(out, "ohlc", filename(x["s"])), ohlc(prices[x["s"]]))
        keep.add(filename(x["s"]))
    for old in os.listdir(os.path.join(out, "ohlc")):
        if old not in keep:
            os.remove(os.path.join(out, "ohlc", old))

    meta = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "markets": {
            "US": {"name": "S&P 500", "currency": "USD", "lot": 1, "index": "S&P 500 (^GSPC)"},
            "TH": {"name": "SET", "currency": "THB", "lot": 100, "index": "SET equal-weight of tracked stocks"},
        },
        "stocks": have,
        "missing": [x["s"] for x in stocks if x not in have],
    }
    write_json(os.path.join(out, "meta.json"), meta)
    return meta


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default="data")
    args = p.parse_args(argv)
    meta = build(args.out)
    print(f"{len(meta['stocks'])} stocks written, {len(meta['missing'])} missing: {meta['missing'][:10]}")


if __name__ == "__main__":
    main()
