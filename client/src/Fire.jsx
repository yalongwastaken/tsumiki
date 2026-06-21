import { fmt } from "./format.js";

// M6 — FIRE / Coast-FI readout. Pure math, no chart deps.
// FIRE number = 25× annual expenses (the 4% rule).
function yearsToTarget(start, monthly, rate, target) {
  if (start >= target) return 0;
  const mr = rate / 12;
  let bal = start, m = 0;
  while (bal < target && m < 1200) { bal = bal * (1 + mr) + monthly; m++; }
  return m >= 1200 ? Infinity : m / 12;
}

const yr = (years) => (years === Infinity ? "—" : `${years.toFixed(years < 10 ? 1 : 0)} yr`);
const whenYear = (years) => (years === Infinity ? "" : `~${new Date().getFullYear() + Math.round(years)}`);

export default function Fire({ netWorth, monthlyInvest, returnRate, annualExpenses }) {
  if (!annualExpenses || annualExpenses <= 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Financial independence</div>
        <div className="text-sm text-slate-400">Log a month of spending and I'll estimate your FIRE number (25× your annual expenses).</div>
      </div>
    );
  }
  const fireNumber = annualExpenses * 25;
  const atPace = yearsToTarget(netWorth, monthlyInvest, returnRate, fireNumber);
  const coast = netWorth >= fireNumber ? 0 : (netWorth > 0 ? Math.log(fireNumber / netWorth) / Math.log(1 + returnRate) : Infinity);
  const pct = Math.min(100, (netWorth / fireNumber) * 100);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Financial independence</div>
        <div className="text-xs text-slate-400">25× {fmt(annualExpenses)}/yr</div>
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <div className="text-3xl font-mono font-bold text-indigo-600">{fmt(fireNumber)}</div>
        <div className="text-xs text-slate-400">your FIRE number</div>
      </div>

      <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-1.5">
        <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-slate-400 mb-4">{pct.toFixed(1)}% there ({fmt(netWorth)})</div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-400">At your pace</div>
          <div className="text-lg font-mono font-bold text-slate-800">{yr(atPace)}</div>
          <div className="text-xs text-slate-400">{whenYear(atPace)} · {fmt(monthlyInvest)}/mo invested</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-400">Coast (no new $)</div>
          <div className="text-lg font-mono font-bold text-slate-800">{yr(coast)}</div>
          <div className="text-xs text-slate-400">growth alone gets you there</div>
        </div>
      </div>
    </div>
  );
}
