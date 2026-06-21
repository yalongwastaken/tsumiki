import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { getState, putState } from "./api.js";
import { fmt } from "./format.js";
import Setup from "./Setup.jsx";
import Plan from "./Plan.jsx";
import QuickAdd from "./QuickAdd.jsx";

// recharts is heavy and only used on the Grow tab — load it on demand.
const Projection = lazy(() => import("./Projection.jsx"));

// M0 note: data model is now the unified shape from the server (SPEC.md §6).
// Existing components are fed DERIVED views (contributions/expenses) off the
// single `transactions` ledger, so screens keep working while the model changes.
const CATS = ["Tech / Gear", "Subscriptions", "Dining Out", "Entertainment", "Education", "Clothing", "Other"];
const CAT_COLORS = ["#FB923C", "#F97316", "#FDBA74", "#FCD34D"];

const EMPTY = {
  accounts: [], snapshots: [], goals: [], debts: [], transactions: [],
  profile: { incomeType: "salary", typicalIncome: 7000, strategy: "balanced" },
  settings: { returnRate: 0.07, monthlyInvest: null },
};

// ─── helpers ──────────────────────────────────────────────────────────────────
const weekKey = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0,0,0,0); return x.getTime(); };
const WEEK = 7 * 86400000;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function savedFor(goalId, contributions) {
  return contributions.filter(c => c.goalId === goalId).reduce((s, c) => s + c.amount, 0);
}

function computeStreak(contributions) {
  const weeks = new Set(contributions.map(c => weekKey(c.date)));
  if (weeks.size === 0) return { current: 0, longest: 0, weeks };
  let cur = weekKey(Date.now());
  if (!weeks.has(cur)) cur -= WEEK;
  let current = 0;
  while (weeks.has(cur)) { current++; cur -= WEEK; }
  const sorted = [...weeks].sort((a,b) => a-b);
  let longest = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] - sorted[i-1] === WEEK ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return { current, longest: Math.max(longest, current), weeks };
}

function useCountUp(target, dur = 900) {
  const [val, setVal] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current, to = target, t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return val;
}

// ─── Sankey Flow ──────────────────────────────────────────────────────────────
function SankeyFlow({ goals, expenses, income }) {
  const W = 580, LX = 50, LW = 16, RX = 405, RW = 16, PTOP = 12, PBOT = 16, GAP = 6, MIN_H = 30, SCALE = 140;
  const catMap = expenses.reduce((a,e) => { a[e.cat] = (a[e.cat]||0)+e.amount; return a; }, {});
  const topCats = Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0,4);
  const items = [
    ...goals.map(g => ({ label: g.name, amount: g.pledge, color: g.color })),
    ...topCats.map(([c,a],i) => ({ label: c, amount: a, color: CAT_COLORS[i % CAT_COLORS.length] })),
  ];
  const freeAmt = income - items.reduce((s,x) => s+x.amount, 0);
  if (freeAmt > 0) items.push({ label: "To brokerage", amount: freeAmt, color: "#94A3B8" });
  if (items.length === 0) return <div className="text-center py-6 text-slate-400 text-sm">Add goals or log spending to see your flow.</div>;

  let ry = PTOP;
  const right = items.map(it => { const h = MIN_H + (it.amount/income)*SCALE; const r = {...it, y:ry, h}; ry += h+GAP; return r; });
  const SVG_H = ry - GAP + PBOT, leftH = SVG_H - PTOP - PBOT;
  let ly = PTOP;
  const left = items.map(it => { const h = (it.amount/income)*leftH; const b = {...it, y:ly, h}; ly += h; return b; });
  const ribbon = (l,r) => { const cx=(RX-LX-LW)*0.42, x1=LX+LW, x2=RX;
    return `M${x1},${l.y} C${x1+cx},${l.y} ${x2-cx},${r.y} ${x2},${r.y} L${x2},${r.y+r.h} C${x2-cx},${r.y+r.h} ${x1+cx},${l.y+l.h} ${x1},${l.y+l.h} Z`; };
  const cY = PTOP + leftH/2;
  return (
    <svg viewBox={`0 0 ${W} ${SVG_H}`} width="100%" style={{ display:"block", overflow:"visible" }}>
      {left.map((b,i) => <rect key={i} x={LX} y={b.y} width={LW} height={Math.max(0.5,b.h)} fill={b.color} />)}
      {right.map((r,i) => <path key={i} d={ribbon(left[i],r)} fill={r.color} fillOpacity={0.2} />)}
      {right.map((r,i) => <rect key={i} x={RX} y={r.y} width={RW} height={r.h} fill={r.color} rx={2} />)}
      {right.map((r,i) => { const m = r.y+r.h/2, lc = r.color==="#94A3B8"?"#64748B":r.color;
        return (<g key={i}>
          <text x={RX+RW+10} y={m-7} dominantBaseline="central" fontSize="11" fill={lc} fontWeight="600">{r.label}</text>
          <text x={RX+RW+10} y={m+7} dominantBaseline="central" fontSize="11" fill="#94A3B8">{fmt(r.amount)}/mo</text>
        </g>); })}
      <text x={LX-10} y={cY-8} textAnchor="end" dominantBaseline="central" fontSize="11" fill="#94A3B8">Monthly</text>
      <text x={LX-10} y={cY+8} textAnchor="end" dominantBaseline="central" fontSize="13" fill="#0F172A" fontWeight="bold">{fmt(income)}</text>
    </svg>
  );
}

