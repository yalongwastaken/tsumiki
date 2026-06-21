// paydays.js — project concrete payday dates from an anchor date + cadence.
import { isCadence } from "./cadence.js";

const DAY = 86400000;

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
// parse a "YYYY-MM-DD" anchor as a LOCAL date (not UTC), so generated paydays —
// built with local new Date(y, m, d) — line up with the anchor in every timezone.
const parseLocal = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
};

/**
 * The next `count` payday dates on/after `from`, given an anchor payday + cadence.
 * @param {string} anchorISO - a known payday date (any past/future occurrence)
 * @param {string} cadence - weekly | biweekly | semimonthly | monthly
 * @returns {Date[]} ascending dates (empty if no/invalid anchor)
 */
export function nextPaydays(anchorISO, cadence, count = 4, from = new Date()) {
  if (!anchorISO || !isCadence(cadence)) {
    return [];
  }
  const today = startOfDay(from);
  const anchor = startOfDay(parseLocal(anchorISO));
  if (isNaN(anchor.getTime())) {
    return [];
  }
  const out = [];

  if (cadence === "weekly" || cadence === "biweekly") {
    const stride = (cadence === "weekly" ? 7 : 14) * DAY;
    let t = anchor.getTime();
    if (t < today.getTime()) {
      // jump forward to the first occurrence on/after today
      t += Math.ceil((today.getTime() - t) / stride) * stride;
    }
    while (out.length < count) {
      out.push(new Date(t));
      t += stride;
    }
    return out;
  }

  // monthly / semimonthly: walk month by month.
  // semimonthly = two days 15 apart, derived from the anchor day (works for any
  // anchor, not just day ≤ 15): e.g. anchor 20th → {5th, 20th}, anchor 1st → {1st, 16th}.
  const day = anchor.getDate();
  const other = day > 15 ? day - 15 : day + 15;
  let y = today.getFullYear();
  let m = today.getMonth();
  while (out.length < count) {
    const dim = daysInMonth(y, m);
    const days =
      cadence === "monthly"
        ? [Math.min(day, dim)]
        : [...new Set([Math.min(day, dim), Math.min(other, dim)])].sort((a, b) => a - b);
    for (const dd of days) {
      const d = new Date(y, m, dd);
      if (d >= today && out.length < count && !out.some((x) => x.getTime() === d.getTime())) {
        out.push(d);
      }
    }
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return out;
}

/**
 * Day-of-month numbers a source pays within a given calendar month.
 * @returns {number[]}
 */
export function paydaysInMonth(anchorISO, cadence, year, month) {
  if (!anchorISO || !isCadence(cadence)) {
    return [];
  }
  const start = new Date(year, month, 1);
  const next = nextPaydays(anchorISO, cadence, 10, start);
  return next
    .filter((d) => d.getFullYear() === year && d.getMonth() === month)
    .map((d) => d.getDate());
}
