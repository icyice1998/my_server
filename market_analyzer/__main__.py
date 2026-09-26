"""CLI.

  python -m market_analyzer PTT --market TH
  python -m market_analyzer AAPL MSFT
  python -m market_analyzer VOO --type fund
  python -m market_analyzer K-USA --market TH --type fund --sec            # SEC_API_KEY needed
  python -m market_analyzer MYFUND --market TH --nav nav.csv --factsheet sheet.json
"""

import argparse
import os
import sys

from . import report
from .data import ASSET_TYPES, MARKETS, load_local, load_thai_fund_sec, load_yahoo


def main(argv=None):
    p = argparse.ArgumentParser(prog="market_analyzer", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("symbols", nargs="+")
    p.add_argument("--market", choices=MARKETS, default="US")
    p.add_argument("--type", dest="asset_type", choices=ASSET_TYPES, default="auto")
    p.add_argument("--period", default="5y", help="Yahoo history period (1y, 2y, 5y, 10y, max)")
    p.add_argument("--sec", action="store_true", help="Thai mutual fund via SEC Thailand API")
    p.add_argument("--nav", help="local NAV/price CSV (Date, Close)")
    p.add_argument("--factsheet", help="local fact sheet JSON")
    p.add_argument("--out", default="reports", help="directory for JSON reports")
    p.add_argument("--quiet", action="store_true", help="skip text report")
    args = p.parse_args(argv)

    os.makedirs(args.out, exist_ok=True)
    failed = 0
    for sym in args.symbols:
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
        filename = f"{result['symbol'].replace('.', '_')}.json"
        path = os.path.join(args.out, filename)
        report.save_json(result, path)
        report.update_index(args.out, result, filename)
        if not args.quiet:
            print(report.to_text(result))
            print(f"-> {path}\n")
    return 1 if failed == len(args.symbols) else 0


if __name__ == "__main__":
    sys.exit(main())
