// backup-db.mjs — WAL-safe SQLite backup via `VACUUM INTO` (dependency-free, node:sqlite).
// A plain `cp` of a live WAL-mode database can be stale or torn: recent writes may
// exist only in the -wal file until a checkpoint. VACUUM INTO asks SQLite itself to
// write a consistent, compacted snapshot — safe while the server is running.
//
// Usage: node --experimental-sqlite server/scripts/backup-db.mjs <source.db> <dest.db>
import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync } from "node:fs";

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error("usage: backup-db.mjs <source.db> <dest.db>");
  process.exit(1);
}
if (!existsSync(src)) {
  console.error(`backup-db: source not found: ${src}`);
  process.exit(1);
}
// VACUUM INTO refuses to overwrite — replace an existing same-name backup (re-running
// on the same day should refresh that day's backup, matching the old `cp` behavior)
rmSync(dest, { force: true });

const db = new DatabaseSync(src);
try {
  // quote the path as a SQL string literal ('' escapes an embedded quote)
  db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
} finally {
  db.close();
}
console.log(`backup-db: ${src} → ${dest}`);
