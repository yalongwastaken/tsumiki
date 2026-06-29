// debt.test.mjs — debt-payoff projection (avalanche/snowball, interest, timeline).
import { test } from "node:test";
import assert from "node:assert/strict";
import { payoffPlan } from "../../src/lib/finance/debt.js";

const TODAY = new Date("2026-06-21T12:00:00Z");

test("no debts → debt-free now, no interest", () => {
  const p = payoffPlan([], { today: TODAY });
  assert.equal(p.debtFree, true);
  assert.equal(p.months, 0);
  assert.equal(p.totalInterest, 0);
  assert.equal(p.payoffDate, null);
});

test("single 0% debt pays off in balance ÷ payment months", () => {
  const p = payoffPlan([{ id: "a", name: "Card", balance: 1000, apr: 0, minPayment: 100 }], {
    today: TODAY,
  });
  assert.equal(p.totalInterest, 0);
  assert.equal(p.months, 10); // 1000 / 100
  assert.equal(p.debtFree, true);
  assert.equal(p.order[0].id, "a");
});

test("interest accrues and extra payments shorten the timeline + cut interest", () => {
  const debt = [{ id: "a", name: "Card", balance: 5000, apr: 24, minPayment: 150 }];
  const slow = payoffPlan(debt, { today: TODAY });
  const fast = payoffPlan(debt, { extra: 200, today: TODAY });
  assert.ok(fast.months < slow.months, "extra pays it off faster");
  assert.ok(fast.totalInterest < slow.totalInterest, "extra saves interest");
  assert.ok(slow.totalInterest > 0);
});

test("avalanche targets the highest APR first; snowball the smallest balance", () => {
  const debts = [
    { id: "big", name: "Big low-rate", balance: 8000, apr: 8, minPayment: 100 },
    { id: "small", name: "Small high-rate", balance: 1000, apr: 27, minPayment: 25 },
  ];
  const ava = payoffPlan(debts, { extra: 300, strategy: "avalanche", today: TODAY });
  const snow = payoffPlan(debts, { extra: 300, strategy: "snowball", today: TODAY });
  // both clear the small one first here (smallest balance AND highest APR), but
  // avalanche must never cost more interest than snowball
  assert.ok(ava.totalInterest <= snow.totalInterest);
  // a higher-balance/lower-APR vs lower-balance/higher-APR split: avalanche order
  assert.equal(ava.order[0].id, "small"); // 27% > 8%
});

test("avalanche and snowball diverge when APR and balance disagree", () => {
  const debts = [
    { id: "hi", name: "High APR big", balance: 6000, apr: 25, minPayment: 120 },
    { id: "lo", name: "Low APR tiny", balance: 800, apr: 6, minPayment: 20 },
  ];
  const ava = payoffPlan(debts, { extra: 200, strategy: "avalanche", today: TODAY });
  const snow = payoffPlan(debts, { extra: 200, strategy: "snowball", today: TODAY });
  assert.equal(ava.order[0].id, "hi"); // highest APR
  assert.equal(snow.order[0].id, "lo"); // smallest balance
});

test("a minimum that can't cover interest → not debt-free (flagged, no infinite loop)", () => {
  // $10k at 30% accrues ~$250/mo interest; a $50 min loses ground
  const p = payoffPlan([{ id: "a", name: "Trap", balance: 10000, apr: 30, minPayment: 50 }], {
    maxMonths: 120,
    today: TODAY,
  });
  assert.equal(p.debtFree, false);
  assert.equal(p.payoffDate, null);
  assert.equal(p.months, 120); // bailed at the cap
});

test("payoffDate lands the right number of months out", () => {
  const p = payoffPlan([{ id: "a", name: "Card", balance: 300, apr: 0, minPayment: 100 }], {
    today: TODAY,
  });
  assert.equal(p.months, 3);
  assert.equal(p.payoffDate.getFullYear(), 2026);
  assert.equal(p.payoffDate.getMonth(), 8); // June (5) + 3 = September (8)
});

test("payoffDate doesn't skip a short month when starting at month-end", () => {
  // Jan 31 + 1 month must land in Feb, not overflow to March
  const p = payoffPlan([{ id: "a", name: "Card", balance: 100, apr: 0, minPayment: 100 }], {
    today: new Date(2026, 0, 31),
  });
  assert.equal(p.months, 1);
  assert.equal(p.payoffDate.getMonth(), 1); // February
});
