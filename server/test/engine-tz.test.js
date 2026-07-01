// engine-tz.test.js — engine correctness that only breaks in non-UTC timezones,
// plus garbage-profile resilience and the year-keyed contribution-limit map.
// TZ is pinned BEFORE the engine is imported so every Date in this process is
// negative-offset (the class of bug: new Date("YYYY-MM-DD") is UTC midnight, which
// is the previous LOCAL day/year west of Greenwich).
process.env.TZ = "America/Los_Angeles";

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, limitsForYear } from "../lib/engine.js";

const acct = (id, type) => ({ id, name: id, type });
const snap = (accountId, balance) => ({
  id: accountId + "s",
  accountId,
  date: "2026-06-01T00:00:00Z",
  balance,
});
const base = () => ({
  accounts: [acct("chk", "checking")],
  snapshots: [snap("chk", 5000)],
  debts: [],
  profile: { checkingFloor: 0, strategy: "long_term" },
  transactions: [],
});

test("a Jan-1 contribution lands in THIS year's YTD (bare date, negative-offset TZ)", () => {
  // regression: new Date("YYYY-01-01").getFullYear() is the PREVIOUS year in LA,
  // which zeroed ytdRetirement and let the plan advise contributing past the caps
  const y = new Date().getFullYear();
  const state = base();
  state.transactions = [
    { id: "c", type: "contribution", bucket: "retirement", amount: 7000, date: `${y}-01-01` },
  ];
  const p = buildPlan(state, 1000);
  assert.equal(p.context.ytdRetirement, 7000);
});

test("a LAST-year December contribution stays out of this year's YTD", () => {
  const y = new Date().getFullYear();
  const state = base();
  state.transactions = [
    { id: "c", type: "contribution", bucket: "retirement", amount: 500, date: `${y - 1}-12-31` },
  ];
  assert.equal(buildPlan(state, 1000).context.ytdRetirement, 0);
});

test("garbage profile numbers can't NaN the plan (steps + context stay finite)", () => {
  const state = base();
  state.profile = {
    strategy: "balanced",
    checkingFloor: "abc", // the exact repro from the audit: this used to delete a step
    emergencyTarget: {},
    highApr: "12%",
    employerMatch: { pct: "four" },
    retirementLimits: { ira: "lots", k401: null },
    split: { savings: "x", retirement: 1, invest: 1, checking: 1 },
    bills: [
      { id: "r", name: "Rent", amount: "1200" },
      { id: "z", name: "Zap" },
    ],
    incomeSources: [{ id: "s", typicalMonthly: "much", cadence: "monthly" }],
  };
  const p = buildPlan(state, 4000);
  assert.equal(p.allocated + p.leftover, 4000);
  for (const s of p.steps) {
    assert.ok(Number.isFinite(s.amount), `step ${s.key} amount is finite (${s.amount})`);
  }
  for (const [k, v] of Object.entries(p.context)) {
    if (typeof v === "number") {
      assert.ok(Number.isFinite(v), `context.${k} is finite (${v})`);
    }
  }
});

test('the audit repro: checkingFloor:"abc" no longer erases the Savings step', () => {
  const state = base();
  state.profile = { strategy: "balanced", checkingFloor: "abc" };
  const p = buildPlan(state, 4000);
  assert.ok(
    p.steps.some((s) => s.key === "emergency"),
    "Savings account step survives",
  );
  assert.equal(p.context.floor, 0); // garbage floor → treated as unset, not NaN
  assert.equal(p.allocated + p.leftover, 4000);
});

test("limitsForYear: known years map exactly; unknown years fall back to the latest", () => {
  assert.deepEqual(limitsForYear(2025), { year: 2025, ira: 7000, k401: 23500 });
  assert.deepEqual(limitsForYear(2026), { year: 2026, ira: 7500, k401: 24500 });
  // a future year we haven't tabulated yet → latest known caps, reported as such
  assert.deepEqual(limitsForYear(2031), { year: 2026, ira: 7500, k401: 24500 });
  assert.deepEqual(limitsForYear("garbage"), { year: 2026, ira: 7500, k401: 24500 });
});

test("the plan context reports which year's limits applied", () => {
  const y = new Date().getFullYear();
  const p = buildPlan(base(), 1000);
  assert.equal(p.context.limitsYear, limitsForYear(y).year);
  assert.match(p.context.limitsNote, /^using \d{4} limits$/);
});
