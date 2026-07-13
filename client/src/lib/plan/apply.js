// apply.js — close the plan → action gap: turn this month's remaining plan targets
// into loggable contribution entries ("I moved the money — record it").
// Pure: amounts are the per-bucket GAP (target − already-logged actual), so tapping
// mid-month never double-logs what you've already contributed.

const CONTRIBUTION_BUCKETS = ["emergency", "retirement", "invest", "debt"];

/**
 * The still-unlogged portion of each plan bucket.
 * @param {Object} target - per-bucket monthly targets (Plan.jsx's collapsed engine steps)
 * @param {Object} actual - per-bucket contributions already logged this month
 * @returns {Array<{bucket, amount}>} only buckets with a positive gap
 */
export function contributionGaps(target = {}, actual = {}) {
  return CONTRIBUTION_BUCKETS.map((bucket) => ({
    bucket,
    amount: Math.round(Math.max(0, (Number(target[bucket]) || 0) - (Number(actual[bucket]) || 0))),
  })).filter((g) => g.amount > 0);
}

/** Total of all gaps (for the button label). */
export const gapsTotal = (gaps) => gaps.reduce((s, g) => s + g.amount, 0);
