// paydays.test.mjs — projection of payday dates from an anchor + cadence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextPaydays, paydaysInMonth } from "../src/paydays.js";

// format as a LOCAL calendar date — paydays are local-midnight dates, so asserting
// via toISOString() (UTC) would shift a day in non-UTC timezones.
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const FROM = new Date("2026-06-21T12:00:00Z"); // a Sunday

test("biweekly projects forward from a past anchor", () => {
  // anchor Fri 2026-06-12; biweekly → 06-12, 06-26, 07-10, ...
  const got = nextPaydays("2026-06-12", "biweekly", 3, FROM).map(iso);
  assert.deepEqual(got, ["2026-06-26", "2026-07-10", "2026-07-24"]);
});

test("weekly lands on the anchor's weekday", () => {
  const got = nextPaydays("2026-06-05", "weekly", 2, FROM).map(iso);
  assert.deepEqual(got, ["2026-06-26", "2026-07-03"]);
});

test("monthly keeps the anchor day-of-month", () => {
  const got = nextPaydays("2026-01-15", "monthly", 2, FROM).map(iso);
  assert.deepEqual(got, ["2026-07-15", "2026-08-15"]);
});

test("monthly clamps to the last day of short months", () => {
  // pay on the 31st → February clamps to the 28th (2027 is not a leap year)
  const got = nextPaydays("2026-01-31", "monthly", 1, new Date("2027-02-01T12:00:00Z")).map(iso);
  assert.deepEqual(got, ["2027-02-28"]);
});

test("semimonthly pays twice a month (day & day+15)", () => {
  const got = nextPaydays("2026-06-01", "semimonthly", 3, FROM).map(iso);
  // from June 21: next are 07-01, 07-16, 08-01 (June's 1st & 16th already passed)
  assert.deepEqual(got, ["2026-07-01", "2026-07-16", "2026-08-01"]);
});

test("semimonthly with an anchor day > 15 pairs day-15 & day (no month-end artifact)", () => {
  // anchor on the 20th → {5th, 20th}, not {20th, month-end}
  const got = nextPaydays("2026-06-20", "semimonthly", 3, FROM).map(iso);
  assert.deepEqual(got, ["2026-07-05", "2026-07-20", "2026-08-05"]);
});

test("no/invalid anchor → no dates", () => {
  assert.deepEqual(nextPaydays(null, "weekly", 3, FROM), []);
  assert.deepEqual(nextPaydays("2026-06-12", "nonsense", 3, FROM), []);
});

test("paydaysInMonth lists the day numbers in that month", () => {
  // biweekly anchored 06-12 → June paydays on 12 and 26
  assert.deepEqual(paydaysInMonth("2026-06-12", "biweekly", 2026, 5), [12, 26]);
});
