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

// strategy → ordered list of bucket keys. `emergency` may be split via caps below.
const ORDER = {
  short_term: ["min_debt", "floor", "match", "high_debt", "emergency", "retirement", "brokerage"],
  balanced:   ["min_debt", "floor", "match", "high_debt", "emergency_half", "retirement", "emergency_rest", "brokerage"],
  long_term:  ["min_debt", "floor", "match", "high_debt", "retirement", "brokerage", "emergency_rest"],
};

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
  const strategy = ORDER[profile.strategy] ? profile.strategy : "balanced";

  const bal = balancesByType(accounts, snapshots);
  const floor = Math.max(0, profile.checkingFloor || 0);
  const emTarget = Math.max(0, profile.emergencyTarget || 0);
  const matchPct = profile.employerMatch?.pct || 0;
  const highApr = profile.highApr ?? DEFAULT_HIGH_APR;
  const iraLimit = profile.retirementLimits?.ira ?? profile.iraLimit ?? DEFAULT_IRA_LIMIT;
  const iraMonthly = iraLimit / 12;

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

  // essentials come first — money already spoken for can't be allocated
  give("essentials", "Essentials (bills & fixed costs)", essentials,
    essentialsSource === "bills" ? "Rent, bills, and fixed costs come off the top." : "Estimated from your typical spending.");

  for (const key of ORDER[strategy]) {
    if (remaining <= 0) break;
    switch (key) {
      case "min_debt":
        give("min_debt", "Minimum debt payments", minPay, "Never miss a minimum — protects credit and avoids fees.");
        break;
      case "floor":
        give("floor", "Top up checking buffer", floorGap, `Keep at least ${money(floor)} in checking as a cushion.`);
        break;
      case "match":
        give("match", "401k — capture employer match", matchTarget, `Contribute ~${matchPct}% to grab the full match. It's free money.`);
        break;
      case "high_debt":
        give("high_debt", "Pay down high-interest debt", highDebtBalance,
          topDebt
            ? (snowball
                ? `Knock out ${topDebt.name} first (${money(topDebt.balance)}) — snowball for a quick win.`
                : `Attack ${topDebt.name} first (${topDebt.apr}% APR) — avalanche saves the most interest.`)
            : `Debt at/above ${highApr}% APR costs more than markets return — kill it.`);
        break;
      case "emergency":
        give("emergency", "Build emergency fund", emGap, `Work toward ${money(emTarget)} (3–6 months of expenses).`);
        break;
      case "emergency_half":
        give("emergency", "Build emergency fund", emGap * 0.5, `Fund part of your ${money(emTarget)} safety net now, the rest after investing.`);
        break;
      case "emergency_rest": {
        const done = steps.filter((s) => s.key === "emergency").reduce((a, s) => a + s.amount, 0);
        give("emergency", "Top up emergency fund", Math.max(0, emGap - done), `Finish your ${money(emTarget)} safety net.`);
        break;
      }
      case "retirement": {
        const room = retirementRoom - retireUsed; // already-captured match counts against the cap
        give("retirement", "Invest for retirement (IRA)", Math.min(iraMonthly, room),
          room <= 0 ? "" : `Tax-advantaged growth — ${money(room)} of room left this year.`);
        break;
      }
      case "brokerage":
        give("brokerage", "Invest in brokerage", remaining, "Everything left compounds in your taxable brokerage.");
        break;
    }
  }
  if (remaining > 0) give("brokerage", "Invest in brokerage", remaining, "Everything left compounds in your taxable brokerage.");

  const investable = steps.filter((s) => s.key === "retirement" || s.key === "brokerage").reduce((a, s) => a + s.amount, 0);

  return {
    income, strategy, allocated: income - remaining, leftover: remaining, investable, steps,
    essentials, essentialsSource,
    context: { checking: bal.checking, savings: bal.savings, floor, emergencyTarget: emTarget, emergencyGap: emGap, minPay, highDebtBalance, matchPct, retirementRoom, ytdRetirement, highApr, iraLimit, essentials, essentialsSource },
  };
}
