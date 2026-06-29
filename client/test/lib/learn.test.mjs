// learn.test.mjs — curated lessons + relevance rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { learnFeed, LESSONS } from "../../src/lib/insights/learn.js";

test("evergreen lesson is always available as a fallback", () => {
  // a fully optimized user: match set, no idle cash, nothing invested, etc.
  const feed = learnFeed({ hasMatch: true });
  assert.ok(feed.length >= 1);
  assert.equal(feed[feed.length - 1].id, "compound");
});

test("missing employer match surfaces the match lesson first", () => {
  const feed = learnFeed({ hasMatch: false }, 1);
  assert.equal(feed[0].id, "match");
});

test("relevance rules gate by context", () => {
  const ids = (ctx) => learnFeed(ctx, 9).map((l) => l.id);
  assert.ok(ids({ hasMatch: true, idleCash: true }).includes("hysa"));
  assert.ok(ids({ hasMatch: true, windfall: true }).includes("windfall"));
  assert.ok(ids({ hasMatch: true, investedTotal: 500, hasRetirement: false }).includes("taxadv"));
  assert.ok(!ids({ hasMatch: true, investedTotal: 0 }).includes("fire"));
});

test("limit is respected and the predicate is not leaked", () => {
  const feed = learnFeed({ hasMatch: false, idleCash: true, hasPaydays: true }, 2);
  assert.equal(feed.length, 2);
  for (const l of feed) {
    assert.equal(typeof l.relevant, "undefined");
    assert.ok(l.topic && l.blurb && l.action && l.tab);
  }
});

test("every lesson is well-formed", () => {
  for (const l of LESSONS) {
    assert.ok(l.id && l.topic && l.blurb && l.action && l.tab);
    assert.equal(typeof l.relevant, "function");
  }
});
