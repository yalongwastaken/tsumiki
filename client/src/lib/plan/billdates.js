// billdates.js — resolve when a bill falls due in a given month from a flexible
// schedule. Pure + TZ-safe (all dates built with local new Date(y, m, d)). Supports
// a fixed day-of-month plus calendar shapes that a plain day number can't express:
// the last day, the last business day, an Nth weekday (e.g. "first Monday"), and the
// last weekday (e.g. "last Friday"). Legacy bills carrying only `dayOfMonth` keep
// working unchanged.
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const isBusiness = (d) => d.getDay() >= 1 && d.getDay() <= 5; // Mon–Fri
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NTH = ["", "first", "second", "third", "fourth", "fifth"];
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** Normalize a bill into a schedule descriptor (or null if it has no due date).
 * New bills carry `due: {kind, ...}`; legacy bills carry a bare `dayOfMonth`. */
export function scheduleOf(bill = {}) {
  if (bill.due && typeof bill.due === "object") {
    return bill.due;
  }
  if (bill.dayOfMonth) {
    return { kind: "day", day: Number(bill.dayOfMonth) };
  }
  return null;
}

/**
 * The day-of-month (1..31) a bill is due in the given calendar month, or null if it
 * doesn't fall that month (e.g. a "5th Monday" in a month with only four).
 * @param {object} bill - a bill (with `due` or legacy `dayOfMonth`)
 * @param {number} year
 * @param {number} month - 0-based
 * @returns {number|null}
 */
export function billDueDay(bill, year, month) {
  const due = scheduleOf(bill);
  if (!due) {
    return null;
  }
  const dim = daysInMonth(year, month);
  switch (due.kind) {
    case "day": {
      const day = Number(due.day);
      return day >= 1 && day <= 31 ? Math.min(day, dim) : null; // clamp short months
    }
    case "lastDay":
      return dim;
    case "lastBusinessDay": {
      const d = new Date(year, month, dim);
      while (!isBusiness(d)) {
        d.setDate(d.getDate() - 1);
      }
      return d.getDate();
    }
    case "nthWeekday": {
      const wd = Number(due.weekday);
      const n = Number(due.n);
      if (!(wd >= 0 && wd <= 6) || !(n >= 1 && n <= 5)) {
        return null;
      }
      const offset = (wd - new Date(year, month, 1).getDay() + 7) % 7;
      const day = 1 + offset + (n - 1) * 7;
      return day <= dim ? day : null; // the 5th occurrence may not exist
    }
    case "lastWeekday": {
      const wd = Number(due.weekday);
      if (!(wd >= 0 && wd <= 6)) {
        return null;
      }
      const d = new Date(year, month, dim);
      while (d.getDay() !== wd) {
        d.setDate(d.getDate() - 1);
      }
      return d.getDate();
    }
    default:
      return null;
  }
}

/**
 * The next calendar date (local midnight) a bill is due, on/after `today`.
 * Scans up to 13 months so a sometimes-absent shape still resolves.
 * @returns {Date|null}
 */
export function nextBillDue(bill, today = new Date()) {
  const t = startOfDay(today);
  for (let i = 0; i < 13; i++) {
    const base = t.getMonth() + i;
    const y = t.getFullYear() + Math.floor(base / 12);
    const m = ((base % 12) + 12) % 12;
    const day = billDueDay(bill, y, m);
    if (day == null) {
      continue;
    }
    const d = new Date(y, m, day);
    if (d >= t) {
      return d;
    }
  }
  return null;
}

/** Short human label for a bill's schedule, e.g. "15th", "last business day",
 * "first Monday", "last Friday". Empty string when there's no schedule. */
export function scheduleLabel(bill) {
  const due = scheduleOf(bill);
  if (!due) {
    return "";
  }
  switch (due.kind) {
    case "day":
      return Number.isFinite(Number(due.day)) ? ordinal(Number(due.day)) : "";
    case "lastDay":
      return "last day";
    case "lastBusinessDay":
      return "last business day";
    case "nthWeekday":
      return `${NTH[Number(due.n)] || ""} ${WEEKDAY[Number(due.weekday)] || ""}`.trim();
    case "lastWeekday":
      return `last ${WEEKDAY[Number(due.weekday)] || ""}`.trim();
    default:
      return "";
  }
}
