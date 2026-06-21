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
import Home from "./Home.jsx";
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

const EMPTY = {
  accounts: [], snapshots: [], goals: [], debts: [], transactions: [],
  profile: { incomeType: "salary", typicalIncome: 7000, strategy: "balanced" },
  settings: { returnRate: 0.07, monthlyInvest: null },
};

// ─── helpers ──────────────────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
          className="px-3 py-2 text-sm font-semibold text-white rounded-lg bg-brand-600 hover:bg-brand-700">Set</button>
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
  const [tab, setTab] = useState("home");
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showOnboard, setShowOnboard] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  // apply dark/light theme to <html> whenever it changes
  useEffect(() => { document.documentElement.classList.toggle("dark", settings?.theme === "dark"); }, [settings?.theme]);
  const toggleTheme = () => save({ ...data, settings: { ...settings, theme: settings?.theme === "dark" ? "light" : "dark" } });
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

  const netWorthDisplay = snapshots.length ? realNetWorth : investedTotal;
  const sectionLabel = NAV.find(n => n[0] === tab)?.[1] || "";

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      {/* mobile overlay */}
      {menuOpen && <div className="fixed inset-0 bg-slate-900/40 z-30 md:hidden" onClick={() => setMenuOpen(false)} />}

      {/* nav — persistent sidebar on desktop, slide-in drawer on mobile */}
      <aside className={`fixed z-40 inset-y-0 left-0 w-60 bg-white border-r border-slate-200 flex flex-col transform transition-transform duration-300 ease-out md:static md:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="px-5 py-4 flex items-center gap-2 border-b border-slate-100">
          <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
            <rect x="6" y="40" width="18" height="18" rx="3" fill="#C9C0FB" /><rect x="23" y="26" width="18" height="18" rx="3" fill="#9B8AFA" /><rect x="40" y="12" width="18" height="18" rx="3" fill="#7C6FE8" />
          </svg>
          <span className="font-bold text-slate-800">Tsumiki</span>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV.map(([key, label, icon]) => (
            <button key={key} onClick={() => { setTab(key); setMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${tab === key ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`}>
              <span className="text-base">{icon}</span>{label}
            </button>
          ))}
        </nav>
        {profile?.name && <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400">Hi, {profile.name}</div>}
      </aside>

      {/* main column */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {celebrate && (
          <button onClick={() => setCelebrate(null)}
            className="w-full text-left bg-gradient-to-r from-amber-400 to-orange-400 text-white px-5 py-2.5 text-sm font-semibold">
            🎉 Milestone{celebrate.length > 1 ? "s" : ""}: {celebrate.map(m => `${m.icon} ${m.label}`).join("  ·  ")} <span className="opacity-70 font-normal">— tap to dismiss</span>
          </button>
        )}
        {error && <div className="bg-rose-50 border-b border-rose-200 text-rose-600 text-xs px-5 py-2">{error}</div>}

        <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200 flex items-center gap-3 px-4 py-3">
          <button onClick={() => setMenuOpen(true)} className="md:hidden text-2xl leading-none text-slate-600" aria-label="Open menu">☰</button>
          <div className="font-semibold text-slate-800">{sectionLabel}</div>
          <div className="ml-auto flex items-center gap-3">
            {toast ? <span className="text-xs text-emerald-500">{toast}</span> : (
              <span className="text-sm font-mono font-bold text-slate-700">{fmt(netWorthDisplay)} <span className="text-xs font-sans font-normal text-slate-400">net worth</span></span>
            )}
            <button onClick={toggleTheme} aria-label="Toggle dark mode" className="text-lg leading-none text-slate-500 hover:text-slate-700">
              {settings?.theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
        </header>

        <ErrorBoundary key={tab}>
          <main className="flex-1 px-4 pt-5 pb-28 space-y-4 w-full max-w-lg md:max-w-2xl mx-auto">
            {tab === "home" && <Home profile={profile} transactions={transactions} accounts={accounts} snapshots={snapshots}
              income={income} realNetWorth={realNetWorth} investedTotal={investedTotal} milestoneList={milestoneList} freezes={freezes} onGo={setTab} />}

            {tab === "plan" && <Plan transactions={transactions} accounts={accounts} snapshots={snapshots} profile={profile} onGoSetup={() => setTab("setup")} />}

            {tab === "calendar" && <Calendar transactions={transactions} profile={profile} />}

            {tab === "money" && <Ledger transactions={transactions} sources={incomeSources} onDelete={deleteTx} />}

            {tab === "grow" && <>
              {realityCheck && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Reality check</div>
                  <div className="text-sm text-slate-600">You contributed {fmt(realityCheck.contribSince)}; net worth changed {fmt(realityCheck.deltaNW)}.</div>
                  <div className={`text-sm mt-1 font-medium ${realityCheck.gap >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                    {realityCheck.gap >= 0 ? `+${fmt(realityCheck.gap)} on top — markets working for you.` : `${fmt(realityCheck.gap)} — markets or unlogged spending took a bite.`}
                  </div>
                </div>
              )}
              <Suspense fallback={<div className="bg-white rounded-xl border border-slate-200 p-4 text-center text-slate-400 text-sm">Loading charts…</div>}>
                <Projection start={netWorth} derivedInvest={derivedInvest} settings={settings} onChange={(s) => save({ ...data, settings: s })} />
                <NetWorthHistory data={nwSeries} />
              </Suspense>
              <Fire netWorth={netWorth} monthlyInvest={monthlyForFire} returnRate={settings.returnRate} annualExpenses={annualExpenses} birthYear={profile?.birthYear} retireAge={profile?.retireAge} />
              <NetWorthCard realNetWorth={realNetWorth} onSet={setNetWorth} />
            </>}

            {tab === "goals" && <>
              <StreakPanel transactions={transactions} freezes={freezes} />
              <Milestones list={milestoneList} />
              <MoneyTargets targets={profile?.moneyTargets || []} onChange={(list) => save({ ...data, profile: { ...profile, moneyTargets: list } })} />
            </>}

            {tab === "setup" && <Setup data={data} onSave={save} onReplayIntro={() => setShowOnboard(true)} />}
          </main>
        </ErrorBoundary>
      </div>

      {/* always-available fast logging (SPEC §9) */}
      <button onClick={() => setShowAdd(true)} aria-label="Log a transaction"
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-3xl leading-none shadow-lg flex items-center justify-center">
        +
      </button>
      <QuickAdd open={showAdd} onClose={() => setShowAdd(false)} onLog={logTx}
        cats={CATS} sources={incomeSources} transactions={transactions} />
      <Onboarding open={showOnboard} initial={profile} onComplete={finishOnboarding} onSkip={skipOnboarding} />
    </div>
  );
}

// section nav (clean-rename IA)
const NAV = [
  ["home", "Home", "🏠"],
  ["plan", "Plan", "🎯"],
  ["calendar", "Calendar", "📅"],
  ["money", "Money", "💸"],
  ["grow", "Grow", "📈"],
  ["goals", "Goals", "🏆"],
  ["setup", "Setup", "⚙️"],
];

// I4 — read-only ledger (logging happens via the + button). Filter + delete.
function Ledger({ transactions, sources, onDelete }) {
  const [filter, setFilter] = useState("all");
  const sourceName = (id) => sources.find((s) => s.id === id)?.name || "income";
  const bucketName = (b) => ({ emergency: "Emergency", retirement: "Retirement", invest: "Invest", debt: "Debt" }[b] || "Invest");
  const rows = [...transactions].filter((t) => filter === "all" || t.type === filter).sort((a, b) => new Date(b.date) - new Date(a.date));
  const meta = (t) => t.type === "spending" ? (t.cat || "Spending") : t.type === "income" ? sourceName(t.sourceId) : bucketName(t.bucket);
  const color = (t) => t.type === "income" ? "text-emerald-600" : t.type === "contribution" ? "text-brand-600" : "text-slate-700";
  return <>
    <div className="flex gap-1 p-1 bg-white border border-slate-200 rounded-xl">
      {[["all", "All"], ["income", "Income"], ["spending", "Spending"], ["contribution", "Saved"]].map(([v, l]) => (
        <button key={v} onClick={() => setFilter(v)}
          className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${filter === v ? "bg-slate-100 text-slate-800" : "text-slate-500"}`}>{l}</button>
      ))}
    </div>
    {rows.length === 0 ? (
      <div className="text-center py-12 text-slate-400 text-sm">Nothing logged yet. Tap <span className="font-semibold text-brand-500">+</span> to start.</div>
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
