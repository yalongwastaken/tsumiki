// finance.js — income/spend derivations shared by BOTH the client and the server
// engine, so the two can't drift. Pure + dependency-free (the server imports this
// directly from client/src). Month buckets use a UTC slice for stability.

// "YYYY-MM" for a date; "" for an unparseable one (so a single bad/corrupt
// transaction date can't throw "Invalid time value" and crash the whole view).
// A bare "YYYY-MM-DD" returns its month verbatim (timezone-independent). A full
// timestamp is bucketed by LOCAL month — transactions are stamped with the local
// instant, so a late-evening spend on the last day of the month must not slip into
// the next month (which a UTC slice would do in western timezones).
export const monthOf = (date) => {
  if (typeof date === "string") {
    const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (bare) {
      return `${bare[1]}-${bare[2]}`;
    }
  }
  const d = new Date(date);
  return isNaN(d.getTime())
    ? ""
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Typical monthly income: a rolling average of complete prior months once there's
 * enough logged history (≥2 months), else the typed source totals.
 * @param {{profile?:Object, transactions?:Array}} state
 * @returns {number}
 */
export function typicalIncome({ profile = {}, transactions = [] } = {}) {
  const sources = profile.incomeSources || [];
  const typed = sources.length
    ? sources.reduce((s, x) => s + (x.typicalMonthly || 0), 0)
    : profile.typicalIncome || 0;
  const ym = new Date().toISOString().slice(0, 7);
  const byMonth = {};
  for (const t of transactions) {
    if (t.type === "income") {
      const m = monthOf(t.date);
      if (m && m < ym) {
        byMonth[m] = (byMonth[m] || 0) + t.amount;
      }
    }
  }
  const months = Object.values(byMonth);
  if (months.length >= 2) {
    return Math.round(months.reduce((a, b) => a + b, 0) / months.length);
  }
  return typed;
}

/**
 * Sum of declared monthly income from sources flagged non-taxable (e.g. Roth
 * withdrawals, gifts, child support, disability, muni-bond interest). Counts toward
 * planning but should be excluded from the tax estimate's gross.
 * @param {{incomeSources?:Array}} profile
 * @returns {number}
 */
export function nonTaxableMonthly(profile = {}) {
  return (profile.incomeSources || [])
    .filter((s) => s.taxable === false)
    .reduce((sum, s) => sum + (s.typicalMonthly || 0), 0);
}

/** Average logged income per month across ALL months with income (incl. the current). */
export function avgMonthlyIncome(transactions = []) {
  const byMonth = {};
  for (const t of transactions) {
    if (t.type === "income" && t.amount > 0) {
      const m = monthOf(t.date);
      if (m) {
        byMonth[m] = (byMonth[m] || 0) + t.amount;
      }
    }
  }
  const vals = Object.values(byMonth);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

/** Average monthly logged spending (fallback "essentials" estimate when no bills). */
export function avgMonthlySpend(transactions = []) {
  const sp = transactions.filter((t) => t.type === "spending" && t.amount > 0);
  if (!sp.length) {
    return 0;
  }
  const months = new Set(sp.map((t) => monthOf(t.date)).filter(Boolean));
  return sp.reduce((s, t) => s + t.amount, 0) / Math.max(1, months.size);
}
