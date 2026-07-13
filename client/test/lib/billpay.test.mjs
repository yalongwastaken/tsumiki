// billpay.test.mjs — bill ↔ spend matching: paid / due / overdue statuses and the
// Home-card rollup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { billPayments, billsSummary } from "../../src/lib/plan/billpay.js";

const Y = 2026;
const M = 6; // July (0-based)
const spend = (id, day, amount, cat = null, note = null) => ({
  id,
  type: "spending",
  amount,
  date: new Date(Y, M, day, 12).toISOString(),
  cat,
  note,
});

test("a spend matching the bill NAME marks it paid (category or note)", () => {
  const bills = [{ id: "b1", name: "Rent", amount: 1800, dayOfMonth: 1 }];
  const [s] = billPayments(bills, [spend("t1", 2, 1800, "Housing", "rent july")], Y, M);
  assert.equal(s.status, "paid");
  assert.equal(s.paidBy, "t1");
  assert.equal(s.paidOn, 2);
});

test("an AMOUNT match counts only within a week of the due day", () => {
  const bills = [{ id: "b1", name: "Internet", amount: 79.99, dayOfMonth: 15 }];
  // same amount but on the 1st — two weeks early, unrelated purchase
  const far = billPayments(bills, [spend("t1", 1, 79.99, "Shopping")], Y, M, new Date(Y, M, 20));
  assert.equal(far[0].status, "overdue");
  // same amount on the 13th — that's the bill
  const near = billPayments(bills, [spend("t2", 13, 79.99, "Shopping")], Y, M, new Date(Y, M, 20));
  assert.equal(near[0].status, "paid");
});

test("amount tolerance: within 2% still matches (wobbly utility bills)", () => {
  const bills = [{ id: "b1", name: "Electric", amount: 100, dayOfMonth: 10 }];
  const [s] = billPayments(bills, [spend("t1", 10, 101.5, "Utilities", "electric")], Y, M);
  assert.equal(s.status, "paid");
});

test("one transaction can pay at most one bill", () => {
  const bills = [
    { id: "b1", name: "Spotify", amount: 12, dayOfMonth: 5 },
    { id: "b2", name: "Spotify Family", amount: 12, dayOfMonth: 6 },
  ];
  const out = billPayments(bills, [spend("t1", 5, 12, null, "spotify")], Y, M, new Date(Y, M, 20));
  const statuses = out.map((s) => s.status).sort();
  assert.deepEqual(statuses, ["overdue", "paid"]); // not both paid by the same tx
});

test("due vs overdue pivots on today vs the due day", () => {
  const bills = [{ id: "b1", name: "Rent", amount: 1800, dayOfMonth: 15 }];
  assert.equal(billPayments(bills, [], Y, M, new Date(Y, M, 10))[0].status, "due");
  assert.equal(billPayments(bills, [], Y, M, new Date(Y, M, 16))[0].status, "overdue");
  // a future month is "upcoming", not overdue
  assert.equal(billPayments(bills, [], Y, M + 1, new Date(Y, M, 16))[0].status, "upcoming");
});

test("weak (reverse) name evidence never matches without an amount match", () => {
  // tx note "gym" is a substring of the bill name, but the amount is way off —
  // marking the bill paid here would suppress a real overdue alert
  const bills = [{ id: "b1", name: "Gym Membership Platinum", amount: 89, dayOfMonth: 5 }];
  const out = billPayments(
    bills,
    [spend("t1", 5, 12.5, null, "gym snacks")],
    Y,
    M,
    new Date(Y, M, 20),
  );
  assert.equal(out[0].status, "overdue");
  // same weak evidence WITH the right amount → that's the bill
  const paid = billPayments(bills, [spend("t2", 5, 89, null, "gym snacks")], Y, M);
  assert.equal(paid[0].status, "paid");
});

test("a bill with no schedule is 'none' unless a spend matches it", () => {
  const bills = [{ id: "b1", name: "Gym", amount: 40 }];
  assert.equal(billPayments(bills, [], Y, M)[0].status, "none");
  assert.equal(billPayments(bills, [spend("t1", 8, 40, null, "gym")], Y, M)[0].status, "paid");
});

test("billsSummary rolls up paid / left / overdue for the Home card", () => {
  const bills = [
    { id: "b1", name: "Rent", amount: 1800, dayOfMonth: 1 },
    { id: "b2", name: "Internet", amount: 80, dayOfMonth: 15 },
    { id: "b3", name: "Electric", amount: 120, dayOfMonth: 25 },
    { id: "b4", name: "Gym", amount: 40 }, // no schedule, no match → excluded
  ];
  const statuses = billPayments(
    bills,
    [spend("t1", 1, 1800, "Housing", "rent")],
    Y,
    M,
    new Date(Y, M, 20),
  );
  const sum = billsSummary(statuses);
  assert.equal(sum.total, 3);
  assert.equal(sum.paidCount, 1);
  assert.equal(sum.leftCount, 2); // internet (overdue) + electric (due)
  assert.equal(sum.leftTotal, 200);
  assert.equal(sum.overdue.length, 1);
  assert.equal(sum.overdue[0].bill.name, "Internet");
});
