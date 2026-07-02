// insights.js — pure, explainable "smart" derivations over the ledger + plan.
// No AI/network: deterministic rules so every number is testable and defensible.
import { monthKey, sumLatestByType, dayKey } from "../core/selectors.js";
import { nextPaydays } from "../plan/paydays.js";
import { CADENCE } from "../plan/cadence.js";
import { scheduleOf, billDueDay } from "../plan/billdates.js";

const DAY = 86400000;
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
// parse a bare YYYY-MM-DD as a LOCAL calendar day (not UTC midnight); pass other
// values through to Date so a full ISO timestamp keeps its instant
const parseLocalDay = (s) => {
  if (typeof s === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) {
      return new Date(+m[1], +m[2] - 1, +m[3]);
    }
  }
  return new Date(s);
};
// local calendar-day key (not UTC) so payday/bill buckets match the displayed day
const localKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Average daily discretionary spend over the last `days` days (real spend only). */
export function avgDailySpend(transactions = [], days = 60, today = new Date()) {
  if (days <= 0) {
    return 0;
  }
  // calendar math, not `- days * DAY`: a fixed-ms window boundary drifts an hour
  // across DST and can drop/keep a transaction on the edge day
  const t0 = startOfDay(today);
  const cutoff = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - days).getTime();
  let total = 0;
  for (const t of transactions) {
    if (
      t.type === "spending" &&
      t.amount > 0 &&
      startOfDay(parseLocalDay(t.date)).getTime() >= cutoff
    ) {
      total += t.amount;
    }
  }
  return total / days;
}

/**
 * Project the checking balance forward, day by day, from known paydays (inflows),
 * scheduled bills (outflows), and typical daily spend. Flags the first dip below
 * the checking floor. Honest estimate — does not assume the planned transfers.
 * @returns {{series, min, minDate, floor, dipsBelow, dipDate, start}}
 */
export function cashflowForecast(state = {}, { days = 45, today = new Date() } = {}) {
  const { accounts = [], snapshots = [], profile = {}, transactions = [] } = state;
  const floor = Math.max(0, profile.checkingFloor || 0);
  const start = sumLatestByType(accounts, snapshots, ["checking"]);
  const billDays = (profile.bills || []).filter((b) => scheduleOf(b) && b.amount > 0);
  const monthlyBills = billDays.reduce((s, b) => s + b.amount, 0);
  const burn = avgDailySpend(transactions, 60, today);
  // bills are subtracted on their due dates below. only net them out of the daily
  // burn when logged spend plausibly *includes* them (logged monthly ≥ bill total);
  // if you log only discretionary, subtracting would hide a real dip.
  const billsLikelyLogged = burn * 30 >= monthlyBills;
  const daily = billsLikelyLogged ? Math.max(0, burn - monthlyBills / 30) : burn;

  // map of local-day key → net change that day (paydays in, bills out)
  const delta = {};
  const addDelta = (d, amt) => {
    const k = localKey(startOfDay(d));
    delta[k] = (delta[k] || 0) + amt;
  };
  let modeledInflow = false;
  for (const s of profile.incomeSources || []) {
    if (!s.payday || !CADENCE[s.cadence]) {
      continue;
    }
    const perCheck = (s.typicalMonthly || 0) / CADENCE[s.cadence];
    for (const d of nextPaydays(s.payday, s.cadence, 12, today)) {
      addDelta(d, perCheck);
      modeledInflow = true;
    }
  }
  // if income sources exist but none have a payday, our inflows are incomplete —
  // a declining projection would be a false alarm, so don't claim a dip.
  const incomeSourcesExist = (profile.incomeSources || []).some((s) => (s.typicalMonthly || 0) > 0);
  const inflowsKnown = modeledInflow || !incomeSourcesExist;

  const t0 = startOfDay(today);
  let bal = start;
  let min = start;
  let minDate = new Date(t0);
  let dipDate = null;
  const series = [{ date: new Date(t0), balance: Math.round(bal) }];
  for (let i = 1; i <= days; i++) {
    // calendar-day step: `t0.getTime() + i * DAY` resolves two iterations to the
    // same local date across DST fall-back, double-applying that day's bills/payday
    const day = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + i);
    const key = localKey(day);
    bal += delta[key] || 0;
    // each bill's resolved due-day for this month (handles last day, last business
    // day, Nth/last weekday — clamped to month length inside billDueDay)
    for (const b of billDays) {
      if (billDueDay(b, day.getFullYear(), day.getMonth()) === day.getDate()) {
        bal -= b.amount;
      }
    }
    bal -= daily;
    series.push({ date: day, balance: Math.round(bal) });
    if (bal < min) {
      min = bal;
      minDate = day;
    }
    if (dipDate == null && floor > 0 && bal < floor) {
      dipDate = day;
    }
  }
  return {
    series,
    start: Math.round(start),
    min: Math.round(min),
    minDate,
    floor,
    dipsBelow: dipDate != null && inflowsKnown,
    dipDate: inflowsKnown ? dipDate : null,
    inflowsKnown,
    hasData: start > 0 || daily > 0,
  };
}

