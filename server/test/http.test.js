// http.test.js — HTTP-level route tests: the express app on an ephemeral listener,
// exercised with node's fetch (no supertest). Covers the destructive-route guards
// (migrate/reset) and the rev requirement on client-facing writes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { readdirSync } from "node:fs";

process.env.TSUMIKI_DB = join(tmpdir(), `tsumiki-http-${process.pid}-${Date.now()}.db`);
const BACKUP_DIR = join(dirname(process.env.TSUMIKI_DB), "backups");

// import AFTER env is set (index.js only listens when run directly, so this is safe)
const { app } = await import("../index.js");
const { putState, getState } = await import("../lib/db.js");

let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const api = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};
const backupsMatching = (label) => {
  try {
    return readdirSync(BACKUP_DIR).filter((f) => f.startsWith(`tsumiki-${label}-`));
  } catch {
    return [];
  }
};

const seed = () =>
  putState({
    accounts: [{ id: "chk", name: "Checking", type: "checking" }],
    transactions: [{ id: "t1", type: "income", amount: 100, date: "2026-06-01" }],
    profile: { name: "Sam" },
  });

test("GET /api/state returns the seeded model", async () => {
  seed();
  const { status, body } = await api("GET", "/api/state");
  assert.equal(status, 200);
  assert.equal(body.accounts[0].name, "Checking");
  assert.ok(Number.isInteger(body.rev));
});

test("PUT /api/state without a rev → 409 with the fresh state, nothing written", async () => {
  seed();
  const before = getState();
  const { status, body } = await api("PUT", "/api/state", {
    accounts: [],
    transactions: [], // a rev-less full wipe must NOT go through
  });
  assert.equal(status, 409);
  assert.match(body.error, /rev/);
  assert.equal(body.state.rev, before.rev); // fresh state handed back for a re-sync
  assert.equal(getState().transactions.length, 1); // ledger untouched
});

test("PUT /api/state with a stale rev → 409; with the current rev → 200 and a bump", async () => {
  seed();
  const cur = getState();
  const stale = await api("PUT", "/api/state", { ...cur, rev: cur.rev - 1 });
  assert.equal(stale.status, 409);
  const ok = await api("PUT", "/api/state", { ...cur, rev: cur.rev });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.rev, cur.rev + 1);
});

test("PATCH /api/state requires a rev too (granular meta write)", async () => {
  seed();
  const noRev = await api("PATCH", "/api/state", { settings: { theme: "dark" } });
  assert.equal(noRev.status, 409);
  const cur = getState();
  const ok = await api("PATCH", "/api/state", { settings: { theme: "dark" }, rev: cur.rev });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.settings.theme, "dark");
});

test("POST /api/migrate refuses to replace existing transactions without force", async () => {
  seed();
  const { status, body } = await api("POST", "/api/migrate", {
    expenses: [{ id: 1, cat: "Food", amount: 10, date: "2026-06-01" }],
  });
  assert.equal(status, 409);
  assert.match(body.error, /force/);
  assert.equal(getState().transactions[0].id, "t1"); // data untouched
});

test("POST /api/migrate with force:true snapshots first, then replaces", async () => {
  seed();
  const beforeBackups = backupsMatching("premigrate").length;
  const { status, body } = await api("POST", "/api/migrate", {
    expenses: [{ id: 9, cat: "Food", amount: 10, date: "2026-06-01" }],
    force: true,
  });
  assert.equal(status, 200);
  assert.equal(backupsMatching("premigrate").length, beforeBackups + 1); // pre-backup written
  assert.ok(body.backedUpTo, "response reports where the snapshot went");
  assert.equal(body.transactions.length, 1);
  assert.equal(body.transactions[0].type, "spending"); // migrated shape
});

test("POST /api/migrate on an empty dataset needs no force", async () => {
  await api("POST", "/api/reset"); // empty the DB first
  const { status } = await api("POST", "/api/migrate", {
    contributions: [{ id: 1, goalId: "g", amount: 50, date: "2026-06-01" }],
  });
  assert.equal(status, 200);
  assert.equal(getState().transactions.length, 1);
});

test("POST /api/reset snapshots the data before wiping", async () => {
  seed();
  const beforeBackups = backupsMatching("prereset").length;
  const { status, body } = await api("POST", "/api/reset");
  assert.equal(status, 200);
  assert.equal(body.transactions.length, 0); // wiped
  assert.equal(backupsMatching("prereset").length, beforeBackups + 1); // snapshot first
  assert.ok(body.backedUpTo);
});

test("POST /api/transactions still appends without a rev (append-only, no clobber risk)", async () => {
  seed();
  const { status, body } = await api("POST", "/api/transactions", {
    id: "t2",
    type: "spending",
    amount: 12,
    date: "2026-06-02",
  });
  assert.equal(status, 200);
  assert.equal(body.transactions.length, 2);
});

test("cross-origin writes are still rejected (guard untouched)", async () => {
  const res = await fetch(`${base}/api/reset`, {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(res.status, 403);
});
