// milestones.js — pure achievement computation for M5 motivation.
// Given a context snapshot, return an ordered list of milestones with
// achieved/progress. No side effects, easy to test.
const NW_TIERS = [10000, 25000, 50000, 100000, 250000, 500000, 1000000];
const CONTRIB_TIERS = [1000, 5000, 10000, 25000, 50000];
const STREAK_TIERS = [4, 12, 26, 52];
const money = (n) => "$" + Math.round(n).toLocaleString();

const METRIC_VALUE = (metric, ctx) =>
  metric === "net_worth" ? ctx.realNetWorth : metric === "emergency" ? ctx.savings : ctx.investedTotal;

export function computeMilestones(ctx) {
  const { realNetWorth = 0, investedTotal = 0, savings = 0, emergencyTarget = 0, debts = [], streak = 0, userTargets = [] } = ctx;
  const m = [];
  const add = (id, label, icon, achieved, cur, target) => m.push({ id, label, icon, achieved, cur, target });

  add("first", "First contribution", "🌱", investedTotal > 0);

  for (const t of CONTRIB_TIERS) add(`contrib_${t}`, `${money(t)} contributed`, "💪", investedTotal >= t, investedTotal, t);
  for (const t of NW_TIERS) add(`nw_${t}`, `${money(t)} net worth`, "🏦", realNetWorth >= t, realNetWorth, t);

  if (emergencyTarget > 0) add("emergency", "Emergency fund funded", "🛡️", savings >= emergencyTarget, savings, emergencyTarget);

  const hasDebt = debts.some((d) => (d.balance || 0) > 0);
  add("debt_free", "Debt-free", "✅", debts.length > 0 && !hasDebt);

  for (const t of STREAK_TIERS) add(`streak_${t}`, `${t}-week streak`, "🔥", streak >= t, streak, t);

  // user-defined money targets (the gamified "save $X" goals, I4)
  for (const g of userTargets) {
    const cur = METRIC_VALUE(g.metric, ctx);
    add(`target_${g.id}`, g.label || `${money(g.amount)} target`, "🎯", g.amount > 0 && cur >= g.amount, cur, g.amount);
  }

  return m;
}

// the next not-yet-achieved milestone that has a measurable target (for "next up")
export function nextMilestone(list) {
  return list.find((x) => !x.achieved && x.target > 0) || null;
}
