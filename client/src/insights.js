// insights.js — pure, explainable "smart" derivations over the ledger + plan.
// No AI/network: deterministic rules so every number is testable and defensible.
import { monthKey, sumLatestByType } from "./selectors.js";
import { nextPaydays } from "./paydays.js";
import { CADENCE } from "./cadence.js";

const DAY = 86400000;
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Average daily discretionary spend over the last `days` days (real spend only). */
export function avgDailySpend(transactions = [], days = 60, today = new Date()) {
  const cutoff = startOfDay(today).getTime() - days * DAY;
  let total = 0;
  for (const t of transactions) {
    if (t.type === "spending" && t.amount > 0 && new Date(t.date).getTime() >= cutoff) {
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
  const daily = avgDailySpend(transactions, 60, today);

  // map of "YYYY-MM-DD" → net change that day (paydays in, bills out)
  const delta = {};
  const addDelta = (d, amt) => {
    const k = startOfDay(d).toISOString().slice(0, 10);
    delta[k] = (delta[k] || 0) + amt;
  };
  for (const s of profile.incomeSources || []) {
    if (!s.payday || !CADENCE[s.cadence]) {
      continue;
    }
    const perCheck = (s.typicalMonthly || 0) / CADENCE[s.cadence];
    for (const d of nextPaydays(s.payday, s.cadence, 12, today)) {
      addDelta(d, perCheck);
    }
  }
  const billDays = (profile.bills || []).filter((b) => b.dayOfMonth && b.amount > 0);

  const t0 = startOfDay(today);
  let bal = start;
  let min = start;
  let minDate = new Date(t0);
  let dipDate = null;
  const series = [{ date: new Date(t0), balance: Math.round(bal) }];
  for (let i = 1; i <= days; i++) {
    const day = new Date(t0.getTime() + i * DAY);
    const key = day.toISOString().slice(0, 10);
    bal += delta[key] || 0;
    for (const b of billDays) {
      if (b.dayOfMonth === day.getDate()) {
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
    dipsBelow: dipDate != null,
    dipDate,
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
 * Charges that repeat (same category + rounded amount across ≥3 months) and aren't
 * already tracked as bills — candidates to add as recurring essentials.
 * @returns {Array<{label, amount, months}>}
 */
export function detectRecurring(transactions = [], existingBills = []) {
  const seen = {}; // "cat|amount" → Set(months)
  for (const t of transactions) {
    if (t.type !== "spending" || !(t.amount > 0)) {
      continue;
    }
    const key = `${t.cat || "Other"}|${Math.round(t.amount)}`;
    (seen[key] = seen[key] || new Set()).add(monthKey(t.date));
  }
  const billNames = new Set((existingBills || []).map((b) => (b.name || "").toLowerCase()));
  const out = [];
  for (const [key, months] of Object.entries(seen)) {
    if (months.size >= 3) {
      const [cat, amt] = key.split("|");
      if (!billNames.has(cat.toLowerCase())) {
        out.push({ label: cat, amount: Number(amt), months: months.size });
      }
    }
  }
  return out.sort((a, b) => b.months - a.months).slice(0, 5);
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

  if (forecast?.dipsBelow) {
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
      text: `You have about ${Math.round(leftToAllocate)} unassigned this month — give it a job before it drifts into spending.`,
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