/**
 * This month's spending per category vs the average of prior complete months.
 * @returns {Array<{cat, now, avg, delta, dir}>} sorted by absolute dollar change
 */
export function spendingTrends(transactions = [], today = new Date()) {
  const ym = monthKey(today);
  const cur = {};
  const prior = {}; // cat → { month → total }
  for (const t of transactions) {
    if (t.type !== "spending" || !(t.amount > 0)) {
      continue;
    }
    const m = monthKey(t.date);
    const c = t.cat || "Other";
    if (m === ym) {
      cur[c] = (cur[c] || 0) + t.amount;
    } else if (m < ym) {
      (prior[c] = prior[c] || {})[m] = (prior[c]?.[m] || 0) + t.amount;
    }
  }
  const cats = new Set([...Object.keys(cur), ...Object.keys(prior)]);
  const out = [];
  for (const c of cats) {
    const months = Object.values(prior[c] || {});
    const avg = months.length ? months.reduce((a, b) => a + b, 0) / months.length : 0;
    const now = cur[c] || 0;
    const delta = avg > 0 ? (now - avg) / avg : now > 0 ? 1 : 0;
    out.push({
      cat: c,
      now,
      avg,
      delta,
      dir: now > avg * 1.1 ? "up" : now < avg * 0.9 ? "down" : "flat",
    });
  }
  return out
    .filter((x) => x.now > 0 || x.avg > 0)
    .sort((a, b) => Math.abs(b.now - b.avg) - Math.abs(a.now - a.avg));
}

/**
 * Charges that repeat (same merchant/category + rounded amount across ≥3 months) and
 * aren't already tracked as bills — candidates to add as recurring essentials. Keys on
 * the transaction note (merchant) when present so two subscriptions in one category
 * don't collapse into a single generic row.
 * @returns {Array<{label, amount, months}>}
 */
export function detectRecurring(transactions = [], existingBills = []) {
  const seen = {}; // "label\u0000amount" → { label, months:Set }
  for (const t of transactions) {
    if (t.type !== "spending" || !(t.amount > 0)) {
      continue;
    }
    const label = (t.note || "").trim() || t.cat || "Other";
    const key = `${label.toLowerCase()}\u0000${Math.round(t.amount)}`;
    if (!seen[key]) {
      seen[key] = { label, amount: Math.round(t.amount), months: new Set() };
    }
    seen[key].months.add(monthKey(t.date));
  }
  const billNames = new Set((existingBills || []).map((b) => (b.name || "").toLowerCase()));
  const out = [];
  for (const { label, amount, months } of Object.values(seen)) {
    if (months.size >= 3 && !billNames.has(label.toLowerCase())) {
      out.push({ label, amount, months: months.size });
    }
  }
  return out.sort((a, b) => b.months - a.months).slice(0, 5);
}

