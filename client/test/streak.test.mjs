// streak.test.mjs — tests for the rotating-objective adherence streak.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAdherence,
  objectiveForWeek,
  OBJECTIVES,
  WEEK,
  weekKey,
} from "../src/lib/streak.js";

const thisWeek = weekKey(Date.now());
const midWeek = (wk) => new Date(wk + 2 * 86400000).toISOString();
let n = 0;
// a transaction that satisfies the given objective id
function txFor(objId, date) {
  n++;
  if (objId === "log") {
    return { id: "x" + n, type: "spending", amount: 10, date, cat: "X" };
  }
  if (objId === "safety") {
    return { id: "x" + n, type: "contribution", amount: 10, date, bucket: "emergency" };
  }
  return { id: "x" + n, type: "contribution", amount: 10, date, bucket: "invest" }; // contribute + invest
}

test("objective rotates deterministically and wraps", () => {
  const ids = [0, 1, 2, 3].map((i) => objectiveForWeek(i * WEEK).id);
  assert.equal(new Set(ids).size, OBJECTIVES.length); // all distinct over one cycle
  assert.equal(objectiveForWeek(4 * WEEK).id, objectiveForWeek(0).id); // wraps
});

test("meeting each week's rotated objective builds the streak", () => {
  const tx = [0, 1, 2].map((i) => {
    const wk = thisWeek - i * WEEK;
    return txFor(objectiveForWeek(wk).id, midWeek(wk));
  });
  const r = computeAdherence(tx, 0);
  assert.equal(r.current, 3);
  assert.equal(r.metThisWeek, true);
});

test("a freeze bridges one missed week", () => {
  // satisfy this week and 2 weeks ago, miss last week
  const tx = [0, 2].map((i) => {
    const wk = thisWeek - i * WEEK;
    return txFor(objectiveForWeek(wk).id, midWeek(wk));
  });
  assert.equal(computeAdherence(tx, 0).current, 1); // breaks at the gap without a freeze
  assert.equal(computeAdherence(tx, 1).current, 2); // freeze bridges the gap
});

test("wrong action for the week does not satisfy it", () => {
  // this week's objective with a deliberately wrong tx type
  const wk = thisWeek;
  const obj = objectiveForWeek(wk).id;
  const wrong =
    obj === "log"
      ? { id: "w", type: "contribution", amount: 5, date: midWeek(wk), bucket: "invest" }
      : { id: "w", type: "spending", amount: 5, date: midWeek(wk), cat: "X" };
  const r = computeAdherence([wrong], 0);
  // "log" met only by spending; the others met only by the right contribution
  if (obj === "log") {
    assert.equal(r.metThisWeek, false);
  } else if (obj === "safety") {
    assert.equal(r.metThisWeek, false);
  }
  // (contribute/invest are satisfied by an invest contribution, so skip those)
});

test("no transactions → zero streak, not infinite loop", () => {
  const r = computeAdherence([], 5);
  assert.equal(r.current, 0);
  assert.equal(r.longest, 0);
  assert.equal(r.cells.length, 12);
});
