// engine.js — the allocation engine (SPEC.md §1.5). The "brain".
// Given an income amount + current state, run a priority waterfall and return
// where each dollar should go, with a human reason per step. Strategy reorders
// the priorities. Pure + deterministic so it's easy to test and explain.

const HIGH_APR = 10;        // % — at/above this, debt is "high interest" (pay aggressively)
const IRA_MONTHLY = 7000 / 12; // ~$583 — soft monthly cap for retirement-beyond-match

// ── read current balances from the latest snapshot per account ────────────────
function balancesByType(accounts, snapshots) {
  const latest = {};
  for (const s of snapshots)
    if (!latest[s.accountId] || new Date(s.date) > new Date(latest[s.accountId].date)) latest[s.accountId] = s;
  const byType = { checking: 0, savings: 0, brokerage: 0, ira: 0, other: 0 };
  for (const a of accounts) {
    const bal = latest[a.id]?.balance || 0;
    byType[a.type] = (byType[a.type] || 0) + bal;
  }
  return byType;
}

// strategy → ordered list of bucket keys. `emergency` may be split via caps below.
const ORDER = {
  short_term: ["min_debt", "floor", "match", "high_debt", "emergency", "retirement", "brokerage"],
  balanced:   ["min_debt", "floor", "match", "high_debt", "emergency_half", "retirement", "emergency_rest", "brokerage"],
  long_term:  ["min_debt", "floor", "match", "high_debt", "retirement", "brokerage", "emergency_rest"],
};

export function buildPlan(state, incomeArg) {
  const { accounts = [], snapshots = [], debts = [], profile = {} } = state;
  const income = Math.max(0, Math.round(Number(incomeArg) || 0));
  const strategy = ORDER[profile.strategy] ? profile.strategy : "balanced";

  const bal = balancesByType(accounts, snapshots);
  const floor = Math.max(0, profile.checkingFloor || 0);
  const emTarget = Math.max(0, profile.emergencyTarget || 0);
  const matchPct = profile.employerMatch?.pct || 0;

  const minPay = debts.reduce((s, d) => s + (d.minPayment || 0), 0);
  const highDebtBalance = debts.filter((d) => (d.apr || 0) >= HIGH_APR).reduce((s, d) => s + (d.balance || 0), 0);
  const floorGap = Math.max(0, floor - bal.checking);
  const emGap = Math.max(0, emTarget - bal.savings);
  const matchTarget = matchPct ? Math.round((income * matchPct) / 100) : 0;

  const steps = [];
  let remaining = income;
  const give = (key, label, want, why) => {
    const amount = Math.max(0, Math.min(remaining, Math.round(want)));
    if (amount > 0) { steps.push({ key, label, amount, why }); remaining -= amount; }
  };

  for (const key of ORDER[strategy]) {
    if (remaining <= 0) break;
    switch (key) {
      case "min_debt":
        give("min_debt", "Minimum debt payments", minPay, "Never miss a minimum — protects your credit and avoids fees.");
        break;
      case "floor":
        give("floor", "Top up checking buffer", floorGap, `Keep at least ${money(floor)} in checking as a cushion.`);
        break;
      case "match":
        give("match", "401k — capture employer match", matchTarget, `Contribute ~${matchPct}% to grab the full match. It's free money.`);
        break;
      case "high_debt":
        give("high_debt", "Pay down high-interest debt", highDebtBalance, `Debt over ${HIGH_APR}% APR costs more than markets return — kill it.`);
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
      case "retirement":
        give("retirement", "Invest for retirement (IRA)", IRA_MONTHLY, "Tax-advantaged long-term growth, toward the annual limit.");
        break;
      case "brokerage":
        give("brokerage", "Invest in brokerage", remaining, "Everything left compounds in your taxable brokerage.");
        break;
    }
  }
  if (remaining > 0) give("brokerage", "Invest in brokerage", remaining, "Everything left compounds in your taxable brokerage.");

  // what this plan actually puts into growth assets (drives the projection, §7)
  const investable = steps
    .filter((s) => s.key === "retirement" || s.key === "brokerage")
    .reduce((a, s) => a + s.amount, 0);

  return {
    income,
    strategy,
    allocated: income - remaining,
    leftover: remaining,
    investable,
    steps,
    context: { checking: bal.checking, savings: bal.savings, floor, emergencyTarget: emTarget, emergencyGap: emGap, minPay, highDebtBalance, matchPct },
  };
}

const money = (n) => "$" + Math.round(n).toLocaleString();
