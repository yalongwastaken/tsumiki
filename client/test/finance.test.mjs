// finance.test.mjs — shared income/spend core (client + server).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nonTaxableMonthly, taxableShare, monthOf } from "../src/lib/finance.js";

test("nonTaxableMonthly sums only sources flagged non-taxable", () => {
  const profile = {
    incomeSources: [
      { id: "a", typicalMonthly: 5000, taxable: true }, // taxable salary
      { id: "b", typicalMonthly: 800 }, // taxable by default (undefined)
      { id: "c", typicalMonthly: 1200, taxable: false }, // non-taxable (e.g. gift)
      { id: "d", typicalMonthly: 300, taxable: false }, // non-taxable (disability)
    ],
  };
  assert.equal(nonTaxableMonthly(profile), 1500); // 1200 + 300
});

test("nonTaxableMonthly is 0 with no sources / all taxable", () => {
  assert.equal(nonTaxableMonthly({}), 0);
  assert.equal(nonTaxableMonthly({ incomeSources: [{ id: "x", typicalMonthly: 4000 }] }), 0);
});

test("taxableShare = taxable fraction of declared income (scales any income figure)", () => {
  // 5000 taxable + 1000 non-taxable → 5/6 taxable
  const p = {
    incomeSources: [
      { id: "a", typicalMonthly: 5000, taxable: true },
      { id: "b", typicalMonthly: 1000, taxable: false },
    ],
  };
  assert.ok(Math.abs(taxableShare(p) - 5 / 6) < 1e-9);
  // applying the share to a LEARNED $5000/mo avg gives ~4166/mo taxable (not 4000 —
  // the old fixed subtraction double-counted)
  assert.equal(Math.round(5000 * taxableShare(p)), 4167);
});

test("taxableShare is 1 with no sources, 0 when all income is non-taxable", () => {
  assert.equal(taxableShare({}), 1);
  assert.equal(taxableShare({ incomeSources: [{ id: "x", typicalMonthly: 4000 }] }), 1);
  assert.equal(
    taxableShare({ incomeSources: [{ id: "x", typicalMonthly: 4000, taxable: false }] }),
    0,
  );
});

test("monthOf is safe on bad dates", () => {
  assert.equal(monthOf("nope"), "");
});

test("monthOf returns a bare date's month verbatim (timezone-independent)", () => {
  assert.equal(monthOf("2026-06-30"), "2026-06");
  assert.equal(monthOf("2026-01-01"), "2026-01");
});

test("monthOf buckets a full timestamp by LOCAL month (no UTC month-edge slip)", () => {
  // a late-evening instant on the last day of the month stays in that month locally
  assert.equal(monthOf(new Date(2026, 5, 30, 23, 0, 0)), "2026-06");
  assert.equal(monthOf(new Date(2026, 0, 1, 0, 30, 0)), "2026-01");
});
