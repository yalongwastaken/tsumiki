// csv.test.mjs — CSV parsing + bank-statement → transaction mapping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, guessMapping, rowsToTransactions, dedupeAgainst } from "../src/lib/csv.js";

test("parseCsv handles quotes, escaped quotes, and commas in fields", () => {
  const text =
    'Date,Description,Amount\n2026-06-01,"Coffee, large",-4.50\n2026-06-02,"He said ""hi""",12';
  const { headers, rows } = parseCsv(text);
  assert.deepEqual(headers, ["Date", "Description", "Amount"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], "Coffee, large"); // comma inside quotes preserved
  assert.equal(rows[1][1], 'He said "hi"'); // escaped quotes
});

test("parseCsv tolerates CRLF and trailing blank lines", () => {
  const { headers, rows } = parseCsv("a,b\r\n1,2\r\n\r\n");
  assert.deepEqual(headers, ["a", "b"]);
  assert.equal(rows.length, 1);
});

test("guessMapping finds date/amount/description columns by name", () => {
  const m = guessMapping(["Posted Date", "Merchant Name", "Amount"]);
  assert.equal(m.date, 0);
  assert.equal(m.description, 1);
  assert.equal(m.amount, 2);
});

test("rowsToTransactions: negative = spending, positive = income", () => {
  const rows = [
    ["2026-06-01", "Coffee", "-4.50"],
    ["2026-06-02", "Paycheck", "2000"],
    ["bad", "x", "10"], // unparseable date → skipped
    ["2026-06-03", "Zero", "0"], // zero → skipped
  ];
  const txs = rowsToTransactions(rows, { date: 0, description: 1, amount: 2 });
  assert.equal(txs.length, 2);
  assert.equal(txs[0].type, "spending");
  assert.equal(txs[0].amount, 4.5);
  assert.equal(txs[0].note, "Coffee");
  assert.equal(txs[0].cat, "Imported");
  assert.equal(txs[1].type, "income");
  assert.equal(txs[1].amount, 2000);
});

test("rowsToTransactions: invert flips the sign convention", () => {
  const rows = [["2026-06-01", "Rent", "1500"]]; // bank lists expense as positive
  const txs = rowsToTransactions(rows, { date: 0, description: 1, amount: 2 }, { invert: true });
  assert.equal(txs[0].type, "spending");
  assert.equal(txs[0].amount, 1500);
});

test("rowsToTransactions strips currency symbols and thousands separators", () => {
  const rows = [["2026-06-01", "Big buy", "-$1,234.56"]];
  const txs = rowsToTransactions(rows, { date: 0, description: 1, amount: 2 });
  assert.equal(txs[0].amount, 1234.56);
});

test("dedupeAgainst drops rows matching existing txs and within the batch", () => {
  const existing = [
    { type: "spending", amount: 4.5, note: "Coffee", date: "2026-06-01T00:00:00.000Z" },
  ];
  const incoming = [
    { type: "spending", amount: 4.5, note: "Coffee", date: "2026-06-01T09:00:00.000Z" }, // dup of existing (same day)
    { type: "spending", amount: 12, note: "Lunch", date: "2026-06-02T00:00:00.000Z" }, // new
    { type: "spending", amount: 12, note: "Lunch", date: "2026-06-02T00:00:00.000Z" }, // dup within batch
  ];
  const { kept, skipped } = dedupeAgainst(incoming, existing);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].note, "Lunch");
  assert.equal(skipped, 2);
});

test("rowsToTransactions reads accounting parentheses as negative (spending)", () => {
  const rows = [
    ["2026-06-01", "Refund out", "(50.00)"],
    ["2026-06-02", "Deposit", "100.00"],
  ];
  const txs = rowsToTransactions(rows, { date: 0, description: 1, amount: 2 });
  assert.equal(txs[0].type, "spending"); // (50.00) must NOT become income
  assert.equal(txs[0].amount, 50);
  assert.equal(txs[1].type, "income");
});
