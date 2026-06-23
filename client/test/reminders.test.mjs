// reminders.test.mjs — time-based alerts engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReminders } from "../src/lib/reminders.js";

// fixed "today" = Fri Jun 13, 2026 (local). Quarterly tax due Jun 15 → 2 days out.
const TODAY = new Date(2026, 5, 13, 9, 0, 0);
const iso = (y, m, d) => new Date(y, m, d, 12).toISOString();

const baseState = {
  profile: {
    incomeSources: [
      { id: "job", name: "Day job", type: "salary", cadence: "monthly", payday: "2026-05-15" },
    ],
    bills: [
      { id: "rent", name: "Rent", amount: 1500, dayOfMonth: 15 },
      { id: "spot", name: "Spotify", amount: 12, dayOfMonth: 28 }, // >5 days out → no reminder
    ],
    checkingFloor: 1000,
  },
  accounts: [{ id: "chk", name: "Checking", type: "checking" }],
  snapshots: [{ id: "s1", accountId: "chk", date: iso(2026, 5, 1), balance: 500 }], // below floor
  transactions: [
    { id: "t1", type: "spending", amount: 10, date: iso(2026, 5, 11) }, // 2 days ago
    { id: "t2", type: "spending", amount: 10, date: iso(2026, 5, 12) }, // yesterday → streak 2
  ],
  settings: { streakFreezes: 0 },
};

const byKind = (rs) => Object.fromEntries(rs.map((r) => [r.kind, r]));

test("surfaces payday, bill, buffer, tax, and streak reminders within the horizon", () => {
  const k = byKind(computeReminders(baseState, TODAY));
  assert.equal(k.payday.title, "Day job payday in 2 days"); // monthly 15th
  assert.equal(k.bill.title, "Rent due in 2 days");
  assert.equal(k.bill.severity, "warn"); // ≤2 days
  assert.equal(k.buffer.kind, "buffer");
  assert.match(k.buffer.detail, /\$500/);
  assert.equal(k.streak.title, "Keep your 2-day streak");
  assert.equal(k.tax, undefined); // not self-employed → no tax reminder
});

test("only bills within the horizon appear (Spotify on the 28th is excluded)", () => {
  const rs = computeReminders(baseState, TODAY);
  const bills = rs.filter((r) => r.kind === "bill");
  assert.equal(bills.length, 1);
  assert.equal(bills[0].title, "Rent due in 2 days");
});

test("self-employed surfaces the quarterly estimated-tax deadline", () => {
  const se = {
    ...baseState,
    profile: {
      ...baseState.profile,
      incomeSources: [{ id: "g", name: "Gig", type: "self_employed" }],
    },
  };
  const k = byKind(computeReminders(se, TODAY));
  assert.equal(k.tax.kind, "tax");
  assert.match(k.tax.title, /Jun 15/);
  assert.equal(k.tax.severity, "warn"); // ≤7 days
});

test("no streak reminder once today is logged", () => {
  const logged = {
    ...baseState,
    transactions: [
      ...baseState.transactions,
      { id: "t3", type: "spending", amount: 5, date: iso(2026, 5, 13) },
    ],
  };
  assert.equal(byKind(computeReminders(logged, TODAY)).streak, undefined);
});

test("empty state yields no reminders and never throws", () => {
  assert.deepEqual(computeReminders({}, TODAY), []);
  assert.deepEqual(computeReminders(undefined, TODAY), []);
});

test("results sort most-urgent first, then soonest date", () => {
  const rs = computeReminders(baseState, TODAY);
  const ranks = { urgent: 0, warn: 1, info: 2 };
  for (let i = 1; i < rs.length; i++) {
    assert.ok(ranks[rs[i - 1].severity] <= ranks[rs[i].severity]);
  }
});
