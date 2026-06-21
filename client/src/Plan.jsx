import { useState, useEffect } from "react";
import { getPlan } from "./api.js";
import { fmt } from "./format.js";

// M2 — "Your Plan": the core promise. Calls the server-side engine and shows
// where each dollar of a given income should go. SPEC.md §1.5.
const COLORS = {
  min_debt: "#EF4444", floor: "#3B82F6", match: "#10B981",
  high_debt: "#F97316", emergency: "#6366F1", retirement: "#8B5CF6", brokerage: "#94A3B8",
};
const STRATEGY_LABEL = { short_term: "Safety first", balanced: "Balanced", long_term: "Growth first", custom: "Custom" };

export default function Plan({ defaultIncome, onGoSetup }) {
  const [income, setIncome] = useState(defaultIncome ?? "");
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function run(amt) {
    setLoading(true); setErr("");
    try { setPlan(await getPlan(amt === "" || amt == null ? undefined : amt)); }
    catch (e) { setErr(String(e.message || e)); }
    setLoading(false);
  }
  useEffect(() => { run(defaultIncome); /* fresh on mount */ }, []); // eslint-disable-line

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your plan</div>
          {plan && (
            <button onClick={onGoSetup} className="text-xs text-slate-400 hover:text-indigo-600">
              {STRATEGY_LABEL[plan.strategy] || plan.strategy} ›
            </button>
          )}
        </div>
        <div className="text-sm text-slate-600 mb-2">If I have this much to put to work:</div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
            <input type="number" value={income} onChange={(e) => setIncome(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run(income)}
              placeholder="amount" className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700" />
          </div>
          <button onClick={() => run(income)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg">Plan it</button>
        </div>
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-600 text-xs rounded-xl p-3">{err}</div>}
      {loading && <div className="text-center py-10 text-slate-400 text-sm">Crunching your plan…</div>}

      {!loading && plan && plan.income === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-400 text-sm">
          Enter an amount above (or set a typical income in Setup) to see your plan.
        </div>
      )}

      {!loading && plan && plan.income > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          {/* stacked allocation bar */}
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-sm font-semibold text-slate-700">{fmt(plan.income)} allocated</div>
            {plan.leftover > 0 && <div className="text-xs text-slate-400">{fmt(plan.leftover)} unassigned</div>}
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 mb-4">
            {plan.steps.map((s, i) => (
              <div key={i} title={`${s.label}: ${fmt(s.amount)}`}
                style={{ width: `${(s.amount / plan.income) * 100}%`, background: COLORS[s.key] || "#cbd5e1" }} />
            ))}
          </div>

          {/* step rows */}
          <div className="space-y-3">
            {plan.steps.map((s, i) => (
              <div key={i} className="flex gap-3">
                <div className="mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[s.key] || "#cbd5e1" }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">{s.label}</span>
                    <span className="text-sm font-mono font-semibold text-slate-900">{fmt(s.amount)}</span>
                  </div>
                  <div className="text-xs text-slate-400">{s.why}</div>
                </div>
              </div>
            ))}
          </div>

          {plan.steps.length === 0 && (
            <div className="text-center py-4 text-slate-400 text-sm">Nothing to allocate at this amount.</div>
          )}
        </div>
      )}
    </>
  );
}
