// engine.js — the allocation engine (SPEC.md §1.5). The "brain".
// Given an income amount + current state, run a priority waterfall and return
// where each dollar should go, with a human reason per step. Strategy reorders
// the priorities. Pure + deterministic so it's easy to test and explain.
// I5: avalanche debt order, YTD-aware retirement, configurable thresholds.

const DEFAULT_HIGH_APR = 10;   // % — at/above this, debt is "high interest"
const DEFAULT_IRA_LIMIT = 7000; // annual retirement contribution cap

// ── read current balances from the latest snapshot per account ────────────────
// average monthly logged spending — fallback "essentials" estimate when no bills
function avgMonthlySpend(transactions) {
  const sp = transactions.filter((t) => t.type === "spending");
  if (!sp.length) return 0;
  const months = new Set(sp.map((t) => new Date(t.date).toISOString().slice(0, 7)));
  return sp.reduce((s, t) => s + t.amount, 0) / Math.max(1, months.size);
}

function balancesByType(accounts, snapshots) {
  const latest = {};
  for (const s of snapshots)
    if (!latest[s.accountId] || new Date(s.date) > new Date(latest[s.accountId].date)) latest[s.accountId] = s;
  const byType = { checking: 0, savings: 0, brokerage: 0, ira: 0, other: 0 };
  for (const a of accounts) byType[a.type] = (byType[a.type] || 0) + (latest[a.id]?.balance || 0);
  return byType;
}

// After the non-negotiables (essentials, min debt, checking floor, employer
// match, high-interest debt), the leftover is SPLIT across the four
// destinations — savings, retirement, personal investment, and flexible
// checking — instead of draining into one. Strategy sets the default weights.
const STRATEGY_SPLIT = {
  short_term: { savings: 0.35, retirement: 0.20, invest: 0.15, checking: 0.30 },
  balanced:   { savings: 0.25, retirement: 0.30, invest: 0.30, checking: 0.15 },
  long_term:  { savings: 0.10, retirement: 0.40, invest: 0.40, checking: 0.10 },
};
// custom override via profile.split (percentages); else strategy defaults
function splitWeights(profile, strategy) {
  const c = profile.split;
  if (c && (c.savings != null || c.retirement != null || c.invest != null || c.checking != null)) {
    const s = Math.max(0, c.savings || 0), r = Math.max(0, c.retirement || 0), i = Math.max(0, c.invest || 0), k = Math.max(0, c.checking || 0);
    const tot = s + r + i + k;
    if (tot > 0) return { savings: s / tot, retirement: r / tot, invest: i / tot, checking: k / tot };
  }
  return STRATEGY_SPLIT[strategy] || STRATEGY_SPLIT.balanced;
}

const money = (n) => "$" + Math.round(n).toLocaleString();

// A3 — typical monthly income: learned from logged history (≥2 complete months),
// else the typed source estimates. Mirrors client income.js.
export function typicalIncome(state) {
  const { profile = {}, transactions = [] } = state;
  const sources = profile.incomeSources || [];
  const typed = sources.length ? sources.reduce((s, x) => s + (x.typicalMonthly || 0), 0) : (profile.typicalIncome || 0);
  const ym = new Date().toISOString().slice(0, 7);
  const byMonth = {};
  for (const t of transactions)
    if (t.type === "income") {
      const m = new Date(t.date).toISOString().slice(0, 7);
      if (m < ym) byMonth[m] = (byMonth[m] || 0) + t.amount;
    }
  const months = Object.values(byMonth);
  if (months.length >= 2) return Math.round(months.reduce((a, b) => a + b, 0) / months.length);
  return typed;
}

