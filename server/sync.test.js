// sync.test.js — REAL integration tests for the price sync. Unlike refresh.test.js
// (which stubs global.fetch), this stands up an actual localhost HTTP server and points
// the feed/Finnhub URLs at it, so the whole path exercises real sockets: fetchTextCapped
// → provider chain → parse → cache → sync-outcome status. It covers the outcomes the UI
// relies on: ok, partial, empty, error (unreachable), multi-URL fallback, and the
// keyed-provider (Finnhub) fallback when the keyless feed yields nothing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.TSUMIKI_PRICES = "1";
process.env.TSUMIKI_DB = `/tmp/tsumiki-sync-${process.pid}-${Date.now()}.db`;

// server-controlled responders, swapped per test
let feedResponder = () => ({ status: 200, body: "" });
let finnhubResponder = () => ({ status: 200, body: '{"c":0}' });

let server, base;
before(async () => {
  server = http.createServer((req, res) => {
    const r = req.url.startsWith("/finnhub") ? finnhubResponder(req) : feedResponder(req);
    res.writeHead(r.status, { "content-type": "text/plain" });
    res.end(r.body ?? "");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

// dynamic import AFTER env is set so module-level reads see TSUMIKI_PRICES
const db = await import("./db.js");
const prices = await import("./prices.js");

const stooqCsv = (rows) =>
  [
    "Symbol,Date,Open,High,Low,Close,Volume",
    ...rows.map((r) => `${r.s}.US,${r.d},1,2,3,${r.c},100`),
  ].join("\n");

function setFeed(url) {
  process.env.TSUMIKI_PRICE_URL = url;
}

test("OK: every held symbol priced → status 'ok', no missing, source 'feed'", async () => {
  db.putState({
    holdings: [
      { id: "h1", ticker: "AAPL", shares: 10 },
      { id: "h2", ticker: "MSFT", shares: 5 },
    ],
  });
  setFeed(`${base}/feed?s={SYMBOLS}`);
  delete process.env.TSUMIKI_FINNHUB_KEY;
  feedResponder = () => ({
    status: 200,
    body: stooqCsv([
      { s: "AAPL", d: "2026-06-20", c: 200 },
      { s: "MSFT", d: "2026-06-20", c: 400 },
    ]),
  });

  const out = await prices.getPrices();
  assert.equal(out.prices.AAPL.price, 200);
  assert.equal(out.prices.MSFT.price, 400);
  assert.equal(out.lastSync.status, "ok");
  assert.equal(out.lastSync.source, "feed");
  assert.deepEqual(out.lastSync.missing, []);
});

test("PARTIAL: feed returns only some symbols → status 'partial' lists the missing", async () => {
  feedResponder = () => ({ status: 200, body: stooqCsv([{ s: "AAPL", d: "2026-06-21", c: 205 }]) });
  await prices.refreshPrices();
  const out = await prices.getPrices();
  assert.equal(out.lastSync.status, "partial");
  assert.deepEqual(out.lastSync.missing, ["MSFT"]);
  assert.equal(out.prices.AAPL.price, 205); // updated
  assert.equal(out.prices.MSFT.price, 400); // last good value preserved
});

test("EMPTY: a 200 with no data rows → status 'empty', cache untouched", async () => {
  feedResponder = () => ({ status: 200, body: "Symbol,Date,Close\n" }); // header only
  await prices.refreshPrices();
  const out = await prices.getPrices();
  assert.equal(out.lastSync.status, "empty");
  assert.equal(out.prices.AAPL.price, 205); // unchanged
});

test("ERROR: an unreachable feed → status 'error' (distinct from 'empty')", async () => {
  setFeed("http://127.0.0.1:1/feed?s={SYMBOLS}"); // nothing listens on :1 → connection refused
  await prices.refreshPrices();
  const out = await prices.getPrices();
  assert.equal(out.lastSync.status, "error");
  assert.equal(out.prices.AAPL.price, 205); // still serves last good
});

test("FALLBACK: first feed empty, second feed has data → source 'feed-2'", async () => {
  // first URL → /empty (header only), second → /feed (data)
  setFeed(`${base}/empty?s={SYMBOLS}, ${base}/feed?s={SYMBOLS}`);
  feedResponder = (req) =>
    req.url.startsWith("/empty")
      ? { status: 200, body: "Symbol,Date,Close\n" }
      : { status: 200, body: stooqCsv([{ s: "AAPL", d: "2026-06-22", c: 210 }]) };
  await prices.refreshPrices();
  const out = await prices.getPrices();
  assert.equal(out.lastSync.source, "feed-2");
  assert.equal(out.prices.AAPL.price, 210);
});

test("FINNHUB FALLBACK: keyless feed empty + key set → source 'finnhub'", async () => {
  db.putState({ holdings: [{ id: "h1", ticker: "AAPL", shares: 10 }] });
  setFeed(`${base}/empty?s={SYMBOLS}`);
  process.env.TSUMIKI_FINNHUB_KEY = "test-key";
  process.env.TSUMIKI_FINNHUB_URL = `${base}/finnhub`;
  feedResponder = () => ({ status: 200, body: "Symbol,Date,Close\n" });
  finnhubResponder = (req) => {
    assert.match(req.url, /token=test-key/); // the key is actually sent
    return { status: 200, body: JSON.stringify({ c: 222.22, t: 1750636800 }) };
  };
  await prices.refreshPrices();
  const out = await prices.getPrices();
  assert.equal(out.lastSync.source, "finnhub");
  assert.equal(out.prices.AAPL.price, 222.22);
  delete process.env.TSUMIKI_FINNHUB_KEY;
});
