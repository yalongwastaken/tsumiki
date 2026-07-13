// schema.js — open the SQLite database and bring its schema up to date.
// Split out of db.js so the connection/DDL/migration concerns live apart from the
// accessors: this module owns WHERE the file is, WHAT the tables look like, and HOW
// an older file is upgraded; db.js owns reading/writing the data.
// Uses Node's built-in node:sqlite — no native build step, nothing to compile on
// the mini PC. (Run node with --experimental-sqlite.)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { resolveDbLocation, relocateDbFiles } from "./dbpath.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// the documented default (README/SECURITY/INSTRUCTIONS + Makefile backups)
const DEFAULT_DB_PATH = join(__dirname, "..", "data", "tsumiki.db");
// where the lib/ refactor accidentally put it (db.js's old module-relative default)
const LEGACY_DB_PATH = join(__dirname, "data", "tsumiki.db");

const loc = resolveDbLocation({
  envPath: process.env.TSUMIKI_DB,
  targetPath: DEFAULT_DB_PATH,
  legacyPath: LEGACY_DB_PATH,
  targetExists: existsSync(DEFAULT_DB_PATH),
  legacyExists: existsSync(LEGACY_DB_PATH),
});
if (loc.action === "relocate") {
  // one-time heal: the live DB is stranded at the legacy lib/ path — move it (and its
  // -wal/-shm) back to the documented path before opening, so backups/docs are right again
  const moved = relocateDbFiles(LEGACY_DB_PATH, DEFAULT_DB_PATH);
  console.log(
    `db: relocated ${LEGACY_DB_PATH} → ${DEFAULT_DB_PATH} (moved: ${moved.join(", ")}) — ` +
      "the lib/ refactor had silently changed the default DB path",
  );
} else if (loc.action === "conflict") {
  console.warn(
    "!".repeat(72) +
      `\ndb: TWO databases exist:\n  documented: ${DEFAULT_DB_PATH}\n  legacy:     ${LEGACY_DB_PATH}\n` +
      "Refusing to guess which one is yours — continuing with the LEGACY file (the one\n" +
      "that has been live since the lib/ refactor). Please resolve manually: verify which\n" +
      "file holds your data, move it to the documented path, and archive the other.\n" +
      "Neither file has been touched.\n" +
      "!".repeat(72),
  );
}
export const DB_PATH = loc.path;

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
