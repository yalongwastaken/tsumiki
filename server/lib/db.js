// db.js — accessors for the unified data model (single-user, single SQLite file).
// The connection + schema + migrations live in schema.js; the pure input validation
// lives in validate.js (re-exported here so callers keep one import site). This
// module owns reading and writing the data: state assembly, granular writes, the
// optimistic-concurrency rev, and local backups.
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { db, DB_PATH } from "./schema.js";
import { validateState } from "./validate.js";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from "./defaults.js";

export { db, DB_PATH } from "./schema.js";
export { invalidDate, validateState, validateTransaction, validateMeta } from "./validate.js";

// boot log: resolved path + rev + row counts — makes a wrong/empty DB path obvious
// immediately (the lib/ refactor bug would have surfaced on the first boot log)
{
  const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  console.log(
    `db: ${DB_PATH} (rev ${getRev()}, ${count("transactions")} transactions, ` +
      `${count("accounts")} accounts)`,
  );
}

// (DEFAULT_PROFILE / DEFAULT_SETTINGS now live in defaults.js — shared with
// migrate.js without dragging this module's DB side effects along; re-exported below)

/** Read a JSON blob from the meta table, or `fallback` if absent. A corrupt/unparseable
 * blob (disk corruption, an external edit) falls back to the default instead of throwing
 * — one bad byte must not brick GET /api/state or block resetAll/recovery. */
function getMeta(key, fallback) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  if (!row) {
    return fallback;
  }
  try {
    return JSON.parse(row.value);
  } catch {
    console.warn(`meta blob "${key}" is corrupt — falling back to default`);
    return fallback;
  }
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

/** Per-symbol consecutive price-sync failure counts { SYMBOL: n }, for the circuit
 * breaker that stops retrying a symbol the feed never prices (e.g. mutual funds). */
export function getPriceFailures() {
  return getMeta("priceFailures", {});
}

/** Persist the per-symbol failure-count map. */
export function setPriceFailures(map) {
  setMeta("priceFailures", map);
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

// local "YYYY-MM-DD" — the server runs on the user's own machine, so its local day is
// the user's day; bucket portfolio-history points the same way as the client's day keys
// (rather than a UTC slice, which would flip the point's date for late-evening syncs).
const localDayKey = (d) => {
  const x = typeof d === "string" ? new Date(d) : d;
  return isNaN(x.getTime())
    ? ""
    : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/** Append (or replace same-day) a portfolio-value point, capped to the last N days. */
export function appendPortfolioPoint(value, date = new Date()) {
  if (typeof value !== "number" || !isFinite(value)) {
    return;
  }
  const day = localDayKey(date);
  if (!day) {
    return;
  }
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

/**
 * The full state PLUS the history blobs (portfolio value + per-symbol closes) —
 * what /api/export and JSON backups write, so a restore doesn't lose the charts.
 * Kept separate from getState(): the client's boot payload doesn't need them.
 */
export function exportState() {
  return {
    ...getState(),
    portfolioHistory: getPortfolioHistory(),
    symbolPriceHistory: getSymbolPriceHistory(),
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
  // history blobs ride along in exports/backups; restore them when the file has them
  // (the client's normal full-state PUT never includes these, so they're untouched)
  if (state.portfolioHistory) {
    setMeta("portfolioHistory", state.portfolioHistory);
  }
  if (state.symbolPriceHistory) {
    setMeta("symbolPriceHistory", state.symbolPriceHistory);
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

// ── per-entity granular writes (PATCH/DELETE /api/<kind>/:id) ─────────────────
// Upsert or delete ONE item in the big collections without a full-state PUT — the
// same spirit as putMeta: shrink the clobber window and skip the DELETE+INSERT of
// the entire ledger for a one-row change. Rev-checked and rev-bumping like every
// other client-facing write. Upserts use ON CONFLICT DO UPDATE (never INSERT OR
// REPLACE, which would delete+reinsert and cascade-wipe an account's snapshots).
const ENTITIES = {
  accounts: {
    defaults: { color: null, cash: null },
    upsertSql: `INSERT INTO accounts(id,name,type,color,cash)
      VALUES(@id,@name,@type,@color,@cash)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, type = excluded.type,
        color = excluded.color, cash = excluded.cash`,
  },
  debts: {
    defaults: { apr: 0, minPayment: 0 },
    upsertSql: `INSERT INTO debts(id,name,balance,apr,min_payment)
      VALUES(@id,@name,@balance,@apr,@minPayment)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, balance = excluded.balance,
        apr = excluded.apr, min_payment = excluded.min_payment`,
  },
  goals: {
    defaults: { color: null, targetDate: null, pledge: 0 },
    upsertSql: `INSERT INTO goals(id,name,target,pledge,color,target_date)
      VALUES(@id,@name,@target,@pledge,@color,@targetDate)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, target = excluded.target, pledge = excluded.pledge,
        color = excluded.color, target_date = excluded.target_date`,
  },
};
export const ENTITY_KINDS = Object.keys(ENTITIES);

/**
 * Validate a single item for a per-entity upsert (reuses the full-state checks).
 * @returns {string|null} an error message, or null when valid
 */
export function validateEntity(kind, item) {
  if (!ENTITIES[kind]) {
    return `unknown collection: ${kind}`;
  }
  return validateState({ [kind]: [item] });
}

/**
 * Insert-or-update one item in `kind` (accounts | debts | goals), bumping the rev.
 * @param {number} [expectedRev] - stale → ConflictError (optimistic concurrency)
 * @returns {Object} the fresh full state
 */
export function upsertEntity(kind, item, expectedRev) {
  const spec = ENTITIES[kind];
  if (!spec) {
    throw new Error(`unknown collection: ${kind}`);
  }
  if (expectedRev != null && Number(expectedRev) !== getRev()) {
    throw new ConflictError("state changed since you loaded it");
  }
  db.exec("BEGIN");
  try {
    db.prepare(spec.upsertSql).run({ ...spec.defaults, ...item });
    setMeta("rev", getRev() + 1);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

/**
 * Delete one item from `kind` by id, bumping the rev. Deleting an account cascades
 * its snapshots (schema FK). A missing id deletes nothing and returns null (→ 404)
 * without bumping the rev.
 * @param {number} [expectedRev] - stale → ConflictError (optimistic concurrency)
 * @returns {Object|null} the fresh full state, or null when the id didn't exist
 */
export function deleteEntity(kind, id, expectedRev) {
  if (!ENTITIES[kind]) {
    throw new Error(`unknown collection: ${kind}`);
  }
  if (expectedRev != null && Number(expectedRev) !== getRev()) {
    throw new ConflictError("state changed since you loaded it");
  }
  db.exec("BEGIN");
  try {
    const { changes } = db.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id);
    if (!changes) {
      db.exec("ROLLBACK"); // nothing deleted — don't burn a rev
      return null;
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
      "DELETE FROM meta WHERE key IN ('profile', 'settings', 'holdings', 'portfolioHistory', 'symbolPriceHistory', 'priceFailures')",
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
    // exportState (not getState) so backups carry the history blobs too
    writeFileSync(file, JSON.stringify(exportState()));
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
