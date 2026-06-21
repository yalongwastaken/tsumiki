// Tests for the legacy → unified migration (pure, no DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateLegacy } from "./migrate.js";

test("migrateLegacy converts contributions/expenses into the ledger", () => {
  const out = migrateLegacy({
    goals: [{ id: "j", name: "Japan", target: 5000, pledge: 300 }],
    contributions: [{ id: 1, goalId: "j", amount: 300, date: "2026-06-01" }],
    expenses: [{ id: 2, cat: "Food", amount: 42, date: "6/2/2026" }],
    settings: { startNetWorth: 12000, returnRate: 0.07 },
  });
  const types = out.transactions.map((t) => t.type).sort();
  assert.deepEqual(types, ["contribution", "spending"]);
  assert.equal(out.transactions.find((t) => t.type === "contribution").amount, 300);
  assert.equal(out.transactions.find((t) => t.type === "spending").amount, 42);
});

test("migrateLegacy seeds a brokerage snapshot from startNetWorth", () => {
  const out = migrateLegacy({ settings: { startNetWorth: 12000 } });
  assert.equal(out.snapshots.length, 1);
  assert.equal(out.snapshots[0].balance, 12000);
  assert.equal(out.accounts[0].type, "brokerage");
});

test("migrateLegacy seeds a Primary income source", () => {
  const out = migrateLegacy({});
  assert.ok(out.profile.incomeSources.length >= 1);
  assert.equal(out.profile.incomeSources[0].typicalMonthly, 7000);
  assert.equal(out.snapshots.length, 0); // no startNetWorth → no snapshot
});
