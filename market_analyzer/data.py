"""Data loading: price history, financial statements, fund fact sheets."""

import os
from dataclasses import dataclass, field

import pandas as pd

MARKETS = ("TH", "US")
ASSET_TYPES = ("auto", "stock", "fund")
FUND_QUOTE_TYPES = {"ETF", "MUTUALFUND"}


def resolve_symbol(symbol: str, market: str) -> str:
    """Map a plain ticker to its Yahoo symbol. SET stocks use the .BK suffix."""
    symbol = symbol.strip().upper()
    if market == "TH" and "." not in symbol:
        return f"{symbol}.BK"
    return symbol


@dataclass
class Instrument:
    symbol: str
    market: str
    asset_type: str
    prices: pd.DataFrame
    info: dict = field(default_factory=dict)
    income: pd.DataFrame = field(default_factory=pd.DataFrame)
    balance: pd.DataFrame = field(default_factory=pd.DataFrame)
    cashflow: pd.DataFrame = field(default_factory=pd.DataFrame)
    factsheet: dict = field(default_factory=dict)


def _safe(fn, default):
    try:
        value = fn()
        return default if value is None else value
    except Exception:
        return default


def load_yahoo(symbol: str, market: str = "US", asset_type: str = "auto",
               period: str = "5y") -> Instrument:
    import yfinance as yf

    ysym = resolve_symbol(symbol, market)
    ticker = yf.Ticker(ysym)
    prices = ticker.history(period=period, auto_adjust=True)
    if prices.empty:
        raise ValueError(f"No price data for {ysym}")
    prices.index = prices.index.tz_localize(None)

    info = _safe(lambda: ticker.info, {})
    if asset_type == "auto":
        asset_type = "fund" if info.get("quoteType") in FUND_QUOTE_TYPES else "stock"

    inst = Instrument(ysym, market, asset_type, prices[["Open", "High", "Low", "Close", "Volume"]], info)
    if asset_type == "stock":
        inst.income = _safe(lambda: ticker.income_stmt, pd.DataFrame())
        inst.balance = _safe(lambda: ticker.balance_sheet, pd.DataFrame())
        inst.cashflow = _safe(lambda: ticker.cash_flow, pd.DataFrame())
    else:
        inst.factsheet = _yahoo_factsheet(ticker, info)
    return inst


def _yahoo_factsheet(ticker, info: dict) -> dict:
    fd = _safe(lambda: ticker.funds_data, None)
    sheet = {
        "name": info.get("longName") or info.get("shortName"),
        "category": info.get("category"),
        "family": info.get("fundFamily"),
        "expense_ratio_pct": info.get("netExpenseRatio"),
        "total_assets": info.get("totalAssets"),
        "yield_pct": _pct(info.get("yield")),
        "ytd_return_pct": info.get("ytdReturn"),
        "return_3y_pct": _pct(info.get("threeYearAverageReturn")),
        "return_5y_pct": _pct(info.get("fiveYearAverageReturn")),
        "beta_3y": info.get("beta3Year"),
        "currency": info.get("currency"),
    }
    if fd is not None:
        ops = _safe(lambda: fd.fund_operations, pd.DataFrame())
        if not ops.empty:
            sheet["turnover"] = _num(ops.iloc[:, 0].get("Annual Holdings Turnover"))
            sheet["category_expense_ratio_pct"] = _pct(_num(ops.iloc[:, -1].get("Annual Report Expense Ratio")))
        holdings = _safe(lambda: fd.top_holdings, pd.DataFrame())
        if not holdings.empty:
            sheet["top_holdings"] = [
                {"symbol": s, "name": r["Name"], "weight_pct": round(r["Holding Percent"] * 100, 2)}
                for s, r in holdings.head(10).iterrows()
            ]
        sectors = _safe(lambda: fd.sector_weightings, {})
        if sectors:
            sheet["sectors_pct"] = {k: round(v * 100, 2) for k, v in sorted(sectors.items(), key=lambda kv: -kv[1])}
    return {k: v for k, v in sheet.items() if v is not None}


def _num(x):
    try:
        return None if x is None or pd.isna(x) else float(x)
    except (TypeError, ValueError):
        return None


def _pct(x):
    return None if x is None else round(float(x) * 100, 4)


# ---- Thai mutual funds (SEC Thailand open API) ----
# Thai mutual funds are not on Yahoo. The SEC open API (https://api-portal.sec.or.th)
# needs a free subscription key in SEC_API_KEY. Endpoint paths follow the public portal
# and may change; any failure falls back to a local NAV CSV + fact sheet JSON.

SEC_BASE = "https://api.sec.or.th"


def _sec_get(path: str, method: str = "GET", json_body=None):
    import requests

    key = os.environ.get("SEC_API_KEY")
    if not key:
        raise RuntimeError("SEC_API_KEY not set")
    resp = requests.request(method, f"{SEC_BASE}{path}", json=json_body, timeout=20,
                            headers={"Ocp-Apim-Subscription-Key": key})
    resp.raise_for_status()
    return resp.json() if resp.content else None


def load_thai_fund_sec(fund_code: str, days: int = 400) -> Instrument:
    found = _sec_get("/FundFactsheet/fund", "POST", {"name": fund_code})
    match = next((f for f in found or [] if f.get("proj_abbr_name", "").upper() == fund_code.upper()), None)
    if not match:
        raise ValueError(f"Thai fund {fund_code} not found at SEC")
    proj_id = match["proj_id"]

    rows = []
    for d in pd.bdate_range(end=pd.Timestamp.today(), periods=days):
        try:
            nav = _sec_get(f"/FundDailyInfo/{proj_id}/dailynav/{d:%Y-%m-%d}")
        except Exception:
            continue
        if nav and nav.get("last_val"):
            rows.append((d, float(nav["last_val"])))
    if not rows:
        raise ValueError(f"No NAV history for {fund_code}")

    prices = _nav_frame(pd.Series(dict(rows)))
    sheet = {"name": match.get("proj_name_en") or match.get("proj_name_th"),
             "family": match.get("unique_id"), "currency": "THB"}
    for key, path in (("policy", "policy"), ("fees", "fee"), ("risk", "suitability")):
        sheet[key] = _safe(lambda p=path: _sec_get(f"/FundFactsheet/fund/{proj_id}/{p}"), None)
    return Instrument(fund_code.upper(), "TH", "fund", prices, factsheet={k: v for k, v in sheet.items() if v})


def load_local(nav_csv: str, symbol: str, market: str, factsheet_json: str = None) -> Instrument:
    """Load a NAV/price CSV (columns: Date, Close[, Open, High, Low, Volume]) and optional fact sheet."""
    import json

    df = pd.read_csv(nav_csv, parse_dates=["Date"]).set_index("Date").sort_index()
    if {"Open", "High", "Low"}.issubset(df.columns):
        prices = df.reindex(columns=["Open", "High", "Low", "Close", "Volume"]).fillna({"Volume": 0})
    else:
        prices = _nav_frame(df["Close"])
    sheet = {}
    if factsheet_json:
        with open(factsheet_json, encoding="utf-8") as f:
            sheet = json.load(f)
    return Instrument(symbol.upper(), market, "fund", prices, factsheet=sheet)


def _nav_frame(nav: pd.Series) -> pd.DataFrame:
    nav = nav.sort_index().astype(float)
    return pd.DataFrame({"Open": nav, "High": nav, "Low": nav, "Close": nav, "Volume": 0.0})
