// income.js — "typical monthly income" estimate (mirrors server engine.typicalIncome).

/**
 * Best estimate of typical monthly income: prefer a rolling average of complete
 * prior months once there's enough logged history, else the typed source totals.
 * @returns {number}
 */
export function typicalIncome(profile, transactions = []) {
  const sources = profile?.incomeSources || [];
  const typed = sources.length
    ? sources.reduce((sum, x) => sum + (x.typicalMonthly || 0), 0)
    : profile?.typicalIncome || 0;

  // sum logged income per complete prior month (skip the in-progress month)
  const ym = new Date().toISOString().slice(0, 7);
  const byMonth = {};
  for (const tx of transactions) {
    if (tx.type !== "income") {
      continue;
    }
    const m = new Date(tx.date).toISOString().slice(0, 7);
    if (m < ym) {
      byMonth[m] = (byMonth[m] || 0) + tx.amount;
    }
  }

  // need ≥2 complete months before trusting history over the typed estimate
  const months = Object.values(byMonth);
  if (months.length >= 2) {
    return Math.round(months.reduce((a, b) => a + b, 0) / months.length);
  }
  return typed;
}
