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
const { putState, getState, appendPortfolioPoint, getPortfolioHistory, getSymbolPriceHistory } =
  await import("../lib/db.js");

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

// ── richer export / import (history blobs survive a backup-restore cycle) ────────

test("GET /api/export includes the history blobs; import restores them", async () => {
  seed();
  appendPortfolioPoint(1234, new Date());
  const exported = (await api("GET", "/api/export")).body;
  assert.ok(Array.isArray(exported.portfolioHistory), "export has portfolioHistory");
  assert.equal(exported.portfolioHistory.at(-1).value, 1234);
  assert.ok(exported.symbolPriceHistory && typeof exported.symbolPriceHistory === "object");
  // GET /api/state (the client boot payload) does NOT carry the blobs
  assert.equal((await api("GET", "/api/state")).body.portfolioHistory, undefined);

  // wipe, then import the export → the portfolio chart comes back
  await api("POST", "/api/reset");
  assert.equal(getPortfolioHistory().length, 0);
  const imp = await api("POST", "/api/import", {
    ...exported,
    symbolPriceHistory: { AAPL: [{ date: "2026-06-01", price: 100 }] },
  });
  assert.equal(imp.status, 200);
  assert.equal(getPortfolioHistory().at(-1).value, 1234);
  assert.equal(getSymbolPriceHistory().AAPL[0].price, 100);
});

test("import rejects malformed history blobs", async () => {
  const bad = await api("POST", "/api/import", {
    portfolioHistory: [{ date: "2026-06-01", value: "lots" }],
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /portfolioHistory/);
});

// ── /api/plan?date=YYYY-MM-DD (plan for a future/past day) ───────────────────────

test("GET /api/plan?date plans for that day's month and year", async () => {
  putState({
    accounts: [{ id: "chk", name: "Checking", type: "checking" }],
    transactions: [
      { id: "c1", type: "contribution", bucket: "retirement", amount: 3000, date: "2025-03-01" },
    ],
    profile: { strategy: "balanced", checkingFloor: 0 },
  });
  // planned within 2025 → the 2025 contribution counts, 2025 caps apply
  const p25 = (await api("GET", "/api/plan?income=1000&date=2025-12-31")).body;
  assert.equal(p25.asOf, "2025-12-31");
  assert.equal(p25.context.ytdRetirement, 3000);
  assert.equal(p25.context.limitsYear, 2025);
  assert.equal(p25.context.iraLimit, 7000);
  // planned in 2026 → last year's contribution is out, 2026 caps apply
  const p26 = (await api("GET", "/api/plan?income=1000&date=2026-06-15")).body;
  assert.equal(p26.context.ytdRetirement, 0);
  assert.equal(p26.context.limitsYear, 2026);
  // a year beyond the table falls back to the latest known caps (and says so)
  const pFar = (await api("GET", "/api/plan?income=1000&date=2031-01-01")).body;
  assert.equal(pFar.context.limitsYear, 2026);
  // no date → today, asOf null
  assert.equal((await api("GET", "/api/plan?income=1000")).body.asOf, null);
});

test("GET /api/plan rejects a malformed or roll-over date", async () => {
  assert.equal((await api("GET", "/api/plan?date=garbage")).status, 400);
  assert.equal((await api("GET", "/api/plan?date=2026-6-1")).status, 400);
  assert.equal((await api("GET", "/api/plan?date=2026-02-30")).status, 400); // Feb 30
  assert.equal((await api("GET", "/api/plan?date=2026-02-28")).status, 200);
});

// ── per-entity granular writes (PATCH/DELETE /api/{accounts,debts,goals}/:id) ────

test("PATCH /api/accounts/:id inserts a new account and bumps the rev", async () => {
  seed();
  const rev = getState().rev;
  const { status, body } = await api("PATCH", "/api/accounts/sav", {
    name: "Savings",
    type: "savings",
    rev,
  });
  assert.equal(status, 200);
  assert.equal(body.rev, rev + 1);
  assert.ok(body.accounts.some((a) => a.id === "sav" && a.name === "Savings"));
  assert.equal(body.transactions.length, 1); // the ledger wasn't rewritten
});

test("PATCH /api/accounts/:id updates in place WITHOUT cascading snapshots", async () => {
  putState({
    accounts: [{ id: "chk", name: "Checking", type: "checking" }],
    snapshots: [{ id: "s1", accountId: "chk", date: "2026-06-01", balance: 500 }],
  });
  const rev = getState().rev;
  const { status, body } = await api("PATCH", "/api/accounts/chk", {
    name: "Main checking",
    type: "checking",
    color: "#123456",
    rev,
  });
  assert.equal(status, 200);
  assert.equal(body.accounts.find((a) => a.id === "chk").name, "Main checking");
  // the critical bit: an upsert must not DELETE+INSERT (which would FK-cascade
  // away the account's snapshot history)
  assert.equal(body.snapshots.length, 1);
  assert.equal(body.snapshots[0].balance, 500);
});

test("per-entity writes are rev-checked like every other write", async () => {
  seed();
  const rev = getState().rev;
  const stale = await api("PATCH", "/api/debts/d1", {
    name: "Card",
    balance: 100,
    rev: rev - 1,
  });
  assert.equal(stale.status, 409);
  const noRev = await api("PATCH", "/api/goals/g1", { name: "Trip", target: 500 });
  assert.equal(noRev.status, 409);
  const badItem = await api("PATCH", "/api/debts/d1", { name: "Card", balance: "lots", rev });
  assert.equal(badItem.status, 400);
});

test("PATCH upserts a debt and a goal (defaults filled)", async () => {
  seed();
  let rev = getState().rev;
  const debt = await api("PATCH", "/api/debts/card", { name: "Card", balance: 900, rev });
  assert.equal(debt.status, 200);
  assert.deepEqual(
    debt.body.debts.find((d) => d.id === "card"),
    { id: "card", name: "Card", balance: 900, apr: 0, minPayment: 0 },
  );
  rev = debt.body.rev;
  const goal = await api("PATCH", "/api/goals/trip", { name: "Trip", target: 2500, rev });
  assert.equal(goal.status, 200);
  assert.equal(goal.body.goals.find((g) => g.id === "trip").pledge, 0); // default
});

test("DELETE /api/accounts/:id removes it (snapshots cascade) with ?rev=", async () => {
  putState({
    accounts: [{ id: "chk", name: "Checking", type: "checking" }],
    snapshots: [{ id: "s1", accountId: "chk", date: "2026-06-01", balance: 500 }],
  });
  const rev = getState().rev;
  const { status, body } = await fetch(`${base}/api/accounts/chk?rev=${rev}`, {
    method: "DELETE",
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal(status, 200);
  assert.equal(body.accounts.length, 0);
  assert.equal(body.snapshots.length, 0); // deliberate cascade on explicit delete
  assert.equal(body.rev, rev + 1);
});

test("DELETE of a missing id → 404 and no rev burn; missing rev → 409", async () => {
  seed();
  const rev = getState().rev;
  const gone = await api("DELETE", `/api/goals/nope?rev=${rev}`);
  assert.equal(gone.status, 404);
  assert.equal(getState().rev, rev); // nothing changed, no rev bump
  const noRev = await api("DELETE", "/api/goals/nope");
  assert.equal(noRev.status, 409);
});
