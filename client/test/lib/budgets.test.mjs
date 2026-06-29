// budgets.test.mjs — envelope category budgets.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetStatus,
  budgetAlert,
  categoryAverages,
  rolloverBalance,
} from "../../src/lib/finance/budgets.js";

const ym = "2026-06";
const tx = [
  { type: "spending", amount: 200, cat: "Dining", date: "2026-06-03" },
  { type: "spending", amount: 180, cat: "Dining", date: "2026-06-10" },
  { type: "spending", amount: 50, cat: "Groceries", date: "2026-06-05" },
  { type: "spending", amount: 999, cat: "Dining", date: "2026-05-30" }, // prior month, ignored
  { type: "income", amount: 5000, date: "2026-06-01" }, // not spending
];

test("budgetStatus reports spend vs cap per budgeted category", () => {
  const rows = budgetStatus(tx, { Dining: 400, Groceries: 300 }, ym);
  const dining = rows.find((r) => r.cat === "Dining");
  assert.equal(dining.spent, 380); // only this month's dining
  assert.equal(dining.budget, 400);
  assert.equal(dining.remaining, 20);
  assert.equal(dining.over, false);
  assert.ok(Math.abs(dining.pct - 0.95) < 1e-9);
  const groceries = rows.find((r) => r.cat === "Groceries");
  assert.equal(groceries.spent, 50);
});

test("budgetStatus flags over-budget and sorts by pct desc", () => {
  const rows = budgetStatus(tx, { Dining: 300, Groceries: 300 }, ym);
  assert.equal(rows[0].cat, "Dining"); // 380/300 highest pct
  assert.equal(rows[0].over, true);
  assert.equal(rows[0].remaining, -80);
});

test("budgetAlert surfaces an over or ≥90% category, else null", () => {
  assert.equal(budgetAlert(budgetStatus(tx, { Dining: 400 }, ym))?.cat, "Dining"); // 95%
  assert.equal(budgetAlert(budgetStatus(tx, { Dining: 1000 }, ym)), null); // 38%, calm
  assert.equal(budgetAlert([]), null);
});

test("budgets with no/zero cap are ignored; empty is safe", () => {
  assert.deepEqual(budgetStatus(tx, {}, ym), []);
  assert.deepEqual(
    budgetStatus(tx, { Dining: 0 }, ym).map((r) => r.cat),
    [],
  );
});

test("budgetStatus adds per-day-left + last-month context", () => {
  // mid-month (Jun 21 of 30) → 10 days left incl. today
  const today = new Date(2026, 5, 21);
  const rows = budgetStatus(tx, { Dining: 400 }, ym, today);
  const dining = rows[0];
  assert.equal(dining.daysLeft, 10);
  assert.ok(Math.abs(dining.perDayLeft - 20 / 10) < 1e-9); // $20 left / 10 days = $2/day
  assert.equal(dining.lastMonth, 999); // May Dining
  // over-budget → no per-day allowance
  assert.equal(budgetStatus(tx, { Dining: 300 }, ym, today)[0].perDayLeft, 0);
});

test("rollover: unused budget carries forward, overspend carries back", () => {
  // Dining cap 400. Apr spent 300 (+100), May spent 500 (−100) → net carry 0 into Jun
  const hist = [
    { type: "spending", amount: 300, cat: "Dining", date: "2026-04-10" },
    { type: "spending", amount: 500, cat: "Dining", date: "2026-05-10" },
    { type: "spending", amount: 100, cat: "Dining", date: "2026-06-10" },
  ];
  const byMonth = { "2026-04": 300, "2026-05": 500 };
  assert.equal(rolloverBalance(byMonth, 400, "2026-06"), 0); // +100 −100

  const rows = budgetStatus(hist, { Dining: 400 }, "2026-06", new Date(2026, 5, 21), {
    Dining: { rollover: true },
  });
  const d = rows[0];
  assert.equal(d.carry, 0);
  assert.equal(d.budget, 400); // cap + carry
  assert.equal(d.spent, 100);
  assert.equal(d.remaining, 300);

  // with only Apr's +100 surplus before May, May's effective cap is 500
  const r2 = rolloverBalance({ "2026-04": 300 }, 400, "2026-05");
  assert.equal(r2, 100);
});

test("rollover off (default) ignores prior months", () => {
  const hist = [
    { type: "spending", amount: 300, cat: "Dining", date: "2026-04-10" },
    { type: "spending", amount: 100, cat: "Dining", date: "2026-06-10" },
  ];
  const rows = budgetStatus(hist, { Dining: 400 }, "2026-06", new Date(2026, 5, 21));
  assert.equal(rows[0].budget, 400);
  assert.equal(rows[0].carry, 0);
  assert.equal(rows[0].rollover, false);
});

test("annual period tracks the calendar year's spend vs a yearly cap", () => {
  const hist = [
    { type: "spending", amount: 800, cat: "Travel", date: "2026-02-10" },
    { type: "spending", amount: 700, cat: "Travel", date: "2026-06-10" },
    { type: "spending", amount: 500, cat: "Travel", date: "2025-12-10" }, // prior year, excluded
  ];
  const rows = budgetStatus(hist, { Travel: 3000 }, "2026-06", new Date(2026, 5, 21), {
    Travel: { period: "annual" },
  });
  const t = rows[0];
  assert.equal(t.period, "annual");
  assert.equal(t.spent, 1500); // 800 + 700 this year
  assert.equal(t.budget, 3000);
  assert.equal(t.remaining, 1500);
  assert.equal(t.daysLeft, 194); // Jun 21 → Dec 31 inclusive
});

test("categoryAverages = mean monthly spend over complete prior months", () => {
  const hist = [
    { type: "spending", amount: 100, cat: "Dining", date: "2026-04-10" },
    { type: "spending", amount: 200, cat: "Dining", date: "2026-05-10" },
    { type: "spending", amount: 999, cat: "Dining", date: "2026-06-10" }, // current month, excluded
  ];
  const avg = categoryAverages(hist, 3, new Date(2026, 5, 21));
  assert.equal(avg.Dining, 150); // (100 + 200) / 2 complete months
});

test("categoryAverages buckets a month-boundary bare date the same in every timezone", () => {
  // a spend on the 1st of the oldest in-window month must count (it failed in US/Pacific
  // when compared via a UTC `new Date(bareDate)` against a local cutoff)
  const hist = [
    { type: "spending", amount: 300, cat: "Dining", date: "2026-03-01" },
    { type: "spending", amount: 300, cat: "Dining", date: "2026-04-01" },
  ];
  const avg = categoryAverages(hist, 3, new Date(2026, 5, 21));
  assert.equal(avg.Dining, 300); // both months counted → (300 + 300) / 2
});
