#!/usr/bin/env python3
"""fake_prices.py — test stand-in for scripts/prices.py (no network, no yfinance).

Prints exactly FAKE_PRICES_JSON (if set) and exits with FAKE_PRICES_EXIT (default 0),
so tests can drive every outcome of the real script's contract: ok / partial / empty /
error / garbage stdout / crash.
"""

import os
import sys

# optionally record which symbols were requested (for "never asks for X" tests)
args_file = os.environ.get("FAKE_PRICES_ARGS_FILE")
if args_file:
    with open(args_file, "a") as f:
        f.write(" ".join(sys.argv[1:]) + "\n")

out = os.environ.get("FAKE_PRICES_JSON", "")
if out:
    print(out)
sys.exit(int(os.environ.get("FAKE_PRICES_EXIT", "0")))
