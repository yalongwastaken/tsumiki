// migrate.test.js — tests for the legacy → unified migration (pure, no DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateLegacy } from "../lib/migrate.js";

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

test("migrated profile/settings carry the newer default fields", () => {
  // fields added after the migration was written must exist on a migrated dataset
  // (DEFAULT_PROFILE/DEFAULT_SETTINGS are spread underneath the migrated values)
  const out = migrateLegacy({ settings: { returnRate: 0.05 } });
  assert.deepEqual(out.profile.bills, []);
  assert.deepEqual(out.profile.moneyTargets, []);
  assert.equal(out.profile.strategy, "balanced");
  assert.equal(out.profile.retireAge, 65);
  assert.equal(out.settings.theme, "light");
  assert.equal(out.settings.onboarded, false);
  // migration-specific values still win over the defaults
  assert.equal(out.settings.returnRate, 0.05);
  assert.equal(out.settings.streakFreezes, 0);
  assert.equal(out.profile.typicalIncome, 7000); // legacy fallback kept
});
