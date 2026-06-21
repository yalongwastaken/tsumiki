// insights.test.mjs — the deterministic "smart" derivations.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avgDailySpend,
  cashflowForecast,
  spendingTrends,
  detectRecurring,
  coachNudges,
} from "../src/insights.js";

const TODAY = new Date("2026-06-21T12:00:00Z");
const snap = (accountId, date, balance) => ({ id: accountId + date, accountId, date, balance });

test("avgDailySpend averages real spend over the window", () => {
  const tx = [
    { type: "spending", amount: 600, date: "2026-06-10" },
    { type: "spending", amount: 0, date: "2026-06-11" }, // no-spend, ignored
    { type: "income", amount: 9999, date: "2026-06-12" }, // ignored
  ];
  assert.equal(avgDailySpend(tx, 60, TODAY), 10); // 600 / 60
});

test("cashflowForecast flags a dip below the floor before payday", () => {
  const state = {
    accounts: [{ id: "c", type: "checking" }],
    snapshots: [snap("c", "2026-06-01", 3200)],
    profile: {
      checkingFloor: 3000,
      // payday is weeks out; ~$50/day discretionary erodes checking before it lands
      incomeSources: [{ id: "x", typicalMonthly: 4000, cadence: "monthly", payday: "2026-07-15" }],
    },
    transactions: [{ type: "spending", amount: 3000, date: "2026-05-25" }], // ~$50/day, no bills
  };
  const f = cashflowForecast(state, { days: 20, today: TODAY });
  assert.equal(f.start, 3200);
  assert.equal(f.inflowsKnown, true);
  assert.ok(f.dipsBelow, "daily spend erodes checking below the 3000 floor before payday");
  assert.ok(f.min < 3000);
});

test("cashflowForecast: bills aren't double-counted against logged spend", () => {
  // rent logged as spending AND listed as a bill → must not be subtracted twice
  const state = {
    accounts: [{ id: "c", type: "checking" }],
    snapshots: [snap("c", "2026-06-01", 5000)],
    profile: {
      checkingFloor: 3000,
      bills: [{ id: "r", name: "Rent", amount: 1500, dayOfMonth: 1 }],
      incomeSources: [{ id: "x", typicalMonthly: 4000, cadence: "monthly", payday: "2026-06-30" }],
    },
    transactions: [
      { type: "spending", amount: 1500, cat: "Rent", date: "2026-05-01" },
      { type: "spending", amount: 1500, cat: "Rent", date: "2026-06-01" },
    ],
  };
  const f = cashflowForecast(state, { days: 25, today: TODAY });
  // discretionary ≈ 0 after removing the bill baseline, so a $5k balance with a
  // single $1.5k bill must NOT fall to a negative / sub-floor false alarm
  assert.ok(f.min >= 3000, `min ${f.min} should stay at/above floor (no double count)`);
  assert.equal(f.dipsBelow, false);
});

test("cashflowForecast: no dip alarm when income exists but no payday is set", () => {
  const state = {
    accounts: [{ id: "c", type: "checking" }],
    snapshots: [snap("c", "2026-06-01", 2000)],
    profile: {
      checkingFloor: 1500,
      incomeSources: [{ id: "x", typicalMonthly: 4000, cadence: "monthly" }], // no payday
    },
    transactions: [{ type: "spending", amount: 1800, date: "2026-05-25" }], // ~$30/day burn
  };
  const f = cashflowForecast(state, { days: 30, today: TODAY });
  assert.equal(f.inflowsKnown, false, "inflows are incomplete");
  assert.equal(f.dipsBelow, false, "no false dip warning without modeled income");
});

test("coachNudges tolerates dipsBelow with a null dipDate", () => {
  assert.doesNotThrow(() => coachNudges({ forecast: { dipsBelow: true, dipDate: null } }));
});

test("avgDailySpend handles a zero window without NaN", () => {
  assert.equal(avgDailySpend([{ type: "spending", amount: 100, date: "2026-06-10" }], 0, TODAY), 0);
});

test("cashflowForecast: a big balance with low spend never dips", () => {
  const state = {
    accounts: [{ id: "c", type: "checking" }],
    snapshots: [snap("c", "2026-06-01", 20000)],
    profile: { checkingFloor: 3000 },
    transactions: [],
  };
  const f = cashflowForecast(state, { days: 30, today: TODAY });
  assert.equal(f.dipsBelow, false);
});

test("spendingTrends compares this month to the prior average", () => {
  const tx = [
    // prior months: Dining avg = (300+100)/2 = 200
    { type: "spending", amount: 300, cat: "Dining", date: "2026-04-10" },
    { type: "spending", amount: 100, cat: "Dining", date: "2026-05-10" },
    // this month: 400 → up vs 200
    { type: "spending", amount: 400, cat: "Dining", date: "2026-06-10" },
  ];
  const [dining] = spendingTrends(tx, TODAY);
  assert.equal(dining.cat, "Dining");
  assert.equal(dining.now, 400);
  assert.equal(dining.avg, 200);
  assert.equal(dining.dir, "up");
});

test("detectRecurring finds repeating charges not already billed", () => {
  const tx = [
    { type: "spending", amount: 15.49, cat: "Subscriptions", date: "2026-04-03" },
    { type: "spending", amount: 15.49, cat: "Subscriptions", date: "2026-05-03" },
    { type: "spending", amount: 15.49, cat: "Subscriptions", date: "2026-06-03" },
    { type: "spending", amount: 42, cat: "Dining", date: "2026-06-04" }, // one-off
  ];
  const found = detectRecurring(tx, []);
  assert.equal(found.length, 1);
  assert.equal(found[0].label, "Subscriptions");
  assert.equal(found[0].amount, 15);
  assert.equal(found[0].months, 3);
});

test("coachNudges prioritizes a cashflow dip and respects the limit", () => {
  const nudges = coachNudges(
    {
      savings: 9000,
      emergencyTarget: 9000,
      strategy: "balanced",
      hasIncome: true,
      hasPaydays: true,
      highDebt: 500,
      leftToAllocate: 400,
      forecast: { dipsBelow: true, dipDate: new Date("2026-07-03") },
    },
    3,
  );
  assert.equal(nudges.length, 3);
  assert.equal(nudges[0].id, "cashflow"); // highest priority
  assert.equal(nudges[0].tone, "warn");
});

test("coachNudges suggests Growth when emergency is funded", () => {
  const nudges = coachNudges({ savings: 10000, emergencyTarget: 9000, strategy: "balanced" });
  assert.ok(nudges.some((n) => n.id === "go-growth"));
});
