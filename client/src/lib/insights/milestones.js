// milestones.js — pure achievement computation for the motivation/game layer.
import { monthOf } from "../finance/finance.js";

const NW_TIERS = [10000, 25000, 50000, 100000, 250000, 500000, 1000000];
const CONTRIB_TIERS = [1000, 5000, 10000, 25000, 50000];
// daily logging streak, in days
const STREAK_TIERS = [3, 7, 14, 30, 60, 100, 180, 365];
// habit achievements derived from the raw ledger
const LOG_TIERS = [10, 50, 100, 500, 1000];
const NOSPEND_TIERS = [1, 5, 25, 100];
const MONTHS_TIERS = [3, 6, 12, 24];
const money = (n) => "$" + Math.round(Number.isFinite(n) ? n : 0).toLocaleString();

const METRIC_VALUE = (g, ctx) =>
  g.metric === "net_worth"
    ? ctx.realNetWorth
    : g.metric === "emergency"
      ? ctx.savings
      : g.metric === "earmarked"
        ? (ctx.earmarked || {})[g.id] || 0
        : ctx.investedTotal;

// quick ledger tallies for the habit/game achievements
function ledgerStats(transactions = []) {
  let logs = 0,
    noSpend = 0,
    invested = false;
  const months = new Set();
  for (const t of transactions) {
    logs++;
    if (t.type === "spending" && !(t.amount > 0)) {
      noSpend++;
    }
    if (t.type === "contribution" && (t.bucket === "invest" || t.bucket === "retirement")) {
      invested = true;
    }
    // local month key (matches monthOf bucketing) so a bare-date txn counts in the same
    // month regardless of timezone
    const m = monthOf(t.date);
    if (m) {
      months.add(m);
    }
  }
  return { logs, noSpend, invested, months: months.size };
}

/**
 * Build the ordered milestone list from a context snapshot, each flagged
 * achieved with its current/target progress. Pure — no side effects.
 * @returns {Array<{id,label,icon,achieved,cur,target}>}
 */
export function computeMilestones(ctx) {
  const {
    realNetWorth = 0,
    investedTotal = 0,
    savings = 0,
    emergencyTarget = 0,
    debts = [],
    streak = 0,
    userTargets = [],
    transactions = [],
  } = ctx;
  const stats = ledgerStats(transactions);
  const m = [];
  const add = (id, label, icon, achieved, cur, target) =>
    m.push({ id, label, icon, achieved, cur, target });

  // ── habit: showing up + logging ──────────────────────────────────────────────
  add("first_log", "Logged your first entry", "pencil", stats.logs > 0);
  for (const t of LOG_TIERS) {
    add(`logs_${t}`, `${t} entries logged`, "list", stats.logs >= t, stats.logs, t);
  }
  for (const t of STREAK_TIERS) {
    add(`streak_${t}`, `${t}-day streak`, "flame", streak >= t, streak, t);
  }
  for (const t of NOSPEND_TIERS) {
    add(
      `nospend_${t}`,
      t === 1 ? "First no-spend day" : `${t} no-spend days`,
      "ban",
      stats.noSpend >= t,
      stats.noSpend,
      t,
    );
  }
  for (const t of MONTHS_TIERS) {
    add(`months_${t}`, `${t} months tracked`, "calendar", stats.months >= t, stats.months, t);
  }

  // ── money: contributions, net worth, safety, debt ────────────────────────────
  add("first", "First contribution", "sprout", investedTotal > 0);
  add("invested", "First investment", "sparkles", stats.invested);
  for (const t of CONTRIB_TIERS) {
    add(`contrib_${t}`, `${money(t)} contributed`, "coins", investedTotal >= t, investedTotal, t);
  }
  for (const t of NW_TIERS) {
    add(`nw_${t}`, `${money(t)} net worth`, "landmark", realNetWorth >= t, realNetWorth, t);
  }

  if (emergencyTarget > 0) {
    add(
      "emergency",
      "Emergency fund funded",
      "shield",
      savings >= emergencyTarget,
      savings,
      emergencyTarget,
    );
  }

  const hasDebt = debts.some((d) => (d.balance || 0) > 0);
  add("debt_free", "Debt-free", "check", debts.length > 0 && !hasDebt);

  // user-defined money targets (the gamified "save $X" goals)
  for (const g of userTargets) {
    const cur = METRIC_VALUE(g, ctx);
    add(
      `target_${g.id}`,
      g.label || `${money(g.amount)} target`,
      "target",
      g.amount > 0 && cur >= g.amount,
      cur,
      g.amount,
    );
  }

  return m;
}

/** Next not-yet-achieved milestone that has a measurable target (for "next up"). */
export function nextMilestone(list) {
  return list.find((x) => !x.achieved && x.target > 0) || null;
}
