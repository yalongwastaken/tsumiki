// portfolio.test.mjs — holdings math + deterministic recommendations.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  portfolioRows,
  portfolioTotals,
  portfolioInsights,
  retirementValue,
  holdingsValueByAccount,
  investmentAccountValue,
  portfolioFlow,
} from "../../src/lib/finance/portfolio.js";

const holdings = [
  { id: "1", ticker: "aapl", shares: 10, costBasis: 150 },
  { id: "2", ticker: "VTI", shares: 5 }, // no cost basis
];
const prices = {
  AAPL: { price: 200, date: "2026-06-20", changePct: 0.03 },
  VTI: { price: 250, date: "2026-06-20" },
};

test("holdingsValueByAccount groups linked holdings' market value by account", () => {
  const holdings = [
    { id: "1", ticker: "AAPL", shares: 10, accountId: "acc1" },
    { id: "2", ticker: "VTI", shares: 5, accountId: "acc1" },
    { id: "3", ticker: "MSFT", shares: 2, accountId: "acc2" },
    { id: "4", ticker: "TSLA", shares: 3 }, // no linked account → ignored
    { id: "5", ticker: "NOPRICE", shares: 9, accountId: "acc2" }, // no price → ignored
  ];
  const prices = { AAPL: { price: 200 }, VTI: { price: 100 }, MSFT: { price: 50 } };
  const byAcct = holdingsValueByAccount(holdings, prices);
  assert.equal(byAcct.acc1, 2500); // 10×200 + 5×100
  assert.equal(byAcct.acc2, 100); // 2×50; NOPRICE excluded
  assert.equal("acc3" in byAcct, false);
});

test("investmentAccountValue = holdings market value + cash; null for cash accounts", () => {
  const holdings = [
    { id: "1", ticker: "AAPL", shares: 10, accountId: "brk" },
    { id: "2", ticker: "VTI", shares: 4, accountId: "brk" },
  ];
  const prices = { AAPL: { price: 200 }, VTI: { price: 100 } };
  assert.equal(
    investmentAccountValue({ id: "brk", type: "brokerage", cash: 500 }, holdings, prices),
    2900, // 10×200 + 4×100 + 500 cash
  );
  // no cash, no prices yet → 0 (last-synced handled by the snapshot layer, not here)
  assert.equal(investmentAccountValue({ id: "brk", type: "ira" }, holdings, {}), 0);
  // a cash account is not auto-valued
  assert.equal(investmentAccountValue({ id: "chk", type: "checking" }, holdings, prices), null);
});

test("holdingsValueByAccount tolerates empty / NaN shares", () => {
  assert.deepEqual(holdingsValueByAccount([], {}), {});
  assert.deepEqual(
    holdingsValueByAccount([{ id: "1", ticker: "A", shares: NaN, accountId: "x" }], {
      A: { price: 10 },
    }),
    {},
  );
});

test("a non-finite shares count yields null value, not NaN-poisoned totals", () => {
  const rows = portfolioRows(
    [
      { id: "1", ticker: "AAPL", shares: 10, costBasis: 150 },
      { id: "2", ticker: "BAD", shares: NaN, costBasis: 50 },
    ],
    { AAPL: { price: 200 }, BAD: { price: 10 } },
  );
  const bad = rows.find((r) => r.ticker === "BAD");
  assert.equal(bad.value, null);
  assert.equal(bad.cost, null);
  const totals = portfolioTotals(rows);
  assert.equal(totals.value, 2000); // only the good row counts; not NaN
  assert.equal(totals.gain, 500);
});

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

// ── portfolioFlow (the stocks-Sankey structure) ─────────────────────────────────

test("portfolioFlow separates the total into account buckets, then tickers", () => {
  const rows = portfolioRows(
    [
      { id: "1", ticker: "AAPL", shares: 10, account: "taxable" }, // 2000
      { id: "2", ticker: "VTI", shares: 4, account: "taxable" }, // 1000
      { id: "3", ticker: "VOO", shares: 5, account: "roth" }, // 2500
    ],
    { AAPL: { price: 200 }, VTI: { price: 250 }, VOO: { price: 500 } },
  );
  const flow = portfolioFlow(rows);
  assert.equal(flow.total, 5500);
  // buckets ordered by value desc: taxable (3000) before roth (2500)
  assert.deepEqual(
    flow.buckets.map((b) => [b.key, b.value]),
    [
      ["taxable", 3000],
      ["roth", 2500],
    ],
  );
  // bucket sums equal the total
  assert.equal(
    flow.buckets.reduce((s, b) => s + b.value, 0),
    flow.total,
  );
  // holdings within a bucket ordered by value desc and labelled
  assert.equal(flow.buckets[0].label, "Taxable");
  assert.deepEqual(
    flow.buckets[0].holdings.map((h) => h.ticker),
    ["AAPL", "VTI"],
  );
});

test("portfolioFlow merges duplicate tickers (two lots) within a bucket", () => {
  const rows = portfolioRows(
    [
      { id: "1", ticker: "AAPL", shares: 10, account: "taxable" }, // 2000
      { id: "2", ticker: "AAPL", shares: 5, account: "taxable" }, // 1000
    ],
    { AAPL: { price: 200 } },
  );
  const flow = portfolioFlow(rows);
  assert.equal(flow.buckets.length, 1);
  assert.equal(flow.buckets[0].holdings.length, 1); // merged
  assert.equal(flow.buckets[0].holdings[0].value, 3000);
});

test("portfolioFlow excludes unpriced holdings and handles an empty portfolio", () => {
  const rows = portfolioRows(
    [
      { id: "1", ticker: "AAPL", shares: 10, account: "taxable" },
      { id: "2", ticker: "NOPRICE", shares: 5, account: "roth" },
    ],
    { AAPL: { price: 200 } },
  );
  const flow = portfolioFlow(rows);
  assert.equal(flow.total, 2000);
  assert.equal(flow.buckets.length, 1); // roth dropped (unpriced)
  assert.deepEqual(portfolioFlow([]), { total: 0, buckets: [] });
});