// ─── Net worth setter (M0 stand-in for proper account snapshots, SPEC §6) ───────
function NetWorthCard({ realNetWorth, onSet }) {
  const [v, setV] = useState("");
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Starting point</div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-600 flex-1">Record your current net worth (a balance snapshot)</span>
        <div className="relative" style={{ width: 130 }}>
          <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
          <input type="number" placeholder={String(Math.round(realNetWorth))} value={v} onChange={e => setV(e.target.value)}
            className="w-full pl-7 pr-2 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700" />
        </div>
        <button onClick={() => { const n = parseFloat(v); if (!Number.isNaN(n)) { onSet(n); setV(""); } }}
          className="px-3 py-2 text-sm font-semibold text-white rounded-lg bg-indigo-600 hover:bg-indigo-700">Set</button>
      </div>
    </div>
  );
}

// ─── Streak ───────────────────────────────────────────────────────────────────
function StreakPanel({ contributions }) {
  const { current, longest, weeks } = computeStreak(contributions);
  const thisWeek = weekKey(Date.now());
  const cells = [];
  for (let i = 11; i >= 0; i--) {
    const wk = thisWeek - i*WEEK;
    cells.push({ wk, active: weeks.has(wk), isNow: wk === thisWeek });
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Discipline streak</div>
        <div className="text-xs text-slate-400">longest: {longest} wk</div>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="text-4xl">{current > 0 ? "🔥" : "💤"}</div>
        <div>
          <div className="text-3xl font-mono font-bold text-slate-900">{current}</div>
          <div className="text-xs text-slate-400">{current === 1 ? "week" : "weeks"} in a row</div>
        </div>
      </div>
      <div className="flex gap-1.5">
        {cells.map((c,i) => (
          <div key={i} title={new Date(c.wk).toLocaleDateString()}
            className={`flex-1 rounded transition-colors ${c.active ? "bg-orange-400" : "bg-slate-100"} ${c.isNow ? "ring-2 ring-orange-300" : ""}`}
            style={{ height: 28 }} />
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-xs text-slate-300">
        <span>12 weeks ago</span><span>this week</span>
      </div>
    </div>
  );
}

// ─── Quick Log ──────────────────────────────────────────────────────────────
function QuickLog({ goals, contributions, onLog }) {
  const [goalId, setGoalId] = useState(goals[0]?.id || "brokerage");
  const [amount, setAmount] = useState("");
  const thisWeek = weekKey(Date.now());
  const loggedThisWeek = contributions.some(c => weekKey(c.date) === thisWeek);
  return (
    <div className={`rounded-xl border p-4 transition-colors ${loggedThisWeek ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{loggedThisWeek ? "✓" : "🔥"}</span>
        <div className="text-sm font-semibold text-slate-700">
          {loggedThisWeek ? "Streak secured this week" : "Log a contribution to keep your streak"}
        </div>
      </div>
      <div className="flex gap-2">
        <select value={goalId} onChange={e => setGoalId(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 flex-1 min-w-0">
          {goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          <option value="brokerage">Brokerage (VTI)</option>
        </select>
        <div className="relative" style={{ width: 110 }}>
          <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
          <input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)}
            className="w-full pl-7 pr-2 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700" />
        </div>
        <button onClick={() => { const n = parseFloat(amount); if (n > 0) { onLog(goalId, n); setAmount(""); } }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
          Log
        </button>
      </div>
    </div>
  );
}

// ─── Goal Card ────────────────────────────────────────────────────────────────
function GoalCard({ goal, saved, onDeposit }) {
  const [input, setInput] = useState("");
  const pct = Math.min(100, (saved/goal.target)*100);
  const mos = saved >= goal.target ? 0 : Math.ceil((goal.target - saved)/(goal.pledge || 1));
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex justify-between items-start mb-3">
        <div><div className="font-semibold text-slate-800">{goal.name}</div>
          <div className="text-xs text-slate-400 mt-0.5">{fmt(goal.pledge)}/month pledged</div></div>
        <div className="text-right"><div className="text-2xl font-mono font-bold text-slate-900">{fmt(saved)}</div>
          <div className="text-xs text-slate-400">of {fmt(goal.target)}</div></div>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-1.5">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: goal.color }} /></div>
      <div className="flex justify-between text-xs text-slate-400 mb-4">
        <span>{pct.toFixed(1)}%</span><span>{pct >= 100 ? "Goal reached!" : `~${mos} months at this pace`}</span></div>
      <div className="flex gap-2">
        <div className="relative flex-1"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
          <input type="number" placeholder="Deposit" value={input} onChange={e => setInput(e.target.value)}
            className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700" /></div>
        <button onClick={() => { const n = parseFloat(input); if (n > 0) { onDeposit(goal.id, n); setInput(""); } }}
          className="px-4 py-2 text-sm font-semibold text-white rounded-lg hover:opacity-90 transition-opacity"
          style={{ background: goal.color }}>Add</button>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("plan");
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { (async () => {
    try { setData({ ...EMPTY, ...(await getState()) }); }
    catch (e) { setError(String(e.message || e)); }
    setLoading(false);
  })(); }, []);

  async function save(next) {
    setData(next);
    try { await putState(next); setToast("Saved"); setTimeout(() => setToast(""), 1200); }
    catch (e) { setError(String(e.message || e)); }
  }

  const { goals, transactions, settings, accounts, snapshots, profile } = data;
  const income = profile?.typicalIncome || 7000;

  // derived views off the single ledger (SPEC.md §6)
  const contributions = useMemo(
    () => transactions.filter(t => t.type === "contribution").map(t => ({ id: t.id, goalId: t.goalId, amount: t.amount, date: t.date })),
    [transactions]);
  const expenses = useMemo(
    () => transactions.filter(t => t.type === "spending").map(t => ({ id: t.id, cat: t.cat, amount: t.amount, note: t.note, date: new Date(t.date).toLocaleDateString() })),
    [transactions]);

  // real net worth = sum of latest snapshot per account (SPEC.md §7)
  const realNetWorth = useMemo(() => {
    const latest = {};
    for (const s of snapshots) if (!latest[s.accountId] || new Date(s.date) > new Date(latest[s.accountId].date)) latest[s.accountId] = s;
    return Object.values(latest).reduce((a, s) => a + s.balance, 0);
  }, [snapshots]);
  const investedTotal = contributions.reduce((s,c) => s+c.amount, 0);
  const netWorth = snapshots.length ? realNetWorth : investedTotal;
  const animNW = useCountUp(netWorth);

  function logContribution(goalId, amount) {
    save({ ...data, transactions: [...transactions, { id: uid(), type: "contribution", goalId, amount, date: new Date().toISOString(), note: null, cat: null }] });
  }
  function addExpense(cat, amount, note) {
    save({ ...data, transactions: [...transactions, { id: uid(), type: "spending", cat, amount, note: note || null, date: new Date().toISOString(), goalId: null }] });
  }
  function deleteTx(id) {
    save({ ...data, transactions: transactions.filter(t => t.id !== id) });
  }
  function logTx({ type, amount, cat = null, goalId = null, note = null }) {
    save({ ...data, transactions: [...transactions, { id: uid(), type, amount, date: new Date().toISOString(), cat, goalId, note }] });
  }
  function setNetWorth(value) {
    let acctId = accounts[0]?.id, accts = accounts;
    if (!acctId) { acctId = "primary"; accts = [{ id: acctId, name: "Net worth", type: "other", color: "#94A3B8" }]; }
    save({ ...data, accounts: accts, snapshots: [...snapshots, { id: uid(), accountId: acctId, date: new Date().toISOString(), balance: value }] });
  }

  if (loading) return <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Loading your data…</div>;

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {error && <div className="bg-rose-50 border-b border-rose-200 text-rose-600 text-xs px-5 py-2">{error}</div>}
      {/* Hero */}
      <div className="bg-white border-b border-slate-200 px-5 pt-5 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-slate-400 tracking-widest uppercase font-medium mb-1">Net worth</div>
            <div className="text-4xl font-mono font-bold text-slate-900 tabular-nums">{fmt(animNW)}</div>
            <div className="text-xs text-slate-400 mt-1">
              {investedTotal > 0 ? `${fmt(investedTotal)} contributed so far` : "Start logging to grow this"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">income</div>
            <div className="text-lg font-mono font-bold text-slate-700">{fmt(income)}</div>
            <div className="text-xs text-slate-400">/mo</div>
          </div>
        </div>
        {toast && <div className="mt-2 text-xs text-emerald-500">{toast}</div>}
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 flex">
        {["Plan","Dashboard","Grow","Log","Goals","Setup"].map(t => (
          <button key={t} onClick={() => setTab(t.toLowerCase())}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.toLowerCase() ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t}</button>
        ))}
      </div>

      <div className="px-4 pt-5 space-y-4 max-w-lg mx-auto">
        {tab === "plan" && <Plan defaultIncome={profile?.typicalIncome ?? undefined} onGoSetup={() => setTab("setup")} />}

        {tab === "dashboard" && <>
          <QuickLog goals={goals} contributions={contributions} onLog={logContribution} />
          <StreakPanel contributions={contributions} />
          <div className="bg-white rounded-xl border border-slate-200 px-4 pt-4 pb-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Monthly flow — the engine</div>
            <SankeyFlow goals={goals} expenses={expenses} income={income} />
          </div>
        </>}

        {tab === "grow" && <>
          <Suspense fallback={<div className="bg-white rounded-xl border border-slate-200 p-4 text-center text-slate-400 text-sm">Loading projection…</div>}>
            <Projection start={netWorth} settings={settings} onChange={(s) => save({ ...data, settings: s })} />
          </Suspense>
          <NetWorthCard realNetWorth={realNetWorth} onSet={setNetWorth} />
        </>}

        {tab === "log" && <LogTab cats={CATS} expenses={expenses} contributions={contributions} goals={goals}
          onAddExpense={addExpense} onDeleteExpense={deleteTx} onDeleteContribution={deleteTx} />}

        {tab === "goals" && (goals.length ? goals.map(g => (
          <GoalCard key={g.id} goal={g} saved={savedFor(g.id, contributions)} onDeposit={logContribution} />
        )) : <div className="text-center py-12 text-slate-400 text-sm">No goals yet.</div>)}

        {tab === "setup" && <Setup data={data} onSave={save} />}
      </div>

      {/* always-available fast logging (SPEC §9) */}
      <button onClick={() => setShowAdd(true)} aria-label="Log a transaction"
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-3xl leading-none shadow-lg flex items-center justify-center">
        +
      </button>
      <QuickAdd open={showAdd} onClose={() => setShowAdd(false)} onLog={logTx}
        cats={CATS} goals={goals} transactions={transactions} />
    </div>
  );
}

function LogTab({ cats, expenses, contributions, goals, onAddExpense, onDeleteExpense, onDeleteContribution }) {
  const [cat, setCat] = useState(cats[0]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const goalName = (id) => id === "brokerage" ? "Brokerage (VTI)" : (goals.find(g => g.id === id)?.name || id);
  return <>
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Log expense</div>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select value={cat} onChange={e => setCat(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700">
            {cats.map(c => <option key={c}>{c}</option>)}</select>
          <div className="relative"><span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
            <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700" /></div>
        </div>
        <input type="text" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700" />
        <button onClick={() => { const n = parseFloat(amount); if (n > 0) { onAddExpense(cat, n, note); setAmount(""); setNote(""); } }}
          className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors">
          Add expense</button>
      </div>
    </div>

    {contributions.length > 0 && (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Contributions</div>
        <div className="divide-y divide-slate-50">
          {[...contributions].reverse().map(c => (
            <div key={c.id} className="flex items-center justify-between py-2.5">
              <div><div className="text-sm text-slate-700">{goalName(c.goalId)}</div>
                <div className="text-xs text-slate-300">{new Date(c.date).toLocaleDateString()}</div></div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-emerald-600">+{fmt(c.amount)}</span>
                <button onClick={() => onDeleteContribution(c.id)} className="text-slate-300 hover:text-rose-400 text-xs">✕</button></div>
            </div>))}
        </div>
      </div>
    )}

    {expenses.length > 0 && (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Expenses</div>
        <div className="divide-y divide-slate-50">
          {[...expenses].reverse().map(e => (
            <div key={e.id} className="flex items-center justify-between py-2.5">
              <div><div className="text-sm text-slate-700">{e.cat}</div>
                {e.note && <div className="text-xs text-slate-400">{e.note}</div>}
                <div className="text-xs text-slate-300">{e.date}</div></div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-slate-700">{fmt(e.amount)}</span>
                <button onClick={() => onDeleteExpense(e.id)} className="text-slate-300 hover:text-rose-400 text-xs">✕</button></div>
            </div>))}
        </div>
      </div>
    )}

    {contributions.length === 0 && expenses.length === 0 && (
      <div className="text-center py-12 text-slate-400 text-sm">Nothing logged yet.</div>
    )}
  </>;
}
