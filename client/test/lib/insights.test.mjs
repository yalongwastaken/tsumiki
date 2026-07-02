// insights.test.mjs — the deterministic "smart" derivations.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avgDailySpend,
  cashflowForecast,
  spendingTrends,
  detectRecurring,
  detectIncomeSchedule,
  coachNudges,
} from "../../src/lib/insights/insights.js";

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

test("cashflowForecast: an unlogged bill still erodes the projection (no false safety)", () => {
  // user logs ZERO discretionary spend but has a $2k bill they pay outside the app;
  // the bill must still be subtracted on its due date rather than netted to nothing
  const state = {
    accounts: [{ id: "c", type: "checking" }],
    snapshots: [snap("c", "2026-06-01", 2500)],
    profile: {
      checkingFloor: 1000,
      bills: [{ id: "r", name: "Rent", amount: 2000, dayOfMonth: 1 }],
      incomeSources: [{ id: "x", typicalMonthly: 4000, cadence: "monthly", payday: "2026-07-20" }],
    },
    transactions: [], // nothing logged → burn is 0, but the bill is real
  };
  const f = cashflowForecast(state, { days: 40, today: TODAY });
  assert.ok(f.min <= 500, `min ${f.min} should reflect the unlogged $2k bill`);
  assert.equal(f.dipsBelow, true);
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
test("avgDailySpend counts a window-edge bare date the same in every timezone", () => {
  // local "today" so the 60-day window is unambiguous across zones; the spend lands
  // exactly on the cutoff day and must be included everywhere (it dropped out in
  // US/Pacific when the bare date was parsed as UTC midnight vs a local cutoff)
  const localToday = new Date(2026, 5, 21); // Jun 21, local
  const tx = [{ type: "spending", amount: 60, date: "2026-04-22" }]; // exactly 60 days before
  assert.equal(avgDailySpend(tx, 60, localToday), 1); // 60 / 60, included
});

test("cashflowForecast steps calendar days across DST fall-back (no double-applied day)", () => {
  // Nov 1 2026 is US fall-back: a fixed `t0 + i*DAY` step resolves two iterations
  // to the same local date, applying that day's bill AND payday twice
  const today = new Date(2026, 9, 30); // Oct 30, local
  const state = {
    accounts: [{ id: "c", type: "checking" }],
    snapshots: [snap("c", "2026-10-01", 5000)],
    profile: {
      bills: [{ id: "r", name: "Rent", amount: 1500, dayOfMonth: 1 }],
      incomeSources: [{ id: "x", typicalMonthly: 3000, cadence: "monthly", payday: "2026-11-01" }],
    },
    transactions: [], // burn = 0, so only the Nov 1 bill + payday move the balance
  };
  const f = cashflowForecast(state, { days: 5, today });
  // every series point is a distinct local calendar day
  const keys = f.series.map(
    (p) => `${p.date.getFullYear()}-${p.date.getMonth()}-${p.date.getDate()}`,
  );
  assert.equal(new Set(keys).size, keys.length, "series must not repeat a local day");
  // 5000 + 3000 payday − 1500 rent, each applied exactly once
  assert.equal(f.series.at(-1).balance, 6500);
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

test("detectRecurring keeps distinct merchants in one category separate (by note)", () => {
  const tx = [];
  for (const m of ["04", "05", "06"]) {
    tx.push({
      type: "spending",
      amount: 15.49,
      cat: "Subscriptions",
      note: "Netflix",
      date: `2026-${m}-03`,
    });
    tx.push({
      type: "spending",
      amount: 11,
      cat: "Subscriptions",
      note: "Spotify",
      date: `2026-${m}-09`,
    });
  }
  const found = detectRecurring(tx, []);
  assert.equal(found.length, 2); // not collapsed into one "Subscriptions" row
  const labels = found.map((f) => f.label).sort();
  assert.deepEqual(labels, ["Netflix", "Spotify"]);
});

test("detectIncomeSchedule infers cadence + last payday from deposits", () => {
  assert.equal(detectIncomeSchedule([{ type: "income", amount: 1, date: "2026-06-01" }]), null);
  const biweekly = [
    { type: "income", amount: 2000, date: "2026-05-01" },
    { type: "income", amount: 2000, date: "2026-05-15" },
    { type: "income", amount: 2000, date: "2026-05-29" },
    { type: "income", amount: 2000, date: "2026-06-12" },
  ];
  const s = detectIncomeSchedule(biweekly);
  assert.equal(s.cadence, "biweekly");
  assert.equal(s.lastPayday, "2026-06-12");
  assert.equal(s.count, 4);

  const monthly = [
    { type: "income", amount: 5000, date: "2026-04-30" },
    { type: "income", amount: 5000, date: "2026-05-30" },
    { type: "income", amount: 5000, date: "2026-06-30" },
  ];
  assert.equal(detectIncomeSchedule(monthly).cadence, "monthly");

  // 1st & 15th lands on two days-of-month → semimonthly, not biweekly
  const semimonthly = [
    { type: "income", amount: 2500, date: "2026-04-01" },
    { type: "income", amount: 2500, date: "2026-04-15" },
    { type: "income", amount: 2500, date: "2026-05-01" },
    { type: "income", amount: 2500, date: "2026-05-15" },
    { type: "income", amount: 2500, date: "2026-06-01" },
  ];
  assert.equal(detectIncomeSchedule(semimonthly).cadence, "semimonthly");

  // full ISO timestamps bucket on the LOCAL calendar day (08:00Z is the same local
  // day across the test matrix), so the emitted lastPayday matches the user's day
  const timestamped = [
    { type: "income", amount: 2000, date: "2026-05-15T08:00:00.000Z" },
    { type: "income", amount: 2000, date: "2026-05-29T08:00:00.000Z" },
    { type: "income", amount: 2000, date: "2026-06-12T08:00:00.000Z" },
  ];
  assert.equal(detectIncomeSchedule(timestamped).lastPayday, "2026-06-12");
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
