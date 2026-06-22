// recurring.js — one-tap "log this month's paychecks". Pure + testable: from your
// income sources (cadence + payday) it lists the paychecks that should have landed
// this month and aren't logged yet, so logging recurring income isn't manual toil.
import { CADENCE } from "./cadence.js";
import { paydaysInMonth } from "./paydays.js";
import { monthKey } from "./selectors.js";

/**
 * Paychecks expected on/before today this month that aren't already logged.
 * @returns {Array<{type, amount, date, sourceId, note}>} (ids assigned by the caller)
 */
export function pendingPaychecks(profile = {}, transactions = [], today = new Date()) {
  const ym = monthKey(today);
  const y = today.getFullYear();
  const m = today.getMonth();
  const todayDay = today.getDate();
  // count income already logged this month per source — robust to logging a
  // paycheck a day early/late (we compare counts, not exact days)
  const loggedCount = {};
  for (const t of transactions) {
    if (t.type === "income" && monthKey(t.date) === ym && t.sourceId) {
      loggedCount[t.sourceId] = (loggedCount[t.sourceId] || 0) + 1;
    }
  }
  const out = [];
  for (const s of profile.incomeSources || []) {
    if (!s.payday || !CADENCE[s.cadence] || !(s.typicalMonthly > 0)) {
      continue;
    }
    const perCheck = Math.round(s.typicalMonthly / CADENCE[s.cadence]);
    // expected paydays on/before today; assume the earliest already-logged ones
    // are covered and only offer the remainder
    const dueDays = paydaysInMonth(s.payday, s.cadence, y, m).filter((d) => d <= todayDay);
    for (const day of dueDays.slice(loggedCount[s.id] || 0)) {
      out.push({
        type: "income",
        amount: perCheck,
        date: new Date(y, m, day).toISOString(),
        sourceId: s.id,
        note: s.name || "Paycheck",
      });
    }
  }
  return out;
}
