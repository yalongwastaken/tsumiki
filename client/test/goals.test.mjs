// goals.test.mjs — goal progress + pace math.
import { test } from "node:test";
import assert from "node:assert/strict";
import { goalProgress } from "../src/lib/goals.js";

const TODAY = new Date("2026-06-21T12:00:00Z");

test("progress percent + reached flag", () => {
  const p = goalProgress({ amount: 10000 }, 2500, TODAY);
  assert.equal(p.pct, 0.25);
  assert.equal(p.reached, false);
  assert.equal(p.remaining, 7500);
  assert.equal(goalProgress({ amount: 10000 }, 10000, TODAY).reached, true);
});

test("required monthly to hit a target date", () => {
  // ~6 months to Dec 21, $6000 remaining → ~$1000/mo
  const p = goalProgress({ amount: 6000, targetDate: "2026-12-21" }, 0, TODAY);
  assert.equal(p.monthsLeft, 6);
  assert.equal(p.requiredMonthly, 1000);
});

test("no target date → no required monthly, just progress", () => {
  const p = goalProgress({ amount: 5000 }, 1000, TODAY);
  assert.equal(p.requiredMonthly, null);
  assert.equal(p.monthsLeft, null);
});

test("a passed date with an unmet goal is overdue; a met goal is not", () => {
  const overdue = goalProgress({ amount: 5000, targetDate: "2026-01-01" }, 1000, TODAY);
  assert.equal(overdue.overdue, true);
  assert.equal(overdue.requiredMonthly, null);
  const done = goalProgress({ amount: 5000, targetDate: "2026-01-01" }, 5000, TODAY);
  assert.equal(done.overdue, false);
  assert.equal(done.reached, true);
});

test("on-track vs behind compares required pace to actual saving", () => {
  // need $1000/mo (6000 over 6mo); saving $1200/mo → on track
  const ahead = goalProgress({ amount: 6000, targetDate: "2026-12-21" }, 0, TODAY, 1200);
  assert.equal(ahead.onTrack, true);
  assert.equal(ahead.behindBy, 0);
  // saving only $400/mo → behind by $600/mo
  const behind = goalProgress({ amount: 6000, targetDate: "2026-12-21" }, 0, TODAY, 400);
  assert.equal(behind.onTrack, false);
  assert.equal(behind.behindBy, 600);
  // no pace known, or no date → null (don't claim a status)
  assert.equal(goalProgress({ amount: 6000, targetDate: "2026-12-21" }, 0, TODAY).onTrack, null);
  assert.equal(goalProgress({ amount: 6000 }, 0, TODAY, 500).onTrack, null);
});

test("zero/empty goal is safe", () => {
  const p = goalProgress({}, 0, TODAY);
  assert.equal(p.pct, 0);
  assert.equal(p.reached, false);
});
