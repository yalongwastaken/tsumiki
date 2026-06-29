// tax.test.mjs — federal brackets + FICA + state estimate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTax, nextQuarterlyDue } from "../../src/lib/finance/tax.js";

test("single $80k in a no-tax state: federal + FICA, marginal 22%", () => {
  const t = estimateTax({ income: 80000, filingStatus: "single", state: "TX" });
  // taxable = 80000 − 16100 std (2026) = 63900
  assert.equal(t.taxable, 63900);
  // federal: 1240 (10%×12400) + 4560 (12%×38000) + 22%×13500 (=2970) = 8770
  assert.equal(t.federal, 8770);
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
  // +$2,050 additional std deduction +$6k senior bonus (no phaseout under $75k)
  assert.equal(senior.taxable, young.taxable - 8050);
  assert.ok(senior.federal < young.federal);
});

test("senior bonus phases out with income and vanishes high up", () => {
  // single, $100k is $25k over the $75k threshold → 6% × 25000 = $1,500 of bonus lost
  const mid = estimateTax({ income: 100000, age: 70, state: "TX" });
  const midYoung = estimateTax({ income: 100000, age: 40, state: "TX" });
  // remaining bonus = 6000 − 1500 = 4500, plus the $2,050 extra std → 6550 less taxable
  assert.equal(mid.taxable, midYoung.taxable - 6550);
  // far above the phaseout the bonus is gone (only the $2,050 extra std remains)
  const rich = estimateTax({ income: 300000, age: 70, state: "TX" });
  const richYoung = estimateTax({ income: 300000, age: 40, state: "TX" });
  assert.equal(rich.taxable, richYoung.taxable - 2050);
});

test("state income tax applies in a taxing state (default ~5%)", () => {
  const t = estimateTax({ income: 100000, filingStatus: "single", state: "CA" });
  assert.equal(t.stateNoTax, false);
  // 5% of taxable (100000 − 16100 = 83900) = 4195 (rounded)
  assert.equal(t.state, 4195);
  const override = estimateTax({ income: 100000, state: "CA", stateRate: 0.09 });
  assert.equal(override.state, Math.round(83900 * 0.09));
  // a bad (negative / non-finite) rate clamps to 0 — never a negative tax or total
  const neg = estimateTax({ income: 100000, state: "CA", stateRate: -1 });
  assert.equal(neg.state, 0);
  assert.ok(neg.total >= 0);
  assert.equal(estimateTax({ income: 100000, state: "CA", stateRate: NaN }).state, 0);
});

test("self-employed: SE tax replaces FICA (~2×) and half is deducted from taxable", () => {
  const w2 = estimateTax({ income: 100000, filingStatus: "single", state: "TX" });
  const se = estimateTax({
    income: 100000,
    filingStatus: "single",
    state: "TX",
    selfEmployed: true,
  });
  // SE tax (~15.3% on 92.35% of income) is roughly double employee FICA (7.65%)
  assert.ok(se.fica > w2.fica * 1.7 && se.fica < w2.fica * 2.1, `se.fica=${se.fica}`);
  // half the SE tax is deductible → lower taxable income, lower federal than the W-2 case
  assert.ok(se.taxable < w2.taxable);
  assert.ok(se.federal < w2.federal);
  // overall a self-employed filer owes more (SE tax dwarfs the income-tax savings)
  assert.ok(se.total > w2.total);
  assert.equal(se.selfEmployed, true);
});

test("married filing jointly: both spouses 65+ double the senior deductions", () => {
  const base = { income: 90000, filingStatus: "married", state: "TX" };
  const young = estimateTax({ ...base, age: 50 });
  const oneSenior = estimateTax({ ...base, age: 70 });
  const bothSenior = estimateTax({ ...base, age: 70, spouseAge: 72 });
  // one 65+: +$1,650 std +$6,000 bonus = $7,650 less taxable
  assert.equal(oneSenior.taxable, young.taxable - 7650);
  // both 65+: doubled → $15,300 less taxable
  assert.equal(bothSenior.taxable, young.taxable - 15300);
  assert.ok(bothSenior.federal < oneSenior.federal);
  // spouseAge is ignored for single filers (no second person); use income under the
  // $75k single phaseout so the full bonus applies
  const single = estimateTax({
    income: 50000,
    filingStatus: "single",
    state: "TX",
    age: 70,
    spouseAge: 72,
  });
  const singleYoung = estimateTax({ income: 50000, filingStatus: "single", state: "TX", age: 50 });
  assert.equal(single.taxable, singleYoung.taxable - 8050); // only the one filer's +$2,050 std +$6k bonus
});

test("nextQuarterlyDue returns the next estimated-tax deadline", () => {
  // mid-June → next deadline is Jun 15? no, that's passed on the 21st → Sep 15
  assert.equal(nextQuarterlyDue(new Date(2026, 5, 21)).getMonth(), 8); // Sep
  // early Feb → Apr 15
  const apr = nextQuarterlyDue(new Date(2026, 1, 1));
  assert.equal(apr.getMonth(), 3);
  assert.equal(apr.getDate(), 15);
  // late Dec → Jan 15 of next year
  const jan = nextQuarterlyDue(new Date(2026, 11, 20));
  assert.equal(jan.getFullYear(), 2027);
  assert.equal(jan.getMonth(), 0);
});

test("married brackets differ from single; zero income is safe", () => {
  const single = estimateTax({ income: 120000, filingStatus: "single", state: "TX" });
  const married = estimateTax({ income: 120000, filingStatus: "married", state: "TX" });
  assert.ok(married.federal < single.federal); // wider brackets + bigger deduction
  const zero = estimateTax({ income: 0 });
  assert.equal(zero.total, 0);
  assert.equal(zero.effectiveRate, 0);
});

test("non-finite income clamps to 0 (no $NaN)", () => {
  for (const bad of [NaN, undefined, Infinity, "abc"]) {
    const r = estimateTax({ income: bad });
    assert.equal(r.gross, 0);
    assert.equal(r.total, 0);
    assert.equal(r.takeHome, 0);
    assert.ok(Number.isFinite(r.federal));
  }
});
