// goals.test.mjs — goal progress + pace math.
import { test } from "node:test";
import assert from "node:assert/strict";
import { goalProgress, earmarkedByGoal } from "../src/lib/goals.js";

// local-component fixture (NOT a "…Z" literal): a UTC instant like noon-Z lands on
// the next calendar day past UTC+12, which would shift monthsUntil by one day.
const TODAY = new Date(2026, 5, 21, 12, 0, 0);

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

test("calendar-month pace: ~1 month out needs the full amount (not halved)", () => {
  // Jul 22 is ~31 days out — calendar diff is 1 month, so requiredMonthly = remaining/1
  const p = goalProgress({ amount: 2000, targetDate: "2026-07-22" }, 0, TODAY);
  assert.equal(p.monthsLeft, 1);
  assert.equal(p.requiredMonthly, 2000);
  // a future same-month date still counts as ≥1 month of runway (not overdue)
  const soon = goalProgress({ amount: 1000, targetDate: "2026-06-28" }, 0, TODAY);
  assert.equal(soon.monthsLeft, 1);
  assert.equal(soon.overdue, false);
});

test("invalid target date is treated as no deadline", () => {
  const p = goalProgress({ amount: 5000, targetDate: "not-a-date" }, 1000, TODAY);
  assert.equal(p.monthsLeft, null);
  assert.equal(p.requiredMonthly, null);
});

test("zero/empty goal is safe", () => {
  const p = goalProgress({}, 0, TODAY);
  assert.equal(p.pct, 0);
  assert.equal(p.reached, false);
});

test("earmarkedByGoal sums contributions tagged to each goal", () => {
  const tx = [
    { type: "contribution", amount: 200, goalId: "vacation" },
    { type: "contribution", amount: 150, goalId: "vacation" },
    { type: "contribution", amount: 500, goalId: "car" },
    { type: "contribution", amount: 100 }, // untagged → ignored
    { type: "spending", amount: 99, goalId: "vacation" }, // not a contribution → ignored
    { type: "contribution", amount: 0, goalId: "car" }, // zero → ignored
  ];
  const e = earmarkedByGoal(tx);
  assert.equal(e.vacation, 350);
  assert.equal(e.car, 500);
  assert.equal("untagged" in e, false);
  assert.deepEqual(earmarkedByGoal([]), {});
});
