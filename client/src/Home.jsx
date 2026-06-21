import { useState, useEffect, useMemo } from "react";
import { fmt } from "./format.js";
import { getPlan } from "./api.js";
import { computeAdherence } from "./streak.js";
import { nextMilestone } from "./milestones.js";
import { Flame, Check } from "lucide-react";
import SankeyFlow from "./Sankey.jsx";
import Calendar from "./Calendar.jsx";
import MilestoneIcon from "./MilestoneIcon.jsx";

// The landing screen — the valuable stuff at a glance, with tap-through to detail.
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

const TONE = {
  slate: ["bg-slate-100", "text-slate-500", "text-slate-900"],
  emerald: ["bg-emerald-50", "text-emerald-700", "text-emerald-700"],
  amber: ["bg-amber-50", "text-amber-700", "text-amber-700"],
  brand: ["bg-brand-50", "text-brand-700", "text-brand-700"],
  blue: ["bg-blue-50", "text-blue-700", "text-blue-700"],
};
function Stat({ label, value, tone = "slate" }) {
  const [bg, lt, vt] = TONE[tone] || TONE.slate;
  return (
    <div className={`rounded-xl p-3 ${bg}`}>
      <div className={`text-xs ${lt}`}>{label}</div>
      <div className={`text-lg font-mono font-bold ${vt}`}>{value}</div>
    </div>
  );
}
function Card({ title, onGo, span, children }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-4 ${span ? "lg:col-span-2" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</div>
        {onGo && <button onClick={onGo} className="text-xs text-slate-400 hover:text-brand-600">open ›</button>}
      </div>
      {children}
    </div>
  );
}

export default function Home({ profile = {}, transactions = [], accounts = [], snapshots = [], income = 0, realNetWorth = 0, investedTotal = 0, milestoneList = [], freezes = 2, onGo }) {
  const ym = new Date().toISOString().slice(0, 7);
  const monthTx = useMemo(() => transactions.filter((t) => new Date(t.date).toISOString().slice(0, 7) === ym), [transactions, ym]);
  const incomeThisMonth = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const spendThisMonth = monthTx.filter((t) => t.type === "spending").reduce((s, t) => s + t.amount, 0);
  const contribThisMonth = monthTx.filter((t) => t.type === "contribution").reduce((s, t) => s + t.amount, 0);

  const annualExpenses = useMemo(() => {
    const sp = transactions.filter((t) => t.type === "spending");
    if (!sp.length) return 0;
    const months = new Set(sp.map((t) => new Date(t.date).toISOString().slice(0, 7)));
    return (sp.reduce((s, t) => s + t.amount, 0) / Math.max(1, months.size)) * 12;
  }, [transactions]);

  const savingsRate = incomeThisMonth > 0 ? Math.max(0, (incomeThisMonth - spendThisMonth) / incomeThisMonth) : null;
  const firePct = annualExpenses > 0 ? realNetWorth / (annualExpenses * 25) : null;

  const planIncome = incomeThisMonth > 0 ? incomeThisMonth : income;
  const [plan, setPlan] = useState(null);
  useEffect(() => { getPlan(planIncome).then(setPlan).catch(() => {}); }, [planIncome]);
  const leftToAllocate = incomeThisMonth - contribThisMonth - spendThisMonth;

  const adh = useMemo(() => computeAdherence(transactions, freezes), [transactions, freezes]);
  const next = nextMilestone(milestoneList);
  const nw = snapshots.length ? realNetWorth : investedTotal;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* hero */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 lg:col-span-2 relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-brand-500" />
        {profile.name && <div className="text-sm text-slate-500 mb-1">{greeting()}, {profile.name}.</div>}
        <div className="text-xs text-slate-400 tracking-widest uppercase font-medium">{snapshots.length ? "Net worth" : "Contributed"}</div>
        <div className="text-4xl font-mono font-bold text-slate-900 tabular-nums">{fmt(nw)}</div>
        <div className="text-xs text-slate-400 mt-1">{investedTotal > 0 ? `${fmt(investedTotal)} contributed by you` : "log a balance in Setup for real net worth"}</div>
      </div>

      {/* key numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 lg:col-span-2">
        <Stat label="Income / mo" value={fmt(income)} tone="emerald" />
        <Stat label="Spent this month" value={fmt(spendThisMonth)} tone="amber" />
        <Stat label="Savings rate" value={savingsRate == null ? "—" : `${Math.round(savingsRate * 100)}%`} tone="brand" />
        <Stat label="FIRE progress" value={firePct == null ? "—" : `${(firePct * 100).toFixed(1)}%`} tone="blue" />
      </div>

      {/* plan snapshot */}
      <Card title={`${new Date().toLocaleDateString(undefined, { month: "long" })} plan`} onGo={() => onGo?.("plan")}>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-sm text-slate-600">Earned this month</span>
          <span className="font-mono text-slate-800">{fmt(incomeThisMonth)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-600">Flexible / unassigned</span>
          <span className={`font-mono font-semibold ${leftToAllocate >= 0 ? "text-slate-900" : "text-rose-500"}`}>{fmt(leftToAllocate)}</span>
        </div>
        {plan?.steps?.length > 0 && (
          <div className="text-xs text-slate-400 mt-2">Next move: {plan.steps.find((s) => s.key !== "essentials")?.label || plan.steps[0].label}</div>
        )}
      </Card>

      {/* game summary */}
      <Card title="Your progress" onGo={() => onGo?.("goals")}>
        <div className="flex items-center gap-3 mb-2">
          <Flame size={28} className={adh.current > 0 ? "text-orange-500" : "text-slate-300"} />
          <div>
            <div className="text-2xl font-mono font-bold text-slate-900">{adh.current}<span className="text-sm font-sans font-normal text-slate-400"> wk streak</span></div>
            <div className="text-xs text-slate-500 inline-flex items-center gap-1">This week: {adh.objective.label} {adh.metThisWeek && <Check size={13} className="text-emerald-600" />}</div>
          </div>
        </div>
        {next && (
          <div>
            <div className="flex items-baseline justify-between text-xs text-slate-500 mb-1">
              <span className="inline-flex items-center gap-1">Next: <MilestoneIcon name={next.icon} size={12} /> {next.label}</span><span className="font-mono">{fmt(next.cur)} / {fmt(next.target)}</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.min(100, (next.cur / next.target) * 100)}%` }} />
            </div>
          </div>
        )}
      </Card>

      {/* flow */}
      <Card title="This month's flow" span>
        <SankeyFlow transactions={transactions} fallbackIncome={income} />
      </Card>

      {/* calendar */}
      <div className="lg:col-span-2 space-y-4">
        <Calendar transactions={transactions} profile={profile} />
      </div>
    </div>
  );
}
