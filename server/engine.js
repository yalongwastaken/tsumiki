// engine.js — the allocation engine. The "brain" of the app.
// Given an income amount + current state, run a priority waterfall and return
// where each dollar should go, with a human reason per step. Strategy reorders
// the priorities. Pure + deterministic so it's easy to test and explain.
// Features: avalanche debt order, YTD-aware retirement, configurable thresholds.

const DEFAULT_HIGH_APR = 10; // % — at/above this, debt is "high interest"
const DEFAULT_IRA_LIMIT = 7000; // annual retirement contribution cap
const CADENCE = { weekly: 4.345, biweekly: 2.1725, semimonthly: 2, monthly: 1 }; // paychecks/month (mirrors client cadence.js)

/** Average monthly logged spending — fallback "essentials" estimate when no bills. */
function avgMonthlySpend(transactions) {
  const sp = transactions.filter((t) => t.type === "spending" && t.amount > 0);
  if (!sp.length) {
    return 0;
  }
  const months = new Set(sp.map((t) => new Date(t.date).toISOString().slice(0, 7)));
  return sp.reduce((s, t) => s + t.amount, 0) / Math.max(1, months.size);
}

/** Sum the latest snapshot balance per account, grouped by account type. */
function balancesByType(accounts, snapshots) {
  const latest = {};
  for (const s of snapshots) {
    if (!latest[s.accountId] || new Date(s.date) > new Date(latest[s.accountId].date)) {
      latest[s.accountId] = s;
    }
  }
  const byType = { checking: 0, savings: 0, brokerage: 0, ira: 0, other: 0 };
  for (const a of accounts) {
    byType[a.type] = (byType[a.type] || 0) + (latest[a.id]?.balance || 0);
  }
  return byType;
}

// After the non-negotiables (essentials, min debt, checking floor, employer
// match, high-interest debt), the leftover is SPLIT across the four
// destinations — savings, retirement, personal investment, and flexible
// checking — instead of draining into one. Strategy sets the default weights.
const STRATEGY_SPLIT = {
  short_term: { savings: 0.35, retirement: 0.2, invest: 0.15, checking: 0.3 },
  balanced: { savings: 0.25, retirement: 0.3, invest: 0.3, checking: 0.15 },
  long_term: { savings: 0.1, retirement: 0.4, invest: 0.4, checking: 0.1 },
};
/** Surplus split weights: custom profile.split (normalized) if set, else strategy defaults. */
function splitWeights(profile, strategy) {
  const c = profile.split;
  if (c && (c.savings != null || c.retirement != null || c.invest != null || c.checking != null)) {
    const s = Math.max(0, c.savings || 0),
      r = Math.max(0, c.retirement || 0),
      i = Math.max(0, c.invest || 0),
      k = Math.max(0, c.checking || 0);
    const tot = s + r + i + k;
    if (tot > 0) {
      return { savings: s / tot, retirement: r / tot, invest: i / tot, checking: k / tot };
    }
  }
  return STRATEGY_SPLIT[strategy] || STRATEGY_SPLIT.balanced;
}

// Aggressive split for windfall money (bonus, refund, extra check): finish the
// safety net, then heavily invest, with almost nothing left idle in checking.
const WINDFALL_SPLIT = { savings: 0.15, retirement: 0.35, invest: 0.45, checking: 0.05 };

/** Linear blend of two weight sets: `t` is the weight on `a` (1 → all a, 0 → all b). */
function blendWeights(a, b, t) {
  return {
    savings: a.savings * t + b.savings * (1 - t),
    retirement: a.retirement * t + b.retirement * (1 - t),
    invest: a.invest * t + b.invest * (1 - t),
    checking: a.checking * t + b.checking * (1 - t),
  };
}

/** Whole-dollar currency, e.g. "$1,234". */
const money = (n) => "$" + Math.round(n).toLocaleString();

/**
 * Typical monthly income: learned from logged history (≥2 complete months),
 * else the typed source estimates. Mirrors client income.js.
 * @returns {number}
 */
