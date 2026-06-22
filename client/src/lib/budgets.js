// budgets.js — envelope-style monthly category budgets. Pure + testable: given the
// ledger and a {category: monthlyCap} map, report this month's spend vs each cap,
// what's left per remaining day, and how it compares to last month.
import { monthKey, thisMonth } from "./selectors.js";

// the month key immediately before `ym` ("2026-06" → "2026-05")
function prevMonthKey(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // m is 1-based; m-2 = previous month (0-based)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * This month's spend per budgeted category vs its cap, with pace + last-month context.
 * @param {Array} transactions
 * @param {Object} budgets - map of category → monthly dollar cap
 * @param {string} [ym] - month key, defaults to the current month
 * @param {Date} [today] - to compute days left (only when ym is the current month)
 * @returns {Array<{cat, spent, budget, pct, remaining, over, perDayLeft, lastMonth, daysLeft}>}
 */
export function budgetStatus(
  transactions = [],
  budgets = {},
  ym = thisMonth(),
  today = new Date(),
) {
  const prev = prevMonthKey(ym);
  const spent = {};
  const lastSpent = {};
  for (const t of transactions) {
    if (t.type !== "spending" || !(t.amount > 0)) {
      continue;
    }
    const c = t.cat || "Other";
    const m = monthKey(t.date);
    if (m === ym) {
      spent[c] = (spent[c] || 0) + t.amount;
    } else if (m === prev) {
      lastSpent[c] = (lastSpent[c] || 0) + t.amount;
    }
  }
  // days left in the month (incl. today) — only meaningful for the current month
  let daysLeft = null;
  if (ym === monthKey(today)) {
    const dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    daysLeft = Math.max(1, dim - today.getDate() + 1);
  }
  return Object.entries(budgets)
    .filter(([, cap]) => cap > 0)
    .map(([cat, cap]) => {
      const s = spent[cat] || 0;
      const remaining = cap - s;
      return {
        cat,
        spent: s,
        budget: cap,
        pct: cap > 0 ? s / cap : 0,
        remaining,
        over: s > cap,
        // budget left spread over the days remaining this month (0 if over/none left)
        perDayLeft: daysLeft && remaining > 0 ? remaining / daysLeft : 0,
        lastMonth: lastSpent[cat] || 0,
        daysLeft,
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
  const cutoff = new Date(today.getFullYear(), today.getMonth() - months, 1);
  const ym = monthKey(today);
  const byCat = {};
  const monthsSeen = {};
  for (const t of transactions) {
    if (t.type !== "spending" || !(t.amount > 0)) {
      continue;
    }
    const d = new Date(t.date);
    const m = monthKey(t.date);
    if (d < cutoff || m === ym) {
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
