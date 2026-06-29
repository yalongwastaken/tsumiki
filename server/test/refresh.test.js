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

test("circuit breaker: a never-priced symbol is given up on after MANUAL_AFTER misses", async () => {
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
});

test("circuit breaker: a given-up symbol recovers on a later probe if the feed returns", async () => {
  db.putState({ holdings: [{ id: "f1", ticker: "SWPPX", shares: 5 }] });
  stub(ok(stooq("AAPL", "2026-08-05", 100))); // still no SWPPX → give up
  for (let i = 0; i < 3; i++) {
    await prices.refreshPrices();
  }
  assert.ok((await prices.getPrices()).lastSync.manual.includes("SWPPX"));

  // feed starts covering SWPPX again; a periodic probe (≤ PROBE_EVERY refreshes) re-prices it
  stub(ok(stooq("SWPPX", "2026-08-09", 80)));
  let recovered = false;
  for (let i = 0; i < 8 && !recovered; i++) {
    const r = await prices.refreshPrices();
    recovered = r.prices.SWPPX?.price === 80;
  }
  assert.ok(recovered, "a given-up symbol should re-price on a later probe");
  assert.ok(
    !(await prices.getPrices()).lastSync.manual.includes("SWPPX"),
    "and leave the manual list",
  );
});

test("a manual holding's ticker is never requested from the feed", async () => {
  // SWPPX is user-marked manual (priced by hand); AAPL is auto. Only AAPL should be fetched.
  db.putState({
    holdings: [
      { id: "a", ticker: "AAPL", shares: 1 },
      { id: "f", ticker: "SWPPX", shares: 5, manual: true, manualPrice: 80 },
    ],
  });
  const asked = [];
  stub(async (url) => {
    asked.push(String(url));
    return {
      ok: true,
      headers: { get: () => null },
      body: null,
      text: async () => stooq("AAPL", "2026-09-01", 190),
    };
  });
  await prices.refreshPrices();
  const joined = asked.join(" ").toLowerCase();
  assert.ok(joined.includes("aapl"), "auto holding AAPL is fetched");
  assert.ok(!joined.includes("swppx"), "manual holding SWPPX is never requested");
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