export function typicalIncome(state) {
  const { profile = {}, transactions = [] } = state;
  const sources = profile.incomeSources || [];
  const typed = sources.length
    ? sources.reduce((s, x) => s + (x.typicalMonthly || 0), 0)
    : profile.typicalIncome || 0;
  const ym = new Date().toISOString().slice(0, 7);
  const byMonth = {};
  for (const t of transactions) {
    if (t.type === "income") {
      const m = new Date(t.date).toISOString().slice(0, 7);
      if (m < ym) {
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
 * Build the allocation plan for a given income: run the priority waterfall
 * (essentials → min debt → checking floor → employer match → high-interest debt),
 * then split the surplus across savings / retirement / investing / checking.
 * @param {Object} state - accounts, snapshots, debts, profile, transactions
 * @param {number} incomeArg - income to plan for
 * @param {{strategy?: string, windfall?: boolean}} [opts] - preview a strategy
 *   without persisting it; opt into the aggressive windfall split (confirm-first)
 * @returns {Object} { steps, split, windfall, allocated, leftover, investable, cadence, ... }
 */
export function buildPlan(state, incomeArg, opts = {}) {
  const { accounts = [], snapshots = [], debts = [], profile = {}, transactions = [] } = state;
  const income = Math.max(0, Math.round(Number(incomeArg) || 0));
  const ym = new Date().toISOString().slice(0, 7);
  // strategy precedence: explicit preview (opts) → this-month override → main
  const mo = profile.monthOverride;
  const overrideStrategy = mo && mo.ym === ym && STRATEGY_SPLIT[mo.strategy] ? mo.strategy : null;
  const strategy =
    (STRATEGY_SPLIT[opts.strategy] && opts.strategy) ||
    overrideStrategy ||
    (STRATEGY_SPLIT[profile.strategy] ? profile.strategy : "balanced");

  const bal = balancesByType(accounts, snapshots);
  const floor = Math.max(0, profile.checkingFloor || 0);
  const emTarget = Math.max(0, profile.emergencyTarget || 0);
  const matchPct = profile.employerMatch?.pct || 0;
  const highApr = profile.highApr ?? DEFAULT_HIGH_APR;
  const iraLimit = profile.retirementLimits?.ira ?? profile.iraLimit ?? DEFAULT_IRA_LIMIT;

  // YTD retirement contributions → remaining annual room (so we never over-contribute)
  const yr = new Date().getFullYear();
  const ytdRetirement = transactions
    .filter(
      (t) =>
        t.type === "contribution" &&
        t.bucket === "retirement" &&
        new Date(t.date).getFullYear() === yr,
    )
    .reduce((s, t) => s + t.amount, 0);
  const retirementRoom = Math.max(0, iraLimit - ytdRetirement);

  const minPay = debts.reduce((s, d) => s + (d.minPayment || 0), 0);
  // payoff order: avalanche (highest APR, math-optimal) or snowball (smallest balance, motivational)
  const snowball = profile.debtStrategy === "snowball";
  const highDebts = debts
    .filter((d) => (d.apr || 0) >= highApr)
    .sort((a, b) => (snowball ? (a.balance || 0) - (b.balance || 0) : (b.apr || 0) - (a.apr || 0)));
  const highDebtBalance = highDebts.reduce((s, d) => s + (d.balance || 0), 0);
  const topDebt = highDebts[0];

  const floorGap = Math.max(0, floor - bal.checking);
  const emGap = Math.max(0, emTarget - bal.savings);
  const matchTarget = matchPct
    ? Math.min(Math.round((income * matchPct) / 100), retirementRoom)
    : 0;

  // reserve essential spending (bills, or learned average) before allocating
  const billsTotal = (profile.bills || []).reduce((s, b) => s + (b.amount || 0), 0);
  const learned = avgMonthlySpend(transactions);
  const essentials = billsTotal > 0 ? billsTotal : learned;
  const essentialsSource = billsTotal > 0 ? "bills" : learned > 0 ? "learned" : "none";

  const steps = [];
  let remaining = income,
    retireUsed = 0;
  const give = (key, label, want, why) => {
    const amount = Math.max(0, Math.min(remaining, Math.round(want)));
    if (amount > 0) {
      steps.push({ key, label, amount, why });
      remaining -= amount;
      if (key === "match" || key === "retirement") {
        retireUsed += amount;
      }
    }
  };

  // ── non-negotiables first (these always come before the split) ──
  give(
    "essentials",
    "Essentials (bills & fixed costs)",
    essentials,
    essentialsSource === "bills"
      ? "Rent, bills, and fixed costs come off the top."
      : "Estimated from your typical spending.",
  );
  give(
    "min_debt",
    "Minimum debt payments",
    minPay,
    "Never miss a minimum — protects credit and avoids fees.",
  );
  give(
    "floor",
    "Top up checking buffer",
    floorGap,
    `Keep at least ${money(floor)} in checking as a cushion.`,
  );
  give(
    "match",
    "401k — capture employer match",
    matchTarget,
    `Contribute ~${matchPct}% to grab the full match. It's free money.`,
  );
  give(
    "high_debt",
    "Pay down high-interest debt",
    highDebtBalance,
    topDebt
      ? snowball
        ? `Knock out ${topDebt.name} first (${money(topDebt.balance)}) — snowball for a quick win.`
        : `Attack ${topDebt.name} first (${topDebt.apr}% APR) — avalanche saves the most interest.`
      : `Debt at/above ${highApr}% APR costs more than markets return — kill it.`,
  );

  // ── split what's left across the four destinations (no single drain) ──
  // Algorithm: the savings account always takes its strategy share, but is BOOSTED
  // to first secure a one-month "starter" safety net before the rest goes to
  // investing. The other three destinations split what remains in proportion — so
  // when no boost is needed this reproduces the plain percentage split exactly.
  const baseW = splitWeights(profile, strategy);
  const surplus = remaining;
  // Windfall: income clearly above your typical → blend an aggressive split into
  // the *extra* surplus (finish savings, then invest), proportional to how much of
  // the surplus is windfall. Detection is always reported; the blend only applies
  // when the caller opts in (confirm-first), so default behavior never changes.
  const typical = typicalIncome(state);
  const windfallAmount = typical > 0 ? Math.max(0, income - typical) : 0;
  const windfallDetected = typical > 0 && windfallAmount >= 500 && income >= typical * 1.25;
  const windfallApplied = windfallDetected && !!opts.windfall;
  const windfallSurplus = windfallApplied ? Math.min(windfallAmount, surplus) : 0;
  const baseFrac = surplus > 0 ? (surplus - windfallSurplus) / surplus : 1;
  const w = windfallApplied ? blendWeights(baseW, WINDFALL_SPLIT, baseFrac) : baseW;
  const roomLeft = Math.max(0, retirementRoom - retireUsed);
  const starter = Math.min(emTarget, Math.max(1000, Math.round(essentials))); // ~1 month of essentials (min $1,000)
  const starterGap = Math.max(0, starter - bal.savings);
  // Smarter, emergency-aware split: as the safety net fills (fundedRatio → 1) the
  // savings share tapers and the freed weight flows to investing. Savings keeps a
  // floor (40% of its nominal weight) so it's always a visible category, and the
  // starter boost still guarantees a baseline cushion first.
  const fundedRatio = emTarget > 0 ? Math.min(1, bal.savings / emTarget) : 0;
  const TAPER = 0.6;
  const wSav = w.savings * (1 - TAPER * fundedRatio);
  const wInv = w.invest + (w.savings - wSav); // freed savings weight → investing
  const eAmt = Math.min(Math.max(surplus * wSav, starterGap), surplus);
  const boosted = eAmt > surplus * wSav + 0.5;
  give(
    "emergency",
    "Savings account",
    eAmt,
    boosted
      ? `Securing a ${money(starter)} starter safety net before investing the rest.`
      : fundedRatio >= 1
        ? "Ongoing savings — your emergency fund is full, so most now flows to investing."
        : emGap > 0
          ? `Building toward your ${money(emTarget)} safety net.`
          : "Ongoing savings — sinking funds and cushion.",
  );

  // remaining splits among retirement / checking / invest by their relative weights
  const rest = remaining;
  const rw = w.retirement + w.checking + wInv || 1;
  const rAmt = Math.min(rest * (w.retirement / rw), roomLeft); // capped at annual room
  const cAmt = rest * (w.checking / rw); // flexible, kept liquid
  give(
    "retirement",
    "Retirement investment",
    rAmt,
    roomLeft > 0 ? `Tax-advantaged — ${money(roomLeft)} of room left this year.` : "Retirement.",
  );
  give("checking_flex", "Keep in checking", cAmt, "Flexible spending money you keep liquid.");
  // everything still unallocated (the invest share + any capped overflow) → personal investment
  give("brokerage", "Personal investment", remaining, "Taxable brokerage for long-term growth.");

  const investable = steps
    .filter((s) => s.key === "retirement" || s.key === "brokerage")
    .reduce((a, s) => a + s.amount, 0);

  // pay cadence → how many paychecks land per month (drives per-paycheck amounts)
  const srcs = profile.incomeSources || [];
  const primary = srcs.slice().sort((a, b) => (b.typicalMonthly || 0) - (a.typicalMonthly || 0))[0];
  const cadence = primary?.cadence && CADENCE[primary.cadence] ? primary.cadence : "monthly";
  const paychecksPerMonth = CADENCE[cadence];

  return {
    income,
    strategy,
    allocated: income - remaining,
    leftover: remaining,
    investable,
    steps,
    split: w,
    strategies: STRATEGY_SPLIT, // all strategy weights, so the UI can show alternatives without duplicating them
    windfall: {
      detected: windfallDetected,
      applied: windfallApplied,
      amount: windfallAmount,
      typical,
    },
    essentials,
    essentialsSource,
    cadence,
    paychecksPerMonth,
    context: {
      checking: bal.checking,
      savings: bal.savings,
      floor,
      emergencyTarget: emTarget,
      emergencyGap: emGap,
      starter,
      minPay,
      highDebtBalance,
      matchPct,
      retirementRoom,
      ytdRetirement,
      highApr,
      iraLimit,
      essentials,
      essentialsSource,
    },
  };
}
