"""Run the full analysis on an Instrument and render JSON / plain-text reports."""

import json
import math
from datetime import datetime

import numpy as np
import pandas as pd

from . import elliott, forecast, fund, fundamental, smc, technical
from .data import Instrument

DISCLAIMER = ("Statistical and rule-based analysis for education only. "
              "Not investment advice; past patterns do not guarantee future prices.")


def run(inst: Instrument) -> dict:
    df = inst.prices.dropna(subset=["Close"])
    tech = technical.analyze(df)
    mc = forecast.monte_carlo(df["Close"])
    wf = forecast.walk_forward_accuracy(df["Close"])

    result = {
        "symbol": inst.symbol,
        "market": inst.market,
        "asset_type": inst.asset_type,
        "name": inst.info.get("longName") or inst.factsheet.get("name") or inst.symbol,
        "currency": inst.info.get("currency") or inst.factsheet.get("currency"),
        "as_of": df.index[-1].strftime("%Y-%m-%d"),
        "generated": datetime.now().isoformat(timespec="seconds"),
        "technical": tech,
        "elliott": elliott.analyze(df),
        "smc": smc.analyze(df),
        "forecast": mc,
        "backtest": wf,
    }

    fscore = fund_score = gap = None
    if inst.asset_type == "stock":
        fa = fundamental.analyze(inst.income, inst.balance, inst.cashflow, inst.info)
        result["fundamental"] = fa
        fscore = fa["score"]
        fv = fa["fair_value"]
        # Consensus target when covered; otherwise the median of the heuristic anchors.
        anchor = fv.get("analyst_target_mean") or (
            float(np.median([fv[k] for k in ("graham_number", "peg1_value") if fv.get(k)]))
            if any(fv.get(k) for k in ("graham_number", "peg1_value")) else None)
        if anchor:
            gap = (anchor / tech["price"] - 1) * 100
            result["valuation_gap_pct"] = gap
    else:
        fa = fund.analyze(df["Close"], inst.factsheet)
        result["fund"] = fa
        fund_score = fa["score"]

    result["outlook"] = forecast.composite_outlook(tech, mc, fscore, fund_score, gap,
                                                   result["elliott"]["bias_score"], result["smc"]["bias_score"])
    n = 500
    primary = result["elliott"]["primary"]
    if primary:  # always include the whole wave count
        n = max(n, len(df) - df.index.searchsorted(pd.Timestamp(primary["pivots"][0]["date"])) + 10)
    result["chart"] = _chart_series(df, n)
    result["disclaimer"] = DISCLAIMER
    return _clean(result)


def _chart_series(df, n: int = 500) -> dict:
    close = df["Close"]
    tail = df.tail(n)
    return {
        "dates": [d.strftime("%Y-%m-%d") for d in tail.index],
        "close": [round(float(x), 4) for x in tail["Close"]],
        "sma50": [None if math.isnan(x) else round(float(x), 4) for x in technical.sma(close, 50).tail(n)],
        "sma200": [None if math.isnan(x) else round(float(x), 4) for x in technical.sma(close, 200).tail(n)],
    }


