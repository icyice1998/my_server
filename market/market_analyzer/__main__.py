"""CLI.

  python -m market_analyzer PTT --market TH
  python -m market_analyzer AAPL MSFT
  python -m market_analyzer VOO --type fund
  python -m market_analyzer K-USA --market TH --type fund --sec            # SEC_API_KEY needed
  python -m market_analyzer MYFUND --market TH --nav nav.csv --factsheet sheet.json
  python -m market_analyzer --query "CP All, Apple, S&P 500 ETF"         # names or tickers
  python -m market_analyzer --screen TH,US,ETF                             # screener -> reports/screener.json
  python -m market_analyzer --export-data data --screen ALL                # + browser price files in data/prices/
  python -m market_analyzer --train model/model.json                       # retrain the prediction model
"""

import argparse
import os
import sys

from . import report
from .data import ASSET_TYPES, MARKETS, load_local, load_thai_fund_sec, load_yahoo
from .resolve import resolve, split_query


def main(argv=None):
    p = argparse.ArgumentParser(prog="market_analyzer", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("symbols", nargs="*")
    p.add_argument("--query", help="comma-separated names or tickers, resolved via Yahoo search")
    p.add_argument("--screen", metavar="UNIVERSES", help="run the screener on TH, US, ETF (comma-separated) or ALL")
    p.add_argument("--export-data", metavar="DIR", help="with --screen: also write browser price files to DIR/prices")
    p.add_argument("--train", metavar="MODEL_JSON", help="train the prediction model on 10 years of the universe")
    p.add_argument("--model", default="model/model.json", help="model file used for predictions")
    p.add_argument("--market", choices=MARKETS + ("AUTO",), default="US",
                   help="with --query, AUTO picks the market from the search result")
    p.add_argument("--type", dest="asset_type", choices=ASSET_TYPES, default="auto")
    p.add_argument("--period", default="5y", help="Yahoo history period (1y, 2y, 5y, 10y, max)")
    p.add_argument("--sec", action="store_true", help="Thai mutual fund via SEC Thailand API")
    p.add_argument("--nav", help="local NAV/price CSV (Date, Close)")
    p.add_argument("--factsheet", help="local fact sheet JSON")
    p.add_argument("--out", default="reports", help="directory for JSON reports")
    p.add_argument("--quiet", action="store_true", help="skip text report")
    args = p.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)

    if args.train:
        from . import model, screener
        from .universe import symbols
        prices = screener._prices(symbols(), "10y")
        m = model.train(prices)
        model.save(m, args.train)
        v = m["validation"]
        print(f"trained on {v['assets']} assets; test year {v['test_from']}..{v['test_to']}: "
              f"AUC {v['auc']:.3f}, top-decile {v['top_decile_avg_return_pct']:+.2f}% vs bottom "
              f"{v['bottom_decile_avg_return_pct']:+.2f}% (1m, relative to market) -> {args.train}")
        return 0

    if args.screen:
        from . import screener
        path = os.path.join(args.out, "screener.json")
        result = screener.run(args.screen, model_path=args.model, export_dir=args.export_data, previous=path)
        report.save_json(result, path)
        print(f"screened {len(result['rows'])} assets ({len(result['failed'])} failed) -> {path}")
        return 0 if result["rows"] else 1

    jobs = [(s, s, args.market if args.market != "AUTO" else "US") for s in args.symbols]
    for q in split_query(args.query or ""):
        try:
            r = resolve(q, args.market)
        except Exception as e:
            print(f"[{q}] error: {e}", file=sys.stderr)
            jobs.append((q, None, None))
            continue
        print(f"[{q}] -> {r['symbol']} ({r['name']})")
        jobs.append((q, r["symbol"], r["market"]))
    if not jobs:
        p.error("give symbols, --query or --screen")

    failed = 0
    for query, sym, market in jobs:
        if sym is None:
            failed += 1
            continue
        args.market = market
        try:
            if args.nav:
                inst = load_local(args.nav, sym, args.market, args.factsheet)
            elif args.sec:
                inst = load_thai_fund_sec(sym)
            else:
                inst = load_yahoo(sym, args.market, args.asset_type, args.period)
            result = report.run(inst)
        except Exception as e:
            print(f"[{sym}] error: {e}", file=sys.stderr)
            failed += 1
            continue
        result["query"] = query
        filename = f"{result['symbol'].replace('.', '_')}.json"
        path = os.path.join(args.out, filename)
        report.save_json(result, path)
        report.update_index(args.out, result, filename)
        if not args.quiet:
            print(report.to_text(result))
            print(f"-> {path}\n")
    return 1 if failed == len(jobs) else 0


if __name__ == "__main__":
    sys.exit(main())
