// news-backoff.test.js — /api/news resilience: failure backoff (RETRY_FLOOR) and the
// single-flight guard, mirroring the prices.js pattern. Fresh module instance (own
// process) so the cache starts empty and the backoff behavior is observable.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TSUMIKI_NEWS_FEED = "https://example.test/feed.xml";
const news = await import("../lib/news.js");

const origFetch = globalThis.fetch;
const FEED_XML =
  "<rss><channel><item><title>A</title><link>https://e.com/a</link></item></channel></rss>";
const okResponse = () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  body: null,
  text: async () => FEED_XML,
});

test("failure backoff: a down feed is NOT re-fetched on every read", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("feed down");
  };
  await news.getNews(); // stale cache → one attempt, which fails
  await news.getNews(); // within RETRY_FLOOR → served from (empty) cache, no fetch
  await news.getNews();
  assert.equal(calls, 1); // exactly one outbound attempt, not one per read
});

test("a manual/scheduled refresh bypasses the failure floor", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return okResponse();
  };
  const res = await news.refreshNews(); // direct refresh ignores the backoff floor
  assert.equal(calls, 1);
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].title, "A");
});

test("single-flight: concurrent refreshes share one in-flight fetch", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 25)); // keep the fetch in flight
    return okResponse();
  };
  const [a, b, c] = await Promise.all([news.refreshNews(), news.refreshNews(), news.getNews()]);
  assert.equal(calls, 1); // three callers, one outbound fetch
  assert.equal(a.items.length, 1);
  assert.equal(b, a); // both refreshes resolved to the same result
  assert.equal(c.enabled, true);
});

test.after(() => {
  globalThis.fetch = origFetch;
});
