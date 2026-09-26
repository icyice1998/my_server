"""Fund analysis: NAV risk/return statistics plus fact-sheet checks."""

import numpy as np
import pandas as pd


def performance(close: pd.Series, risk_free_pct: float = 2.0) -> dict:
    r = close.pct_change().dropna()
    out = {}
    for label, days in (("1m", 21), ("3m", 63), ("6m", 126), ("1y", 252), ("3y", 756), ("5y", 1260)):
        if len(close) > days:
            total = close.iloc[-1] / close.iloc[-days - 1] - 1
            years = days / 252
            out[f"return_{label}_pct"] = float((total if years <= 1 else (1 + total) ** (1 / years) - 1) * 100)
    vol = r.tail(756).std() * np.sqrt(252)
    ann = r.tail(756).mean() * 252
    downside = r.tail(756)[r.tail(756) < 0].std() * np.sqrt(252)
    out["volatility_ann_pct"] = float(vol * 100)
    out["sharpe"] = float((ann - risk_free_pct / 100) / vol) if vol else np.nan
    out["sortino"] = float((ann - risk_free_pct / 100) / downside) if downside else np.nan
    peak = close.cummax()
    dd = close / peak - 1
    out["max_drawdown_pct"] = float(dd.min() * 100)
    out["current_drawdown_pct"] = float(dd.iloc[-1] * 100)
    return out


def analyze(close: pd.Series, factsheet: dict) -> dict:
    perf = performance(close)
    flags = []
    er = factsheet.get("expense_ratio_pct")
    cat_er = factsheet.get("category_expense_ratio_pct")
    if er is not None:
        if cat_er:
            flags.append(("+ " if er <= cat_er else "- ") + f"Expense ratio {er:.2f}% vs category {cat_er:.2f}%")
        elif er <= 0.5:
            flags.append(f"+ Low expense ratio {er:.2f}%")
        elif er >= 1.5:
            flags.append(f"- High expense ratio {er:.2f}%")
    turnover = factsheet.get("turnover")
    if turnover is not None and turnover > 1:
        flags.append(f"- High turnover {turnover * 100:.0f}% (trading costs, tax drag)")
    holdings = factsheet.get("top_holdings") or []
    top10 = sum(h.get("weight_pct", 0) for h in holdings[:10])
    if top10:
        flags.append(("- Concentrated" if top10 > 50 else "+ Diversified") + f": top-10 holdings {top10:.1f}%")
    sectors = factsheet.get("sectors_pct") or {}
    if sectors:
        name, w = next(iter(sectors.items()))
        if w > 35:
            flags.append(f"- Sector tilt: {name} {w:.1f}%")
    if perf.get("sharpe") is not None and not np.isnan(perf["sharpe"]):
        s = perf["sharpe"]
        flags.append(("+ " if s >= 1 else "- " if s < 0.3 else "  ") + f"Sharpe (3y) {s:.2f}")
    if perf["max_drawdown_pct"] < -35:
        flags.append(f"- Deep max drawdown {perf['max_drawdown_pct']:.1f}%")

    good = sum(f.startswith("+") for f in flags)
    bad = sum(f.startswith("-") for f in flags)
    score = round(50 + 50 * (good - bad) / max(good + bad, 1), 1)
    return {"performance": perf, "factsheet": factsheet, "flags": flags, "score": score}
