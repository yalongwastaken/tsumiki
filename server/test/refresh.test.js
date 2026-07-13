// refresh.test.js — end-to-end tests for the nightly price + news refreshes.
// Runs in its own process (node --test isolates files), so we set the opt-in env
// BEFORE dynamically importing the modules. Prices spawn the fake_prices.py fixture
// (a stand-in for scripts/prices.py); news stubs global.fetch to avoid network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, rmSync } from "node:fs";

process.env.TSUMIKI_PRICES = "1";
process.env.TSUMIKI_NEWS_FEED = "https://example.com/feed.xml";
process.env.TSUMIKI_DB = `/tmp/tsumiki-refresh-${process.pid}-${Date.now()}.db`;
process.env.TSUMIKI_PRICES_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "fake_prices.py",
);

// dynamic import so the env above is in place when the modules read it at eval time
const db = await import("../lib/db.js");
const prices = await import("../lib/prices.js");
const news = await import("../lib/news.js");

// prices: drive the fake script via env
const feed = (rows, error = null) => {
  process.env.FAKE_PRICES_JSON = JSON.stringify({ rows, error });
  process.env.FAKE_PRICES_EXIT = "0";
};
const row = (symbol, close, date) => ({ symbol, close, date });

// news: stub fetch (news still uses http.js)
const origFetch = globalThis.fetch;
const stub = (handler) => {
  globalThis.fetch = handler;
};
const ok = (body) => async () => ({
  ok: true,
  headers: { get: () => null },
  body: null,
  text: async () => body,
});

// ── prices ────────────────────────────────────────────────────────────────────

test("refreshPrices caches closes, computes value, persists history", async () => {
  db.putState({ holdings: [{ id: "h1", ticker: "AAPL", shares: 10 }] });
  feed([row("AAPL", 100, "2026-06-01")]);
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
    feed([row("AAPL", 100 + i, `2026-07-0${i}`)]);
    last = await prices.refreshPrices();
  }
  assert.equal(db.getSymbolPriceHistory().AAPL.length >= 6, true);
  assert.ok(typeof last.prices.AAPL.changePct === "number");
  // price went 101→106 vs the 6-back baseline of 101 → positive
  assert.ok(last.prices.AAPL.changePct > 0);
});

test("refreshPrices keeps the last good cache when the script fails", async () => {
  process.env.FAKE_PRICES_JSON = "";
  process.env.FAKE_PRICES_EXIT = "1"; // crash — like python dying mid-fetch
  const res = await prices.refreshPrices();
  assert.equal(res.prices.AAPL.price, 106); // unchanged from the last good fetch
  process.env.FAKE_PRICES_EXIT = "0";
});

test("getPrices reports the opt-in flag + cached payload shape", async () => {
  const p = await prices.getPrices();
  assert.equal(p.enabled, true);
  assert.ok(Array.isArray(p.history));
  assert.ok(p.prices.AAPL);
});

test("circuit breaker: a never-priced symbol is given up on after MANUAL_AFTER misses", async () => {
  // hold a symbol yfinance never returns (delisted/typo); the feed prices AAPL only
  db.putState({ holdings: [{ id: "f1", ticker: "GONEX", shares: 5 }] });
  feed([row("AAPL", 100, "2026-08-01")]); // clean answers, never GONEX
  let p;
  for (let i = 0; i < 3; i++) {
    await prices.refreshPrices(); // MANUAL_AFTER = 3 consecutive misses
    p = await prices.getPrices();
  }
  assert.ok(p.lastSync.manual.includes("GONEX"), "symbol should be given up on after 3 misses");
  assert.ok(!p.lastSync.missing.includes("GONEX"), "given-up symbol is not reported as missing");
  assert.equal(p.lastSync.status, "ok"); // calm: nothing left to retry, not an error
});

