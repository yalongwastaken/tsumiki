// db.js — SQLite schema + accessors for the unified data model.
// Single-user, single SQLite file. Uses Node's built-in node:sqlite — no native
// build step, nothing to compile on the mini PC. (Run node with --experimental-sqlite.)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.TSUMIKI_DB || join(__dirname, "data", "tsumiki.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    type  TEXT NOT NULL,            -- checking | savings | brokerage | ira | other
    color TEXT
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id         TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,       -- ISO string
    balance    REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS goals (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    target      REAL NOT NULL,
    pledge      REAL NOT NULL DEFAULT 0,
    color       TEXT,
    target_date TEXT                -- optional ISO date; enables pace math later
  );

  CREATE TABLE IF NOT EXISTS debts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    balance     REAL NOT NULL,
    apr         REAL NOT NULL DEFAULT 0,
    min_payment REAL NOT NULL DEFAULT 0
  );

  -- one unified ledger: income | spending | contribution
  CREATE TABLE IF NOT EXISTS transactions (
    id        TEXT PRIMARY KEY,
    type      TEXT NOT NULL,        -- income | spending | contribution
    amount    REAL NOT NULL,
    date      TEXT NOT NULL,        -- ISO string
    note      TEXT,
    cat       TEXT,                 -- for spending
    goal_id   TEXT,                 -- legacy contribution target (folds into invest)
    source_id TEXT,                 -- for income (which income source it came from)
    bucket    TEXT                  -- for contribution: emergency|retirement|invest|debt
  );
  CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
  CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);

  -- flexible JSON blobs for the evolving profile + settings
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL             -- JSON
  );
