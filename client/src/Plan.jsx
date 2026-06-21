import { useState, useEffect, useMemo } from "react";
import { getPlan } from "./api.js";
import { fmt } from "./format.js";

// I3 — the living monthly plan. This month's pooled income → engine targets per
// bucket vs your actual contributions, what's left to allocate, and a
// forward-looking checking minimum watch. SPEC §1.5 + IMPROVEMENTS I3.
const BUCKET_META = [
  ["debt", "Debt paydown", "#EF4444"],
  ["emergency", "Emergency fund", "#6366F1"],
  ["retirement", "Retirement", "#8B5CF6"],
  ["invest", "Invest", "#10B981"],
];
const monthName = () => new Date().toLocaleDateString(undefined, { month: "long" });

// where did a logged contribution actually go? (legacy goalId folds into invest)
function bucketOf(t) {
  const b = t.bucket;
  if (b === "debt" || b === "emergency" || b === "retirement" || b === "invest") return b;
  return "invest";
}

export default function Plan({ transactions = [], accounts = [], snapshots = [], profile = {}, onGoSetup }) {
  const ym = new Date().toISOString().slice(0, 7);
  const monthTx = useMemo(() => transactions.filter((t) => new Date(t.date).toISOString().slice(0, 7) === ym), [transactions, ym]);
  const incomeThisMonth = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const spendThisMonth = monthTx.filter((t) => t.type === "spending").reduce((s, t) => s + t.amount, 0);

  const sources = profile.incomeSources || [];
  const typical = sources.length ? sources.reduce((s, x) => s + (x.typicalMonthly || 0), 0) : (profile.typicalIncome || 0);
  const planIncome = incomeThisMonth > 0 ? incomeThisMonth : typical;

  const [amount, setAmount] = useState(planIncome);
  useEffect(() => { setAmount(planIncome); }, [planIncome]);

  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { getPlan(amount === "" ? 0 : amount).then(setPlan).catch((e) => setErr(String(e.message || e))); }, [amount]);

  // actuals this month, by bucket
  const actual = useMemo(() => {
    const a = { debt: 0, emergency: 0, retirement: 0, invest: 0 };
    for (const t of monthTx) if (t.type === "contribution") a[bucketOf(t)] += t.amount;
    return a;
  }, [monthTx]);

  // targets from the engine plan, collapsed to display buckets
  const target = useMemo(() => {
    const t = { debt: 0, emergency: 0, retirement: 0, invest: 0, floor: 0 };
    for (const s of plan?.steps || []) {
      if (s.key === "min_debt" || s.key === "high_debt") t.debt += s.amount;
      else if (s.key === "emergency") t.emergency += s.amount;
      else if (s.key === "match" || s.key === "retirement") t.retirement += s.amount;
      else if (s.key === "brokerage") t.invest += s.amount;
      else if (s.key === "floor") t.floor += s.amount;
    }
    return t;
  }, [plan]);

  // checking buffer + forward-looking minimum watch
  const checkingBalance = useMemo(() => {
    const latest = {};
    for (const s of snapshots) if (!latest[s.accountId] || new Date(s.date) > new Date(latest[s.accountId].date)) latest[s.accountId] = s;
    return accounts.filter((a) => a.type === "checking").reduce((sum, a) => sum + (latest[a.id]?.balance || 0), 0);
  }, [accounts, snapshots]);
  const floor = profile.checkingFloor || 0;
  const dayOfMonth = new Date().getDate();
  const dailySpend = spendThisMonth / Math.max(1, dayOfMonth);
  const daysToFloor = dailySpend > 0 ? (checkingBalance - floor) / dailySpend : Infinity;

  const assigned = actual.debt + actual.emergency + actual.retirement + actual.invest;
  const leftToAllocate = incomeThisMonth - assigned - spendThisMonth;

  const rows = BUCKET_META.filter(([k]) => target[k] > 0 || actual[k] > 0);

  return (
    <>
      {/* header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{monthName()} — your plan</div>
          {plan && <button onClick={onGoSetup} className="text-xs text-slate-400 hover:text-indigo-600">{plan.strategy?.replace("_", " ")} ›</button>}
        </div>
        <div className="flex items-baseline gap-2 mb-3">
          <div className="text-3xl font-mono font-bold text-slate-900">{fmt(incomeThisMonth)}</div>
          <div className="text-xs text-slate-400">earned this month{typical ? ` · ~${fmt(typical)} typical` : ""}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Plan for</span>
          <div className="relative" style={{ width: 120 }}>
            <span className="absolute left-3 top-2 text-slate-400 text-sm">$</span>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full pl-7 pr-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700" />
          </div>
          {incomeThisMonth > 0 && Number(amount) !== incomeThisMonth && (
            <button onClick={() => setAmount(incomeThisMonth)} className="text-xs text-indigo-600">use this month</button>
          )}
        </div>
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-600 text-xs rounded-xl p-3">{err}</div>}

      {/* per-bucket plan vs actual */}
      {rows.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Plan vs. actual</div>
          {rows.map(([k, label, color]) => {
            const tgt = target[k], act = actual[k];
            const pct = tgt > 0 ? Math.min(100, (act / tgt) * 100) : (act > 0 ? 100 : 0);
            const done = tgt > 0 && act >= tgt;
            return (
              <div key={k}>
                <div className="flex items-baseline justify-between text-sm mb-1">
                  <span className="font-medium text-slate-700">{label}</span>
                  <span className="font-mono text-slate-600">{fmt(act)}<span className="text-slate-300"> / {fmt(tgt)}</span></span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                </div>
                {tgt > 0 && !done && <div className="text-xs text-slate-400 mt-1">{fmt(tgt - act)} to go this month</div>}
                {done && <div className="text-xs text-emerald-600 mt-1">target met ✓</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* what's left to allocate (flexible money) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Flexible / unassigned</div>
            <div className="text-xs text-slate-400">income earned − assigned − spent, this month</div>
          </div>
          <div className={`text-2xl font-mono font-bold ${leftToAllocate >= 0 ? "text-slate-900" : "text-rose-500"}`}>{fmt(leftToAllocate)}</div>
        </div>
      </div>

      {/* checking minimum watch */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Checking buffer</div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-sm text-slate-600">Balance vs. floor</span>
          <span className="font-mono text-sm text-slate-700">{fmt(checkingBalance)}<span className="text-slate-300"> / {fmt(floor)} min</span></span>
        </div>
        {checkingBalance < floor ? (
          <div className="text-sm text-rose-500 font-medium">Below your floor by {fmt(floor - checkingBalance)}.</div>
        ) : dailySpend > 0 && isFinite(daysToFloor) ? (
          <div className={`text-sm font-medium ${daysToFloor < 14 ? "text-amber-600" : "text-emerald-600"}`}>
            At this spend rate, ~{Math.round(daysToFloor)} days of buffer above your floor.
          </div>
        ) : (
          <div className="text-sm text-emerald-600 font-medium">Above your floor.</div>
        )}
      </div>
    </>
  );
}
