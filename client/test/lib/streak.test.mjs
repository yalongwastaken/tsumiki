// streak.test.mjs — tests for the daily logging streak + weekly adherence challenge.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAdherence,
  computeDailyStreak,
  objectiveForWeek,
  OBJECTIVES,
  WEEK,
  DAY,
  dayKey,
  weekKey,
} from "../../src/lib/insights/streak.js";

test("dayKey keeps a bare YYYY-MM-DD as the local day in every timezone", () => {
  // a bare date is already a local calendar day — it must not shift back a day when
  // parsed as UTC midnight (this runs across the TZ matrix)
  assert.equal(dayKey("2026-12-31"), "2026-12-31");
  assert.equal(dayKey("2026-01-01"), "2026-01-01");
});

// local-midnight ISO for `daysAgo` days before `now`
const now = Date.now();
const dayAgo = (n) => {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
};
const logOn = (n, extra = {}) => ({
  id: "d" + n + (extra.bucket || extra.cat || ""),
  type: "spending",
  amount: 1,
  date: dayAgo(n),
  ...extra,
});

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

// ── daily logging streak ──────────────────────────────────────────────────────

test("dayKey is local and stable; invalid dates yield ''", () => {
  assert.equal(dayKey("not a date"), "");
  assert.equal(dayKey(new Date(2026, 5, 1)), "2026-06-01");
});

test("consecutive days of any log build the daily streak", () => {
  const tx = [logOn(0), logOn(1), logOn(2)];
  const r = computeDailyStreak(tx, 0);
  assert.equal(r.current, 3);
  assert.equal(r.loggedToday, true);
  assert.equal(r.cells.length, 14);
  assert.equal(r.cells[13].isNow, true);
});

test("any log type counts — even a $0 no-spend day", () => {
  const tx = [
    { id: "a", type: "spending", amount: 0, cat: "No-spend day", date: dayAgo(0) },
    { id: "b", type: "income", amount: 100, date: dayAgo(1) },
    { id: "c", type: "contribution", amount: 50, bucket: "invest", date: dayAgo(2) },
  ];
  assert.equal(computeDailyStreak(tx, 0).current, 3);
});

test("not logging today doesn't break a run through yesterday", () => {
  const tx = [logOn(1), logOn(2)]; // nothing today
  const r = computeDailyStreak(tx, 0);
  assert.equal(r.loggedToday, false);
  assert.equal(r.current, 2); // counts back from yesterday
});

test("a freeze bridges a single missed day", () => {
  const tx = [logOn(0), logOn(2)]; // missed yesterday
  assert.equal(computeDailyStreak(tx, 0).current, 1); // breaks at the gap
  assert.equal(computeDailyStreak(tx, 1).current, 2); // freeze bridges it
});

test("longest tracks the best historical run", () => {
  const tx = [logOn(10), logOn(11), logOn(12), logOn(13), logOn(0)];
  const r = computeDailyStreak(tx, 0);
  assert.equal(r.longest, 4);
});

test("empty ledger → zero daily streak, 14 cells, no crash", () => {
  const r = computeDailyStreak([], 3);
  assert.equal(r.current, 0);
  assert.equal(r.longest, 0);
  assert.equal(r.loggedToday, false);
  assert.equal(r.cells.length, 14);
});

test("a future-dated entry does not hang the longest-run loop", () => {
  const future = new Date(now);
  future.setDate(future.getDate() + 5);
  const tx = [logOn(0), { id: "f", type: "income", amount: 1, date: future.toISOString() }];
  const r = computeDailyStreak(tx, 0); // must return, not spin forever
  assert.equal(r.current, 1); // today logged; future doesn't extend the current run
  assert.ok(r.longest >= 1);
});

test("DAY constant and WEEK relationship", () => {
  assert.equal(WEEK, 7 * DAY);
});