`);

// migrate older DBs that predate source_id
{
  const cols = db
    .prepare("PRAGMA table_info(transactions)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("source_id")) {
    db.exec("ALTER TABLE transactions ADD COLUMN source_id TEXT");
  }
  if (!cols.includes("bucket")) {
    db.exec("ALTER TABLE transactions ADD COLUMN bucket TEXT");
  }
}

// ── defaults ────────────────────────────────────────────────────────────────
const DEFAULT_PROFILE = {
  name: "",
  birthYear: null,
  retireAge: 65,
  incomeType: "salary",
  typicalIncome: null,
  checkingFloor: 0,
  emergencyTarget: 0,
  employerMatch: null,
  retirementLimits: null,
  strategy: "balanced",
  customRules: null,
  incomeSources: [], // [{ id, name, type, typicalMonthly }] — replaces single income field
  moneyTargets: [], // [{ id, label, amount, metric }] — user-defined game goals
  bills: [], // [{ id, name, amount }] — recurring essentials (inform-only)
};
const DEFAULT_SETTINGS = {
  returnRate: 0.07,
  monthlyInvest: null,
  streakFreezes: 2,
  onboarded: false,
  theme: "light",
};

/** Read a JSON blob from the meta table, or `fallback` if absent. */
function getMeta(key, fallback) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}

/** Upsert a JSON blob into the meta table. */
function setMeta(key, obj) {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(obj));
}

// ── optimistic-concurrency rev (guards against two tabs clobbering) ───────────
function getRev() {
  return getMeta("rev", 0);
}

// ── lightweight validation: reject obviously malformed PUTs ───────────────────
const TX_TYPES = new Set(["income", "spending", "contribution"]);

/**
 * Validate a full-state PUT body.
 * @returns {string|null} an error message, or null when valid
 */
export function validateState(s) {
  if (!s || typeof s !== "object") {
    return "body must be an object";
  }
  for (const k of ["accounts", "snapshots", "goals", "debts", "transactions", "holdings"]) {
    if (s[k] != null && !Array.isArray(s[k])) {
      return `${k} must be an array`;
    }
  }
  for (const h of s.holdings || []) {
    if (!h?.id || !h?.ticker) {
      return "holding needs an id and ticker";
    }
    if (typeof h.shares !== "number" || !isFinite(h.shares)) {
      return "holding.shares must be a finite number";
    }
  }
  for (const a of s.accounts || []) {
    if (!a?.id || !a?.type) {
      return "account needs an id and type";
    }
    if (!a.name || !String(a.name).trim()) {
      return "account needs a name";
    }
  }
  for (const t of s.transactions || []) {
    if (!TX_TYPES.has(t?.type)) {
      return `bad transaction type: ${t?.type}`;
    }
    if (typeof t.amount !== "number" || !isFinite(t.amount)) {
      return "transaction.amount must be a finite number";
    }
  }
  for (const sn of s.snapshots || []) {
    if (!sn?.accountId) {
      return "snapshot needs an accountId";
    }
    if (typeof sn.balance !== "number" || !isFinite(sn.balance)) {
      return "snapshot.balance must be a finite number";
    }
  }
  for (const d of s.debts || []) {
    if (!d?.id || !d?.name) {
      return "debt needs an id and name";
    }
  }
  return null; // ok
}

/**
 * Validate a single appended transaction.
 * @returns {string|null} an error message, or null when valid
 */
export function validateTransaction(t) {
  if (!t || typeof t !== "object") {
    return "transaction must be an object";
  }
  if (!t.id) {
    return "transaction needs an id";
  }
  if (!TX_TYPES.has(t.type)) {
    return `bad transaction type: ${t.type}`;
  }
  if (typeof t.amount !== "number" || !isFinite(t.amount)) {
    return "transaction.amount must be a finite number";
  }
  if (!t.date) {
    return "transaction needs a date";
  }
  return null;
}

/**
 * Append a single transaction (cheaper than re-sending the whole state) and
 * bump the concurrency rev. Wrapped in a transaction.
 * @returns {Object} the fresh full state
 */
export function addTransaction(t) {
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO transactions(id,type,amount,date,note,cat,goal_id,source_id,bucket) VALUES(@id,@type,@amount,@date,@note,@cat,@goalId,@sourceId,@bucket)",
    ).run({ note: null, cat: null, goalId: null, sourceId: null, bucket: null, ...t });
    setMeta("rev", getRev() + 1);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

// ── full state assembly (what GET /api/state returns) ─────────────────────────
/** Assemble the full unified model from the normalized tables. */
export function getState() {
  return {
    rev: getRev(),
    accounts: db.prepare("SELECT id, name, type, color FROM accounts").all(),
    snapshots: db
      .prepare("SELECT id, account_id AS accountId, date, balance FROM snapshots ORDER BY date")
      .all(),
    goals: db
      .prepare("SELECT id, name, target, pledge, color, target_date AS targetDate FROM goals")
      .all(),
    debts: db.prepare("SELECT id, name, balance, apr, min_payment AS minPayment FROM debts").all(),
    transactions: db
      .prepare(
        "SELECT id, type, amount, date, note, cat, goal_id AS goalId, source_id AS sourceId, bucket FROM transactions ORDER BY date",
      )
      .all(),
    holdings: getMeta("holdings", []), // [{ id, ticker, shares, costBasis }] — manually entered
    profile: getMeta("profile", DEFAULT_PROFILE),
    settings: getMeta("settings", DEFAULT_SETTINGS),
  };
}

// ── full state replace (pragmatic bridge for v1; PUT /api/state) ──────────────
// Data lives in real normalized tables; the client keeps its simple "save the
// whole model" pattern. Granular endpoints can replace this later.
/** Wipe and re-insert every table from a full-state object (no transaction here). */
function replaceAll(state) {
  db.prepare("DELETE FROM snapshots").run();
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM accounts").run();
  db.prepare("DELETE FROM goals").run();
  db.prepare("DELETE FROM debts").run();

  const ins = {
    account: db.prepare("INSERT INTO accounts(id,name,type,color) VALUES(@id,@name,@type,@color)"),
    snapshot: db.prepare(
      "INSERT INTO snapshots(id,account_id,date,balance) VALUES(@id,@accountId,@date,@balance)",
    ),
    goal: db.prepare(
      "INSERT INTO goals(id,name,target,pledge,color,target_date) VALUES(@id,@name,@target,@pledge,@color,@targetDate)",
    ),
    debt: db.prepare(
      "INSERT INTO debts(id,name,balance,apr,min_payment) VALUES(@id,@name,@balance,@apr,@minPayment)",
    ),
    tx: db.prepare(
      "INSERT INTO transactions(id,type,amount,date,note,cat,goal_id,source_id,bucket) VALUES(@id,@type,@amount,@date,@note,@cat,@goalId,@sourceId,@bucket)",
    ),
  };

  for (const a of state.accounts || []) {
    ins.account.run({ color: null, ...a });
  }
  for (const s of state.snapshots || []) {
    ins.snapshot.run(s);
  }
  for (const g of state.goals || []) {
    ins.goal.run({ color: null, targetDate: null, pledge: 0, ...g });
  }
  for (const d of state.debts || []) {
    ins.debt.run({ apr: 0, minPayment: 0, ...d });
  }
  for (const t of state.transactions || []) {
    ins.tx.run({ note: null, cat: null, goalId: null, sourceId: null, bucket: null, ...t });
  }

  if (state.profile) {
    setMeta("profile", state.profile);
  }
  if (state.settings) {
    setMeta("settings", state.settings);
  }
  if (state.holdings) {
    setMeta("holdings", state.holdings);
  }
}

// node:sqlite has no .transaction() helper — wrap manually so a bad PUT can't
// leave the tables half-written. `expectedRev` enables optimistic concurrency:
// if the caller's rev is stale, we refuse rather than clobber a newer write.
export class ConflictError extends Error {}

/**
 * Replace the full state inside a transaction, bumping the rev.
 * @param {number} [expectedRev] - if set and stale, throws ConflictError (optimistic concurrency)
 * @returns {Object} the fresh full state
 */
export function putState(state, expectedRev) {
  if (expectedRev != null && Number(expectedRev) !== getRev()) {
    throw new ConflictError("state changed since you loaded it");
  }
  db.exec("BEGIN");
  try {
    replaceAll(state);
    setMeta("rev", getRev() + 1);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

/**
 * Erase everything — all rows + the saved profile/settings — and start fresh.
 * Profile/settings fall back to defaults, so onboarding shows again.
 * @returns {Object} the fresh (empty) state
 */
export function resetAll() {
  db.exec("BEGIN");
  try {
    for (const t of ["snapshots", "transactions", "accounts", "goals", "debts"]) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    db.prepare("DELETE FROM meta WHERE key IN ('profile', 'settings', 'holdings')").run();
    setMeta("rev", getRev() + 1);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

export { DEFAULT_PROFILE, DEFAULT_SETTINGS };
