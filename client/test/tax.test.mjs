// tax.test.mjs — federal brackets + FICA + state estimate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTax } from "../src/tax.js";

test("single $80k in a no-tax state: federal + FICA, marginal 22%", () => {
  const t = estimateTax({ income: 80000, filingStatus: "single", state: "TX" });
  // taxable = 80000 − 15750 std (2025 post-OBBBA) = 64250
  assert.equal(t.taxable, 64250);
  // federal: 1192.5 + 4386 + 22%×15775 (=3470.5) = 9049
  assert.equal(t.federal, 9049);
  // FICA: 80000×6.2% + 80000×1.45% = 6120
  assert.equal(t.fica, 6120);
  assert.equal(t.state, 0); // TX has no income tax
  assert.equal(t.stateNoTax, true);
  assert.equal(t.marginalRate, 0.22);
  assert.ok(t.takeHomeMonthly > 0 && t.takeHomeMonthly < 80000 / 12);
});

test("65+ gets the extra std deduction plus the OBBBA senior bonus", () => {
  const young = estimateTax({ income: 50000, age: 40, state: "TX" });
  const senior = estimateTax({ income: 50000, age: 70, state: "TX" });
  // +$2k additional std deduction +$6k senior bonus (no phaseout under $75k)
  assert.equal(senior.taxable, young.taxable - 8000);
  assert.ok(senior.federal < young.federal);
});

test("senior bonus phases out with income and vanishes high up", () => {
  // single, $100k is $25k over the $75k threshold → 6% × 25000 = $1,500 of bonus lost
  const mid = estimateTax({ income: 100000, age: 70, state: "TX" });
  const midYoung = estimateTax({ income: 100000, age: 40, state: "TX" });
  // remaining bonus = 6000 − 1500 = 4500, plus the $2k extra std → 6500 less taxable
  assert.equal(mid.taxable, midYoung.taxable - 6500);
  // far above the phaseout the bonus is gone (only the $2k extra std remains)
  const rich = estimateTax({ income: 300000, age: 70, state: "TX" });
  const richYoung = estimateTax({ income: 300000, age: 40, state: "TX" });
  assert.equal(rich.taxable, richYoung.taxable - 2000);
});

test("state income tax applies in a taxing state (default ~5%)", () => {
  const t = estimateTax({ income: 100000, filingStatus: "single", state: "CA" });
  assert.equal(t.stateNoTax, false);
  // 5% of taxable (100000 − 15750 = 84250) = 4213 (rounded)
  assert.equal(t.state, 4213);
  const override = estimateTax({ income: 100000, state: "CA", stateRate: 0.09 });
  assert.equal(override.state, Math.round(84250 * 0.09));
});

test("married brackets differ from single; zero income is safe", () => {
  const single = estimateTax({ income: 120000, filingStatus: "single", state: "TX" });
  const married = estimateTax({ income: 120000, filingStatus: "married", state: "TX" });
  assert.ok(married.federal < single.federal); // wider brackets + bigger deduction
  const zero = estimateTax({ income: 0 });
  assert.equal(zero.total, 0);
  assert.equal(zero.effectiveRate, 0);
});
