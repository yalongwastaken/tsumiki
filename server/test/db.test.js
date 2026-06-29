// db.test.js — DB layer tests: validation + state roundtrip + single-tx append.
// runs against a throwaway SQLite file (node --experimental-sqlite --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TSUMIKI_DB = join(tmpdir(), `tsumiki-test-${Date.now()}.db`);
const {
  putState,
  getState,
  addTransaction,
  validateState,
  validateTransaction,
  resetAll,
  putMeta,
  validateMeta,
  backupStateToFile,
  pruneAutoBackups,
  db,
} = await import("../lib/db.js");
const { readFileSync, readdirSync, writeFileSync, mkdirSync } = await import("node:fs");
const { join: joinPath } = await import("node:path");

test("backupStateToFile writes the current state to a JSON file", () => {
  putState({
    accounts: [{ id: "a", name: "Checking", type: "checking" }],
    transactions: [{ id: "t", type: "spending", amount: 9, date: "2026-06-01" }],
  });
  const file = backupStateToFile("preimport");
  assert.ok(file && file.endsWith(".json"));
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(saved.accounts[0].name, "Checking");
  assert.equal(saved.transactions[0].id, "t");
});

test("pruneAutoBackups keeps the newest N auto files and spares pre-import snapshots", () => {
  // backups live beside the DB, under a "backups" dir (mirrors BACKUP_DIR default)
  const dir = joinPath(process.env.TSUMIKI_DB, "..", "backups");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 35; i++) {
    const stamp = `2026-06-01T00-${String(i).padStart(2, "0")}-00-000Z`;
    writeFileSync(joinPath(dir, `tsumiki-auto-${stamp}.json`), "{}");
  }
  writeFileSync(joinPath(dir, "tsumiki-preimport-2026-06-01T09-00-00-000Z.json"), "{}");
  pruneAutoBackups(30);
  const left = readdirSync(dir);
  assert.equal(left.filter((f) => f.startsWith("tsumiki-auto-")).length, 30); // capped
  assert.ok(left.some((f) => f.startsWith("tsumiki-preimport-"))); // safety snapshot kept
  // the oldest auto files are the ones removed
  assert.ok(!left.includes("tsumiki-auto-2026-06-01T00-00-00-000Z.json"));
  assert.ok(left.includes("tsumiki-auto-2026-06-01T00-34-00-000Z.json"));
});

test("schema migrations stamp user_version (idempotent on a fresh DB)", () => {
  const v = db.prepare("PRAGMA user_version").get().user_version;
  assert.ok(v >= 1, "user_version should be set after migrations run");
});

test("putMeta updates only the blob slices and leaves the ledger intact", () => {
  putState({
    transactions: [{ id: "keep", type: "spending", amount: 5, date: "2026-06-01" }],
    accounts: [{ id: "a1", name: "Checking", type: "checking" }],
    profile: { name: "Old", strategy: "balanced" },
    settings: { theme: "light" },
  });
  const before = getState();
  const out = putMeta({ settings: { theme: "dark" }, profile: { name: "New" } }, before.rev);
  assert.equal(out.settings.theme, "dark");
  assert.equal(out.profile.name, "New");
  // the normalized tables are untouched and the rev advanced
  assert.equal(out.transactions.length, 1);
  assert.equal(out.transactions[0].id, "keep");
  assert.equal(out.accounts.length, 1);
  assert.equal(out.rev, before.rev + 1);
});

test("a transfer round-trips with from/to and appends via addTransaction", () => {
  putState({
    accounts: [
      { id: "a", name: "Checking", type: "checking" },
      { id: "b", name: "Savings", type: "savings" },
    ],
    transactions: [],
  });
  const out = addTransaction({
    id: "tr1",
    type: "transfer",
    amount: 500,
    date: "2026-06-01",
    fromId: "a",
    toId: "b",
  });
  const tr = out.transactions.find((t) => t.id === "tr1");
  assert.equal(tr.type, "transfer");
  assert.equal(tr.fromId, "a");
  assert.equal(tr.toId, "b");
});

test("validateTransaction accepts a transfer type", () => {
  assert.equal(
    validateTransaction({
      id: "x",
      type: "transfer",
      amount: 100,
      date: "2026-06-01",
      fromId: "a",
      toId: "b",
    }),
    null,
  );
});

test("a transfer needs two distinct accounts (rejected otherwise)", () => {
  const ok = { id: "x", type: "transfer", amount: 100, date: "2026-06-01", fromId: "a", toId: "b" };
  assert.equal(validateTransaction(ok), null);
  assert.ok(validateTransaction({ ...ok, toId: "a" })); // same account
  assert.ok(validateTransaction({ ...ok, toId: null })); // missing endpoint
  // full-state PUT rejects a malformed transfer too
  assert.ok(validateState({ transactions: [{ ...ok, toId: "a" }] }));
});

test("validateMeta accepts blob slices, rejects junk + bad tickers", () => {
  assert.equal(validateMeta({ settings: { theme: "dark" } }), null);
  assert.equal(validateMeta({ profile: { name: "x" }, holdings: [] }), null);
  assert.ok(validateMeta(null));
  assert.ok(validateMeta({ settings: "nope" }));
  assert.ok(validateMeta({ holdings: "nope" }));
  assert.ok(validateMeta({ holdings: [{ id: "h", ticker: "BAD TICKER!" }] }));
});

