// db.js — SQLite schema + accessors for the unified data model.
// Single-user, single SQLite file. Uses Node's built-in node:sqlite — no native
// build step, nothing to compile on the mini PC. (Run node with --experimental-sqlite.)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";

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
    type  TEXT NOT NULL,            -- checking | savings | credit | brokerage | ira | roth | 401k | other
    color TEXT,
    cash  REAL                      -- uninvested cash in an investment account (null otherwise)
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id         TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,       -- ISO string
    balance    REAL NOT NULL,
    source     TEXT                 -- null = manual; "holdings" = auto-valued from a linked holding
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

  -- one unified ledger: income | spending | contribution | transfer
  CREATE TABLE IF NOT EXISTS transactions (
    id        TEXT PRIMARY KEY,
    type      TEXT NOT NULL,        -- income | spending | contribution | transfer
    amount    REAL NOT NULL,
    date      TEXT NOT NULL,        -- ISO string
    note      TEXT,
    cat       TEXT,                 -- for spending
    goal_id   TEXT,                 -- legacy contribution target (folds into invest)
    source_id TEXT,                 -- for income (which income source it came from)
    bucket    TEXT,                 -- for contribution: emergency|retirement|invest|debt
    from_id   TEXT,                 -- for transfer: account moved FROM
    to_id     TEXT                  -- for transfer: account moved TO
  );
  CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
  CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);

  -- flexible JSON blobs for the evolving profile + settings
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL             -- JSON
  );
