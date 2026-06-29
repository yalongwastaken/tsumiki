// prices.test.js — Stooq CSV parsing (the only non-trivial pure part of prices.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStooqCsv, parseFinnhubQuote } from "../lib/prices.js";

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

test("strips a leading BOM from the header so the first column still matches", () => {
  const csv = ["﻿Symbol,Date,Close", "AAPL.US,2026-06-20,200"].join("\n");
  const rows = parseStooqCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "AAPL");
  assert.equal(rows[0].close, 200);
});

test("returns nothing when the close or symbol column is missing", () => {
  assert.deepEqual(parseStooqCsv(["Date,Open,High", "2026-06-20,1,2"].join("\n")), []);
  assert.deepEqual(parseStooqCsv(["Symbol,Date", "AAPL.US,2026-06-20"].join("\n")), []);
});

test("honors quoted fields (commas inside quotes don't shift columns)", () => {
  const csv = ["Symbol,Name,Date,Close", '"AAPL.US","Apple, Inc.",2026-06-20,200'].join("\n");
  const rows = parseStooqCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "AAPL");
  assert.equal(rows[0].close, 200);
});

// ── Finnhub quote JSON (the API-key fallback provider) ──────────────────────────

test("parseFinnhubQuote reads the current price and derives the date from the ts", () => {
  const row = parseFinnhubQuote("aapl", { c: 201.5, t: 1750636800 }); // 2025-06-23 UTC
  assert.equal(row.symbol, "AAPL"); // uppercased
  assert.equal(row.close, 201.5);
  assert.equal(row.date, "2025-06-23");
});

test("parseFinnhubQuote accepts a JSON string too", () => {
  const row = parseFinnhubQuote("MSFT", '{"c":410,"t":1750636800}');
  assert.equal(row.close, 410);
});

test("parseFinnhubQuote returns null for a zero/absent/garbage price", () => {
  assert.equal(parseFinnhubQuote("X", { c: 0 }), null); // Finnhub's "unknown symbol" sentinel
  assert.equal(parseFinnhubQuote("X", { c: -1 }), null);
  assert.equal(parseFinnhubQuote("X", {}), null);
  assert.equal(parseFinnhubQuote("X", "not json"), null);
});

test("parseFinnhubQuote falls back to today's date when the ts is missing", () => {
  const row = parseFinnhubQuote("AAPL", { c: 100 });
  assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("parseFinnhubQuote keeps a valid price even when the ts is out-of-range/garbage", () => {
  // a finite-but-absurd or Infinite ts would make new Date(...).toISOString() throw;
  // the close is valid, so the row must still come back (date falls back to today)
  for (const t of [9e15, Infinity, -9e15]) {
    const row = parseFinnhubQuote("AAPL", { c: 123.45, t });
    assert.equal(row?.close, 123.45);
    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});
