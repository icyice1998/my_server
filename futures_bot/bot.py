"""Binance USDⓈ-M Futures trading bot.

Defaults are safe: BOT_TESTNET=true and BOT_DRY_RUN=true.
Run:  python bot.py
"""
import logging
import signal
import time

from client import BinanceAPIError, FuturesClient
from config import Config
from risk import position_size, round_tick, stop_and_target, symbol_filters
from strategy import generate_signal

log = logging.getLogger("bot")
INTERVAL_SEC = {"1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
                "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400}


class Bot:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.client = FuturesClient(cfg.api_key, cfg.api_secret, cfg.base_url)
        self.running = True
        self.last_candle = None

    def setup(self):
        self.client.sync_time()
        self.filters = symbol_filters(self.client.exchange_info(self.cfg.symbol))
        log.info("Mode: %s | %s | %s %s | filters %s",
                 "TESTNET" if self.cfg.testnet else "LIVE",
                 "DRY-RUN" if self.cfg.dry_run else "TRADING",
                 self.cfg.symbol, self.cfg.interval, self.filters)
        if not self.cfg.dry_run:
            self.client.set_margin_type(self.cfg.symbol, "ISOLATED")
            self.client.set_leverage(self.cfg.symbol, self.cfg.leverage)

    def daily_loss_hit(self, equity):
        if self.cfg.dry_run:
            return False
        pnl = self.client.income_today()
        if pnl < 0 and abs(pnl) >= equity * self.cfg.max_daily_loss:
            log.warning("Daily loss limit hit (%.2f USDT). No new trades today.", pnl)
            return True
        return False

    def tick(self):
        # Drop the last kline: it is still forming.
        candles = self.client.klines(self.cfg.symbol, self.cfg.interval, limit=500)[:-1]
        if candles[-1][0] == self.last_candle:
            return
        self.last_candle = candles[-1][0]

        sig = generate_signal(candles, self.cfg)
        log.info("Candle close %.2f | %s", sig.price, sig.reason)
        if not sig.side:
            return

        pos = 0.0 if self.cfg.dry_run else self.client.position(self.cfg.symbol)
        if pos != 0:
            log.info("Position already open (%s). Skipping new signal.", pos)
            return

        equity = 1000.0 if self.cfg.dry_run else self.client.balance_usdt()
        if self.daily_loss_hit(equity):
            return

        sl, tp = stop_and_target(sig.side, sig.price, sig.atr, self.cfg)
        qty = position_size(equity, sig.price, abs(sig.price - sl), self.cfg, self.filters)
        if not qty:
            log.warning("Size below exchange minimum; skipping.")
            return
        sl_s, tp_s = round_tick(sl, self.filters["tick"]), round_tick(tp, self.filters["tick"])
        log.info("SIGNAL %s qty=%s entry~%.2f SL=%s TP=%s", sig.side, qty, sig.price, sl_s, tp_s)
        if not self.cfg.dry_run:
            self.open_trade(sig.side, qty, sl_s, tp_s)

    def open_trade(self, side, qty, sl, tp):
        exit_side = "SELL" if side == "BUY" else "BUY"
        self.client.cancel_all(self.cfg.symbol)
        self.client.market_order(self.cfg.symbol, side, qty)
        try:
            self.client.conditional_close(self.cfg.symbol, exit_side, "STOP_MARKET", sl)
            self.client.conditional_close(self.cfg.symbol, exit_side, "TAKE_PROFIT_MARKET", tp)
        except BinanceAPIError:
            # Never leave a position without protection.
            log.exception("Protective orders failed; flattening position.")
            self.client.cancel_all(self.cfg.symbol)
            self.client.market_order(self.cfg.symbol, exit_side, qty, reduce_only=True)
            raise

    def run(self):
        self.setup()
        step = INTERVAL_SEC.get(self.cfg.interval, 60)
        while self.running:
            try:
                self.tick()
            except BinanceAPIError as e:
                log.error("API error: %s", e)
            except Exception:
                log.exception("Unexpected error")
            # Wake shortly after the next candle closes.
            time.sleep(step - time.time() % step + 3)

    def stop(self, *_):
        log.info("Stopping...")
        self.running = False


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(), logging.FileHandler("bot.log")])
    cfg = Config()
    if not cfg.dry_run and not (cfg.api_key and cfg.api_secret):
        raise SystemExit("Set BINANCE_API_KEY and BINANCE_API_SECRET, or keep BOT_DRY_RUN=true.")
    bot = Bot(cfg)
    signal.signal(signal.SIGINT, bot.stop)
    signal.signal(signal.SIGTERM, bot.stop)
    bot.run()


if __name__ == "__main__":
    main()
