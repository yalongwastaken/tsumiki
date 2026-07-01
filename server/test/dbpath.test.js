// dbpath.test.js — DB path resolution + the one-time relocation of a database
// stranded at the legacy server/lib/data/ location (the lib/ refactor bug).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolveDbLocation, relocateDbFiles } from "../lib/dbpath.js";

const TARGET = "/srv/tsumiki/server/data/tsumiki.db";
const LEGACY = "/srv/tsumiki/server/lib/data/tsumiki.db";
const resolve = (flags) => resolveDbLocation({ targetPath: TARGET, legacyPath: LEGACY, ...flags });

test("TSUMIKI_DB env override wins outright", () => {
  const loc = resolve({ envPath: "/elsewhere/x.db", targetExists: true, legacyExists: true });
  assert.deepEqual(loc, { path: "/elsewhere/x.db", action: "env" });
});

test("fresh install (neither file) → the documented default path", () => {
  const loc = resolve({ targetExists: false, legacyExists: false });
  assert.deepEqual(loc, { path: TARGET, action: "default" });
});

test("normal case (only the documented file) → open it, no action", () => {
  const loc = resolve({ targetExists: true, legacyExists: false });
  assert.deepEqual(loc, { path: TARGET, action: "default" });
});

test("stranded DB (only the legacy lib/ file) → relocate to the documented path", () => {
  const loc = resolve({ targetExists: false, legacyExists: true });
  assert.deepEqual(loc, { path: TARGET, action: "relocate" });
});

test("BOTH files exist → refuse to guess: keep the legacy (live) file and flag a conflict", () => {
  // silently preferring either file could discard someone's only copy of their data
  const loc = resolve({ targetExists: true, legacyExists: true });
  assert.deepEqual(loc, { path: LEGACY, action: "conflict" });
});

test("relocateDbFiles moves the db + -wal/-shm siblings and reports what moved", () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumiki-dbpath-"));
  const legacy = join(dir, "lib", "data", "tsumiki.db");
  const target = join(dir, "data", "tsumiki.db");
  mkdirSync(join(dir, "lib", "data"), { recursive: true });
  writeFileSync(legacy, "main");
  writeFileSync(legacy + "-wal", "wal"); // live WAL must travel with the main file

  const moved = relocateDbFiles(legacy, target);
  assert.deepEqual(moved, ["db", "-wal"]); // no -shm existed → not reported
  assert.equal(readFileSync(target, "utf8"), "main");
  assert.equal(readFileSync(target + "-wal", "utf8"), "wal");
  assert.ok(!existsSync(legacy), "legacy main file moved away");
  assert.ok(!existsSync(legacy + "-wal"), "legacy -wal moved away");
});

test("relocateDbFiles never overwrites an existing file at the target", () => {
  const dir = mkdtempSync(join(tmpdir(), "tsumiki-dbpath-"));
  const legacy = join(dir, "lib", "tsumiki.db");
  const target = join(dir, "data", "tsumiki.db");
  mkdirSync(join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(legacy, "legacy-data");
  writeFileSync(target, "target-data");
  const moved = relocateDbFiles(legacy, target);
  assert.deepEqual(moved, []); // refused — the target already exists
  assert.equal(readFileSync(target, "utf8"), "target-data"); // untouched
  assert.equal(readFileSync(legacy, "utf8"), "legacy-data"); // untouched
});
