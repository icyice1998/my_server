import os
from dataclasses import dataclass


def _bool(name, default):
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Config:
    api_key: str = os.getenv("BINANCE_API_KEY", "")
    api_secret: str = os.getenv("BINANCE_API_SECRET", "")
    testnet: bool = _bool("BOT_TESTNET", True)
    dry_run: bool = _bool("BOT_DRY_RUN", True)

    symbol: str = os.getenv("BOT_SYMBOL", "BTCUSDT")
    interval: str = os.getenv("BOT_INTERVAL", "15m")
    leverage: int = int(os.getenv("BOT_LEVERAGE", "3"))

    fast_ema: int = int(os.getenv("BOT_FAST_EMA", "9"))
    slow_ema: int = int(os.getenv("BOT_SLOW_EMA", "21"))
    trend_ema: int = int(os.getenv("BOT_TREND_EMA", "200"))
    rsi_period: int = int(os.getenv("BOT_RSI_PERIOD", "14"))
    atr_period: int = int(os.getenv("BOT_ATR_PERIOD", "14"))

    risk_per_trade: float = float(os.getenv("BOT_RISK_PER_TRADE", "0.01"))  # 1% of equity
    sl_atr_mult: float = float(os.getenv("BOT_SL_ATR", "1.5"))
    tp_atr_mult: float = float(os.getenv("BOT_TP_ATR", "3.0"))
    max_daily_loss: float = float(os.getenv("BOT_MAX_DAILY_LOSS", "0.03"))  # 3% kill switch
    max_notional_x: float = float(os.getenv("BOT_MAX_NOTIONAL_X", "2.0"))  # notional cap, multiple of equity

    @property
    def base_url(self):
        return "https://testnet.binancefuture.com" if self.testnet else "https://fapi.binance.com"
