// milestones.test.mjs — unit tests for the milestones engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMilestones, nextMilestone } from "../src/milestones.js";

const ctx = {
  realNetWorth: 12000,
  investedTotal: 1500,
  savings: 5000,
  emergencyTarget: 10000,
  debts: [{ balance: 0 }],
  streak: 5,
  userTargets: [{ id: "t1", label: "Save $5k", amount: 5000, metric: "contributed" }],
};

test("net-worth and contributed tiers resolve correctly", () => {
  const m = computeMilestones(ctx);
  const a = (id) => m.find((x) => x.id === id)?.achieved;
  assert.equal(a("first"), true); // invested > 0
  assert.equal(a("contrib_1000"), true); // 1500 ≥ 1000
  assert.equal(a("contrib_5000"), false); // 1500 < 5000
  assert.equal(a("nw_10000"), true); // 12000 ≥ 10000
  assert.equal(a("nw_25000"), false);
});

test("emergency + debt-free + streak tiers", () => {
  const m = computeMilestones(ctx);
  const a = (id) => m.find((x) => x.id === id)?.achieved;
  assert.equal(a("emergency"), false); // 5000 < 10000
  assert.equal(a("debt_free"), true); // a debt exists, all zero balance
  assert.equal(a("streak_4"), true); // streak 5 ≥ 4
  assert.equal(a("streak_12"), false);
});

test("debt-free is false when there are no debts at all", () => {
  const m = computeMilestones({ ...ctx, debts: [] });
  assert.equal(m.find((x) => x.id === "debt_free").achieved, false);
});

test("user money targets track their chosen metric", () => {
  const m = computeMilestones(ctx);
  const t = m.find((x) => x.id === "target_t1");
  assert.equal(t.cur, 1500); // metric "contributed" → investedTotal
  assert.equal(t.achieved, false); // 1500 < 5000
  const m2 = computeMilestones({ ...ctx, investedTotal: 5000 });
  assert.equal(m2.find((x) => x.id === "target_t1").achieved, true);
});

test("nextMilestone returns the first unachieved with a target", () => {
  const n = nextMilestone(computeMilestones(ctx));
  assert.ok(n && !n.achieved && n.target > 0);
});
