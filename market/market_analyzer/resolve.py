"""Turn what a user types (a ticker or a company / fund name) into a Yahoo symbol and market."""

import re

US_EXCHANGES = {"NMS", "NYQ", "NGM", "NCM", "PCX", "ASE", "BTS", "NAS", "NYS"}  # OTC (PNK) excluded
KINDS = {"EQUITY", "ETF", "MUTUALFUND"}
TICKER = re.compile(r"^[A-Za-z0-9^=\-]{1,12}(\.[A-Za-z]{1,3})?$")


def split_query(text: str) -> list:
    """'CP All, Apple' -> ['CP All', 'Apple']; 'PTT KBANK' -> ['PTT', 'KBANK']; 'CP All' -> ['CP All'].
    Without commas, text is split on spaces only when every word is an upper-case ticker."""
    text = (text or "").strip()
    if "," in text:
        parts = text.split(",")
    elif all(w.isupper() and TICKER.match(w) for w in text.split()):
        parts = text.split()
    else:
        parts = [text]
    return [p.strip() for p in parts if p.strip()]


def _market_of(symbol: str) -> str:
    return "TH" if symbol.upper().endswith(".BK") else "US"


def _allowed(q: dict) -> bool:
    sym = q.get("symbol", "")
    if q.get("quoteType") not in KINDS:
        return False
    if sym.endswith(".BK"):
        return not sym.endswith("-R.BK") and not sym.endswith("-F.BK")  # skip NVDR / foreign board
    return q.get("exchange") in US_EXCHANGES and "." not in sym


def rank(query: str, quotes: list, market: str = "AUTO") -> list:
    """Order Yahoo search hits: exact ticker first, then the preferred market, keeping Yahoo's order."""
    q = query.strip().upper()
    hits = [x for x in quotes if _allowed(x)]

    def key(item):
        i, x = item
        sym = x["symbol"].upper()
        exact = sym in (q, f"{q}.BK")
        pref = market == "AUTO" or _market_of(sym) == market
        return (not exact, not pref, i)

    return [x for _, x in sorted(enumerate(hits), key=key)]


def resolve(query: str, market: str = "AUTO", search=None) -> dict:
    """Best match for one query. `search` is injectable for tests: search(text) -> list of quotes."""
    if search is None:
        import yfinance as yf
        search = lambda text: yf.Search(text, max_results=10).quotes
    query = query.strip()
    if market == "TH" and TICKER.match(query) and "." not in query:
        candidates = rank(query, search(query), "TH")
        exact = [c for c in candidates if c["symbol"].upper() == f"{query.upper()}.BK"]
        if exact:
            candidates = exact
    else:
        candidates = rank(query, search(query), market)
    if not candidates:
        raise ValueError(f"No stock, ETF or fund found for '{query}'")
    best = candidates[0]
    return {
        "query": query,
        "symbol": best["symbol"],
        "market": _market_of(best["symbol"]),
        "name": best.get("longname") or best.get("shortname") or best["symbol"],
        "quote_type": best.get("quoteType"),
        "alternatives": [c["symbol"] for c in candidates[1:5]],
    }
