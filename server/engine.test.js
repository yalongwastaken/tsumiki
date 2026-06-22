// engine.test.js — allocation engine unit tests (run: npm test).
// asserts exact behavior across the scenarios that matter for coaching quality
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, typicalIncome } from "./engine.js";

const acct = (id, type) => ({ id, name: id, type });
const snap = (accountId, balance) => ({
  id: accountId + "s",
  accountId,
  date: "2026-06-01T00:00:00Z",
  balance,
});

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
    profile: {
      checkingFloor: 3000,
      emergencyTarget: 9000,
      employerMatch: { pct: 4 },
      strategy: "balanced",
    },
    transactions: [],
  };
  const keys = buildPlan(state, 6000).steps.map((s) => s.key);
  assert.deepEqual(keys.slice(0, 4), ["min_debt", "floor", "match", "high_debt"]);
  assert.ok(keys.includes("emergency"));
});

test("avalanche: highest-APR debt is named first", () => {
  const state = {
    accounts: [acct("chk", "checking")],
    snapshots: [snap("chk", 5000)],
    debts: [
      { id: "a", name: "Card A", balance: 1000, apr: 15, minPayment: 20 },
      { id: "b", name: "Card B", balance: 500, apr: 27, minPayment: 15 },
    ],
    profile: { checkingFloor: 3000, strategy: "balanced" },
    transactions: [],
  };
  const high = buildPlan(state, 6000).steps.find((s) => s.key === "high_debt");
  assert.match(high.why, /Card B/); // 27% beats 15%
});

test("snowball: smallest-balance debt is named first", () => {
  const state = {
    accounts: [acct("chk", "checking")],
    snapshots: [snap("chk", 5000)],
    debts: [
      { id: "a", name: "Big", balance: 5000, apr: 22, minPayment: 50 },
      { id: "b", name: "Small", balance: 300, apr: 20, minPayment: 10 },
    ],
    profile: { checkingFloor: 3000, strategy: "balanced", debtStrategy: "snowball" },
    transactions: [],
  };
  const high = buildPlan(state, 6000).steps.find((s) => s.key === "high_debt");
  assert.match(high.why, /Small/);
});

test("YTD retirement caps the annual room", () => {
  const state = {
    accounts: [acct("chk", "checking")],
    snapshots: [snap("chk", 5000)],
    debts: [],
    profile: { checkingFloor: 3000, strategy: "long_term" },
    transactions: [
      {
        id: "r",
        type: "contribution",
        bucket: "retirement",
        amount: 7300, // leaves $200 of the $7,500 IRA room
        date: "2026-02-01T00:00:00Z",
      },
    ],
  };
  const p = buildPlan(state, 6000);
  const retire = p.steps
    .filter((s) => s.key === "match" || s.key === "retirement")
    .reduce((a, s) => a + s.amount, 0);
  assert.ok(retire <= 200 + 1, `retirement ${retire} should be ≤ remaining room 200`);
  assert.equal(p.context.retirementRoom, 200);
});

test("an employer match unlocks 401k room beyond the IRA cap", () => {
  const base = {
    accounts: [acct("chk", "checking")],
    snapshots: [snap("chk", 5000)],
    debts: [],
    transactions: [],
  };
  // no match → IRA-only room ($7.5k); with a match → IRA + 401k room ($32k)
  const noMatch = buildPlan(
    { ...base, profile: { checkingFloor: 3000, strategy: "long_term" } },
    6000,
  );
  const withMatch = buildPlan(
    { ...base, profile: { checkingFloor: 3000, strategy: "long_term", employerMatch: { pct: 4 } } },
    6000,
  );
  assert.equal(noMatch.context.retirementRoom, 7500);
  assert.equal(withMatch.context.retirementRoom, 7500 + 24500);
});

test("a windfall check doesn't inflate the employer-match suggestion", () => {
  const state = {
    accounts: [acct("chk", "checking")],
    snapshots: [snap("chk", 5000)],
    debts: [],
    profile: {
      checkingFloor: 3000,
      strategy: "balanced",
      employerMatch: { pct: 5 },
      incomeSources: [{ id: "s", typicalMonthly: 6000 }], // typical = 6000
    },
    transactions: [],
  };
  // a $20k windfall: match is 5% of the regular $6k paycheck ($300), not of $20k ($1000)
  const match = buildPlan(state, 20000).steps.find((s) => s.key === "match");
  assert.equal(match.amount, 300);
});