export function buildPlan(state, incomeArg) {
  const { accounts = [], snapshots = [], debts = [], profile = {}, transactions = [] } = state;
  const income = Math.max(0, Math.round(Number(incomeArg) || 0));
  const strategy = STRATEGY_SPLIT[profile.strategy] ? profile.strategy : "balanced";

  const bal = balancesByType(accounts, snapshots);
  const floor = Math.max(0, profile.checkingFloor || 0);
  const emTarget = Math.max(0, profile.emergencyTarget || 0);
  const matchPct = profile.employerMatch?.pct || 0;
  const highApr = profile.highApr ?? DEFAULT_HIGH_APR;
  const iraLimit = profile.retirementLimits?.ira ?? profile.iraLimit ?? DEFAULT_IRA_LIMIT;

  // YTD retirement contributions → remaining annual room (so we never over-contribute)
  const yr = new Date().getFullYear();
  const ytdRetirement = transactions
    .filter((t) => t.type === "contribution" && t.bucket === "retirement" && new Date(t.date).getFullYear() === yr)
    .reduce((s, t) => s + t.amount, 0);
  const retirementRoom = Math.max(0, iraLimit - ytdRetirement);

  const minPay = debts.reduce((s, d) => s + (d.minPayment || 0), 0);
  // payoff order: avalanche (highest APR, math-optimal) or snowball (smallest balance, motivational)
  const snowball = profile.debtStrategy === "snowball";
  const highDebts = debts.filter((d) => (d.apr || 0) >= highApr)
    .sort((a, b) => snowball ? (a.balance || 0) - (b.balance || 0) : (b.apr || 0) - (a.apr || 0));
  const highDebtBalance = highDebts.reduce((s, d) => s + (d.balance || 0), 0);
  const topDebt = highDebts[0];

  const floorGap = Math.max(0, floor - bal.checking);
  const emGap = Math.max(0, emTarget - bal.savings);
  const matchTarget = matchPct ? Math.min(Math.round((income * matchPct) / 100), retirementRoom) : 0;

  // A1: reserve essential spending (bills, or learned average) before allocating
  const billsTotal = (profile.bills || []).reduce((s, b) => s + (b.amount || 0), 0);
  const learned = avgMonthlySpend(transactions);
  const essentials = billsTotal > 0 ? billsTotal : learned;
  const essentialsSource = billsTotal > 0 ? "bills" : learned > 0 ? "learned" : "none";

  const steps = [];
  let remaining = income, retireUsed = 0;
  const give = (key, label, want, why) => {
    const amount = Math.max(0, Math.min(remaining, Math.round(want)));
    if (amount > 0) {
      steps.push({ key, label, amount, why });
      remaining -= amount;
      if (key === "match" || key === "retirement") retireUsed += amount;
    }
  };

  // ── non-negotiables first (these always come before the split) ──
  give("essentials", "Essentials (bills & fixed costs)", essentials,
    essentialsSource === "bills" ? "Rent, bills, and fixed costs come off the top." : "Estimated from your typical spending.");
  give("min_debt", "Minimum debt payments", minPay, "Never miss a minimum — protects credit and avoids fees.");
  give("floor", "Top up checking buffer", floorGap, `Keep at least ${money(floor)} in checking as a cushion.`);
  give("match", "401k — capture employer match", matchTarget, `Contribute ~${matchPct}% to grab the full match. It's free money.`);
  give("high_debt", "Pay down high-interest debt", highDebtBalance,
    topDebt
      ? (snowball
          ? `Knock out ${topDebt.name} first (${money(topDebt.balance)}) — snowball for a quick win.`
          : `Attack ${topDebt.name} first (${topDebt.apr}% APR) — avalanche saves the most interest.`)
      : `Debt at/above ${highApr}% APR costs more than markets return — kill it.`);

  // ── split what's left across the four destinations (no single drain) ──
  const w = splitWeights(profile, strategy);
  const surplus = remaining;
  const roomLeft = Math.max(0, retirementRoom - retireUsed);
  const eAmt = Math.min(surplus * w.savings, emGap);          // savings → capped at emergency target
  const rAmt = Math.min(surplus * w.retirement, roomLeft);    // retirement → capped at annual room
  const cAmt = surplus * w.checking;                          // flexible, kept in checking
  give("emergency", "Savings — emergency fund", eAmt, emGap > 0 ? `Toward your ${money(emTarget)} safety net.` : "Safety cushion.");
  give("retirement", "Retirement investment", rAmt, roomLeft > 0 ? `Tax-advantaged — ${money(roomLeft)} of room left this year.` : "Retirement.");
  give("checking_flex", "Keep in checking", cAmt, "Flexible spending money you keep liquid.");
  // everything still unallocated (the invest share + any capped overflow) → personal investment
  give("brokerage", "Personal investment", remaining, "Taxable brokerage for long-term growth.");

  const investable = steps.filter((s) => s.key === "retirement" || s.key === "brokerage").reduce((a, s) => a + s.amount, 0);

  return {
    income, strategy, allocated: income - remaining, leftover: remaining, investable, steps, split: w,
    essentials, essentialsSource,
    context: { checking: bal.checking, savings: bal.savings, floor, emergencyTarget: emTarget, emergencyGap: emGap, minPay, highDebtBalance, matchPct, retirementRoom, ytdRetirement, highApr, iraLimit, essentials, essentialsSource },
  };
}
