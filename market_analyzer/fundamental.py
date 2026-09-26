"""Accounting analysis from income statement, balance sheet and cash flow."""

import numpy as np
import pandas as pd


def _row(df: pd.DataFrame, *names):
    """First matching statement row, oldest -> newest, as floats."""
    for n in names:
        if not df.empty and n in df.index:
            s = df.loc[n].dropna().astype(float)
            if not s.empty:
                return s.sort_index()
    return pd.Series(dtype=float)


def _latest(s: pd.Series):
    return float(s.iloc[-1]) if len(s) else np.nan


def _cagr(s: pd.Series):
    if len(s) < 2 or s.iloc[0] <= 0 or s.iloc[-1] <= 0:
        return np.nan
    return ((s.iloc[-1] / s.iloc[0]) ** (1 / (len(s) - 1)) - 1) * 100


def _div(a, b):
    return a / b * 100 if b and not np.isnan(b) and not np.isnan(a) else np.nan


def analyze(income: pd.DataFrame, balance: pd.DataFrame, cashflow: pd.DataFrame, info: dict) -> dict:
    revenue = _row(income, "Total Revenue", "Operating Revenue")
    net = _row(income, "Net Income Common Stockholders", "Net Income")
    op_inc = _row(income, "Operating Income", "EBIT")
    gross = _row(income, "Gross Profit")
    eps = _row(income, "Diluted EPS", "Basic EPS")
    equity = _row(balance, "Stockholders Equity", "Common Stock Equity")
    assets = _row(balance, "Total Assets")
    debt = _row(balance, "Total Debt")
    cur_a = _row(balance, "Current Assets")
    cur_l = _row(balance, "Current Liabilities")
    ocf = _row(cashflow, "Operating Cash Flow")
    fcf = _row(cashflow, "Free Cash Flow")

    rev, ni = _latest(revenue), _latest(net)
    m = {
        "fiscal_years": len(revenue),
        "revenue": rev,
        "net_income": ni,
        "revenue_cagr_pct": _cagr(revenue),
        "net_income_cagr_pct": _cagr(net),
        "eps_cagr_pct": _cagr(eps),
        "gross_margin_pct": _div(_latest(gross), rev),
        "operating_margin_pct": _div(_latest(op_inc), rev),
        "net_margin_pct": _div(ni, rev),
        "roe_pct": _div(ni, _latest(equity)),
        "roa_pct": _div(ni, _latest(assets)),
        "debt_to_equity": _latest(debt) / _latest(equity) if _latest(equity) else np.nan,
        "current_ratio": _latest(cur_a) / _latest(cur_l) if _latest(cur_l) else np.nan,
        "free_cash_flow": _latest(fcf),
        "cash_conversion": _latest(ocf) / ni if ni and ni > 0 else np.nan,
        "pe": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
        "pbv": info.get("priceToBook"),
        "dividend_yield_pct": info.get("dividendYield"),
        "sector": info.get("sector"),
        "currency": info.get("currency"),
        "eps_ttm": info.get("trailingEps"),
        "book_value_ps": info.get("bookValue"),
    }
    m["profit_trend"] = _direction(net)
    m["revenue_trend"] = _direction(revenue)
    m["score"], m["flags"] = _score(m)
    m["fair_value"] = fair_value(m, info)
    return m


def _direction(s: pd.Series) -> str:
    if len(s) < 3:
        return "n/a"
    d = np.sign(np.diff(s.values))
    if (d > 0).all():
        return "rising every year"
    if (d < 0).all():
        return "falling every year"
    return "rising overall" if s.iloc[-1] > s.iloc[0] else "falling overall"


def _score(m: dict):
    """Quality/value score 0-100 from simple, transparent rules."""
    rules = [
        ("roe_pct", lambda v: v >= 15, "ROE >= 15%", lambda v: v < 5, "ROE < 5%"),
        ("net_margin_pct", lambda v: v >= 10, "Net margin >= 10%", lambda v: v < 3, "Net margin < 3%"),
        ("revenue_cagr_pct", lambda v: v >= 5, "Revenue growing >= 5%/yr", lambda v: v < 0, "Revenue shrinking"),
        ("net_income_cagr_pct", lambda v: v >= 5, "Profit growing >= 5%/yr", lambda v: v < 0, "Profit shrinking"),
        ("debt_to_equity", lambda v: v <= 0.5, "Low debt (D/E <= 0.5)", lambda v: v > 2, "High debt (D/E > 2)"),
        ("current_ratio", lambda v: v >= 1.5, "Current ratio >= 1.5", lambda v: v < 1, "Current ratio < 1"),
        ("cash_conversion", lambda v: v >= 1, "Operating cash flow >= net income", lambda v: v < 0.7, "Weak cash conversion"),
        ("free_cash_flow", lambda v: v > 0, "Positive free cash flow", lambda v: v < 0, "Negative free cash flow"),
        ("pe", lambda v: 0 < v <= 15, "P/E <= 15", lambda v: v > 35 or v <= 0, "P/E > 35 or negative"),
        ("pbv", lambda v: 0 < v <= 1.5, "P/BV <= 1.5", lambda v: v > 6, "P/BV > 6"),
    ]
    points, counted, flags = 0.0, 0, []
    for key, good, good_msg, bad, bad_msg in rules:
        v = m.get(key)
        if v is None or (isinstance(v, float) and np.isnan(v)):
            continue
        counted += 1
        if good(v):
            points += 1
            flags.append("+ " + good_msg)
        elif bad(v):
            flags.append("- " + bad_msg)
        else:
            points += 0.5
    return (round(points / counted * 100, 1) if counted else np.nan), flags


def fair_value(m: dict, info: dict) -> dict:
    """Rough intrinsic-value anchors; each is a heuristic, not a valuation model."""
    out = {}
    eps, bv = m.get("eps_ttm"), m.get("book_value_ps")
    if eps and bv and eps > 0 and bv > 0:
        out["graham_number"] = float(np.sqrt(22.5 * eps * bv))
    growth = m.get("eps_cagr_pct")
    if eps and eps > 0 and growth is not None and not np.isnan(growth):
        g = float(np.clip(growth, 0, 20))
        out["peg1_value"] = eps * max(g, 8)  # P/E equal to growth, floor 8
    target = info.get("targetMeanPrice")
    if target:
        out["analyst_target_mean"] = float(target)
        out["analyst_count"] = info.get("numberOfAnalystOpinions")
    return out
