# Binance USDⓈ-M Futures Bot

A small automated trading bot for Binance USDⓈ-M perpetual futures, written in plain Python (only `requests`).

> It runs on the **testnet** in **dry-run** mode by default. Crypto futures with leverage can lose more than you expect, very quickly. Backtest first, then paper trade on the testnet for weeks before you turn on live trading.

## Layout

```
futures_bot/
  config.py      settings from environment variables
  client.py      signed REST client (orders, algo orders, account)
  indicators.py  EMA, RSI, ATR (Wilder)
  strategy.py    EMA 9/21 crossover + EMA200 trend + RSI filter
  risk.py        position sizing, step/tick rounding, SL/TP
  bot.py         main loop (acts once per closed candle)
  backtest.py    quick historical test
  tests/         unit tests
```

## Flow

```
closed candle -> indicators -> signal? --no--> wait
                                  |yes
                     position open? --yes--> skip
                                  |no
                   daily loss limit hit? --yes--> skip
                                  |no
        size = equity*risk% / |entry-SL|   (capped at N x equity notional)
                                  |
          MARKET entry -> STOP_MARKET + TAKE_PROFIT_MARKET (Algo Order API)
          if the protective orders fail -> flatten immediately
```

## Quick start

```bash
cd futures_bot
pip install -r requirements.txt
python -m unittest discover -s tests      # unit tests
python backtest.py BTCUSDT 15m 1500        # backtest
python bot.py                              # testnet, dry-run (logs signals only)
```

To place real orders on the testnet:
1. Create API keys at https://testnet.binancefuture.com
2. `export BINANCE_API_KEY=... BINANCE_API_SECRET=... BOT_DRY_RUN=false`
3. `python bot.py`

For mainnet, also set `BOT_TESTNET=false`. Create the API key with **Futures trading only**. Do not enable withdrawals. Restrict the key to your server's IP.

## Settings (env vars)

| Variable | Default | Meaning |
|---|---|---|
| `BOT_TESTNET` | `true` | Use testnet.binancefuture.com |
| `BOT_DRY_RUN` | `true` | Log signals, place no orders |
| `BOT_SYMBOL` / `BOT_INTERVAL` | `BTCUSDT` / `15m` | Market and timeframe |
| `BOT_LEVERAGE` | `3` | Isolated margin leverage |
| `BOT_RISK_PER_TRADE` | `0.01` | Fraction of equity lost if SL is hit |
| `BOT_SL_ATR` / `BOT_TP_ATR` | `1.5` / `3.0` | SL / TP distance in ATRs (1:2 R:R) |
| `BOT_MAX_DAILY_LOSS` | `0.03` | Stop opening trades after -3% in a UTC day |
| `BOT_MAX_NOTIONAL_X` | `2.0` | Max position notional as multiple of equity |

## Notes

- Since 2025-12-09 Binance requires `STOP_MARKET` / `TAKE_PROFIT_MARKET` to be sent to `/fapi/v1/algoOrder` with `triggerPrice`. The old `/fapi/v1/order` returns `-4120`. `client.py` uses the new endpoint.
- The bot assumes **one-way** position mode (the Binance default).
- The strategy is a simple starting point, not a proven edge. Replace `generate_signal()` in `strategy.py` with your own logic. The rest of the bot does not need to change.
