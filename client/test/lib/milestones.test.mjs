// milestones.test.mjs — unit tests for the milestones engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMilestones, nextMilestone } from "../../src/lib/insights/milestones.js";

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

test("emergency + debt-free + daily streak tiers", () => {
  const m = computeMilestones(ctx);
  const a = (id) => m.find((x) => x.id === id)?.achieved;
  assert.equal(a("emergency"), false); // 5000 < 10000
  assert.equal(a("debt_free"), true); // a debt exists, all zero balance
  assert.equal(a("streak_3"), true); // streak 5 ≥ 3 days
  assert.equal(a("streak_7"), false); // 5 < 7 days
});

test("ledger-derived habit achievements (logs, no-spend, months tracked)", () => {
  const transactions = [
    { id: "1", type: "spending", amount: 10, date: "2026-04-02" },
    { id: "2", type: "spending", amount: 0, cat: "No-spend day", date: "2026-05-02" },
    { id: "3", type: "contribution", amount: 50, bucket: "invest", date: "2026-06-02" },
  ];
  const m = computeMilestones({ ...ctx, transactions });
  const a = (id) => m.find((x) => x.id === id)?.achieved;
  assert.equal(a("first_log"), true); // ≥1 entry
  assert.equal(a("nospend_1"), true); // one $0 no-spend day
  assert.equal(a("nospend_5"), false);
  assert.equal(a("invested"), true); // an invest contribution exists
  assert.equal(a("months_3"), true); // Apr/May/Jun → 3 distinct months
  assert.equal(a("months_6"), false);
  const logs10 = m.find((x) => x.id === "logs_10");
  assert.equal(logs10.cur, 3);
  assert.equal(logs10.achieved, false);
});

test("no transactions → habit achievements unearned, no crash", () => {
  const m = computeMilestones({ ...ctx, transactions: [] });
  const a = (id) => m.find((x) => x.id === id)?.achieved;
  assert.equal(a("first_log"), false);
  assert.equal(a("invested"), false);
  assert.equal(a("months_3"), false);
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

test("earmarked goals read their per-goal balance from ctx.earmarked", () => {
  const m = computeMilestones({
    ...ctx,
    userTargets: [{ id: "vac", label: "Vacation", amount: 2000, metric: "earmarked" }],
    earmarked: { vac: 2000 },
  });
  const t = m.find((x) => x.id === "target_vac");
  assert.equal(t.cur, 2000);
  assert.equal(t.achieved, true); // earmarked 2000 >= 2000
  // a different goal's earmark doesn't bleed in
  const m2 = computeMilestones({
    ...ctx,
    userTargets: [{ id: "vac", label: "Vacation", amount: 2000, metric: "earmarked" }],
    earmarked: { car: 5000 },
  });
  assert.equal(m2.find((x) => x.id === "target_vac").cur, 0);
});

test("nextMilestone returns the first unachieved with a target", () => {
  const n = nextMilestone(computeMilestones(ctx));
  assert.ok(n && !n.achieved && n.target > 0);
});
