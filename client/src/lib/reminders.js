// reminders.js — time-based alerts derived from the current model + "today": an
// upcoming payday, a bill due soon, a checking balance below its buffer, an estimated-
// tax deadline, and a streak about to lapse. Pure and dependency-light so it can drive
// both the in-app alerts and (opt-in) server-scheduled push.
import { nextPaydays } from "./paydays.js";
import { nextQuarterlyDue } from "./tax.js";
import { computeDailyStreak } from "./streak.js";
import { sumLatestByType } from "./selectors.js";
import { fmt } from "./format.js";

const DAY = 86400000;
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const daysBetween = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / DAY);
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const shortDate = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const plural = (n) => (n === 1 ? "" : "s");

// next calendar occurrence of a day-of-month on/after `today` (clamped to month length)
function nextDayOfMonth(dom, today) {
  const t = startOfDay(today);
  const y = t.getFullYear();
  const m = t.getMonth();
  const here = new Date(y, m, Math.min(dom, daysInMonth(y, m)));
  if (here >= t) {
    return here;
  }
  const m2 = (m + 1) % 12;
  const y2 = m + 1 > 11 ? y + 1 : y;
  return new Date(y2, m2, Math.min(dom, daysInMonth(y2, m2)));
}

/**
 * Active reminders for the current model.
 * @param {{profile?,accounts?,snapshots?,transactions?,settings?}} state
 * @param {Date} [today]
 * @param {{horizonDays?:number, taxHorizonDays?:number}} [opts]
 * @returns {Array<{id,kind,severity,title,detail,date?}>} severity: info|warn|urgent
 */
export function computeReminders(state = {}, today = new Date(), opts = {}) {
  const { profile = {}, accounts = [], snapshots = [], transactions = [], settings = {} } = state;
  const horizon = opts.horizonDays ?? 5;
  const taxHorizon = opts.taxHorizonDays ?? 14;
  const out = [];

  // upcoming paydays (one per income source that has a date + cadence)
  for (const s of profile.incomeSources || []) {
    const next = nextPaydays(s.payday, s.cadence, 1, today)[0];
    if (!next) {
      continue;
    }
    const d = daysBetween(next, today);
    if (d >= 0 && d <= horizon) {
      out.push({
        id: `payday-${s.id}-${next.toISOString().slice(0, 10)}`,
        kind: "payday",
        severity: "info",
        title: d === 0 ? `${s.name} payday today` : `${s.name} payday in ${d} day${plural(d)}`,
        detail: "Time to move money toward your plan.",
        date: next.toISOString().slice(0, 10),
      });
    }
  }

  // bills due soon (only bills with a day-of-month set)
  for (const b of profile.bills || []) {
    if (!b.dayOfMonth) {
      continue;
    }
    const next = nextDayOfMonth(b.dayOfMonth, today);
    const d = daysBetween(next, today);
    if (d >= 0 && d <= horizon) {
      out.push({
        id: `bill-${b.id}-${next.toISOString().slice(0, 10)}`,
        kind: "bill",
        severity: d <= 2 ? "warn" : "info",
        title: d === 0 ? `${b.name} due today` : `${b.name} due in ${d} day${plural(d)}`,
        detail: `${b.amount ? `${fmt(b.amount)} · ` : ""}${shortDate(next)}`,
        date: next.toISOString().slice(0, 10),
      });
    }
  }

  // checking below its buffer floor
  const floor = Number(profile.checkingFloor) || 0;
  if (floor > 0) {
    const checking = sumLatestByType(accounts, snapshots, ["checking"]);
    if (checking < floor) {
      out.push({
        id: "buffer-low",
        kind: "buffer",
        severity: "warn",
        title: "Checking below your buffer",
        detail: `${fmt(checking)} in checking · target ${fmt(floor)}.`,
      });
    }
  }

  // self-employed estimated taxes coming due (no withholding → set money aside)
  if ((profile.incomeSources || []).some((s) => s.type === "self_employed")) {
    const due = nextQuarterlyDue(today);
    const d = daysBetween(due, today);
    if (d >= 0 && d <= taxHorizon) {
      out.push({
        id: `tax-${due.toISOString().slice(0, 10)}`,
        kind: "tax",
        severity: d <= 7 ? "warn" : "info",
        title: d === 0 ? "Estimated taxes due today" : `Estimated taxes due ${shortDate(due)}`,
        detail: "Self-employed income isn't withheld — set aside your quarterly payment.",
        date: due.toISOString().slice(0, 10),
      });
    }
  }

  // daily streak about to lapse (nothing logged today, with a run going)
  const freezes = settings.streakFreezes ?? 2;
  const streak = computeDailyStreak(transactions, freezes, +today);
  if (!streak.loggedToday && streak.current > 0) {
    out.push({
      id: "streak-risk",
      kind: "streak",
      severity: streak.current >= 7 ? "warn" : "info",
      title: `Keep your ${streak.current}-day streak`,
      detail: "Log anything today — even a no-spend day counts.",
    });
  }

  // honor per-kind preferences (settings.reminders[kind] === false turns one off;
  // anything not explicitly disabled stays on), then sort urgent → soonest dated.
  const prefs = settings.reminders || {};
  const rank = { urgent: 0, warn: 1, info: 2 };
  return out
    .filter((r) => prefs[r.kind] !== false)
    .sort(
      (a, b) => rank[a.severity] - rank[b.severity] || (a.date || "").localeCompare(b.date || ""),
    );
}
