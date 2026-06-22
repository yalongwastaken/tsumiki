// recurring.test.mjs — one-tap "log this month's paychecks".
import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingPaychecks } from "../src/lib/recurring.js";

const TODAY = new Date(2026, 5, 21); // Jun 21 2026, local

test("lists expected paychecks on/before today, not future ones", () => {
  const profile = {
    incomeSources: [
      { id: "s", name: "Job", typicalMonthly: 6000, cadence: "biweekly", payday: "2026-06-05" },
    ],
  };
  const due = pendingPaychecks(profile, [], TODAY);
  // biweekly from Jun 5 → Jun 5 and Jun 19 are ≤ Jun 21; Jul 3 is next month
  assert.equal(due.length, 2);
  assert.equal(due[0].type, "income");
  assert.equal(due[0].sourceId, "s");
  assert.equal(due[0].amount, Math.round(6000 / 2.1725)); // per-paycheck
  assert.ok(due.every((d) => new Date(d.date).getDate() <= 21));
});

test("skips paychecks already logged for that source + day", () => {
  const profile = {
    incomeSources: [
      { id: "s", name: "Job", typicalMonthly: 6000, cadence: "biweekly", payday: "2026-06-05" },
    ],
  };
  const tx = [
    { type: "income", sourceId: "s", amount: 2762, date: new Date(2026, 5, 5).toISOString() },
  ];
  const due = pendingPaychecks(profile, tx, TODAY);
  assert.equal(due.length, 1); // only the Jun 19 one remains
  assert.equal(new Date(due[0].date).getDate(), 19);
});

test("counts logged paychecks (robust to a paycheck logged a day off)", () => {
  const profile = {
    incomeSources: [
      { id: "s", name: "Job", typicalMonthly: 6000, cadence: "biweekly", payday: "2026-06-05" },
    ],
  };
  // logged on the 6th (a day after the expected 5th) — still counts as 1 covered
  const tx = [
    { type: "income", sourceId: "s", amount: 2762, date: new Date(2026, 5, 6).toISOString() },
  ];
  const due = pendingPaychecks(profile, tx, TODAY);
  assert.equal(due.length, 1); // 2 expected − 1 logged = 1 remaining, no double-offer
});

test("sources without payday/cadence/amount are skipped", () => {
  const profile = {
    incomeSources: [
      { id: "a", name: "No payday", typicalMonthly: 5000, cadence: "monthly" },
      { id: "b", name: "No amount", cadence: "monthly", payday: "2026-06-01" },
    ],
  };
  assert.deepEqual(pendingPaychecks(profile, [], TODAY), []);
});