test("validateState rejects malformed bodies", () => {
  assert.ok(validateState({ transactions: [{ id: "x", type: "bogus", amount: 1, date: "d" }] }));
  assert.ok(validateState({ accounts: [{ id: "a", type: "checking" }] })); // no name
  assert.ok(validateState({ goals: "nope" }));
  // numeric columns must be finite numbers, not strings/missing (would throw raw SQLite errors)
  assert.ok(validateState({ debts: [{ id: "d", name: "Card", balance: "lots" }] }));
  assert.ok(validateState({ debts: [{ id: "d", name: "Card" }] })); // missing balance
  assert.ok(validateState({ goals: [{ id: "g", name: "Trip", target: null }] }));
  // a ticker is interpolated into the price-feed URL → reject non-symbol charsets
  assert.ok(validateState({ holdings: [{ id: "h", ticker: "evil&x=1", shares: 1 }] }));
  assert.ok(validateState({ holdings: [{ id: "h", ticker: "a b", shares: 1 }] }));
  assert.equal(validateState({ holdings: [{ id: "h", ticker: "BRK.B", shares: 1 }] }), null);
  assert.equal(validateState({ holdings: [{ id: "h", ticker: "^GSPC", shares: 1 }] }), null);
  // optional uninvested cash on an investment account must be a finite number if present
  assert.ok(
    validateState({ accounts: [{ id: "a", name: "Brk", type: "brokerage", cash: "lots" }] }),
  );
  assert.equal(
    validateState({ accounts: [{ id: "a", name: "Brk", type: "brokerage", cash: 250 }] }),
    null,
  );
  // a garbage date would persist and skew month/streak/forecast math
  assert.ok(
    validateState({ transactions: [{ id: "x", type: "income", amount: 5, date: "not-a-date" }] }),
  );
  // a roll-over-invalid calendar date (Feb 30) is rejected, not silently shifted to Mar 1
  assert.ok(
    validateState({ transactions: [{ id: "x", type: "income", amount: 5, date: "2024-02-30" }] }),
  );
  assert.equal(
    validateState({ transactions: [{ id: "x", type: "income", amount: 5, date: "2024-02-29" }] }),
    null, // 2024 is a leap year — the 29th is real
  );
  assert.equal(validateState({ debts: [{ id: "d", name: "Card", balance: 1000, apr: 20 }] }), null);
  assert.equal(validateState({ goals: [{ id: "g", name: "Trip", target: 5000 }] }), null);
  assert.equal(
    validateState({ transactions: [{ id: "x", type: "income", amount: 5, date: "2026-01-01" }] }),
    null,
  );
});

test("validateTransaction guards type/amount/id/date", () => {
  assert.ok(validateTransaction({ type: "income", amount: 5, date: "2026-01-01" })); // no id
  assert.ok(validateTransaction({ id: "x", type: "nope", amount: 5, date: "2026-01-01" }));
  assert.ok(validateTransaction({ id: "x", type: "income", amount: NaN, date: "2026-01-01" }));
  assert.ok(validateTransaction({ id: "x", type: "income", amount: 5, date: "garbage" })); // bad date
  assert.equal(
    validateTransaction({ id: "x", type: "income", amount: 5, date: "2026-01-01" }),
    null,
  );
});

test("putState round-trips and bumps rev", () => {
  const s = putState({
    accounts: [{ id: "chk", name: "Checking", type: "checking" }],
    transactions: [],
    profile: { name: "Sam" },
  });
  assert.equal(s.accounts[0].name, "Checking");
  assert.equal(s.profile.name, "Sam");
  const rev0 = s.rev;
  const s2 = putState({ ...s });
  assert.equal(s2.rev, rev0 + 1);
});

test("snapshot source tag round-trips (manual vs holdings-auto)", () => {
  const s = putState({
    accounts: [{ id: "brk", name: "Brokerage", type: "brokerage" }],
    snapshots: [
      { id: "m1", accountId: "brk", date: "2026-06-01T00:00:00Z", balance: 100 }, // manual (no source)
      {
        id: "h1",
        accountId: "brk",
        date: "2026-06-02T00:00:00Z",
        balance: 2500,
        source: "holdings",
      },
    ],
    transactions: [],
  });
  const byId = Object.fromEntries(s.snapshots.map((x) => [x.id, x]));
  assert.equal(byId.m1.source ?? null, null); // manual stays untagged
  assert.equal(byId.h1.source, "holdings"); // auto-valued tag survives the round-trip
});

test("addTransaction appends one row and bumps rev", () => {
  const before = getState();
  const after = addTransaction({
    id: "t" + Date.now(),
    type: "income",
    amount: 2000,
    date: "2026-06-01T00:00:00Z",
    sourceId: "job",
  });
  assert.equal(after.transactions.length, before.transactions.length + 1);
  assert.equal(after.rev, before.rev + 1);
});

test("resetAll wipes data and restores defaults, bumping rev", () => {
  putState({
    accounts: [{ id: "a", name: "A", type: "checking" }],
    transactions: [{ id: "z", type: "income", amount: 5, date: "2026-01-01" }],
    profile: { name: "Sam", strategy: "long_term" },
  });
  const before = getState();
  const fresh = resetAll();
  assert.equal(fresh.accounts.length, 0);
  assert.equal(fresh.transactions.length, 0);
  assert.equal(fresh.profile.name, ""); // back to DEFAULT_PROFILE
  assert.equal(fresh.settings.onboarded, false); // onboarding shows again
  assert.equal(fresh.rev, before.rev + 1);
});
