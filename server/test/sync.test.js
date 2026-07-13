// sync.test.js — REAL integration tests for the price sync. The refresh path spawns
// an actual python3 process (the fixture fake_prices.py, driven by env vars) exactly
// like production spawns scripts/prices.py, so the whole chain is exercised:
// execFile → JSON contract → cache → circuit breaker → sync-outcome status. It covers
// the outcomes the UI relies on: ok, partial, empty, error, missing python, garbage
// output, and breaker behavior across error vs miss.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

process.env.TSUMIKI_PRICES = "1";
process.env.TSUMIKI_DB = `/tmp/tsumiki-sync-${process.pid}-${Date.now()}.db`;
process.env.TSUMIKI_PRICES_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake_prices.py",
);

// dynamic import AFTER env is set so module-level reads see TSUMIKI_PRICES
const db = await import("../lib/db.js");
const prices = await import("../lib/prices.js");

const feed = (rows, error = null) => {
  process.env.FAKE_PRICES_JSON = JSON.stringify({ rows, error });
  process.env.FAKE_PRICES_EXIT = "0";
};
const row = (symbol, close, date = "2026-06-20") => ({ symbol, close, date });

test("OK: every held symbol priced → status 'ok', source 'yfinance'", async () => {
  db.putState({
    holdings: [
      { id: "h1", ticker: "AAPL", shares: 10 },
      { id: "h2", ticker: "VTSAX", shares: 5 }, // a mutual fund — the whole point
    ],
  });
  feed([row("AAPL", 200), row("VTSAX", 131.42)]);
  const out = await prices.getPrices();
  assert.equal(out.prices.AAPL.price, 200);
  assert.equal(out.prices.VTSAX.price, 131.42);
  assert.equal(out.lastSync.status, "ok");
  assert.equal(out.lastSync.source, "yfinance");
  assert.deepEqual(out.lastSync.missing, []);
});

test("PARTIAL: script returns only some symbols → 'partial' lists the missing", async () => {
  feed([row("AAPL", 205, "2026-06-21")]);
  await prices.refreshPrices();
  const out = await prices.getPrices();
  assert.equal(out.lastSync.status, "partial");
  assert.deepEqual(out.lastSync.missing, ["VTSAX"]);
  assert.equal(out.prices.AAPL.price, 205); // updated
  assert.equal(out.prices.VTSAX.price, 131.42); // last good value preserved
});

test("EMPTY: a clean run with no rows → 'empty', cache untouched", async () => {
  feed([]);
  await prices.refreshPrices();
  const out = await prices.getPrices();
  assert.equal(out.lastSync.status, "empty");
  assert.equal(out.prices.AAPL.price, 205); // unchanged
});

test("ERROR: the script reports a failure → 'error' + note, no breaker punishment", async () => {
  feed([], "yfinance failed for 2 symbol(s) — network or rate limit?");
  // three error syncs in a row must NOT flip real holdings to "manual"
  for (let i = 0; i < 3; i++) {
    await prices.refreshPrices();
  }
  const out = await prices.getPrices();
  assert.equal(out.lastSync.status, "error");
  assert.match(out.lastSync.note, /network or rate limit/);
  assert.deepEqual(out.lastSync.manual, []); // breaker never engaged
  assert.equal(out.prices.AAPL.price, 205); // still serves last good
});

test("GARBAGE: unreadable stdout → 'error', not a crash", async () => {
  process.env.FAKE_PRICES_JSON = "this is not json";
  await prices.refreshPrices();
  const out = await prices.getPrices();
  assert.equal(out.lastSync.status, "error");
  assert.match(out.lastSync.note, /unreadable/);
});

test("CRASH: a non-zero exit with no output → 'error' with the failure note", async () => {
  process.env.FAKE_PRICES_JSON = "";
  process.env.FAKE_PRICES_EXIT = "2";
  await prices.refreshPrices();
  const out = await prices.getPrices();
  assert.equal(out.lastSync.status, "error");
  assert.ok(out.lastSync.note);
  process.env.FAKE_PRICES_EXIT = "0";
});

test("MISSING PYTHON: friendly note telling the user what to install", async () => {
  const orig = process.env.TSUMIKI_PYTHON;
  process.env.TSUMIKI_PYTHON = "/nonexistent/python3";
  await prices.refreshPrices();
  const out = await prices.getPrices();
  assert.equal(out.lastSync.status, "error");
  assert.match(out.lastSync.note, /needs Python/);
  assert.match(out.lastSync.note, /pip install yfinance/);
  if (orig) {
    process.env.TSUMIKI_PYTHON = orig;
  } else {
    delete process.env.TSUMIKI_PYTHON;
  }
});

test("BREAKER: three clean misses flip a symbol to 'manual'; a later success resets it", async () => {
  db.putState({ holdings: [{ id: "h1", ticker: "GONE", shares: 1 }] });
  feed([]); // clean runs, GONE never prices
  for (let i = 0; i < 3; i++) {
    await prices.refreshPrices();
  }
  let out = await prices.getPrices();
  assert.deepEqual(out.lastSync.manual, ["GONE"]);
  // probe round eventually re-asks; when it prices, the breaker resets
  feed([row("GONE", 12)]);
  for (let i = 0; i < 8; i++) {
    await prices.refreshPrices(); // covers the every-7th probe round
  }
  out = await prices.getPrices();
  assert.deepEqual(out.lastSync.manual, []);
  assert.equal(out.prices.GONE.price, 12);
});

test("rows with garbage entries are filtered by the Node-side validation", async () => {
  db.putState({ holdings: [{ id: "h1", ticker: "AAPL", shares: 1 }] });
  feed([
    { symbol: "AAPL", close: 210.5, date: "2026-06-22" },
    { symbol: "BAD", close: -5, date: "2026-06-22" }, // non-positive → dropped
    { symbol: "", close: 10, date: "" }, // no symbol → dropped
    { close: 10 }, // malformed → dropped
  ]);
  const res = await prices.refreshPrices();
  assert.equal(res.prices.AAPL.price, 210.5);
  assert.equal(res.prices.BAD, undefined);
});
