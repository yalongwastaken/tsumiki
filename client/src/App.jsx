import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { getState, putState, getPlan, addTransaction } from "./api.js";
import { fmt } from "./format.js";
import { typicalIncome } from "./income.js";
import { computeAdherence } from "./streak.js";
import Setup from "./Setup.jsx";
import Plan from "./Plan.jsx";
import QuickAdd from "./QuickAdd.jsx";
import Calendar from "./Calendar.jsx";
import Onboarding from "./Onboarding.jsx";
import Milestones from "./Milestones.jsx";
import MoneyTargets from "./MoneyTargets.jsx";
import { computeMilestones } from "./milestones.js";

import Fire from "./Fire.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
// recharts is heavy and only used on the Grow tab — load it on demand.
const Projection = lazy(() => import("./Projection.jsx"));
const NetWorthHistory = lazy(() => import("./NetWorthHistory.jsx"));

// M0 note: data model is now the unified shape from the server (SPEC.md §6).
// Components read the unified `transactions` ledger; contributions are bucketed.
const CATS = ["Tech / Gear", "Subscriptions", "Dining Out", "Entertainment", "Education", "Clothing", "Other"];
const CAT_COLORS = ["#FB923C", "#F97316", "#FDBA74", "#FCD34D"];

const EMPTY = {
  accounts: [], snapshots: [], goals: [], debts: [], transactions: [],
  profile: { incomeType: "salary", typicalIncome: 7000, strategy: "balanced" },
  settings: { returnRate: 0.07, monthlyInvest: null },
};

