// finance.js — income/spend derivations shared by BOTH the client and the server
// engine, so the two can't drift. Pure + dependency-free (the server imports this
// directly from client/src). Month buckets use the LOCAL calendar (see monthOf), to
// match the day-bucketing in streak/insights/portfolio and the user's own calendar.

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
  // use the LOCAL current month for the cutoff so it matches monthOf's local
  // bucketing (a UTC slice would, for a few hours after UTC rolls over, count the
  // user's still-current local month as "prior" and average in an incomplete month)
  const ym = monthOf(new Date());
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

/**
 * Fraction of declared income that is taxable (0–1). Use this to scale ANY income
 * figure (typed total OR a learned rolling average) into its taxable portion, rather
 * than subtracting a fixed non-taxable dollar amount — subtraction double-counts when
 * the income figure is learned from logged deposits that may already exclude the
 * non-taxable source. Returns 1 when no sources are declared (assume all taxable).
 * @param {{incomeSources?:Array}} profile
 * @returns {number}
 */
export function taxableShare(profile = {}) {
  const sources = profile.incomeSources || [];
  const total = sources.reduce((s, x) => s + (x.typicalMonthly || 0), 0);
  if (total <= 0) {
    return 1;
  }
  const nonTax = nonTaxableMonthly(profile);
  return Math.max(0, Math.min(1, (total - nonTax) / total));
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

/**
 * Average monthly logged spending (fallback "essentials" estimate when no bills).
 * Excludes the current — still partial — month once at least one complete month of
 * spending exists (the same cutoff `typicalIncome` uses): dividing three days of
 * spend by a whole month deflates the average, making the FIRE number too low,
 * emergency-fund suggestions too small, and runway look longer than it is. When the
 * current month is the ONLY data it counts as-is (a rough figure beats claiming $0).
 * @param {Array} transactions
 * @param {Date|string} [today] - "now" for the current-month cutoff (the engine
 *   passes its asOf so a plan-for-a-date stays consistent)
 */
export function avgMonthlySpend(transactions = [], today = new Date()) {
  const ym = monthOf(today);
  const byMonth = {};
  for (const t of transactions) {
    if (t.type === "spending" && t.amount > 0) {
      const m = monthOf(t.date);
      if (m) {
        byMonth[m] = (byMonth[m] || 0) + t.amount;
      }
    }
  }
  const complete = Object.keys(byMonth).filter((m) => m < ym);
  const months = complete.length ? complete : Object.keys(byMonth);
  if (!months.length) {
    return 0;
  }
  return months.reduce((s, m) => s + byMonth[m], 0) / months.length;
}
