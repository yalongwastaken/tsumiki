// yahoo.test.js — the keyless Yahoo chart fallback: parsing, and that it fills the
// symbols earlier providers missed (the "all my stocks should sync" path — mutual
// funds Finnhub's free tier can't price).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TSUMIKI_PRICES = "1";
// a keyless CSV feed is the FIRST provider; the stubbed fetch answers it with AAPL
// only, so Yahoo (last provider) must fill the rest
process.env.TSUMIKI_PRICE_URL = "https://feed.test/q?s={SYMBOLS}&e=csv";
process.env.TSUMIKI_DB = `/tmp/tsumiki-yahoo-${process.pid}-${Date.now()}.db`;

const db = await import("../lib/db.js");
const prices = await import("../lib/prices.js");
const { parseYahooChart } = prices;

const origFetch = globalThis.fetch;
const ok = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  body: null,
  text: async () => body,
});
const yahooBody = (symbol, price, epoch) =>
  JSON.stringify({
    chart: {
      result: [
        {
          meta: { symbol, regularMarketPrice: price, regularMarketTime: epoch },
          indicators: { quote: [{ close: [price - 1, price] }] },
        },
      ],
      error: null,
    },
  });

// ── parseYahooChart (pure) ──────────────────────────────────────────────────────

test("parseYahooChart reads meta.regularMarketPrice + stamps the market time", () => {
  const row = parseYahooChart("vtsax", yahooBody("VTSAX", 131.42, 1783977000));
  assert.equal(row.symbol, "VTSAX");
  assert.equal(row.close, 131.42);
  assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("parseYahooChart falls back to the last finite close in the series", () => {
  const body = JSON.stringify({
    chart: {
      result: [
        {
          meta: { symbol: "VTSAX" }, // no regularMarketPrice
          indicators: { quote: [{ close: [130.1, null, 131.9, null] }] },
        },
      ],
    },
  });
  assert.equal(parseYahooChart("VTSAX", body).close, 131.9);
});

test("parseYahooChart rejects garbage: bad JSON, no result, non-positive price", () => {
  assert.equal(parseYahooChart("A", "not json"), null);
  assert.equal(parseYahooChart("A", "{}"), null);
  assert.equal(parseYahooChart("A", yahooBody("A", 0, 1)), null);
  assert.equal(parseYahooChart("A", yahooBody("A", -5, 1)), null);
});

test("parseYahooChart survives a garbage timestamp (keeps the close, stamps today)", () => {
  const row = parseYahooChart("A", yahooBody("A", 50, Number.MAX_SAFE_INTEGER));
  assert.equal(row.close, 50);
  assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
});

// ── provider chain: yahoo fills what the earlier providers missed ───────────────

test("yahoo fills symbols the CSV feed missed — every holding syncs", async () => {
  db.putState({
    holdings: [
      { id: "h1", ticker: "AAPL", shares: 1 },
      { id: "h2", ticker: "VTSAX", shares: 2 }, // not in the CSV feed → yahoo's job
    ],
  });
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith("https://feed.test/")) {
      return ok("Symbol,Date,Open,High,Low,Close,Volume\nAAPL.US,2026-07-10,1,2,3,210,100");
    }
    if (u.includes("/v8/finance/chart/VTSAX")) {
      return ok(yahooBody("VTSAX", 131.42, 1783977000));
    }
    throw new Error("unexpected fetch: " + u);
  };
  const res = await prices.refreshPrices();
  assert.equal(res.prices.AAPL.price, 210);
  assert.equal(res.prices.VTSAX.price, 131.42);
  const { lastSync } = await prices.getPrices();
  assert.equal(lastSync.status, "ok"); // nothing missing, nothing manual
  assert.equal(lastSync.source, "feed,yahoo"); // both providers contributed
  assert.deepEqual(lastSync.missing, []);
  assert.deepEqual(lastSync.manual, []);
});

test("a yahoo 429 counts as a provider error — unpriced symbols aren't punished", async () => {
  db.putState({ holdings: [{ id: "h1", ticker: "VTSAX", shares: 2 }] });
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith("https://feed.test/")) {
      return ok("Symbol,Date,Open,High,Low,Close,Volume\n"); // feed: answers, no rows
    }
    return { ok: false, status: 429, headers: { get: () => null }, body: null };
  };
  // three error syncs in a row must NOT flip the holding to "manual"
  for (let i = 0; i < 3; i++) {
    await prices.refreshPrices();
  }
  const { lastSync } = await prices.getPrices();
  assert.equal(lastSync.status, "error");
  assert.deepEqual(lastSync.manual, []); // breaker never engaged
  assert.deepEqual(lastSync.missing, ["VTSAX"]);
});

test("TSUMIKI_YAHOO=0 disables the fallback", async () => {
  process.env.TSUMIKI_YAHOO = "0";
  db.putState({ holdings: [{ id: "h1", ticker: "VTSAX", shares: 2 }] });
  let yahooCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes("finance/chart")) {
      yahooCalled = true;
    }
    return ok("Symbol,Date,Open,High,Low,Close,Volume\n");
  };
  await prices.refreshPrices();
  assert.equal(yahooCalled, false);
  delete process.env.TSUMIKI_YAHOO;
});

test("cleanup", () => {
  globalThis.fetch = origFetch;
});