test("circuit breaker: a given-up symbol recovers on a later probe if the feed returns", async () => {
  db.putState({ holdings: [{ id: "f1", ticker: "GONEX", shares: 5 }] });
  feed([]); // still no GONEX → give up
  for (let i = 0; i < 3; i++) {
    await prices.refreshPrices();
  }
  assert.ok((await prices.getPrices()).lastSync.manual.includes("GONEX"));

  // yfinance starts covering it again; a periodic probe (≤ PROBE_EVERY refreshes) re-prices it
  feed([row("GONEX", 80, "2026-08-09")]);
  let recovered = false;
  for (let i = 0; i < 8 && !recovered; i++) {
    const r = await prices.refreshPrices();
    recovered = r.prices.GONEX?.price === 80;
  }
  assert.ok(recovered, "a given-up symbol should re-price on a later probe");
  assert.ok(
    !(await prices.getPrices()).lastSync.manual.includes("GONEX"),
    "and leave the manual list",
  );
});

test("a manual holding's ticker is never sent to the script", async () => {
  // SWPPX is user-marked manual (priced by hand); AAPL is auto. Only AAPL is requested.
  db.putState({
    holdings: [
      { id: "a", ticker: "AAPL", shares: 1 },
      { id: "f", ticker: "SWPPX", shares: 5, manual: true, manualPrice: 80 },
    ],
  });
  const argsFile = `/tmp/tsumiki-args-${process.pid}-${Date.now()}.txt`;
  process.env.FAKE_PRICES_ARGS_FILE = argsFile;
  feed([row("AAPL", 190, "2026-09-01")]);
  await prices.refreshPrices();
  delete process.env.FAKE_PRICES_ARGS_FILE;
  const asked = readFileSync(argsFile, "utf8");
  rmSync(argsFile, { force: true });
  assert.ok(asked.includes("AAPL"), "auto holding AAPL is fetched");
  assert.ok(!asked.includes("SWPPX"), "manual holding SWPPX is never requested");
});

test("same-day re-sync replaces the day's close instead of dropping it", async () => {
  db.putState({
    holdings: [
      { id: "a", ticker: "AAPL", shares: 1 },
      { id: "f", ticker: "SWPPX", shares: 5, manual: true, manualPrice: 80 },
    ],
  });
  feed([row("AAPL", 150, "2026-10-01")]);
  await prices.refreshPrices();
  feed([row("AAPL", 151, "2026-10-01")]); // later close, same session
  const res = await prices.refreshPrices();
  assert.equal(res.prices.AAPL.price, 151);
  const sameDay = db.getSymbolPriceHistory().AAPL.filter((p) => p.date === "2026-10-01");
  assert.equal(sameDay.length, 1); // one entry per day…
  assert.equal(sameDay[0].price, 151); // …holding the NEWER close
});

test("portfolio-value history includes manual holdings at their user-set price", async () => {
  // holdings from the previous test: AAPL (auto, priced 151) + SWPPX (manual @ $80 × 5)
  const hist = db.getPortfolioHistory();
  assert.equal(hist[hist.length - 1].value, 151 * 1 + 80 * 5); // 551, not 151
});

test("a partial sync records NO portfolio point (no phantom dips)", async () => {
  db.putState({
    holdings: [
      { id: "a", ticker: "AAPL", shares: 1 },
      { id: "m", ticker: "MSFT", shares: 2 }, // auto-sync, never priced, no manualPrice
    ],
  });
  const before = JSON.stringify(db.getPortfolioHistory());
  feed([row("AAPL", 152, "2026-10-02")]); // MSFT missing from the answer
  await prices.refreshPrices();
  assert.equal(JSON.stringify(db.getPortfolioHistory()), before); // unchanged
});

test("a script-reported outage reports 'error' and never trips the circuit breaker", async () => {
  db.putState({ holdings: [{ id: "r", ticker: "RATED", shares: 1 }] });
  feed([], "yfinance failed for 1 symbol(s) — network or rate limit?");
  // more consecutive failed syncs than MANUAL_AFTER — used to flip it to "manual"
  for (let i = 0; i < 4; i++) {
    await prices.refreshPrices();
  }
  const p = await prices.getPrices();
  assert.equal(p.lastSync.status, "error"); // a provider failure, not "empty"
  assert.deepEqual(p.lastSync.manual, []); // RATED is NOT given up on
  assert.ok(p.lastSync.missing.includes("RATED")); // still being retried
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