// ─── helpers ──────────────────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

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
// M4 (§7): real money flow for the current month — actual income on the left,
// actual spending + contributions + leftover on the right. Honest, not planned.
const BUCKET_LABELS = { emergency: "Emergency", retirement: "Retirement", invest: "Invest", debt: "Debt" };
const BUCKET_COLORS = { emergency: "#6366F1", retirement: "#8B5CF6", invest: "#10B981", debt: "#EF4444" };
function SankeyFlow({ transactions, fallbackIncome }) {
  const W = 580, LX = 50, LW = 16, RX = 405, RW = 16, PTOP = 12, PBOT = 16, GAP = 6, MIN_H = 30, SCALE = 140;
  const ym = new Date().toISOString().slice(0, 7);
  const month = transactions.filter(t => new Date(t.date).toISOString().slice(0, 7) === ym);
  const incomeActual = month.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const income = incomeActual > 0 ? incomeActual : fallbackIncome;
  const usingFallback = incomeActual <= 0;

  const catMap = {};
  for (const t of month) if (t.type === "spending") catMap[t.cat || "Other"] = (catMap[t.cat || "Other"] || 0) + t.amount;
  const topCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const contribMap = {};
  for (const t of month) if (t.type === "contribution") { const b = BUCKET_LABELS[t.bucket] ? t.bucket : "invest"; contribMap[b] = (contribMap[b] || 0) + t.amount; }

  const items = [
    ...Object.entries(contribMap).map(([b, a]) => ({ label: BUCKET_LABELS[b], amount: a, color: BUCKET_COLORS[b] })),
    ...topCats.map(([c, a], i) => ({ label: c, amount: a, color: CAT_COLORS[i % CAT_COLORS.length] })),
  ];
  if (!income || income <= 0)
    return <div className="text-center py-6 text-slate-400 text-sm">Log income and spending to see this month's flow.</div>;
  const freeAmt = income - items.reduce((s, x) => s + x.amount, 0);
  if (freeAmt > 0) items.push({ label: "Unspent / to invest", amount: freeAmt, color: "#94A3B8" });
  if (items.length === 0) return <div className="text-center py-6 text-slate-400 text-sm">Log spending or contributions to see your flow.</div>;

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
      <text x={LX-10} y={cY-8} textAnchor="end" dominantBaseline="central" fontSize="11" fill="#94A3B8">{usingFallback ? "Income (est.)" : "Income"}</text>
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

// ─── Streak ─── plan-adherence with a rotating weekly objective (A4) ───────────
function StreakPanel({ transactions, freezes = 0 }) {
  const { current, longest, freezesUsed, cells, objective, metThisWeek } = computeAdherence(transactions, freezes);
  const freezesLeft = Math.max(0, freezes - freezesUsed);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Adherence streak</div>
        <div className="text-xs text-slate-400">{"❄️".repeat(freezesLeft) || "no freezes"} · longest {longest} wk</div>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <div className="text-4xl">{current > 0 ? "🔥" : "💤"}</div>
        <div>
          <div className="text-3xl font-mono font-bold text-slate-900">{current}</div>
          <div className="text-xs text-slate-400">{current === 1 ? "week" : "weeks"} in a row</div>
        </div>
      </div>
      <div className={`rounded-lg px-3 py-2 mb-3 text-sm ${metThisWeek ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-600"}`}>
        <span className="font-semibold">This week: </span>{objective.label} {metThisWeek ? "✓" : ""}
      </div>
      <div className="flex gap-1.5">
        {cells.map((c, i) => (
          <div key={i} title={new Date(c.wk).toLocaleDateString()}
            className={`flex-1 rounded transition-colors ${c.met ? "bg-orange-400" : "bg-slate-100"} ${c.isNow ? "ring-2 ring-orange-300" : ""}`}
            style={{ height: 28 }} />
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-xs text-slate-300">
        <span>12 weeks ago</span><span>this week</span>
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
  const [showOnboard, setShowOnboard] = useState(false);
  const [derivedInvest, setDerivedInvest] = useState(null); // monthly investable per the plan (§7)
  const revRef = useRef(0);            // last server rev (optimistic concurrency)
  const saveChain = useRef(Promise.resolve()); // serialize writes so rapid saves can't self-conflict

  useEffect(() => { (async () => {
    try {
      const fresh = await getState();
      revRef.current = fresh.rev ?? 0;
      setData({ ...EMPTY, ...fresh });
      if (!fresh.settings?.onboarded) setShowOnboard(true); // first run
      try { setDerivedInvest((await getPlan()).investable); } catch (_) {}
    }
    catch (e) { setError(String(e.message || e)); }
    setLoading(false);
  })(); }, []);

  function save(next) {
    setData(next); // optimistic UI
    saveChain.current = saveChain.current.then(async () => {
      try {
        const saved = await putState({ ...next, rev: revRef.current });
        revRef.current = saved.rev ?? revRef.current;
        setToast("Saved"); setTimeout(() => setToast(""), 1200);
      } catch (e) {
        // 409 = changed elsewhere; any other failure means the write didn't
        // persist, so re-sync from the server rather than leave stale optimistic UI.
        try {
          const fresh = await getState();
          revRef.current = fresh.rev ?? 0;
          setData({ ...EMPTY, ...fresh });
          setError(e.status === 409 ? "" : String(e.message || e));
          setToast(e.status === 409 ? "Reloaded — changed elsewhere" : "Couldn't save — reloaded");
          setTimeout(() => setToast(""), 1800);
        } catch (_) { setError(String(e.message || e)); }
      }
    });
  }

  const { transactions, settings, accounts, snapshots, profile, debts } = data;
  const incomeSources = profile?.incomeSources || [];
  // typical monthly income — learned from history when available (A3)
  const income = useMemo(() => typicalIncome(profile, transactions), [profile, transactions]);

  // derived views off the single ledger (SPEC.md §6)
  const contributions = useMemo(
    () => transactions.filter(t => t.type === "contribution").map(t => ({ id: t.id, bucket: t.bucket, amount: t.amount, date: t.date })),
    [transactions]);

  // real net worth = sum of latest snapshot per account (SPEC.md §7)
  const realNetWorth = useMemo(() => {
    const latest = {};
    for (const s of snapshots) if (!latest[s.accountId] || new Date(s.date) > new Date(latest[s.accountId].date)) latest[s.accountId] = s;
    return Object.values(latest).reduce((a, s) => a + s.balance, 0);
  }, [snapshots]);
  const investedTotal = contributions.reduce((s,c) => s+c.amount, 0); // "contributed by you" — only goes up
  const netWorth = snapshots.length ? realNetWorth : investedTotal;
  const animNW = useCountUp(netWorth);

  // §7 reality check: contributions since you started tracking vs the actual
  // change in net worth. The gap is the market (or unlogged spending) at work.
  const realityCheck = useMemo(() => {
    if (snapshots.length < 2) return null;
    const firstByAcct = {};
    for (const s of snapshots) if (!firstByAcct[s.accountId] || new Date(s.date) < new Date(firstByAcct[s.accountId].date)) firstByAcct[s.accountId] = s;
    const startNW = Object.values(firstByAcct).reduce((a, s) => a + s.balance, 0);
    const startDate = Object.values(firstByAcct).reduce((a, s) => (new Date(s.date) < new Date(a) ? s.date : a), firstByAcct[Object.keys(firstByAcct)[0]].date);
    const deltaNW = realNetWorth - startNW;
    const contribSince = contributions.filter(c => new Date(c.date) >= new Date(startDate)).reduce((s, c) => s + c.amount, 0);
    if (contribSince <= 0) return null;
    return { gap: deltaNW - contribSince, deltaNW, contribSince };
  }, [snapshots, contributions, realNetWorth]);

  // ── M5 motivation: streak freezes + milestones ──────────────────────────────
  const freezes = settings?.streakFreezes ?? 2;
  const savingsBalance = useMemo(() => {
    const latest = {};
    for (const s of snapshots) if (!latest[s.accountId] || new Date(s.date) > new Date(latest[s.accountId].date)) latest[s.accountId] = s;
    return accounts.filter(a => a.type === "savings").reduce((sum, a) => sum + (latest[a.id]?.balance || 0), 0);
  }, [accounts, snapshots]);
  const streakNow = useMemo(() => computeAdherence(transactions, freezes).current, [transactions, freezes]);
  const milestoneList = useMemo(() => computeMilestones({
    realNetWorth, investedTotal, savings: savingsBalance,
    emergencyTarget: profile?.emergencyTarget || 0, debts, streak: streakNow,
    userTargets: profile?.moneyTargets || [],
  }), [realNetWorth, investedTotal, savingsBalance, profile, debts, streakNow]);

  // celebrate milestones newly achieved during this session — pure, no writes.
  // Baseline is captured on first load so we don't re-celebrate old wins.
  const [celebrate, setCelebrate] = useState(null);
  const seenRef = useRef(null);
  useEffect(() => {
    if (loading) return;
    const achieved = milestoneList.filter(m => m.achieved).map(m => m.id);
    if (seenRef.current === null) { seenRef.current = new Set(achieved); return; }
    const fresh = achieved.filter(id => !seenRef.current.has(id));
    if (fresh.length) {
      fresh.forEach(id => seenRef.current.add(id));
      setCelebrate(milestoneList.filter(m => fresh.includes(m.id)));
    }
  }, [milestoneList, loading]); // eslint-disable-line

  // ── M6 insight: FIRE inputs + net-worth history ─────────────────────────────
  const annualExpenses = useMemo(() => {
    const sp = transactions.filter(t => t.type === "spending");
    if (!sp.length) return 0;
    const months = new Set(sp.map(t => new Date(t.date).toISOString().slice(0, 7)));
    return (sp.reduce((s, t) => s + t.amount, 0) / Math.max(1, months.size)) * 12;
  }, [transactions]);
  const monthlyForFire = settings?.monthlyInvest ?? (derivedInvest != null ? derivedInvest : 3000);
  const nwSeries = useMemo(() => {
    if (snapshots.length < 2) return [];
    const sorted = [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date));
    const bal = {}, out = [];
    for (const s of sorted) {
      bal[s.accountId] = s.balance;
      out.push({ label: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }), value: Math.round(Object.values(bal).reduce((x, y) => x + y, 0)) });
    }
    return out;
  }, [snapshots]);

  function deleteTx(id) {
    save({ ...data, transactions: transactions.filter(t => t.id !== id) });
  }
  // S3: append via the lean endpoint instead of re-sending the whole state.
  function logTx({ type, amount, cat = null, sourceId = null, bucket = null, note = null }) {
    const tx = { id: uid(), type, amount, date: new Date().toISOString(), cat, goalId: null, sourceId, bucket, note };
    setData({ ...data, transactions: [...transactions, tx] }); // optimistic
    saveChain.current = saveChain.current.then(async () => {
      try {
        const saved = await addTransaction(tx);
        revRef.current = saved.rev ?? revRef.current;
        setToast("Saved"); setTimeout(() => setToast(""), 1200);
      } catch (e) {
        try { const fresh = await getState(); revRef.current = fresh.rev ?? 0; setData({ ...EMPTY, ...fresh }); } catch (_) {}
        setError(String(e.message || e));
      }
    });
  }
  function finishOnboarding({ name, strategy, source }) {
    const sources = source ? [...(profile.incomeSources || []), source] : (profile.incomeSources || []);
    const typical = sources.reduce((s, x) => s + (x.typicalMonthly || 0), 0);
    save({ ...data, profile: { ...profile, name, strategy, incomeSources: sources, typicalIncome: typical }, settings: { ...settings, onboarded: true } });
    setShowOnboard(false);
  }
  function skipOnboarding() {
    save({ ...data, settings: { ...settings, onboarded: true } });
    setShowOnboard(false);
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
      {celebrate && (
        <button onClick={() => setCelebrate(null)}
          className="w-full text-left bg-gradient-to-r from-amber-400 to-orange-400 text-white px-5 py-2.5 text-sm font-semibold">
          🎉 Milestone{celebrate.length > 1 ? "s" : ""}: {celebrate.map(m => `${m.icon} ${m.label}`).join("  ·  ")} <span className="opacity-70 font-normal">— tap to dismiss</span>
        </button>
      )}
      {/* Hero */}
      <div className="bg-white border-b border-slate-200 px-5 pt-5 pb-5">
        {profile?.name && <div className="text-sm text-slate-500 mb-2">{greeting()}, {profile.name}.</div>}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-slate-400 tracking-widest uppercase font-medium mb-1">
              {snapshots.length ? "Net worth" : "Contributed"}
            </div>
            <div className="text-4xl font-mono font-bold text-slate-900 tabular-nums">{fmt(animNW)}</div>
            <div className="text-xs text-slate-400 mt-1">
              {snapshots.length
                ? (investedTotal > 0 ? `${fmt(investedTotal)} contributed by you` : "real balances · set in Setup")
                : "log a balance in Setup for real net worth"}
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
        {["Plan","Calendar","Dashboard","Grow","Log","Goals","Setup"].map(t => (
          <button key={t} onClick={() => setTab(t.toLowerCase())}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.toLowerCase() ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t}</button>
        ))}
      </div>

      <ErrorBoundary key={tab}>
      <div className="px-4 pt-5 space-y-4 max-w-lg mx-auto">
        {tab === "plan" && <Plan transactions={transactions} accounts={accounts} snapshots={snapshots} profile={profile} onGoSetup={() => setTab("setup")} />}

        {tab === "calendar" && <Calendar transactions={transactions} profile={profile} />}

        {tab === "dashboard" && <>
          {realityCheck && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Reality check</div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-slate-600">You contributed {fmt(realityCheck.contribSince)}; net worth changed {fmt(realityCheck.deltaNW)}.</span>
              </div>
              <div className={`text-sm mt-1 font-medium ${realityCheck.gap >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                {realityCheck.gap >= 0
                  ? `+${fmt(realityCheck.gap)} on top — markets working for you.`
                  : `${fmt(realityCheck.gap)} — markets or unlogged spending took a bite.`}
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl border border-slate-200 px-4 pt-4 pb-3">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">This month's flow — actual</div>
            <SankeyFlow transactions={transactions} fallbackIncome={income} />
          </div>
          {transactions.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">Tap <span className="font-semibold text-indigo-500">+</span> to log income or spending — your flow and plan fill in from there.</div>
          )}
        </>}

        {tab === "grow" && <>
          <Suspense fallback={<div className="bg-white rounded-xl border border-slate-200 p-4 text-center text-slate-400 text-sm">Loading charts…</div>}>
            <Projection start={netWorth} derivedInvest={derivedInvest} settings={settings} onChange={(s) => save({ ...data, settings: s })} />
            <NetWorthHistory data={nwSeries} />
          </Suspense>
          <Fire netWorth={netWorth} monthlyInvest={monthlyForFire} returnRate={settings.returnRate} annualExpenses={annualExpenses} birthYear={profile?.birthYear} retireAge={profile?.retireAge} />
          <NetWorthCard realNetWorth={realNetWorth} onSet={setNetWorth} />
        </>}

        {tab === "log" && <Ledger transactions={transactions} sources={incomeSources} onDelete={deleteTx} />}

        {tab === "goals" && <>
          <StreakPanel transactions={transactions} freezes={freezes} />
          <Milestones list={milestoneList} />
          <MoneyTargets targets={profile?.moneyTargets || []} onChange={(list) => save({ ...data, profile: { ...profile, moneyTargets: list } })} />
        </>}

        {tab === "setup" && <Setup data={data} onSave={save} onReplayIntro={() => setShowOnboard(true)} />}
      </div>
      </ErrorBoundary>

      {/* always-available fast logging (SPEC §9) */}
      <button onClick={() => setShowAdd(true)} aria-label="Log a transaction"
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-3xl leading-none shadow-lg flex items-center justify-center">
        +
      </button>
      <QuickAdd open={showAdd} onClose={() => setShowAdd(false)} onLog={logTx}
        cats={CATS} sources={incomeSources} transactions={transactions} />
      <Onboarding open={showOnboard} initial={profile} onComplete={finishOnboarding} onSkip={skipOnboarding} />
    </div>
  );
}

// I4 — read-only ledger (logging happens via the + button). Filter + delete.
function Ledger({ transactions, sources, onDelete }) {
  const [filter, setFilter] = useState("all");
  const sourceName = (id) => sources.find((s) => s.id === id)?.name || "income";
  const bucketName = (b) => ({ emergency: "Emergency", retirement: "Retirement", invest: "Invest", debt: "Debt" }[b] || "Invest");
  const rows = [...transactions].filter((t) => filter === "all" || t.type === filter).sort((a, b) => new Date(b.date) - new Date(a.date));
  const meta = (t) => t.type === "spending" ? (t.cat || "Spending") : t.type === "income" ? sourceName(t.sourceId) : bucketName(t.bucket);
  const color = (t) => t.type === "income" ? "text-emerald-600" : t.type === "contribution" ? "text-indigo-600" : "text-slate-700";
  return <>
    <div className="flex gap-1 p-1 bg-white border border-slate-200 rounded-xl">
      {[["all", "All"], ["income", "Income"], ["spending", "Spending"], ["contribution", "Saved"]].map(([v, l]) => (
        <button key={v} onClick={() => setFilter(v)}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${filter === v ? "bg-slate-100 text-slate-800" : "text-slate-500"}`}>{l}</button>
      ))}
    </div>
    {rows.length === 0 ? (
      <div className="text-center py-12 text-slate-400 text-sm">Nothing logged yet. Tap <span className="font-semibold text-indigo-500">+</span> to start.</div>
    ) : (
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-50">
        {rows.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <div className="text-sm text-slate-700">{meta(t)}</div>
              {t.note && <div className="text-xs text-slate-400">{t.note}</div>}
              <div className="text-xs text-slate-300">{new Date(t.date).toLocaleDateString()}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-sm font-mono ${color(t)}`}>{t.type === "spending" ? "−" : "+"}{fmt(t.amount)}</span>
              <button onClick={() => onDelete(t.id)} className="text-slate-300 hover:text-rose-400 text-xs">✕</button>
            </div>
          </div>
        ))}
      </div>
    )}
  </>;
}
