import { useState, useEffect, useMemo } from "react";
import { Check } from "lucide-react";
import { getPlan } from "./api.js";
import { fmt } from "./format.js";
import { typicalIncome } from "./income.js";
import { BUCKETS, bucketOf } from "./buckets.js";

// I3 — the living monthly plan. This month's pooled income → engine targets per
// bucket vs your actual contributions, what's left to allocate, and a
// forward-looking checking minimum watch. SPEC §1.5 + IMPROVEMENTS I3.
const BUCKET_META = BUCKETS.map((b) => [b.key, b.label, b.color]);
const monthName = () => new Date().toLocaleDateString(undefined, { month: "long" });

export default function Plan({ transactions = [], accounts = [], snapshots = [], profile = {}, onGoSetup }) {
  const ym = new Date().toISOString().slice(0, 7);
  const monthTx = useMemo(() => transactions.filter((t) => new Date(t.date).toISOString().slice(0, 7) === ym), [transactions, ym]);
  const incomeThisMonth = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const spendThisMonth = monthTx.filter((t) => t.type === "spending").reduce((s, t) => s + t.amount, 0);

  const typical = useMemo(() => typicalIncome(profile, transactions), [profile, transactions]);
  const planIncome = incomeThisMonth > 0 ? incomeThisMonth : typical;

  const [amount, setAmount] = useState(planIncome);
  useEffect(() => { setAmount(planIncome); }, [planIncome]);

  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const n = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    getPlan(n).then(setPlan).catch((e) => setErr(String(e.message || e)));
  }, [amount]);

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
  const hasCheckingContext = accounts.some((a) => a.type === "checking") || floor > 0;
  const dayOfMonth = new Date().getDate();
  const dailySpend = spendThisMonth / Math.max(1, dayOfMonth);
  const daysToFloor = dailySpend > 0 ? (checkingBalance - floor) / dailySpend : Infinity;

  const assigned = actual.debt + actual.emergency + actual.retirement + actual.invest;
  const leftToAllocate = incomeThisMonth - assigned - spendThisMonth;

  const rows = BUCKET_META.filter(([k]) => target[k] > 0 || actual[k] > 0);

  // where each step's money should physically go (the core "split my paycheck" advice)
  const STEP_COLOR = (k) => ({ essentials: "#94A3B8", min_debt: "#E05656", high_debt: "#E05656", floor: "#378ADD", emergency: "#378ADD", match: "#A78BFA", retirement: "#A78BFA", brokerage: "#1D9E75" }[k] || "#94A3B8");
  const acctName = (type) => accounts.find((a) => a.type === type)?.name;
  const routeFor = (k) => {
    if (k === "essentials" || k === "floor" || k === "min_debt") return acctName("checking") || "your checking";
    if (k === "emergency") return acctName("savings") || "a savings account";
    if (k === "match" || k === "retirement") return acctName("ira") || "your 401k / IRA";
    if (k === "brokerage") return acctName("brokerage") || "a brokerage account";
    if (k === "high_debt") return "your highest-rate debt";
    return "—";
  };

  return (
    <>
      {/* header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{monthName()} — your plan</div>
          {plan && <button onClick={onGoSetup} className="text-xs text-slate-400 hover:text-brand-600">{plan.strategy?.replace("_", " ")} ›</button>}
        </div>
        <div className="flex items-baseline gap-2 mb-3">
          <div className="text-3xl font-mono font-bold text-slate-900">{fmt(incomeThisMonth)}</div>
          <div className="text-xs text-slate-400">earned this month{typical ? ` · ~${fmt(typical)} typical` : ""}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Plan for</span>
          <div className="relative" style={{ width: 120 }}>
            <span className="absolute left-3 top-2 text-slate-400 text-sm">$</span>
            <input type="number" value={amount} onChange={(e) => { const v = e.target.value; setAmount(v === "" || Number.isNaN(Number(v)) ? "" : Number(v)); }}
              className="w-full pl-7 pr-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700" />
          </div>
          {incomeThisMonth > 0 && Number(amount) !== incomeThisMonth && (
            <button onClick={() => setAmount(incomeThisMonth)} className="text-xs text-brand-600">use this month</button>
          )}
        </div>
        {plan?.essentials > 0 && (
          <div className="text-xs text-slate-400 mt-2">
            {fmt(plan.essentials)} reserved for essentials {plan.essentialsSource === "bills" ? "(your bills)" : "(est. from spending)"} — the rest is allocated below.
          </div>
        )}
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-600 text-xs rounded-xl p-3">{err}</div>}

      {/* paycheck → accounts routing (the core advice) */}
      {plan?.steps?.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Send this money to…</div>
          <div className="space-y-2.5">
            {plan.steps.map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: STEP_COLOR(s.key) }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-700">{s.label}</div>
                  <div className="text-xs text-slate-400 truncate">→ {routeFor(s.key)}</div>
                </div>
                <span className="text-sm font-mono font-semibold text-slate-900">{fmt(s.amount)}</span>
              </div>
            ))}
            {plan.leftover > 0 && (
              <div className="flex items-center gap-3 pt-1 border-t border-slate-50">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-slate-300" />
                <div className="flex-1 text-sm text-slate-500">Leftover · flexible in checking</div>
                <span className="text-sm font-mono text-slate-500">{fmt(plan.leftover)}</span>
              </div>
            )}
          </div>
        </div>
      )}

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
                {done && <div className="text-xs text-emerald-600 mt-1 inline-flex items-center gap-1"><Check size={13} /> target met</div>}
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

      {/* checking minimum watch — only when there's something to watch */}
      {hasCheckingContext && (
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
      )}
    </>
  );
}
