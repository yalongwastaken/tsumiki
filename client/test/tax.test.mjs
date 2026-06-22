// tax.test.mjs — federal brackets + FICA + state estimate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTax } from "../src/tax.js";

test("single $80k in a no-tax state: federal + FICA, marginal 22%", () => {
  const t = estimateTax({ income: 80000, filingStatus: "single", state: "TX" });
  // taxable = 80000 − 15000 std = 65000
  assert.equal(t.taxable, 65000);
  // federal: 1192.5 + 4386 + 22%×16525 (=3635.5) = 9214
  assert.equal(t.federal, 9214);
  // FICA: 80000×6.2% + 80000×1.45% = 6120
  assert.equal(t.fica, 6120);
  assert.equal(t.state, 0); // TX has no income tax
  assert.equal(t.stateNoTax, true);
  assert.equal(t.marginalRate, 0.22);
  assert.ok(t.takeHomeMonthly > 0 && t.takeHomeMonthly < 80000 / 12);
});

test("65+ gets the larger standard deduction", () => {
  const young = estimateTax({ income: 50000, age: 40, state: "TX" });
  const senior = estimateTax({ income: 50000, age: 70, state: "TX" });
  assert.equal(senior.taxable, young.taxable - 2000); // +$2k extra deduction
  assert.ok(senior.federal < young.federal);
});

test("state income tax applies in a taxing state (default ~5%)", () => {
  const t = estimateTax({ income: 100000, filingStatus: "single", state: "CA" });
  assert.equal(t.stateNoTax, false);
  // 5% of taxable (100000 − 15000 = 85000) = 4250
  assert.equal(t.state, 4250);
  const override = estimateTax({ income: 100000, state: "CA", stateRate: 0.09 });
  assert.equal(override.state, Math.round(85000 * 0.09));
});

test("married brackets differ from single; zero income is safe", () => {
  const single = estimateTax({ income: 120000, filingStatus: "single", state: "TX" });
  const married = estimateTax({ income: 120000, filingStatus: "married", state: "TX" });
  assert.ok(married.federal < single.federal); // wider brackets + bigger deduction
  const zero = estimateTax({ income: 0 });
  assert.equal(zero.total, 0);
  assert.equal(zero.effectiveRate, 0);
});
