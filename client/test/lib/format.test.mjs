// format.test.mjs — currency formatters: whole-dollar display, safe on non-finite, no "$-0".
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmt, fmtK } from "../../src/lib/core/format.js";

test("fmt renders whole dollars with separators", () => {
  assert.equal(fmt(1234), "$1,234");
  assert.equal(fmt(1234.56), "$1,235"); // rounds
  assert.equal(fmt(-1500), "$-1,500");
});

test("fmt is safe on non-finite input (never $NaN/$Infinity)", () => {
  assert.equal(fmt(NaN), "$0");
  assert.equal(fmt(Infinity), "$0");
  assert.equal(fmt(undefined), "$0");
});

test("fmt normalizes -0 and sub-cent negatives to $0 (no $-0)", () => {
  assert.equal(fmt(-0), "$0");
  assert.equal(fmt(-0.3), "$0"); // Math.round(-0.3) === -0
  assert.equal(fmt(-0.49), "$0");
});

test("fmtK compacts thousands and is -0 safe", () => {
  assert.equal(fmtK(1500), "$1.5k");
  assert.equal(fmtK(12000), "$12k");
  assert.equal(fmtK(950), "$950");
  assert.equal(fmtK(-0.3), "$0"); // no $-0
  assert.equal(fmtK(NaN), "$0");
});
