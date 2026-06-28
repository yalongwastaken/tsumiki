// budgets.js — envelope-style category budgets. Pure + testable. A budget is a
// {category: monthlyCap} map; an optional per-category options map adds:
//   • rollover: true  — unused budget carries forward and overspend carries back
//                       (net "envelope" balance accumulated over trailing months)
//   • period: "annual" — the cap is a once-a-year cap tracked against the calendar
//                        year's spend, instead of a monthly cap
import { monthKey, thisMonth } from "./selectors.js";

const ROLLOVER_LOOKBACK = 12; // cap how many trailing months a rollover balance spans

// the month key immediately before `ym` ("2026-06" → "2026-05")
function prevMonthKey(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // m is 1-based; m-2 = previous month (0-based)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const addMonth = (key) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m, 1); // m (1-based) as 0-based next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Net rollover balance carried INTO month `ym` for a category: the running sum of
 * (cap − spent) over complete prior months, from the category's first active month
 * (bounded to the last ROLLOVER_LOOKBACK months) up to the month before `ym`.
 * @returns {number} positive = saved-up cushion, negative = overspend debt
 */
export function rolloverBalance(byMonth = {}, cap = 0, ym = thisMonth()) {
  const priorMonths = Object.keys(byMonth)
    .filter((m) => m < ym)
    .sort();
  if (!priorMonths.length || !(cap > 0)) {
    return 0;
  }
  // start at the later of first-active-month and (ym − lookback)
  const earliestAllowed = (() => {
    let k = ym;
    for (let i = 0; i < ROLLOVER_LOOKBACK; i++) {
      k = prevMonthKey(k);
    }
    return k;
  })();
  let key = priorMonths[0] < earliestAllowed ? earliestAllowed : priorMonths[0];
  let carry = 0;
  while (key < ym) {
    carry += cap - (byMonth[key] || 0);
    key = addMonth(key);
  }
  return carry;
}

/**
 * This month's spend per budgeted category vs its cap, with pace + last-month context.
 * Honors per-category rollover and annual periods via `opts`.
 * @param {Array} transactions
 * @param {Object} budgets - map of category → cap (monthly, or annual when period=annual)
 * @param {string} [ym] - month key, defaults to the current month
 * @param {Date} [today] - to compute days left (only when ym is the current month)
 * @param {Object} [opts] - map of category → { rollover?:bool, period?:"annual" }
 * @returns {Array<{cat, spent, budget, cap, pct, remaining, over, perDayLeft, lastMonth, daysLeft, period, rollover, carry}>}
 */
export function budgetStatus(
  transactions = [],
  budgets = {},
  ym = thisMonth(),
  today = new Date(),
  opts = {},
) {
  const prev = prevMonthKey(ym);
  const year = ym.slice(0, 4);
  // per-category: spend this month, last month, this year, and a month→spend map
  const spent = {};
  const lastSpent = {};
  const yearSpent = {};
  const byMonth = {}; // cat → { "YYYY-MM": amount }
  for (const t of transactions) {
    if (t.type !== "spending" || !(t.amount > 0)) {
      continue;
    }
    const c = t.cat || "Other";
    const m = monthKey(t.date);
    if (!m) {
      continue;
    }
    (byMonth[c] ??= {})[m] = (byMonth[c][m] || 0) + t.amount;
    if (m === ym) {
      spent[c] = (spent[c] || 0) + t.amount;
    } else if (m === prev) {
      lastSpent[c] = (lastSpent[c] || 0) + t.amount;
    }
    if (m.slice(0, 4) === year) {
      yearSpent[c] = (yearSpent[c] || 0) + t.amount;
    }
  }
  const isCurrentMonth = ym === monthKey(today);
  // days left in the current month / year (for the per-day pace)
  const monthDaysLeft = isCurrentMonth
    ? Math.max(
        1,
        new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate() + 1,
      )
    : null;
  const isCurrentYear = String(today.getFullYear()) === year;
  const yearDaysLeft = isCurrentYear
    ? (() => {
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const end = new Date(today.getFullYear(), 11, 31);
        return Math.max(1, Math.round((end - start) / 86400000) + 1); // incl. today
      })()
    : null;

  return Object.entries(budgets)
    .filter(([, cap]) => cap > 0)
    .map(([cat, cap]) => {
      const o = opts[cat] || {};
      const annual = o.period === "annual";
      if (annual) {
        const s = yearSpent[cat] || 0;
        const remaining = cap - s;
        return {
          cat,
          spent: s,
          cap,
          budget: cap,
          pct: s / cap,
          remaining,
          over: s > cap,
          perDayLeft: yearDaysLeft && remaining > 0 ? remaining / yearDaysLeft : 0,
          lastMonth: lastSpent[cat] || 0,
          daysLeft: yearDaysLeft,
          period: "annual",
          rollover: false,
          carry: 0,
        };
      }
      const s = spent[cat] || 0;
      const carry = o.rollover ? rolloverBalance(byMonth[cat] || {}, cap, ym) : 0;
      const effectiveCap = cap + carry; // envelope balance available this month
      const remaining = effectiveCap - s;
      return {
        cat,
        spent: s,
        cap,
        budget: effectiveCap,
        pct: effectiveCap > 0 ? s / effectiveCap : s > 0 ? 1 : 0,
        remaining,
        over: s > effectiveCap,
        perDayLeft: monthDaysLeft && remaining > 0 ? remaining / monthDaysLeft : 0,
        lastMonth: lastSpent[cat] || 0,
        daysLeft: monthDaysLeft,
        period: "monthly",
        rollover: !!o.rollover,
        carry,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

/**
 * The single most-pressing budget alert for the coach (over, or ≥90% used), or null.
 * @returns {{cat, spent, budget, pct, over}|null}
 */
export function budgetAlert(rows = []) {
  return rows.find((r) => r.over || r.pct >= 0.9) || null;
}

/**
 * Suggested monthly budgets = average monthly spend per category over the last
 * `months` complete months (rounded), for a one-tap "budget from my spending".
 * @returns {Object} map of category → suggested cap
 */
export function categoryAverages(transactions = [], months = 3, today = new Date()) {
  // compare by local month key (not a UTC `new Date(bareDate)`), so a bare-date txn on a
  // month boundary buckets the same in every timezone
  const cutoffYm = monthKey(new Date(today.getFullYear(), today.getMonth() - months, 1));
  const ym = monthKey(today);
  const byCat = {};
  const monthsSeen = {};
  for (const t of transactions) {
    if (t.type !== "spending" || !(t.amount > 0)) {
      continue;
    }
    const m = monthKey(t.date);
    if (m < cutoffYm || m === ym) {
      continue; // only complete prior months within the window
    }
    const c = t.cat || "Other";
    byCat[c] = (byCat[c] || 0) + t.amount;
    (monthsSeen[c] = monthsSeen[c] || new Set()).add(m);
  }
  const out = {};
  for (const c of Object.keys(byCat)) {
    out[c] = Math.round(byCat[c] / Math.max(1, monthsSeen[c].size));
  }
  return out;
}
