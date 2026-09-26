from decimal import Decimal


def symbol_filters(symbol_info):
    f = {x["filterType"]: x for x in symbol_info["filters"]}
    return {
        "step": float(f["MARKET_LOT_SIZE"]["stepSize"]),
        "min_qty": float(f["MARKET_LOT_SIZE"]["minQty"]),
        "tick": float(f["PRICE_FILTER"]["tickSize"]),
        "min_notional": float(f.get("MIN_NOTIONAL", {}).get("notional", 5)),
    }


def round_step(value, step):
    """Floor value to a multiple of step, returned as a clean string."""
    d = Decimal(str(step))
    return format(((Decimal(str(value)) // d) * d).normalize(), "f")


def round_tick(value, tick):
    d = Decimal(str(tick))
    q = (Decimal(str(value)) / d).quantize(Decimal(1)) * d
    return format(q.normalize(), "f")


def position_size(equity, price, stop_distance, cfg, filters):
    """Risk a fixed fraction of equity between entry and stop, capped by notional limits."""
    if stop_distance <= 0 or price <= 0:
        return None
    qty = (equity * cfg.risk_per_trade) / stop_distance
    max_qty = equity * min(cfg.max_notional_x, cfg.leverage) / price
    qty = min(qty, max_qty)
    qty_str = round_step(qty, filters["step"])
    q = float(qty_str)
    if q < filters["min_qty"] or q * price < filters["min_notional"]:
        return None
    return qty_str


def stop_and_target(side, price, atr_value, cfg):
    sl_dist, tp_dist = atr_value * cfg.sl_atr_mult, atr_value * cfg.tp_atr_mult
    if side == "BUY":
        return price - sl_dist, price + tp_dist
    return price + sl_dist, price - tp_dist
