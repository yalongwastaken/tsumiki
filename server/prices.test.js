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

test("strips the exchange suffix but preserves a 1-letter class share", () => {
  const csv = [
    "Symbol,Date,Close",
    "BRK-B.US,2026-06-20,410", // dash form → BRK-B
    "BRK.B,2026-06-20,410", // dotted class share → must stay BRK.B, not BRK
    "VOO.US,2026-06-20,500",
  ].join("\n");
  const rows = parseStooqCsv(csv);
  assert.deepEqual(
    rows.map((r) => r.symbol),
    ["BRK-B", "BRK.B", "VOO"],
  );
});

test("handles CRLF, blank lines, negative/zero closes, and short rows", () => {
  const csv = [
    "Symbol,Date,Open,High,Low,Close,Volume",
    "A.US,2026-06-20,1,2,0,-3,100", // negative close → skipped
    "B.US,2026-06-20,1,2,0,0,100", // zero close → skipped
    "", // blank line
    "C.US,2026-06-20", // too few columns → close NaN → skipped
    "D.US,2026-06-20,1,2,3,9.99,100",
  ].join("\r\n");
  const rows = parseStooqCsv(csv);
  assert.deepEqual(
    rows.map((r) => r.symbol),
    ["D"],
  );
  assert.equal(rows[0].close, 9.99);
});

test("tolerates a header in any column order", () => {
  const csv = ["Close,Symbol,Date", "7.5,AAPL.US,2026-06-20"].join("\n");
  const rows = parseStooqCsv(csv);
  assert.equal(rows[0].symbol, "AAPL");
  assert.equal(rows[0].close, 7.5);
  assert.equal(rows[0].date, "2026-06-20");
});
