// budgets.test.mjs — envelope category budgets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetStatus, budgetAlert } from "../src/lib/budgets.js";

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
