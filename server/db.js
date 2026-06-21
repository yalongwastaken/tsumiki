// db.js — SQLite schema + accessors for the unified model (SPEC.md §6).
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
    id      TEXT PRIMARY KEY,
    type    TEXT NOT NULL,          -- income | spending | contribution
    amount  REAL NOT NULL,
    date    TEXT NOT NULL,          -- ISO string
    note    TEXT,
    cat     TEXT,                   -- for spending
    goal_id TEXT                    -- for contribution (abstract ref; not FK-enforced)
  );
  CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
  CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);

  -- flexible JSON blobs for the evolving profile + settings (SPEC.md §6)
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL             -- JSON
  );
`);

// ── defaults ────────────────────────────────────────────────────────────────
const DEFAULT_PROFILE = {
  incomeType: "salary",
  typicalIncome: null,
  checkingFloor: 0,
  emergencyTarget: 0,
  employerMatch: null,
  retirementLimits: null,
  strategy: "balanced",
  customRules: null,
};
const DEFAULT_SETTINGS = { returnRate: 0.07, monthlyInvest: null, streakFreezes: 0 };

function getMeta(key, fallback) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}
function setMeta(key, obj) {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, JSON.stringify(obj));
}

// ── full state assembly (what GET /api/state returns) ─────────────────────────
export function getState() {
  return {
    accounts: db.prepare("SELECT id, name, type, color FROM accounts").all(),
    snapshots: db
      .prepare("SELECT id, account_id AS accountId, date, balance FROM snapshots ORDER BY date")
      .all(),
    goals: db
      .prepare("SELECT id, name, target, pledge, color, target_date AS targetDate FROM goals")
      .all(),
    debts: db
      .prepare("SELECT id, name, balance, apr, min_payment AS minPayment FROM debts")
      .all(),
    transactions: db
      .prepare("SELECT id, type, amount, date, note, cat, goal_id AS goalId FROM transactions ORDER BY date")
      .all(),
    profile: getMeta("profile", DEFAULT_PROFILE),
    settings: getMeta("settings", DEFAULT_SETTINGS),
  };
}

// ── full state replace (pragmatic bridge for v1; PUT /api/state) ──────────────
// Data lives in real normalized tables; the client keeps its simple "save the
// whole model" pattern. Granular endpoints can replace this later.
function replaceAll(state) {
  db.prepare("DELETE FROM snapshots").run();
  db.prepare("DELETE FROM transactions").run();
  db.prepare("DELETE FROM accounts").run();
  db.prepare("DELETE FROM goals").run();
  db.prepare("DELETE FROM debts").run();

  const ins = {
    account: db.prepare("INSERT INTO accounts(id,name,type,color) VALUES(@id,@name,@type,@color)"),
    snapshot: db.prepare("INSERT INTO snapshots(id,account_id,date,balance) VALUES(@id,@accountId,@date,@balance)"),
    goal: db.prepare("INSERT INTO goals(id,name,target,pledge,color,target_date) VALUES(@id,@name,@target,@pledge,@color,@targetDate)"),
    debt: db.prepare("INSERT INTO debts(id,name,balance,apr,min_payment) VALUES(@id,@name,@balance,@apr,@minPayment)"),
    tx: db.prepare("INSERT INTO transactions(id,type,amount,date,note,cat,goal_id) VALUES(@id,@type,@amount,@date,@note,@cat,@goalId)"),
  };

  for (const a of state.accounts || []) ins.account.run({ color: null, ...a });
  for (const s of state.snapshots || []) ins.snapshot.run(s);
  for (const g of state.goals || []) ins.goal.run({ color: null, targetDate: null, pledge: 0, ...g });
  for (const d of state.debts || []) ins.debt.run({ apr: 0, minPayment: 0, ...d });
  for (const t of state.transactions || [])
    ins.tx.run({ note: null, cat: null, goalId: null, ...t });

  if (state.profile) setMeta("profile", state.profile);
  if (state.settings) setMeta("settings", state.settings);
}

// node:sqlite has no .transaction() helper — wrap manually so a bad PUT can't
// leave the tables half-written.
export function putState(state) {
  db.exec("BEGIN");
  try {
    replaceAll(state);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

export { DEFAULT_PROFILE, DEFAULT_SETTINGS };
