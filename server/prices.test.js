// prices.test.js — Stooq CSV parsing (the only non-trivial pure part of prices.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStooqCsv } from "./prices.js";

test("parses closes and strips the exchange suffix", () => {
  const csv = [
    "Symbol,Date,Open,High,Low,Close,Volume",
    "AAPL.US,2026-06-20,198,201,197,200.12,1000",
    "VTI.US,2026-06-20,249,251,248,250.4,500",
  ].join("\n");
  const rows = parseStooqCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].symbol, "AAPL"); // .US stripped
  assert.equal(rows[0].close, 200.12);
  assert.equal(rows[0].date, "2026-06-20");
});

test("skips bad/unknown rows (N/D close) and junk", () => {
  const csv = ["Symbol,Date,Close", "BAD.US,N/D,N/D", "GOOD.US,2026-06-20,12.5"].join("\n");
  const rows = parseStooqCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "GOOD");
  assert.deepEqual(parseStooqCsv(""), []);
});
