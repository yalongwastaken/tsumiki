// portfolio.test.mjs — holdings math + deterministic recommendations.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  portfolioRows,
  portfolioTotals,
  portfolioInsights,
  retirementValue,
} from "../src/portfolio.js";

const holdings = [
  { id: "1", ticker: "aapl", shares: 10, costBasis: 150 },
  { id: "2", ticker: "VTI", shares: 5 }, // no cost basis
];
const prices = {
  AAPL: { price: 200, date: "2026-06-20", changePct: 0.03 },
  VTI: { price: 250, date: "2026-06-20" },
};

test("portfolioRows computes value + gain vs cost basis", () => {
  const rows = portfolioRows(holdings, prices);
  const aapl = rows.find((r) => r.ticker === "AAPL");
  assert.equal(aapl.value, 2000); // 10 × 200
  assert.equal(aapl.cost, 1500); // 10 × 150
  assert.equal(aapl.gain, 500);
  assert.ok(Math.abs(aapl.gainPct - 500 / 1500) < 1e-9);
  const vti = rows.find((r) => r.ticker === "VTI");
  assert.equal(vti.value, 1250);
  assert.equal(vti.gain, null); // no cost basis → no gain
});

test("portfolioTotals sums value; gain only over rows with a basis", () => {
  const t = portfolioTotals(portfolioRows(holdings, prices));
  assert.equal(t.value, 3250); // 2000 + 1250
  assert.equal(t.gain, 500); // only AAPL has a basis
  assert.equal(t.priced, true);
});

test("missing prices → unpriced rows, no NaN", () => {
  const rows = portfolioRows(holdings, {});
  assert.equal(rows[0].value, null);
  const t = portfolioTotals(rows);
  assert.equal(t.value, 0);
  assert.equal(t.priced, false);
});

test("insights flag concentration risk", () => {
  const rows = portfolioRows([{ id: "1", ticker: "AAPL", shares: 100 }], { AAPL: { price: 200 } });
  const recs = portfolioInsights(rows, portfolioTotals(rows));
  assert.ok(recs.some((r) => r.id === "concentration"));
});

test("insights flag a big mover and stay capped at 3", () => {
  const rows = portfolioRows(
    [
      { id: "1", ticker: "A", shares: 1 },
      { id: "2", ticker: "B", shares: 1 },
      { id: "3", ticker: "C", shares: 1 },
      { id: "4", ticker: "D", shares: 1 },
    ],
    {
      A: { price: 100, changePct: -0.12 },
      B: { price: 100, changePct: 0.1 },
      C: { price: 100, changePct: 0.09 },
      D: { price: 100, changePct: 0.11 },
    },
  );
  const recs = portfolioInsights(rows, portfolioTotals(rows));
  assert.ok(recs.length <= 3);
  assert.ok(recs.some((r) => r.id.startsWith("move-")));
});

test("account tag: rows default to taxable; retirementValue sums 401k/IRA/Roth", () => {
  const rows = portfolioRows(
    [
      { id: "1", ticker: "VOO", shares: 1, account: "401k" },
      { id: "2", ticker: "AAPL", shares: 1 }, // defaults to taxable
    ],
    { VOO: { price: 400 }, AAPL: { price: 200 } },
  );
  assert.equal(rows.find((r) => r.ticker === "AAPL").account, "taxable");
  assert.equal(retirementValue(rows), 400);
  // has a retirement holding → the tax-advantaged nudge should NOT fire
  const recs = portfolioInsights(rows, portfolioTotals(rows));
  assert.ok(!recs.some((r) => r.id === "tax-advantaged"));
});

test("tax-advantaged nudge fires when everything is taxable", () => {
  const rows = portfolioRows(
    [
      { id: "1", ticker: "A", shares: 1 },
      { id: "2", ticker: "B", shares: 1 },
      { id: "3", ticker: "C", shares: 1 },
    ],
    { A: { price: 10 }, B: { price: 10 }, C: { price: 10 } },
  );
  const recs = portfolioInsights(rows, portfolioTotals(rows));
  assert.ok(recs.some((r) => r.id === "tax-advantaged"));
});

test("evergreen single-stock nudge when no concentration/movers", () => {
  // three evenly-weighted holdings (each ~33% < 40%), no big moves
  const rows = portfolioRows(
    [
      { id: "1", ticker: "A", shares: 1 },
      { id: "2", ticker: "B", shares: 1 },
      { id: "3", ticker: "C", shares: 1 },
    ],
    { A: { price: 10 }, B: { price: 10 }, C: { price: 10 } },
  );
  const recs = portfolioInsights(rows, portfolioTotals(rows));
  assert.ok(recs.some((r) => r.id === "single-stock"));
});
