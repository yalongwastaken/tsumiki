// budgets.js — envelope-style monthly category budgets. Pure + testable: given the
// ledger and a {category: monthlyCap} map, report this month's spend vs each cap.
import { monthKey, thisMonth } from "./selectors.js";

/**
 * This month's spend per budgeted category vs its cap.
 * @param {Array} transactions
 * @param {Object} budgets - map of category → monthly dollar cap
 * @param {string} [ym] - month key, defaults to the current month
 * @returns {Array<{cat, spent, budget, pct, remaining, over}>} sorted by pct desc
 */
export function budgetStatus(transactions = [], budgets = {}, ym = thisMonth()) {
  const spent = {};
  for (const t of transactions) {
    if (t.type === "spending" && t.amount > 0 && monthKey(t.date) === ym) {
      const c = t.cat || "Other";
      spent[c] = (spent[c] || 0) + t.amount;
    }
  }
  return Object.entries(budgets)
    .filter(([, cap]) => cap > 0)
    .map(([cat, cap]) => {
      const s = spent[cat] || 0;
      return {
        cat,
        spent: s,
        budget: cap,
        pct: cap > 0 ? s / cap : 0,
        remaining: cap - s,
        over: s > cap,
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