test("match base falls back to logged income when no typical is set", () => {
  // no income sources, no typed estimate, only a single current-month deposit →
  // typicalIncome returns 0, but the match must use that ~$6k, not a $20k windfall
  const state = {
    accounts: [acct("chk", "checking")],
    snapshots: [snap("chk", 5000)],
    debts: [],
    profile: { checkingFloor: 3000, strategy: "balanced", employerMatch: { pct: 5 } },
    transactions: [{ id: "i", type: "income", amount: 6000, date: "2026-06-10T00:00:00Z" }],
  };
  const match = buildPlan(state, 20000).steps.find((s) => s.key === "match");
  assert.equal(match.amount, 300); // 5% of the logged $6k, not 5% of $20k
});

test("configurable high-APR threshold excludes lower-rate debt", () => {
  const state = {
    accounts: [acct("chk", "checking")],
    snapshots: [snap("chk", 5000)],
    debts: [
      { id: "a", name: "A", balance: 1000, apr: 24, minPayment: 0 },
      { id: "b", name: "B", balance: 500, apr: 15, minPayment: 0 },
    ],
    profile: { checkingFloor: 3000, strategy: "balanced", highApr: 20 },
    transactions: [],
  };
  const high = buildPlan(state, 6000).steps.find((s) => s.key === "high_debt");
  assert.equal(high.amount, 1000); // only the 24% card
});

