// Tests for the DB layer: validation + state roundtrip + single-tx append.
// Runs against a throwaway SQLite file (node --experimental-sqlite --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TSUMIKI_DB = join(tmpdir(), `tsumiki-test-${Date.now()}.db`);
const { putState, getState, addTransaction, validateState, validateTransaction } = await import("./db.js");

test("validateState rejects malformed bodies", () => {
  assert.ok(validateState({ transactions: [{ id: "x", type: "bogus", amount: 1, date: "d" }] }));
  assert.ok(validateState({ accounts: [{ id: "a", type: "checking" }] })); // no name
  assert.ok(validateState({ goals: "nope" }));
  assert.equal(validateState({ transactions: [{ id: "x", type: "income", amount: 5, date: "2026-01-01" }] }), null);
});

test("validateTransaction guards type/amount/id/date", () => {
  assert.ok(validateTransaction({ type: "income", amount: 5, date: "d" })); // no id
  assert.ok(validateTransaction({ id: "x", type: "nope", amount: 5, date: "d" }));
  assert.ok(validateTransaction({ id: "x", type: "income", amount: NaN, date: "d" }));
  assert.equal(validateTransaction({ id: "x", type: "income", amount: 5, date: "d" }), null);
});

test("putState round-trips and bumps rev", () => {
  const s = putState({ accounts: [{ id: "chk", name: "Checking", type: "checking" }], transactions: [], profile: { name: "Sam" } });
  assert.equal(s.accounts[0].name, "Checking");
  assert.equal(s.profile.name, "Sam");
  const rev0 = s.rev;
  const s2 = putState({ ...s });
  assert.equal(s2.rev, rev0 + 1);
});

test("addTransaction appends one row and bumps rev", () => {
  const before = getState();
  const after = addTransaction({ id: "t" + Date.now(), type: "income", amount: 2000, date: "2026-06-01T00:00:00Z", sourceId: "job" });
  assert.equal(after.transactions.length, before.transactions.length + 1);
  assert.equal(after.rev, before.rev + 1);
});
