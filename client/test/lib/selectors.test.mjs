// selectors.test.mjs — lock in the behavior App/Plan/Home previously implemented
// inline, so the shared-selector refactor can't drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthKey,
  latestSnapshots,
  netWorthFromSnapshots,
  sumLatestByType,
  annualSpend,
  monthTotals,
  localNoonIso,
} from "../../src/lib/core/selectors.js";

test("localNoonIso keeps the calendar day in every timezone (no UTC-midnight drift)", () => {
  const d = new Date(localNoonIso("2026-06-15"));
  // the local calendar day must still be the 15th — the bug class is rendering the 14th
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 5);
  assert.equal(d.getDate(), 15);
  // already-full timestamps and junk pass through untouched
  assert.equal(localNoonIso("2026-06-15T08:30:00.000Z"), "2026-06-15T08:30:00.000Z");
  assert.equal(localNoonIso(""), "");
});

test("monthKey is safe on an invalid date (no throw) + correct on a good one", () => {
  assert.equal(monthKey("2026-06-15"), "2026-06");
  assert.equal(monthKey("garbage"), ""); // would previously throw "Invalid time value"
  // a corrupt transaction date must not crash month bucketing
  assert.doesNotThrow(() =>
    monthTotals([{ type: "spending", amount: 5, date: "nope" }], "2026-06"),
  );
});

const snap = (accountId, date, balance) => ({ id: accountId + date, accountId, date, balance });

test("monthKey returns YYYY-MM", () => {
  assert.equal(monthKey("2026-06-21T12:00:00Z"), "2026-06");
});

test("latestSnapshots keeps the newest per account", () => {
  const snaps = [
    snap("a", "2026-01-01", 100),
    snap("a", "2026-05-01", 300),
    snap("b", "2026-03-01", 50),
  ];
  const latest = latestSnapshots(snaps);
  assert.equal(latest.a.balance, 300);
  assert.equal(latest.b.balance, 50);
});

test("netWorthFromSnapshots sums latest per account", () => {
  const snaps = [
    snap("a", "2026-01-01", 100),
    snap("a", "2026-05-01", 300),
    snap("b", "2026-03-01", 50),
  ];
  assert.equal(netWorthFromSnapshots(snaps), 350); // 300 + 50
  assert.equal(netWorthFromSnapshots([]), 0);
});

test("sumLatestByType filters by account type", () => {
  const accounts = [
    { id: "c", type: "checking" },
    { id: "s", type: "savings" },
    { id: "s2", type: "savings" },
  ];
  const snaps = [
    snap("c", "2026-05-01", 4000),
    snap("s", "2026-05-01", 6000),
    snap("s2", "2026-05-01", 1000),
  ];
  assert.equal(sumLatestByType(accounts, snaps, ["savings"]), 7000);
  assert.equal(sumLatestByType(accounts, snaps, ["checking"]), 4000);
  assert.equal(sumLatestByType(accounts, snaps, ["brokerage"]), 0);
});

test("annualSpend averages monthly spend × 12", () => {
  const tx = [
    { type: "spending", amount: 1000, date: "2026-04-10" },
    { type: "spending", amount: 2000, date: "2026-05-10" },
    { type: "income", amount: 9999, date: "2026-05-10" }, // ignored
  ];
  // two months, $3000 total → $1500/mo × 12
  assert.equal(annualSpend(tx), 18000);
  assert.equal(annualSpend([]), 0);
});
