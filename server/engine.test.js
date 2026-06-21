// Unit tests for the allocation engine (run: npm test). Pure function, so we
// assert exact behavior across the scenarios that matter for coaching quality.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, typicalIncome } from "./engine.js";

const acct = (id, type) => ({ id, name: id, type });
const snap = (accountId, balance) => ({ id: accountId + "s", accountId, date: "2026-06-01T00:00:00Z", balance });

test("zero income → no steps", () => {
  const p = buildPlan({ profile: {} }, 0);
  assert.equal(p.income, 0);
  assert.equal(p.steps.length, 0);
  assert.equal(p.leftover, 0);
});

test("full waterfall order: min debt → floor → match → high debt → emergency", () => {
  const state = {
    accounts: [acct("chk", "checking")],
    snapshots: [snap("chk", 1000)], // below floor 3000
    debts: [{ id: "a", name: "Card A", balance: 1000, apr: 24, minPayment: 30 }],
    profile: { checkingFloor: 3000, emergencyTarget: 9000, employerMatch: { pct: 4 }, strategy: "balanced" },
    transactions: [],
  };
  const keys = buildPlan(state, 6000).steps.map((s) => s.key);
  assert.deepEqual(keys.slice(0, 4), ["min_debt", "floor", "match", "high_debt"]);
  assert.ok(keys.includes("emergency"));
});

test("avalanche: highest-APR debt is named first", () => {
  const state = {
    accounts: [acct("chk", "checking")], snapshots: [snap("chk", 5000)],
    debts: [{ id: "a", name: "Card A", balance: 1000, apr: 15, minPayment: 20 }, { id: "b", name: "Card B", balance: 500, apr: 27, minPayment: 15 }],
    profile: { checkingFloor: 3000, strategy: "balanced" }, transactions: [],
  };
  const high = buildPlan(state, 6000).steps.find((s) => s.key === "high_debt");
  assert.match(high.why, /Card B/); // 27% beats 15%
});

test("snowball: smallest-balance debt is named first", () => {
  const state = {
    accounts: [acct("chk", "checking")], snapshots: [snap("chk", 5000)],
    debts: [{ id: "a", name: "Big", balance: 5000, apr: 22, minPayment: 50 }, { id: "b", name: "Small", balance: 300, apr: 20, minPayment: 10 }],
    profile: { checkingFloor: 3000, strategy: "balanced", debtStrategy: "snowball" }, transactions: [],
  };
  const high = buildPlan(state, 6000).steps.find((s) => s.key === "high_debt");
  assert.match(high.why, /Small/);
});

test("YTD retirement caps the annual room", () => {
  const state = {
    accounts: [acct("chk", "checking")], snapshots: [snap("chk", 5000)],
    debts: [], profile: { checkingFloor: 3000, strategy: "long_term" },
    transactions: [{ id: "r", type: "contribution", bucket: "retirement", amount: 6800, date: "2026-02-01T00:00:00Z" }],
  };
  const p = buildPlan(state, 6000);
  const retire = p.steps.filter((s) => s.key === "match" || s.key === "retirement").reduce((a, s) => a + s.amount, 0);
  assert.ok(retire <= 200 + 1, `retirement ${retire} should be ≤ remaining room 200`);
  assert.equal(p.context.retirementRoom, 200);
});

test("configurable high-APR threshold excludes lower-rate debt", () => {
  const state = {
    accounts: [acct("chk", "checking")], snapshots: [snap("chk", 5000)],
    debts: [{ id: "a", name: "A", balance: 1000, apr: 24, minPayment: 0 }, { id: "b", name: "B", balance: 500, apr: 15, minPayment: 0 }],
    profile: { checkingFloor: 3000, strategy: "balanced", highApr: 20 }, transactions: [],
  };
  const high = buildPlan(state, 6000).steps.find((s) => s.key === "high_debt");
  assert.equal(high.amount, 1000); // only the 24% card
});

test("A3: typical income prefers logged history (≥2 months), else typed", () => {
  const profile = { incomeSources: [{ id: "s", typicalMonthly: 4000 }] };
  // no history → typed estimate
  assert.equal(typicalIncome({ profile, transactions: [] }), 4000);
  // 2 complete prior months averaging 5000 → history wins
  const tx = [
    { type: "income", amount: 4800, date: "2026-04-10T00:00:00Z" },
    { type: "income", amount: 5200, date: "2026-05-10T00:00:00Z" },
  ];
  assert.equal(typicalIncome({ profile, transactions: tx }), 5000);
});

test("A1: bills are reserved as essentials before the waterfall", () => {
  const state = {
    accounts: [acct("chk", "checking")], snapshots: [snap("chk", 9000)], debts: [],
    profile: { checkingFloor: 3000, strategy: "long_term", bills: [{ id: "r", name: "Rent", amount: 2000 }] },
    transactions: [],
  };
  const p = buildPlan(state, 5000);
  const ess = p.steps.find((s) => s.key === "essentials");
  assert.equal(ess.amount, 2000);
  assert.equal(p.essentialsSource, "bills");
  // essentials reserved, the rest is split + allocated
  assert.equal(p.allocated, 5000);
});

test("split: surplus is shared across destinations, not drained into one", () => {
  const state = {
    accounts: [acct("chk", "checking"), acct("sav", "savings")],
    snapshots: [snap("chk", 5000), snap("sav", 0)], // checking funded, savings empty
    debts: [],
    profile: { checkingFloor: 3000, emergencyTarget: 20000, strategy: "balanced" }, // big emergency gap
    transactions: [],
  };
  const p = buildPlan(state, 4000);
  const amt = (k) => p.steps.filter((s) => s.key === k).reduce((a, s) => a + s.amount, 0);
  // even with a huge unmet emergency target, money still reaches retirement + investing
  assert.ok(amt("emergency") > 0, "savings funded");
  assert.ok(amt("retirement") > 0, "retirement funded");
  assert.ok(amt("brokerage") > 0, "personal investment funded");
  // savings does NOT swallow everything
  assert.ok(amt("emergency") < 4000, "savings is only a share, not the whole paycheck");
  assert.equal(p.allocated + p.leftover, 4000);
});

test("A1: with no bills, essentials fall back to learned avg spending", () => {
  const state = {
    accounts: [acct("chk", "checking")], snapshots: [snap("chk", 9000)], debts: [],
    profile: { checkingFloor: 3000, strategy: "long_term" },
    transactions: [{ id: "x", type: "spending", amount: 1500, date: "2026-06-10T00:00:00Z", cat: "X" }],
  };
  const p = buildPlan(state, 5000);
  assert.equal(p.essentialsSource, "learned");
  assert.equal(p.steps.find((s) => s.key === "essentials").amount, 1500);
});

test("investable = retirement + brokerage; allocation sums to income", () => {
  const p = buildPlan({ accounts: [acct("chk", "checking")], snapshots: [snap("chk", 9000)], debts: [], profile: { checkingFloor: 3000, strategy: "long_term" }, transactions: [] }, 4000);
  const invest = p.steps.filter((s) => s.key === "retirement" || s.key === "brokerage").reduce((a, s) => a + s.amount, 0);
  assert.equal(p.investable, invest);
  assert.equal(p.allocated + p.leftover, 4000);
});