def _clean(obj):
    """Make JSON-safe: NaN/inf -> None, numpy -> python."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.floating, float)):
        return None if not math.isfinite(obj) else float(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def save_json(result: dict, path: str):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)


def update_index(out_dir: str, result: dict, filename: str):
    """reports/index.json lists every saved report for the web viewer."""
    import os

    path = os.path.join(out_dir, "index.json")
    try:
        with open(path, encoding="utf-8") as f:
            index = json.load(f)
    except (OSError, ValueError):
        index = []
    index = [e for e in index if e.get("file") != filename]
    index.append({"file": filename, "symbol": result["symbol"], "name": result["name"],
                  "market": result["market"], "asset_type": result["asset_type"],
                  "as_of": result["as_of"], "signal": result["outlook"]["signal"],
                  "score": result["outlook"]["score"]})
    index.sort(key=lambda e: (e["market"], e["asset_type"], e["symbol"]))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)


# ---- plain-text rendering ----

def _f(v, fmt="{:,.2f}", na="n/a"):
    return na if v is None else fmt.format(v)


def _table(rows, headers):
    widths = [max(len(str(x)) for x in col) for col in zip(headers, *rows)]
    line = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    fmt = lambda r: "| " + " | ".join(str(c).ljust(w) for c, w in zip(r, widths)) + " |"
    return "\n".join([line, fmt(headers), line] + [fmt(r) for r in rows] + [line])


def to_text(r: dict) -> str:
    t, o = r["technical"], r["outlook"]
    out = [f"{r['name']} ({r['symbol']})  market={r['market']}  type={r['asset_type']}  "
           f"as of {r['as_of']}  [{r.get('currency') or ''}]", ""]

    out.append(f"OUTLOOK: {o['signal']}  score {o['score']:+.1f} / 100  "
               f"(components agree {o['agreement_pct']:.0f}%)")
    out.append(_table([[k, f"{v:+.1f}"] for k, v in o["components"].items()], ["component", "score"]))
    out.append("")

    out.append("PRICE PATTERN / TREND")
    out.append(_table([
        ["Price", _f(t["price"])],
        ["Trend", f"{t['trend']} (score {t['trend_score']:+.0f}, ADX {_f(t['adx14'], '{:.0f}')} {t['trend_strength']})"],
        ["SMA 20 / 50 / 200", f"{_f(t['sma20'])} / {_f(t['sma50'])} / {_f(t['sma200'])}"],
        ["RSI 14", f"{t['rsi14']:.1f} ({t['rsi_state']})"],
        ["MACD hist", _f(t["macd_hist"], "{:+.3f}")],
        ["Slope 3m / 1y (ann.)", f"{t['slope_3m_ann_pct']:+.1f}% (R2 {t['r2_3m']:.2f}) / {t['slope_1y_ann_pct']:+.1f}%"],
        ["Volatility (ann.)", _f(t["volatility_ann_pct"], "{:.1f}%")],
        ["Support", ", ".join(_f(x) for x in t["support"]) or "-"],
        ["Resistance", ", ".join(_f(x) for x in t["resistance"]) or "-"],
    ], ["metric", "value"]))
    for p in t["patterns"]:
        out.append(f"  * {p}")
    out.append("")

    out += _elliott_text(r["elliott"]) + _smc_text(r["smc"])

    if "fundamental" in r:
        fa = r["fundamental"]
        out.append(f"ACCOUNTS / FUNDAMENTALS  score {_f(fa['score'], '{:.0f}')}/100  ({fa['fiscal_years']} fiscal years)")
        out.append(_table([
            ["Revenue CAGR", _f(fa["revenue_cagr_pct"], "{:+.1f}%"), fa["revenue_trend"]],
            ["Net income CAGR", _f(fa["net_income_cagr_pct"], "{:+.1f}%"), fa["profit_trend"]],
            ["Gross / Op / Net margin", f"{_f(fa['gross_margin_pct'], '{:.1f}')} / {_f(fa['operating_margin_pct'], '{:.1f}')} / {_f(fa['net_margin_pct'], '{:.1f}')} %", ""],
            ["ROE / ROA", f"{_f(fa['roe_pct'], '{:.1f}')} / {_f(fa['roa_pct'], '{:.1f}')} %", ""],
            ["Debt/Equity", _f(fa["debt_to_equity"]), ""],
            ["Current ratio", _f(fa["current_ratio"]), ""],
            ["OCF / Net income", _f(fa["cash_conversion"]), ""],
            ["P/E  P/BV  Div yield", f"{_f(fa['pe'], '{:.1f}')}  {_f(fa['pbv'], '{:.2f}')}  {_f(fa['dividend_yield_pct'], '{:.2f}%')}", ""],
        ], ["metric", "value", "note"]))
        for k, v in fa["fair_value"].items():
            out.append(f"  {k}: {_f(v, '{:.0f}') if k == 'analyst_count' else _f(v)}")
        if r.get("valuation_gap_pct") is not None:
            out.append(f"  valuation anchor vs price: {r['valuation_gap_pct']:+.1f}%")
        out += [f"  {x}" for x in fa["flags"]]
        out.append("")

    if "fund" in r:
        fd, perf = r["fund"], r["fund"]["performance"]
        out.append(f"FUND FACT SHEET  score {fd['score']:.0f}/100")
        sheet = fd["factsheet"]
        rows = [[k, v] for k, v in sheet.items() if not isinstance(v, (list, dict))]
        rows += [[k, _f(v, "{:.2f}")] for k, v in perf.items()]
        out.append(_table(rows, ["field", "value"]))
        for h in (sheet.get("top_holdings") or [])[:5]:
            out.append(f"  holding {h['symbol']:<8} {h['weight_pct']:>6.2f}%  {h['name']}")
        out += [f"  {x}" for x in fd["flags"]]
        out.append("")

    out.append("PRICE PROJECTION (bootstrap Monte Carlo, drift shrunk 50%)")
    out.append(_table([[h, _f(v["p5"]), _f(v["p25"]), _f(v["median"]), _f(v["p75"]), _f(v["p95"]),
                        f"{v['prob_up_pct']:.0f}%"] for h, v in r["forecast"].items()],
                      ["horizon", "p5", "p25", "median", "p75", "p95", "P(up)"]))
    b = r["backtest"]
    out.append(f"  walk-forward: trend-following 1m direction hit rate {_f(b['trend_following_hit_rate_pct'], '{:.0f}%')} "
               f"over {b['samples']} samples (base rate up {_f(b['base_rate_up_pct'], '{:.0f}%')})")
    out.append("")
    out.append(r["disclaimer"])
    return "\n".join(out)


def _elliott_text(e: dict) -> list:
    out = [f"ELLIOTT WAVE  bias {e['bias_score']:+.1f}"]
    p = e["primary"]
    if not p:
        return out + ["  " + e["note"], ""]
    out.append(f"  Main count ({p['degree']} degree): {p['pattern']}, now in {p['current_wave']} "
               f"-> {p['expectation']}  [fit {p['confidence_pct']:.0f}%]")
    out.append("  Waves: " + "  ".join(f"{x['label']}={x['price']:,.2f} ({x['date']})" for x in p["pivots"]))
    out.append("  Fibonacci: " + "; ".join(p["fib_notes"]))
    out.append("  Targets: " + ", ".join(f"{k} {v:,.2f}{' (reached)' if k in p['targets_reached'] else ''}"
                                         for k, v in p["targets"].items()))
    out.append(f"  Invalidation: {p['invalidation']:,.2f}")
    for a in e["alternates"]:
        out.append(f"  Alternate ({a['degree']} degree): {a['pattern']}, in {a['current_wave']} "
                   f"[fit {a['confidence_pct']:.0f}%], invalidation {a['invalidation']:,.2f}")
    return out + [""]


def _smc_text(m: dict) -> list:
    out = [f"SMART MONEY CONCEPTS  structure {m['trend']}  bias {m['bias_score']:+.1f}"]
    if m["last_event"]:
        e = m["last_event"]
        out.append(f"  Last event: {e['direction']} {e['type']} at {e['level']:,.2f} on {e['date']}")
    pdz = m["premium_discount"]
    if pdz:
        out.append(f"  Dealing range {pdz['range_low']:,.2f} - {pdz['range_high']:,.2f}, "
                   f"price at {pdz['position_pct']:.0f}% ({pdz['zone']}), equilibrium {pdz['equilibrium']:,.2f}")
        out.append(f"  OTE long {pdz['ote_long'][0]:,.2f}-{pdz['ote_long'][1]:,.2f} | "
                   f"OTE short {pdz['ote_short'][0]:,.2f}-{pdz['ote_short'][1]:,.2f}")
    rows = []
    for key, label in (("supply_zones", "Supply OB"), ("demand_zones", "Demand OB")):
        rows += [[label, f"{z['bottom']:,.2f} - {z['top']:,.2f}", z["status"], z["date"]] for z in m[key]]
    rows += [[f"FVG {g['direction']}", f"{g['bottom']:,.2f} - {g['top']:,.2f}", g["status"], g["date"]]
             for g in m["fair_value_gaps"]]
    rows += [["Buy-side liquidity", f"{p['level']:,.2f}", f"{p['touches']} equal highs", ""] for p in m["buy_side_liquidity"]]
    rows += [["Sell-side liquidity", f"{p['level']:,.2f}", f"{p['touches']} equal lows", ""] for p in m["sell_side_liquidity"]]
    rows += [["Sweep", f"{s['level']:,.2f}", s["side"], s["date"]] for s in m["recent_sweeps"]]
    if rows:
        out.append(_table(rows, ["zone", "price", "status", "date"]))
    return out + [""]