`);

// ── schema migrations (versioned via PRAGMA user_version) ─────────────────────
// The CREATE TABLE statements above define the latest schema for a FRESH DB; the
// ordered migrations below bring an OLDER DB up to date (and double as a record of how
// the schema evolved). Each is idempotent; we run only those past the stored version,
// each in its own transaction, then stamp user_version.
function columnsOf(table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}
function addColumn(table, col, decl) {
  if (!columnsOf(table).includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
  }
}
const MIGRATIONS = [
  // 1 → columns accreted across v1.x: transactions.source_id/bucket, snapshots.source,
  //     accounts.cash. Idempotent so DBs created before user_version was tracked converge.
  () => {
    addColumn("transactions", "source_id", "TEXT");
    addColumn("transactions", "bucket", "TEXT");
    addColumn("snapshots", "source", "TEXT");
    addColumn("accounts", "cash", "REAL");
  },
  // 2 → account-transfer ledger entries (money moved between your own accounts)
  () => {
    addColumn("transactions", "from_id", "TEXT");
    addColumn("transactions", "to_id", "TEXT");
  },
];
function runMigrations() {
  let v = db.prepare("PRAGMA user_version").get().user_version;
  for (; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      MIGRATIONS[v]();
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
runMigrations();

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

// ── portfolio value history (one point per day, appended on each price sync) ──
const PORTFOLIO_HISTORY_MAX = 400;

/** Saved portfolio-value points: [{ date:"YYYY-MM-DD", value }]. */
export function getPortfolioHistory() {
  return getMeta("portfolioHistory", []);
}

/** Per-symbol close history { SYMBOL: [{date, price}] }, for week-over-week change. */
export function getSymbolPriceHistory() {
  return getMeta("symbolPriceHistory", {});
}

/** Persist the per-symbol close history map. */
export function setSymbolPriceHistory(hist) {
  setMeta("symbolPriceHistory", hist);
}

/** App-lock config { salt, hash, secret } or null when no password is set. Stored
 * outside the keys resetAll() clears, so a data reset doesn't unlock the app. */
export function getAuth() {
  return getMeta("auth", null);
}
export function setAuth(obj) {
  if (obj == null) {
    db.prepare("DELETE FROM meta WHERE key = 'auth'").run();
  } else {
    setMeta("auth", obj);
  }
}

/** Append (or replace same-day) a portfolio-value point, capped to the last N days. */
export function appendPortfolioPoint(value, date = new Date().toISOString()) {
  if (typeof value !== "number" || !isFinite(value)) {
    return;
  }
  const day = date.slice(0, 10);
  const hist = getPortfolioHistory();
  // replace any existing point for this day (not just the last one), else append
  const existing = hist.find((p) => p.date === day);
  if (existing) {
    existing.value = value;
  } else {
    hist.push({ date: day, value });
  }
  // keep chronological + capped, so the chart's x-axis is always monotonic
  hist.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  while (hist.length > PORTFOLIO_HISTORY_MAX) {
    hist.shift();
  }
  setMeta("portfolioHistory", hist);
}

// ── lightweight validation: reject obviously malformed PUTs ───────────────────
const TX_TYPES = new Set(["income", "spending", "contribution", "transfer"]);

// a transfer must move between two DISTINCT accounts → reject a malformed one (the UI
// already enforces this; this guards a direct POST). Returns an error string or null.
function transferError(t) {
  if (t.type !== "transfer") {
    return null;
  }
  if (!t.fromId || !t.toId) {
    return "transfer needs a from and to account";
  }
  if (t.fromId === t.toId) {
    return "transfer needs two different accounts";
  }
  return null;
}

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
    if (typeof h.ticker !== "string") {
      return "holding.ticker must be a string";
    }
    // a ticker is interpolated into the (opt-in) price-feed URL, so keep it to a
    // plain symbol charset — no query-param/URL injection via a crafted ticker
    if (!/^[A-Za-z0-9.\-^]{1,15}$/.test(h.ticker)) {
      return "holding.ticker has invalid characters";
    }
    if (typeof h.shares !== "number" || !isFinite(h.shares)) {
      return "holding.shares must be a finite number";
    }
    // optional link to an account whose balance tracks this holding's value
    if (h.accountId != null && typeof h.accountId !== "string") {
      return "holding.accountId must be a string";
    }
  }
  for (const a of s.accounts || []) {
    if (!a?.id || !a?.type) {
      return "account needs an id and type";
    }
    if (!a.name || !String(a.name).trim()) {
      return "account needs a name";
    }
    // optional uninvested cash held in an investment account
    if (a.cash != null && (typeof a.cash !== "number" || !isFinite(a.cash))) {
      return "account.cash must be a finite number";
    }
  }
  for (const t of s.transactions || []) {
    if (!t?.id) {
      return "transaction needs an id";
    }
    if (!TX_TYPES.has(t?.type)) {
      return `bad transaction type: ${t?.type}`;
    }
    if (typeof t.amount !== "number" || !isFinite(t.amount)) {
      return "transaction.amount must be a finite number";
    }
    if (!t.date) {
      return "transaction needs a date";
    }
    if (Number.isNaN(Date.parse(t.date))) {
      return "transaction.date is not a valid date";
    }
    const te = transferError(t);
    if (te) {
      return te;
    }
  }
  for (const sn of s.snapshots || []) {
    if (!sn?.id) {
      return "snapshot needs an id"; // PRIMARY KEY — a null id collides with other id-less rows
    }
    if (!sn?.accountId) {
      return "snapshot needs an accountId";
    }
    if (typeof sn.balance !== "number" || !isFinite(sn.balance)) {
      return "snapshot.balance must be a finite number";
    }
    if (!sn.date || Number.isNaN(Date.parse(sn.date))) {
      return "snapshot.date is not a valid date";
    }
  }
  for (const d of s.debts || []) {
    if (!d?.id || !d?.name) {
      return "debt needs an id and name";
    }
    // balance/apr/minPayment hit NOT NULL REAL columns — reject non-numbers up front
    // so a bad PUT fails cleanly instead of throwing a raw SQLite constraint error
    if (typeof d.balance !== "number" || !isFinite(d.balance)) {
      return "debt.balance must be a finite number";
    }
    if (d.apr != null && (typeof d.apr !== "number" || !isFinite(d.apr))) {
      return "debt.apr must be a finite number";
    }
    if (d.minPayment != null && (typeof d.minPayment !== "number" || !isFinite(d.minPayment))) {
      return "debt.minPayment must be a finite number";
    }
  }
  for (const g of s.goals || []) {
    if (!g?.id || !g?.name) {
      return "goal needs an id and name";
    }
    if (typeof g.target !== "number" || !isFinite(g.target)) {
      return "goal.target must be a finite number";
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
  // a garbage date string would persist and silently skew month/streak/forecast math
  if (Number.isNaN(Date.parse(t.date))) {
    return "transaction.date is not a valid date";
  }
  return transferError(t);
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
      "INSERT INTO transactions(id,type,amount,date,note,cat,goal_id,source_id,bucket,from_id,to_id) VALUES(@id,@type,@amount,@date,@note,@cat,@goalId,@sourceId,@bucket,@fromId,@toId)",
    ).run({
      note: null,
      cat: null,
      goalId: null,
      sourceId: null,
      bucket: null,
      fromId: null,
      toId: null,
      ...t,
    });
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
    accounts: db.prepare("SELECT id, name, type, color, cash FROM accounts").all(),
    snapshots: db
      .prepare(
        "SELECT id, account_id AS accountId, date, balance, source FROM snapshots ORDER BY date",
      )
      .all(),
    goals: db
      .prepare("SELECT id, name, target, pledge, color, target_date AS targetDate FROM goals")
      .all(),
    debts: db.prepare("SELECT id, name, balance, apr, min_payment AS minPayment FROM debts").all(),
    transactions: db
      .prepare(
        "SELECT id, type, amount, date, note, cat, goal_id AS goalId, source_id AS sourceId, bucket, from_id AS fromId, to_id AS toId FROM transactions ORDER BY date",
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
    account: db.prepare(
      "INSERT INTO accounts(id,name,type,color,cash) VALUES(@id,@name,@type,@color,@cash)",
    ),
    snapshot: db.prepare(
      "INSERT INTO snapshots(id,account_id,date,balance,source) VALUES(@id,@accountId,@date,@balance,@source)",
    ),
    goal: db.prepare(
      "INSERT INTO goals(id,name,target,pledge,color,target_date) VALUES(@id,@name,@target,@pledge,@color,@targetDate)",
    ),
    debt: db.prepare(
      "INSERT INTO debts(id,name,balance,apr,min_payment) VALUES(@id,@name,@balance,@apr,@minPayment)",
    ),
    tx: db.prepare(
      "INSERT INTO transactions(id,type,amount,date,note,cat,goal_id,source_id,bucket,from_id,to_id) VALUES(@id,@type,@amount,@date,@note,@cat,@goalId,@sourceId,@bucket,@fromId,@toId)",
    ),
  };

  for (const a of state.accounts || []) {
    ins.account.run({ color: null, cash: null, ...a });
  }
  for (const s of state.snapshots || []) {
    ins.snapshot.run({ source: null, ...s });
  }
  for (const g of state.goals || []) {
    ins.goal.run({ color: null, targetDate: null, pledge: 0, ...g });
  }
  for (const d of state.debts || []) {
    ins.debt.run({ apr: 0, minPayment: 0, ...d });
  }
  for (const t of state.transactions || []) {
    ins.tx.run({
      note: null,
      cat: null,
      goalId: null,
      sourceId: null,
      bucket: null,
      fromId: null,
      toId: null,
      ...t,
    });
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
 * Validate a meta-only patch body ({profile?, settings?, holdings?}).
 * @returns {string|null} an error message, or null when valid
 */
export function validateMeta(p) {
  if (!p || typeof p !== "object") {
    return "body must be an object";
  }
  if (p.profile !== undefined && (typeof p.profile !== "object" || p.profile == null)) {
    return "profile must be an object";
  }
  if (p.settings !== undefined && (typeof p.settings !== "object" || p.settings == null)) {
    return "settings must be an object";
  }
  if (p.holdings !== undefined) {
    if (!Array.isArray(p.holdings)) {
      return "holdings must be an array";
    }
    const err = validateState({ holdings: p.holdings }); // reuse the holding/ticker checks
    if (err) {
      return err;
    }
  }
  return null;
}

/**
 * Granular write: update only the JSON-blob slices (profile / settings / holdings)
 * WITHOUT rewriting the normalized tables — so a settings/profile toggle (theme, blur,
 * reminders, budgets, goals, strategy…) doesn't re-DELETE+INSERT the whole ledger.
 * Bumps the rev (optimistic concurrency).
 * @returns {Object} the fresh full state
 */
export function putMeta(partial, expectedRev) {
  if (expectedRev != null && Number(expectedRev) !== getRev()) {
    throw new ConflictError("state changed since you loaded it");
  }
  db.exec("BEGIN");
  try {
    if (partial.profile !== undefined) {
      setMeta("profile", partial.profile);
    }
    if (partial.settings !== undefined) {
      setMeta("settings", partial.settings);
    }
    if (partial.holdings !== undefined) {
      setMeta("holdings", partial.holdings);
    }
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
    db.prepare(
      "DELETE FROM meta WHERE key IN ('profile', 'settings', 'holdings', 'portfolioHistory', 'symbolPriceHistory')",
    ).run();
    setMeta("rev", getRev() + 1);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

// ── local backups (safety net for the user's only copy of their data) ─────────
const BACKUP_DIR = process.env.TSUMIKI_BACKUP_DIR || join(dirname(DB_PATH), "backups");

/**
 * Write the current full state to a timestamped JSON file under the backups dir.
 * Used as a safety net before a destructive import, and by the optional scheduler.
 * @returns {string|null} the file path, or null on failure (never throws)
 */
export function backupStateToFile(label = "backup") {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(BACKUP_DIR, `tsumiki-${label}-${stamp}.json`);
    writeFileSync(file, JSON.stringify(getState()));
    return file;
  } catch (e) {
    console.warn("backup failed:", e.message);
    return null;
  }
}

/** Keep only the newest `keep` auto-backups so the daily scheduler can't fill the
 * disk over time. Pre-import snapshots are left untouched. Never throws. */
export function pruneAutoBackups(keep = 30) {
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("tsumiki-auto-") && f.endsWith(".json"))
      .sort(); // ISO timestamps sort chronologically
    for (const f of files.slice(0, Math.max(0, files.length - keep))) {
      rmSync(join(BACKUP_DIR, f), { force: true });
    }
  } catch {
    // best-effort: a missing dir or a transient FS error shouldn't break backups
  }
}

/** Opt-in (TSUMIKI_AUTO_BACKUP=1) daily local backup. No-op otherwise. */
export function scheduleBackup() {
  if (!["1", "true", "yes"].includes((process.env.TSUMIKI_AUTO_BACKUP || "").toLowerCase())) {
    return null;
  }
  const run = () => {
    backupStateToFile("auto");
    pruneAutoBackups();
  };
  run();
  return setInterval(run, 24 * 60 * 60 * 1000);
}

export { DEFAULT_PROFILE, DEFAULT_SETTINGS };
