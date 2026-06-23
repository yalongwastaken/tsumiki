// finance.test.mjs — shared income/spend core (client + server).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nonTaxableMonthly, monthOf } from "../src/lib/finance.js";

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

test("monthOf is safe on bad dates", () => {
  assert.equal(monthOf("nope"), "");
  assert.equal(monthOf("2026-06-15T00:00:00Z"), "2026-06");
});
