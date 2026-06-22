// goals.js — progress + pace math for user money goals. Pure + testable: given a
// goal's target amount, the current value of its metric, and an optional target
// date, work out percent done and the monthly savings needed to land on time.

/**
 * Months from `today` until `dateStr` (YYYY-MM-DD), rounded up, min 0.
 * @returns {number|null} null when no date
 */
function monthsUntil(dateStr, today = new Date()) {
  if (!dateStr) {
    return null;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    return null;
  }
  const ms = d.getTime() - today.getTime();
  return Math.max(0, Math.ceil(ms / (30.44 * 86400000)));
}

/**
 * Progress + pace for one goal.
 * @param {{amount:number, targetDate?:string}} goal
 * @param {number} current - current value of the goal's metric
 * @param {Date} [today]
 * @param {number|null} [monthlyPace] - your actual recent saving rate, to judge on-track
 * @returns {{pct, reached, remaining, monthsLeft, requiredMonthly, overdue, onTrack, behindBy}}
 */
export function goalProgress(goal, current = 0, today = new Date(), monthlyPace = null) {
  const amount = Math.max(0, goal?.amount || 0);
  const remaining = Math.max(0, amount - current);
  const reached = amount > 0 && current >= amount;
  const monthsLeft = monthsUntil(goal?.targetDate, today);
  // overdue = a date that's already passed but the goal isn't met yet
  const overdue = monthsLeft === 0 && !reached && !!goal?.targetDate;
  // dollars/month to close the gap by the target date (null when no date or done)
  const requiredMonthly =
    monthsLeft && monthsLeft > 0 && !reached ? Math.ceil(remaining / monthsLeft) : null;
  // compare the required pace to what you're actually saving (null if unknown)
  const haveBoth = requiredMonthly != null && monthlyPace != null;
  const onTrack = haveBoth ? monthlyPace >= requiredMonthly : null;
  const behindBy = haveBoth ? Math.max(0, requiredMonthly - monthlyPace) : null;
  return {
    pct: amount > 0 ? Math.min(1, current / amount) : 0,
    reached,
    remaining,
    monthsLeft,
    requiredMonthly,
    overdue,
    onTrack,
    behindBy,
  };
}
