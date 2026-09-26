import hashlib
import hmac
import time
from urllib.parse import urlencode

import requests


class BinanceAPIError(Exception):
    def __init__(self, status, payload):
        super().__init__(f"HTTP {status}: {payload}")
        self.status = status
        self.payload = payload


class FuturesClient:
    """Minimal USDⓈ-M Futures REST client (one-way position mode)."""

    def __init__(self, api_key, api_secret, base_url, timeout=10):
        self.api_key = api_key
        self.api_secret = api_secret.encode()
        self.base_url = base_url
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers["X-MBX-APIKEY"] = api_key
        self.time_offset = 0

    def _request(self, method, path, params=None, signed=False):
        params = {k: v for k, v in (params or {}).items() if v is not None}
        if signed:
            params["timestamp"] = int(time.time() * 1000) + self.time_offset
            params["recvWindow"] = 5000
            query = urlencode(params)
            sig = hmac.new(self.api_secret, query.encode(), hashlib.sha256).hexdigest()
            query += f"&signature={sig}"
        else:
            query = urlencode(params)
        url = f"{self.base_url}{path}" + (f"?{query}" if query else "")
        resp = self.session.request(method, url, timeout=self.timeout)
        data = resp.json() if resp.content else {}
        if resp.status_code >= 400 or (isinstance(data, dict) and data.get("code", 0) < 0):
            raise BinanceAPIError(resp.status_code, data)
        return data

    # --- market data ---
    def sync_time(self):
        server = self._request("GET", "/fapi/v1/time")["serverTime"]
        self.time_offset = server - int(time.time() * 1000)

    def klines(self, symbol, interval, limit=500):
        return self._request("GET", "/fapi/v1/klines",
                             {"symbol": symbol, "interval": interval, "limit": limit})

    def exchange_info(self, symbol):
        info = self._request("GET", "/fapi/v1/exchangeInfo")
        for s in info["symbols"]:
            if s["symbol"] == symbol:
                return s
        raise ValueError(f"Unknown symbol {symbol}")

    def mark_price(self, symbol):
        return float(self._request("GET", "/fapi/v1/premiumIndex", {"symbol": symbol})["markPrice"])

    # --- account ---
    def balance_usdt(self):
        for a in self._request("GET", "/fapi/v2/balance", signed=True):
            if a["asset"] == "USDT":
                return float(a["balance"])
        return 0.0

    def position(self, symbol):
        rows = self._request("GET", "/fapi/v2/positionRisk", {"symbol": symbol}, signed=True)
        return float(rows[0]["positionAmt"]) if rows else 0.0

    def income_today(self):
        start = int(time.time() // 86400 * 86400 * 1000)
        rows = self._request("GET", "/fapi/v1/income",
                             {"startTime": start, "limit": 1000}, signed=True)
        return sum(float(r["income"]) for r in rows
                   if r["incomeType"] in ("REALIZED_PNL", "COMMISSION", "FUNDING_FEE"))

    def set_leverage(self, symbol, leverage):
        return self._request("POST", "/fapi/v1/leverage",
                             {"symbol": symbol, "leverage": leverage}, signed=True)

    def set_margin_type(self, symbol, margin_type="ISOLATED"):
        try:
            return self._request("POST", "/fapi/v1/marginType",
                                 {"symbol": symbol, "marginType": margin_type}, signed=True)
        except BinanceAPIError as e:
            if e.payload.get("code") == -4046:  # already set
                return None
            raise

    # --- orders ---
    def market_order(self, symbol, side, quantity, reduce_only=False):
        return self._request("POST", "/fapi/v1/order", {
            "symbol": symbol, "side": side, "type": "MARKET",
            "quantity": quantity, "reduceOnly": "true" if reduce_only else None,
        }, signed=True)

    def conditional_close(self, symbol, side, order_type, trigger_price):
        """STOP_MARKET / TAKE_PROFIT_MARKET via the Algo Order API (required since 2025-12-09)."""
        return self._request("POST", "/fapi/v1/algoOrder", {
            "algoType": "CONDITIONAL", "symbol": symbol, "side": side,
            "type": order_type, "triggerPrice": trigger_price,
            "closePosition": "true", "workingType": "MARK_PRICE",
        }, signed=True)

    def cancel_all(self, symbol):
        self._request("DELETE", "/fapi/v1/allOpenOrders", {"symbol": symbol}, signed=True)
        algo = self._request("GET", "/fapi/v1/algoOpenOrders", {"symbol": symbol}, signed=True)
        if isinstance(algo, dict):
            algo = algo.get("orders", [])
        for o in algo:
            self._request("DELETE", "/fapi/v1/algoOrder", {"algoId": o["algoId"]}, signed=True)
