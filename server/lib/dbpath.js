// dbpath.js — decide where the SQLite file lives, and heal the lib/ refactor's
// silent path change. db.js used a module-relative default (join(__dirname, "data")),
// so moving db.js into server/lib/ silently relocated the LIVE database from the
// documented server/data/tsumiki.db to server/lib/data/tsumiki.db — while backups
// and docs kept pointing at the (now-orphaned) old file. The resolver below picks
// the right path and tells db.js whether a one-time relocation (or a loud conflict
// warning) is needed. Pure decision logic, so it's unit-testable without a DB.
import { dirname } from "node:path";
import { existsSync, mkdirSync, renameSync } from "node:fs";

/**
 * Decide which DB path to open and what (if anything) to do first.
 * Pure — callers pass in existence flags, nothing here touches the disk.
 *
 * @param {Object} opts
 * @param {string} [opts.envPath] - TSUMIKI_DB override (wins outright)
 * @param {string} opts.targetPath - the documented default (server/data/tsumiki.db)
 * @param {string} opts.legacyPath - the accidental lib/ location (server/lib/data/tsumiki.db)
 * @param {boolean} opts.targetExists
 * @param {boolean} opts.legacyExists
 * @returns {{path: string, action: "env"|"default"|"relocate"|"conflict"}}
 *   - "relocate": only the legacy file exists → move it to the target, then open the target
 *   - "conflict": BOTH exist → refuse to guess; keep using the legacy (live) file and warn
 */
export function resolveDbLocation({ envPath, targetPath, legacyPath, targetExists, legacyExists }) {
  if (envPath) {
    return { path: envPath, action: "env" };
  }
  if (legacyExists && targetExists) {
    // Two databases, both real files: silently preferring either could discard data
    // (the target is *probably* the pre-refactor orphan, but "probably" isn't good
    // enough for someone's only copy of their finances). Keep opening the legacy file
    // — it's the one that has been live since the refactor — and warn loudly.
    return { path: legacyPath, action: "conflict" };
  }
  if (legacyExists) {
    return { path: targetPath, action: "relocate" };
  }
  return { path: targetPath, action: "default" };
}

/**
 * Move a SQLite database (plus its -wal/-shm siblings) from `legacyPath` to
 * `targetPath`. Only call when the target does not exist (see resolveDbLocation).
 * @returns {string[]} the suffixes moved (e.g. ["", "-wal"])
 */
export function relocateDbFiles(legacyPath, targetPath) {
  mkdirSync(dirname(targetPath), { recursive: true });
  const moved = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(legacyPath + suffix) && !existsSync(targetPath + suffix)) {
      renameSync(legacyPath + suffix, targetPath + suffix);
      moved.push(suffix || "db");
    }
  }
  return moved;
}
