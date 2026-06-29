// billdates.test.mjs — resolving flexible bill schedules to concrete due dates.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scheduleOf,
  billDueDay,
  nextBillDue,
  scheduleLabel,
} from "../../src/lib/plan/billdates.js";

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("scheduleOf reads new `due` and legacy `dayOfMonth`, else null", () => {
  assert.deepEqual(scheduleOf({ due: { kind: "lastDay" } }), { kind: "lastDay" });
  assert.deepEqual(scheduleOf({ dayOfMonth: 15 }), { kind: "day", day: 15 });
  assert.equal(scheduleOf({ name: "no schedule" }), null);
  assert.equal(scheduleOf({ dayOfMonth: null }), null);
});

test("fixed day clamps to month length (31st → 28th in non-leap Feb)", () => {
  assert.equal(billDueDay({ due: { kind: "day", day: 15 } }, 2026, 5), 15); // June 15
  assert.equal(billDueDay({ due: { kind: "day", day: 31 } }, 2027, 1), 28); // Feb 2027
  assert.equal(billDueDay({ dayOfMonth: 10 }, 2026, 5), 10); // legacy still resolves
});

test("lastDay is the calendar last day", () => {
  assert.equal(billDueDay({ due: { kind: "lastDay" } }, 2026, 1), 28); // Feb 2026
  assert.equal(billDueDay({ due: { kind: "lastDay" } }, 2024, 1), 29); // leap Feb
  assert.equal(billDueDay({ due: { kind: "lastDay" } }, 2026, 5), 30); // June
});

test("lastBusinessDay backs off weekends", () => {
  // May 2026 ends Sun 31 → last business day is Fri 29
  assert.equal(billDueDay({ due: { kind: "lastBusinessDay" } }, 2026, 4), 29);
  // Aug 2026 ends Mon 31 → that's itself a business day
  assert.equal(billDueDay({ due: { kind: "lastBusinessDay" } }, 2026, 7), 31);
});

test("nthWeekday resolves first/third occurrences; missing 5th → null", () => {
  // June 2026: 1st is a Monday → first Monday = 1, third Monday = 15
  assert.equal(billDueDay({ due: { kind: "nthWeekday", n: 1, weekday: 1 } }, 2026, 5), 1);
  assert.equal(billDueDay({ due: { kind: "nthWeekday", n: 3, weekday: 1 } }, 2026, 5), 15);
  // first Friday of June 2026 = 5
  assert.equal(billDueDay({ due: { kind: "nthWeekday", n: 1, weekday: 5 } }, 2026, 5), 5);
  // June 2026 has 5 Mondays (1,8,15,22,29) → the 5th resolves to 29
  assert.equal(billDueDay({ due: { kind: "nthWeekday", n: 5, weekday: 1 } }, 2026, 5), 29);
  // Feb 2026 has only 4 Mondays (2,9,16,23) → the 5th is null
  assert.equal(billDueDay({ due: { kind: "nthWeekday", n: 5, weekday: 1 } }, 2026, 1), null);
});

test("lastWeekday finds the final occurrence", () => {
  // last Friday of June 2026 = 26
  assert.equal(billDueDay({ due: { kind: "lastWeekday", weekday: 5 } }, 2026, 5), 26);
  // last Monday of June 2026 = 29
  assert.equal(billDueDay({ due: { kind: "lastWeekday", weekday: 1 } }, 2026, 5), 29);
});

test("nextBillDue returns the next local date on/after today (skips absent months)", () => {
  const from = new Date(2026, 5, 20); // local Sat Jun 20 2026
  // last business day of June (Tue 30) is the next occurrence
  assert.equal(iso(nextBillDue({ due: { kind: "lastBusinessDay" } }, from)), "2026-06-30");
  // a fixed 10th already passed this month → July 10
  assert.equal(iso(nextBillDue({ due: { kind: "day", day: 10 } }, from)), "2026-07-10");
  // first Monday: passed in June → first Monday of July = Jul 6
  assert.equal(
    iso(nextBillDue({ due: { kind: "nthWeekday", n: 1, weekday: 1 } }, from)),
    "2026-07-06",
  );
  // no schedule → null
  assert.equal(nextBillDue({ name: "x" }, from), null);
});

test("scheduleLabel reads each shape", () => {
  assert.equal(scheduleLabel({ due: { kind: "day", day: 1 } }), "1st");
  assert.equal(scheduleLabel({ dayOfMonth: 22 }), "22nd");
  assert.equal(scheduleLabel({ due: { kind: "lastDay" } }), "last day");
  assert.equal(scheduleLabel({ due: { kind: "lastBusinessDay" } }), "last business day");
  assert.equal(scheduleLabel({ due: { kind: "nthWeekday", n: 1, weekday: 1 } }), "first Monday");
  assert.equal(scheduleLabel({ due: { kind: "lastWeekday", weekday: 5 } }), "last Friday");
  assert.equal(scheduleLabel({ name: "none" }), "");
});
