// refresh.test.js — end-to-end tests for the nightly price + news refreshes.
// Runs in its own process (node --test isolates files), so we set the opt-in env
// BEFORE dynamically importing the modules, and stub global.fetch to avoid network.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TSUMIKI_PRICES = "1";
// there's no default price feed anymore (Stooq is bot-walled), so configure a keyless
// CSV feed explicitly; the stubbed fetch ignores the URL and returns canned CSV.
process.env.TSUMIKI_PRICE_URL = "https://example.test/q?s={SYMBOLS}&e=csv";
process.env.TSUMIKI_NEWS_FEED = "https://example.com/feed.xml";
process.env.TSUMIKI_DB = `/tmp/tsumiki-refresh-${process.pid}-${Date.now()}.db`;

// dynamic import so the env above is in place when the modules read it at eval time
const db = await import("../lib/db.js");
const prices = await import("../lib/prices.js");
const news = await import("../lib/news.js");

const origFetch = globalThis.fetch;
const stub = (handler) => {
  globalThis.fetch = handler;
};
// minimal Response stub for fetchTextCapped (no content-length, no stream body →
// it falls back to .text())
const ok = (body) => async () => ({
  ok: true,
  headers: { get: () => null },
  body: null,
  text: async () => body,
});
const stooq = (sym, date, close) =>
  `Symbol,Date,Open,High,Low,Close,Volume\n${sym}.US,${date},1,2,3,${close},100`;

// ── prices ────────────────────────────────────────────────────────────────────

test("refreshPrices caches closes, computes value, persists history", async () => {
  db.putState({ holdings: [{ id: "h1", ticker: "AAPL", shares: 10 }] });
  stub(ok(stooq("AAPL", "2026-06-01", 100)));
  const res = await prices.refreshPrices();
  assert.equal(res.prices.AAPL.price, 100);
  assert.equal(res.prices.AAPL.changePct, null); // no prior history yet
  assert.ok(res.fetchedAt > 0);
  // portfolio value point recorded (10 shares × $100)
  const hist = db.getPortfolioHistory();
  assert.equal(hist[hist.length - 1].value, 1000);
  // per-symbol history persisted to the DB
  assert.equal(db.getSymbolPriceHistory().AAPL.length, 1);
});

test("week-over-week changePct appears once ~6 sessions of history exist", async () => {
  // 6 sessions across 6 dates → the 6th compares against the 1st
  let last = null;
  for (let i = 1; i <= 6; i++) {
    stub(ok(stooq("AAPL", `2026-07-0${i}`, 100 + i)));
    last = await prices.refreshPrices();
  }
  assert.equal(db.getSymbolPriceHistory().AAPL.length >= 6, true);
  assert.ok(typeof last.prices.AAPL.changePct === "number");
  // price went 101→106 vs the 6-back baseline of 101 → positive
  assert.ok(last.prices.AAPL.changePct > 0);
});

test("refreshPrices keeps the last good cache when the network fails", async () => {
  stub(async () => {
    throw new Error("offline");
  });
  const res = await prices.refreshPrices();
  assert.equal(res.prices.AAPL.price, 106); // unchanged from the last good fetch
});

test("a non-OK response doesn't clobber the cache", async () => {
  stub(async () => ({ ok: false, text: async () => "" }));
  const res = await prices.refreshPrices();
  assert.equal(res.prices.AAPL.price, 106);
});

test("getPrices reports the opt-in flag + cached payload shape", async () => {
  const p = await prices.getPrices();
  assert.equal(p.enabled, true);
  assert.ok(Array.isArray(p.history));
  assert.ok(p.prices.AAPL);
});

test("circuit breaker: a never-priced symbol becomes 'manual' and is no longer chased", async () => {
  // hold a symbol the feed never returns (e.g. a mutual fund); stub always prices AAPL only
  db.putState({ holdings: [{ id: "f1", ticker: "SWPPX", shares: 5 }] });
  stub(ok(stooq("AAPL", "2026-08-01", 100))); // CSV never contains SWPPX
  let p;
  for (let i = 0; i < 3; i++) {
    await prices.refreshPrices(); // MANUAL_AFTER = 3 consecutive misses
    p = await prices.getPrices();
  }
  assert.ok(p.lastSync.manual.includes("SWPPX"), "symbol should be given up on after 3 misses");
  assert.ok(!p.lastSync.missing.includes("SWPPX"), "given-up symbol is not reported as missing");
  assert.equal(p.lastSync.status, "ok"); // calm: nothing left to retry, not an error

  // and it's no longer requested: a stub that throws on any fetch must NOT be hit
  let hits = 0;
  stub(async () => {
    hits++;
    throw new Error("should not fetch a manual symbol");
  });
  await prices.refreshPrices();
  assert.equal(hits, 0, "a manual symbol must not trigger any fetch");

  // editing the holding to a new ticker starts fresh (the breaker is per-symbol)
  db.putState({ holdings: [{ id: "f1", ticker: "VOO", shares: 5 }] });
  stub(ok(stooq("VOO", "2026-08-02", 550)));
  const after = await prices.refreshPrices();
  assert.equal(after.prices.VOO.price, 550);
});

// ── news ────────────────────────────────────────────────────────────────────

test("refreshNews caches headlines and caps to MAX_ITEMS", async () => {
  const items = Array.from(
    { length: 12 },
    (_, i) => `<item><title>Headline ${i}</title><link>https://e.com/${i}</link></item>`,
  ).join("");
  stub(ok(`<rss><channel>${items}</channel></rss>`));
  const res = await news.refreshNews();
  assert.equal(res.items.length, 8); // MAX_ITEMS
  assert.equal(res.items[0].title, "Headline 0");
});

test("refreshNews keeps the cache on failure and on an empty feed", async () => {
  stub(async () => {
    throw new Error("offline");
  });
  assert.equal((await news.refreshNews()).items.length, 8); // unchanged
  stub(ok("<rss><channel></channel></rss>")); // valid but no items
  assert.equal((await news.refreshNews()).items.length, 8); // still unchanged
});

test("getNews reports enabled + payload shape", async () => {
  const n = await news.getNews();
  assert.equal(n.enabled, true);
  assert.ok(n.items.length > 0);
  assert.ok(n.fetchedAt > 0);
});

test.after(() => {
  globalThis.fetch = origFetch;
});
