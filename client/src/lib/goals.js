// goals.js — progress + pace math for user money goals. Pure + testable: given a
// goal's target amount, the current value of its metric, and an optional target
// date, work out percent done and the monthly savings needed to land on time.

// parse a value to a local-midnight Date. A bare "YYYY-MM-DD" is treated as a
// LOCAL calendar date (not UTC midnight) so month math doesn't shift a day in
// negative-offset timezones.
const startOfDay = (d) => {
  if (typeof d === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
  }
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * Whole calendar months from `today` until `dateStr` (YYYY-MM-DD). 0 when the date
 * is today/past; ≥1 for any future date. Calendar-based (not a 30.44-day divide) so
 * a goal ~1 month out doesn't round to 2 and halve the required monthly amount.
 * @returns {number|null} null when no/invalid date
 */
function monthsUntil(dateStr, today = new Date()) {
  if (!dateStr) {
    return null;
  }
  const d = startOfDay(dateStr);
  if (isNaN(d.getTime())) {
    return null;
  }
  const t = startOfDay(today);
  if (d <= t) {
    return 0; // due today or in the past
  }
  let m = (d.getFullYear() - t.getFullYear()) * 12 + (d.getMonth() - t.getMonth());
  if (d.getDate() < t.getDate()) {
    m -= 1; // not a full month elapsed yet
  }
  return Math.max(1, m); // any future date is at least one month of runway
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