/**
 * Infer a pay schedule from logged income deposits — the median gap between
 * deposits maps to a cadence, and the latest deposit anchors the next payday.
 * Needs ≥3 distinct deposit days to suggest anything.
 * @returns {{cadence, lastPayday, count, medianGap}|null}
 */
export function detectIncomeSchedule(transactions = []) {
  // normalize each deposit to its LOCAL calendar day (stored dates are local-instant
  // ISO stamps), so gaps and the emitted payday match the user's own calendar — same
  // convention as the streak/forecast/portfolio bucketing
  const localDayMs = (d) => startOfDay(parseLocalDay(d)).getTime();
  const days = [
    ...new Set(
      (transactions || [])
        .filter((t) => t.type === "income" && t.amount > 0)
        .map((t) => localDayMs(t.date)),
    ),
  ].sort((a, b) => a - b);
  if (days.length < 3) {
    return null;
  }
  const gaps = [];
  for (let i = 1; i < days.length; i++) {
    gaps.push(Math.round((days[i] - days[i - 1]) / DAY));
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)];
  // semimonthly (e.g. 1st & 15th) lands on ≤2 days of the month; true biweekly
  // drifts across many days — use that to tell the two ~14-day cadences apart
  const distinctDoms = new Set(days.map((d) => new Date(d).getDate())).size;
  let cadence;
  if (medianGap <= 9) {
    cadence = "weekly";
  } else if (medianGap >= 24) {
    cadence = "monthly";
  } else {
    // need ≥4 deposits before trusting the ≤2-days signal — with only 3, a biweekly
    // run that happens to repeat a day-of-month (e.g. Feb 14/28 → Mar 14) is ambiguous
    cadence = distinctDoms <= 2 && days.length >= 4 ? "semimonthly" : "biweekly";
  }
  const lastPayday = dayKey(new Date(days[days.length - 1])); // local YYYY-MM-DD
  return { cadence, lastPayday, count: days.length, medianGap };
}

/**
 * Context-aware coaching nudges from real balances + plan. Each is actionable
 * (carries a `tab` to jump to). Returns at most `limit`, highest priority first.
 * @returns {Array<{id, text, tab, tone}>}
 */
export function coachNudges(ctx = {}, limit = 3) {
  const {
    savings = 0,
    emergencyTarget = 0,
    strategy = "balanced",
    hasIncome = false,
    hasPaydays = false,
    highDebt = 0,
    leftToAllocate = 0,
    forecast = null,
  } = ctx;
  const out = [];

  if (forecast?.dipsBelow && forecast.dipDate) {
    const when = forecast.dipDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    out.push({
      id: "cashflow",
      tone: "warn",
      tab: "plan",
      text: `Heads up: at your usual pace, checking dips below your floor around ${when}. Ease off transfers until your next payday.`,
    });
  }
  if (highDebt > 0) {
    out.push({
      id: "debt",
      tone: "warn",
      tab: "plan",
      text: `You have high-interest debt — the plan attacks it first. Every extra dollar here beats investing right now.`,
    });
  }
  if (emergencyTarget <= 0) {
    out.push({
      id: "set-emergency",
      tone: "info",
      tab: "settings",
      text: `Set an emergency-fund target so the plan knows how big a safety net to build.`,
    });
  } else if (savings >= emergencyTarget && strategy !== "long_term") {
    out.push({
      id: "go-growth",
      tone: "good",
      tab: "plan",
      text: `Your emergency fund is fully funded 🎉 — preview the Growth strategy to put more toward investing.`,
    });
  }
  if (leftToAllocate > 200) {
    out.push({
      id: "unallocated",
      tone: "info",
      tab: "plan",
      text: `You have about $${Math.round(leftToAllocate).toLocaleString()} unassigned this month — give it a job before it drifts into spending.`,
    });
  }
  if (hasIncome && !hasPaydays) {
    out.push({
      id: "add-payday",
      tone: "info",
      tab: "accounts",
      text: `Add a payday date to your income so I can show dated transfer reminders and a cashflow forecast.`,
    });
  }
  return out.slice(0, limit);
}
