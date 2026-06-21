// Fire.jsx — FIRE / Coast-FI readout (pure math, no chart deps).
import { PartyPopper } from "lucide-react";
import { fmt } from "./format.js";

// fire number = 25× annual expenses (the 4% rule)

/** Years for `start` to reach `target` at `monthly` contributions + annual `rate`. */
function yearsToTarget(start, monthly, rate, target) {
  if (start >= target) {
    return 0;
  }
  const mr = rate / 12;
  let bal = start,
    m = 0;
  while (bal < target && m < 1200) {
    bal = bal * (1 + mr) + monthly;
    m++;
  }
  return m >= 1200 ? Infinity : m / 12;
}

const yr = (years) => (years === Infinity ? "—" : `${years.toFixed(years < 10 ? 1 : 0)} yr`);
const whenYear = (years) =>
  years === Infinity ? "" : `~${new Date().getFullYear() + Math.round(years)}`;

/** FIRE readout: target number, progress, years-at-pace, and Coast-FI status. */
export default function Fire({
  netWorth,
  monthlyInvest,
  returnRate,
  annualExpenses,
  birthYear,
  retireAge,
}) {
  if (!annualExpenses || annualExpenses <= 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Financial independence
        </div>
        <div className="text-sm text-slate-400">
          Log a month of spending and I'll estimate your FIRE number (25× your annual expenses).
        </div>
      </div>
    );
  }
  const fireNumber = annualExpenses * 25;
  const atPace = yearsToTarget(netWorth, monthlyInvest, returnRate, fireNumber);
  const coast =
    netWorth >= fireNumber
      ? 0
      : netWorth > 0
        ? Math.log(fireNumber / netWorth) / Math.log(1 + returnRate)
        : Infinity;
  const pct = Math.min(100, (netWorth / fireNumber) * 100);

  // Coast-FI: are you "coasting"? If today's net worth grows (no new contributions)
  // to the FIRE number by your retirement age, you've reached Coast-FI.
  const age = birthYear ? new Date().getFullYear() - birthYear : null;
  const yearsToRetire = age != null && retireAge ? Math.max(0, retireAge - age) : null;
  const coastNumberAtRetire =
    yearsToRetire != null ? fireNumber / Math.pow(1 + returnRate, yearsToRetire) : null;
  const isCoasting = coastNumberAtRetire != null && netWorth >= coastNumberAtRetire;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Financial independence
        </div>
        <div className="text-xs text-slate-400">25× {fmt(annualExpenses)}/yr</div>
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <div className="text-3xl font-mono font-bold text-brand-600">{fmt(fireNumber)}</div>
        <div className="text-xs text-slate-400">your FIRE number</div>
      </div>

      <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-1.5">
        <div
          className="h-full bg-brand-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-slate-400 mb-4">
        {pct.toFixed(1)}% there ({fmt(netWorth)})
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-400">At your pace</div>
          <div className="text-lg font-mono font-bold text-slate-800">{yr(atPace)}</div>
          <div className="text-xs text-slate-400">
            {whenYear(atPace)} · {fmt(monthlyInvest)}/mo invested
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-400">Coast (no new $)</div>
          <div className="text-lg font-mono font-bold text-slate-800">{yr(coast)}</div>
          <div className="text-xs text-slate-400">growth alone gets you there</div>
        </div>
      </div>

      {coastNumberAtRetire != null && (
        <div
          className={`mt-3 rounded-lg p-3 text-sm flex gap-2 ${isCoasting ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-600"}`}
        >
          {isCoasting && <PartyPopper size={16} className="flex-shrink-0 mt-0.5" />}
          <span>
            {isCoasting
              ? `You've hit Coast-FI — current savings alone grow to your FIRE number by age ${retireAge}. New contributions just get you there sooner.`
              : `Coast-FI at age ${retireAge}: you'd need ${fmt(coastNumberAtRetire)} invested today (you have ${fmt(netWorth)}) to coast to FIRE without adding more.`}
          </span>
        </div>
      )}
    </div>
  );
}