test("typical income prefers logged history (≥2 months), else typed", () => {
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

test("bills are reserved as essentials before the waterfall", () => {
  const state = {
    accounts: [acct("chk", "checking")],
    snapshots: [snap("chk", 9000)],
    debts: [],
    profile: {
      checkingFloor: 3000,
      strategy: "long_term",
      bills: [{ id: "r", name: "Rent", amount: 2000 }],
    },
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

test("starter buffer: with empty savings, savings is boosted past its split share", () => {
  // big essentials so the $1k+ starter clearly exceeds the 25% balanced savings share
  const state = {
    accounts: [acct("chk", "checking"), acct("sav", "savings")],
    snapshots: [snap("chk", 5000), snap("sav", 0)],
    debts: [],
    profile: {
      checkingFloor: 3000,
      emergencyTarget: 20000,
      strategy: "balanced",
      bills: [{ id: "r", name: "Rent", amount: 1800 }],
    },
    transactions: [],
  };
  // surplus after $1800 essentials = ~$1200; plain 25% share would be ~$300,
  // but the starter ($1800) forces savings to take the lot first.
  const p = buildPlan(state, 3000);
  const amt = (k) => p.steps.filter((s) => s.key === k).reduce((a, s) => a + s.amount, 0);
  assert.ok(amt("emergency") > 300, `savings boosted past its share (${amt("emergency")})`);
  assert.equal(p.allocated + p.leftover, 3000);
});

test("no boost, no taper: split is the plain percentage split", () => {
  // no emergency target → no starter boost and no funded-taper → exact weights
  const state = {
    accounts: [acct("chk", "checking"), acct("sav", "savings")],
    snapshots: [snap("chk", 5000), snap("sav", 5000)],
    debts: [],
    profile: { checkingFloor: 3000, emergencyTarget: 0, strategy: "balanced" },
    transactions: [],
  };
  const p = buildPlan(state, 4000);
  const amt = (k) => p.steps.filter((s) => s.key === k).reduce((a, s) => a + s.amount, 0);
  assert.equal(amt("emergency"), 1000); // 25% of 4000
  assert.equal(amt("retirement"), 1200); // 30%
  assert.equal(amt("checking_flex"), 600); // 15%
  assert.equal(amt("brokerage"), 1200); // 30%
});

test("emergency-aware taper: a funded safety net shifts savings toward investing", () => {
  const base = {
    accounts: [acct("chk", "checking"), acct("sav", "savings")],
    debts: [],
    profile: { checkingFloor: 3000, emergencyTarget: 10000, strategy: "balanced" },
    transactions: [],
  };
  const unfunded = buildPlan({ ...base, snapshots: [snap("chk", 5000), snap("sav", 0)] }, 4000);
  const funded = buildPlan({ ...base, snapshots: [snap("chk", 5000), snap("sav", 10000)] }, 4000);
  const amt = (p, k) => p.steps.filter((s) => s.key === k).reduce((a, s) => a + s.amount, 0);
  // funded → less to savings, more to investing; but savings never disappears
  assert.ok(amt(funded, "emergency") < amt(unfunded, "emergency"), "savings tapers when funded");
  assert.ok(amt(funded, "emergency") > 0, "savings stays a visible category");
  assert.ok(
    amt(funded, "brokerage") > amt(unfunded, "brokerage"),
    "freed weight flows to investing",
  );
});

test("windfall: detected always, but only tilts the split when opted in", () => {
  const state = {
    accounts: [acct("chk", "checking"), acct("sav", "savings")],
    snapshots: [snap("chk", 5000), snap("sav", 5000)],
    debts: [],
    profile: {
      checkingFloor: 3000,
      emergencyTarget: 0,
      strategy: "balanced",
      incomeSources: [{ id: "s", typicalMonthly: 6000 }], // typical = 6000
    },
    transactions: [],
  };
  const amt = (p, k) => p.steps.filter((s) => s.key === k).reduce((a, s) => a + s.amount, 0);

  const base = buildPlan(state, 11000); // $5k windfall, not applied
  const applied = buildPlan(state, 11000, { windfall: true }); // applied
  assert.equal(base.windfall.detected, true);
  assert.equal(base.windfall.applied, false);
  assert.equal(base.windfall.amount, 5000);
  // opting in pushes the extra toward investing and out of idle checking
  assert.ok(applied.windfall.applied);
  assert.ok(amt(applied, "brokerage") > amt(base, "brokerage"), "more invested");
  assert.ok(amt(applied, "checking_flex") < amt(base, "checking_flex"), "less idle cash");
  // both still allocate the whole paycheck
  assert.equal(applied.allocated + applied.leftover, 11000);
  // no false positive at typical income, and the opt-in flag is a no-op then
  assert.equal(buildPlan(state, 6000).windfall.detected, false);
  assert.equal(buildPlan(state, 6000, { windfall: true }).windfall.applied, false);
});

test("preview: strategyOverride changes the split without touching profile", () => {
  const state = {
    accounts: [acct("chk", "checking"), acct("sav", "savings")],
    snapshots: [snap("chk", 5000), snap("sav", 5000)],
    debts: [],
    profile: { checkingFloor: 3000, emergencyTarget: 20000, strategy: "balanced" },
    transactions: [],
  };
  const base = buildPlan(state, 4000);
  const growth = buildPlan(state, 4000, { strategy: "long_term" });
  assert.equal(base.strategy, "balanced");
  assert.equal(growth.strategy, "long_term");
  // growth invests more than balanced
  assert.ok(growth.investable > base.investable);
});

test("cadence: paychecksPerMonth derives from the dominant income source", () => {
  const state = {
    accounts: [acct("chk", "checking")],
    snapshots: [snap("chk", 5000)],
    debts: [],
    profile: {
      checkingFloor: 0,
      strategy: "balanced",
      incomeSources: [
        { id: "a", typicalMonthly: 4000, cadence: "biweekly" },
        { id: "b", typicalMonthly: 500, cadence: "monthly" },
      ],
    },
    transactions: [],
  };
  const p = buildPlan(state, 5000);
  assert.equal(p.cadence, "biweekly");
  assert.ok(p.paychecksPerMonth > 2 && p.paychecksPerMonth < 2.5);
  // default when no sources
  assert.equal(buildPlan({ profile: {} }, 1000).cadence, "monthly");
});

test("with no bills, essentials fall back to learned avg spending", () => {
  const state = {
    accounts: [acct("chk", "checking")],
    snapshots: [snap("chk", 9000)],
    debts: [],
    profile: { checkingFloor: 3000, strategy: "long_term" },
    transactions: [
      { id: "x", type: "spending", amount: 1500, date: "2026-06-10T00:00:00Z", cat: "X" },
    ],
  };
  const p = buildPlan(state, 5000);
  assert.equal(p.essentialsSource, "learned");
  assert.equal(p.steps.find((s) => s.key === "essentials").amount, 1500);
});

test("investable = retirement + brokerage; allocation sums to income", () => {
  const p = buildPlan(
    {
      accounts: [acct("chk", "checking")],
      snapshots: [snap("chk", 9000)],
      debts: [],
      profile: { checkingFloor: 3000, strategy: "long_term" },
      transactions: [],
    },
    4000,
  );
  const invest = p.steps
    .filter((s) => s.key === "retirement" || s.key === "brokerage")
    .reduce((a, s) => a + s.amount, 0);
  assert.equal(p.investable, invest);
  assert.equal(p.allocated + p.leftover, 4000);
});
