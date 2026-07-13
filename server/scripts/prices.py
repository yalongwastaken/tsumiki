#!/usr/bin/env python3
"""prices.py — fetch the latest close for each ticker via yfinance.

The ONE price source for Tsumiki: the Node server spawns this script with the held
ticker symbols as arguments and reads one line of JSON from stdout:

    {"rows": [{"symbol": "AAPL", "close": 210.5, "date": "2026-07-10"}, ...],
     "error": null | "human-readable problem"}

Contract notes (mirrors what the Node side expects):
- rows contains only symbols that actually priced (finite close > 0);
- "error" non-null means a REAL failure happened (network, rate limit, missing
  dependency) — the Node circuit breaker must NOT punish unpriced symbols for it;
- a symbol yfinance answers but can't price (delisted, typo) is simply absent from
  rows with error null — that's a genuine per-symbol miss.

Only your ticker symbols are sent to Yahoo (via yfinance). Nothing personal leaves
the machine. Requires:  pip install yfinance
"""

import json
import sys


def emit(rows, error=None):
    print(json.dumps({"rows": rows, "error": error}))


def main(argv):
    symbols = []
    for raw in argv:
        s = raw.strip().upper()
        if s and s not in symbols:
            symbols.append(s)
    if not symbols:
        emit([])
        return 0

    try:
        import yfinance as yf
    except ImportError:
        emit([], "yfinance is not installed — run: pip install yfinance")
        return 0

    rows = []
    failures = 0
    for sym in symbols:
        try:
            ticker = yf.Ticker(sym)
            price = None
            date = ""
            # daily history is the most reliable across stocks, ETFs, AND mutual
            # funds (fast_info/quote endpoints often lag or 404 for funds)
            hist = ticker.history(period="5d", interval="1d", auto_adjust=False)
            if hist is not None and len(hist) > 0 and "Close" in hist:
                closes = hist["Close"].dropna()
                if len(closes) > 0:
                    price = float(closes.iloc[-1])
                    date = str(closes.index[-1].date())
            if price is None:
                # fallback: last traded price (works for most live symbols)
                try:
                    last = ticker.fast_info["last_price"]
                    if last is not None and float(last) > 0:
                        price = float(last)
                except Exception:
                    pass
            if price is not None and price > 0:
                rows.append({"symbol": sym, "close": price, "date": date})
        except Exception:
            failures += 1  # network / rate limit / yfinance internals

    # any exception = a symbol that was never genuinely answered (network, rate
    # limit, yfinance internals) — report it as an error so the Node circuit
    # breaker doesn't punish those symbols. yfinance does NOT throw for unknown
    # tickers (it returns empty history), so throws are real provider failures.
    error = f"yfinance failed for {failures} symbol(s) — network or rate limit?" if failures else None
    emit(rows, error)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
