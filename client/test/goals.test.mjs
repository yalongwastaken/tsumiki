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

test("zero/empty goal is safe", () => {
  const p = goalProgress({}, 0, TODAY);
  assert.equal(p.pct, 0);
  assert.equal(p.reached, false);
});
