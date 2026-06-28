// App.jsx — root component: loads/saves state, owns nav, and routes the tabs.
import { useState, useEffect, useRef, useMemo } from "react";
import {
  getState,
  putState,
  getPlan,
  addTransaction,
  resetAll,
  getPrices,
  refreshPrices,
  authStatus,
  setOnLocked,
} from "./lib/api.js";
import { fmt } from "./lib/format.js";
import { typicalIncome } from "./lib/income.js";
import {
  netWorthFromSnapshots,
  sumLatestByType,
  annualSpend,
  thisMonth,
  avgMonthlyContribution,
} from "./lib/selectors.js";
import { computeAdherence, computeDailyStreak } from "./lib/streak.js";
import { holdingsValueByAccount, INVESTMENT_TYPES } from "./lib/portfolio.js";
import { computeReminders } from "./lib/reminders.js";
import { earmarkedByGoal } from "./lib/goals.js";
import { allCategories } from "./lib/categories.js";
import { uid } from "./lib/uid.js";
import Setup from "./Setup.jsx";
import Plan from "./Plan.jsx";
import QuickAdd from "./QuickAdd.jsx";
import Activity from "./Activity.jsx";
import Onboarding from "./Onboarding.jsx";
import Login from "./Login.jsx";
import Home from "./Home.jsx";
import NetWorthCard from "./NetWorthCard.jsx";
import {
  Home as HomeIcon,
  Target,
  History,
  TrendingUp,
  Trophy,
  Settings as SettingsIcon,
  Wallet,
  Flame,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Snowflake,
  Check,
  PartyPopper,
  Plus,
  Eye,
  EyeOff,
} from "lucide-react";
import Money from "./Money.jsx";
import MilestoneIcon from "./MilestoneIcon.jsx";
import Milestones from "./Milestones.jsx";
import MoneyTargets from "./MoneyTargets.jsx";
import { computeMilestones } from "./lib/milestones.js";

import Fire from "./Fire.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import Projection from "./Projection.jsx";
import NetWorthHistory from "./NetWorthHistory.jsx";
import Portfolio from "./Portfolio.jsx";

// Data model is the unified shape from the server: components read the single
// `transactions` ledger; contributions are bucketed.

const EMPTY = {
  accounts: [],
  snapshots: [],
  goals: [],
  debts: [],
  transactions: [],
  holdings: [],
  profile: { incomeType: "salary", typicalIncome: 7000, strategy: "balanced" },
  settings: { returnRate: 0.07, monthlyInvest: null },
};

// ─── Streak ─── daily logging streak (headline) + weekly rotating challenge ─────
function StreakPanel({ streak, transactions, freezes = 2 }) {
  const { current, longest, freezesUsed, loggedToday, cells } = streak;
  // secondary: this week's rotating plan-adherence challenge (a bonus to chase)
  const { objective, metThisWeek } = computeAdherence(transactions, freezes);
  const freezesLeft = Math.max(0, freezes - freezesUsed);
  const daysLogged = cells.filter((c) => c.met).length;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Daily streak
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span
            className="inline-flex items-center gap-0.5"
            aria-label={`${freezesLeft} streak freezes left`}
          >
            {Array.from({ length: freezesLeft }).map((_, i) => (
              <Snowflake key={i} size={12} className="text-blue-400" aria-hidden="true" />
            ))}
          </span>
          <span>
            longest {longest} {longest === 1 ? "day" : "days"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <Flame size={34} className={current > 0 ? "text-orange-500" : "text-slate-400"} />
        <div>
          <div className="text-3xl font-mono font-bold text-slate-900">{current}</div>
          <div className="text-xs text-slate-500">{current === 1 ? "day" : "days"} in a row</div>
        </div>
      </div>
      <div
        role="status"
        className={`rounded-lg px-3 py-2 mb-3 text-sm flex items-center gap-1.5 ${loggedToday ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
      >
        {loggedToday ? (
          <>
            <Check size={14} /> <span className="font-semibold">Logged today</span> — streak safe.
          </>
        ) : (
          <>
            <span className="font-semibold">Nothing logged today.</span> Any entry (even a no-spend
            day) keeps it going.
          </>
        )}
      </div>
      <span className="sr-only">{daysLogged} of the last 14 days logged.</span>
      <div className="flex gap-1.5" aria-hidden="true">
        {cells.map((c, i) => (
          <div
            key={i}
            title={c.day ? new Date(`${c.day}T00:00:00`).toLocaleDateString() : ""}
            className={`flex-1 rounded transition-colors ${c.met ? "bg-orange-400" : "bg-slate-100"} ${c.isNow ? "ring-2 ring-orange-300" : ""}`}
            style={{ height: 28 }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1.5 mb-3 text-xs text-slate-400">
        <span>14 days ago</span>
        <span>today</span>
      </div>
      <div
        className={`rounded-lg px-3 py-2 text-xs flex items-center gap-1.5 ${metThisWeek ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-500"}`}
      >
        <span className="font-semibold">Weekly bonus:</span> {objective.label}{" "}
        {metThisWeek && <Check size={13} />}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
/** Root component: loads state, serializes saves, owns the nav rail + tab routing. */
export default function App() {
  const [tab, setTab] = useState("home");
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showOnboard, setShowOnboard] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("tsumiki-rail") === "1";
    } catch {
      return false;
    }
  });
  const toggleRail = () =>
    setCollapsed((c) => {
      const n = !c;
      try {
        localStorage.setItem("tsumiki-rail", n ? "1" : "0");
      } catch {}
      return n;
    });
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setShowAdd(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [derivedInvest, setDerivedInvest] = useState(null); // monthly investable per the plan
  const [prices, setPrices] = useState(null); // opt-in synced stock prices (null until fetched)
  const [locked, setLocked] = useState(false); // app lock engaged + this device unauthed
  const [authSecure, setAuthSecure] = useState(true); // served over a secure origin?
  const revRef = useRef(0); // last server rev (optimistic concurrency)
  const saveChain = useRef(Promise.resolve()); // serialize writes so rapid saves can't self-conflict

  // load the full model + plan + prices (called after boot and after a successful unlock)
  async function loadData() {
    try {
      const fresh = await getState();
      revRef.current = fresh.rev ?? 0;
      setData({ ...EMPTY, ...fresh });
      if (!fresh.settings?.onboarded) {
        setShowOnboard(true);
      } // first run
      try {
        setDerivedInvest((await getPlan()).investable);
      } catch (_) {}
      getPrices()
        .then(setPrices)
        .catch(() => {});
    } catch (e) {
      setError(String(e.message || e));
    }
    setLoading(false);
  }

  useEffect(() => {
    setOnLocked(() => setLocked(true)); // any later 401 flips to the login screen
    (async () => {
      try {
        const st = await authStatus();
        setAuthSecure(st.secure);
        if (st.enabled && !st.authed) {
          setLocked(true);
          setLoading(false);
          return; // hold at the login screen; don't fetch gated data yet
        }
      } catch (_) {
        // status should always answer; if it doesn't, fall through and try loading
      }
      await loadData();
    })();
  }, []);

  function onUnlock() {
    setLocked(false);
    setLoading(true);
    loadData();
  }

  // auto-value investment accounts: write/refresh today's snapshot for each
  // brokerage/IRA/Roth/401k account = its holdings' market value (from synced prices)
  // plus any uninvested cash. Client-owned (rev-checked save) so the nightly server
  // refresh can't race the main state, and idempotent (no change → no save). An account
  // with holdings we can't price right now is skipped so its LAST SYNCED value stands;
  // a cash-only investment account still persists. Never clobbers a manual same-day edit.
  useEffect(() => {
    if (loading || !prices) {
      return;
    }
    const byAcct = holdingsValueByAccount(data.holdings, prices.prices || {});
    const todayKey = new Date().toISOString().slice(0, 10);
    const isToday = (s, accId) => s.accountId === accId && String(s.date).slice(0, 10) === todayKey;
    let snaps = data.snapshots;
    let changed = false;
    for (const a of data.accounts) {
      if (!INVESTMENT_TYPES.has(a.type)) {
        continue;
      }
      const hasHoldings = data.holdings.some((h) => h.accountId === a.id);
      const market = byAcct[a.id] || 0;
      const cash = Number(a.cash) || 0;
      if (!hasHoldings && cash <= 0) {
        continue; // nothing to value yet — don't write a spurious $0 snapshot
      }
      if (hasHoldings && market <= 0) {
        // can't price the shares right now. Keep the last synced "holdings" snapshot if
        // we have one; only when there's none (brand-new, never synced) do we still
        // record the cash floor so it isn't invisible to net worth.
        const hasPrior = snaps.some((s) => s.accountId === a.id && s.source === "holdings");
        if (hasPrior || cash <= 0) {
          continue;
        }
      }
      const val = Math.round(market + cash);
      // only ever touch our own auto-valued snapshot — never clobber a manual same-day edit
      const ours = snaps.find((s) => isToday(s, a.id) && s.source === "holdings");
      if (ours) {
        if (Math.round(ours.balance) !== val) {
          snaps = snaps.map((s) => (s === ours ? { ...s, balance: val } : s));
          changed = true;
        }
      } else if (snaps.some((s) => isToday(s, a.id))) {
        continue; // a manual snapshot already exists for today — respect it
      } else {
        snaps = [
          ...snaps,
          {
            id: uid(),
            accountId: a.id,
            date: new Date().toISOString(),
            balance: val,
            source: "holdings",
          },
        ];
        changed = true;
      }
    }
    if (changed) {
      save({ ...data, snapshots: snaps });
    }
  }, [prices, data.holdings, data.accounts, data.snapshots]); // eslint-disable-line

  function save(next) {
    setData(next); // optimistic UI
    saveChain.current = saveChain.current.then(async () => {
      try {
        const saved = await putState({ ...next, rev: revRef.current });
        revRef.current = saved.rev ?? revRef.current;
        setToast("Saved");
        setTimeout(() => setToast(""), 1200);
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
        } catch (_) {
          setError(String(e.message || e));
        }
      }
    });
  }

  const { transactions, settings, accounts, snapshots, profile, debts, holdings = [] } = data;
  // apply theme to <html> — supports light / dark / system (live OS updates)
  useEffect(() => {
    const t = settings?.theme;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        t === "dark" || (t === "system" && mq?.matches),
      );
    apply();
    if (t === "system" && mq?.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [settings?.theme]);
  const incomeSources = profile?.incomeSources || [];
  // typical monthly income — learned from history when available
  const income = useMemo(() => typicalIncome(profile, transactions), [profile, transactions]);

  // derived views off the single ledger
  const contributions = useMemo(
    () =>
      transactions
        .filter((t) => t.type === "contribution")
        .map((t) => ({ id: t.id, bucket: t.bucket, amount: t.amount, date: t.date })),
    [transactions],
  );

  // real net worth = sum of latest snapshot per account
  const realNetWorth = useMemo(() => netWorthFromSnapshots(snapshots), [snapshots]);
  const investedTotal = contributions.reduce((s, c) => s + c.amount, 0); // "contributed by you" — only goes up
  const netWorth = snapshots.length ? realNetWorth : investedTotal;

  // reality check: contributions since you started tracking vs the actual
  // change in net worth. The gap is the market (or unlogged spending) at work.
  const realityCheck = useMemo(() => {
    if (snapshots.length < 2) {
      return null;
    }
    const firstByAcct = {};
    for (const s of snapshots) {
      if (!firstByAcct[s.accountId] || new Date(s.date) < new Date(firstByAcct[s.accountId].date)) {
        firstByAcct[s.accountId] = s;
      }
    }
    const startNW = Object.values(firstByAcct).reduce((a, s) => a + s.balance, 0);
    const startDate = Object.values(firstByAcct).reduce(
      (a, s) => (new Date(s.date) < new Date(a) ? s.date : a),
      firstByAcct[Object.keys(firstByAcct)[0]].date,
    );
    const deltaNW = realNetWorth - startNW;
    const contribSince = contributions
      .filter((c) => new Date(c.date) >= new Date(startDate))
      .reduce((s, c) => s + c.amount, 0);
    if (contribSince <= 0) {
      return null;
    }
    return { gap: deltaNW - contribSince, deltaNW, contribSince };
  }, [snapshots, contributions, realNetWorth]);

  // ── motivation: streak freezes + milestones ─────────────────────────────────
  const freezes = settings?.streakFreezes ?? 2;
  const savingsBalance = useMemo(
    () => sumLatestByType(accounts, snapshots, ["savings"]),
    [accounts, snapshots],
  );
  // one daily-streak computation, reused by the panel + milestones (was derived 3×)
  const dailyStreak = useMemo(
    () => computeDailyStreak(transactions, freezes),
    [transactions, freezes],
  );
  const streakNow = dailyStreak.current;
  // per-goal earmarked balances (contributions tagged to a goal) for earmarked targets
  const earmarked = useMemo(() => earmarkedByGoal(transactions), [transactions]);
  // memoize the full-ledger walks feeding always-mounted QuickAdd + the goals tab
  const quickAddCats = useMemo(() => allCategories(transactions), [transactions]);
  const monthlyPace = useMemo(() => avgMonthlyContribution(transactions), [transactions]);
  // time-based alerts (paydays, bills, buffer, est. taxes, streak) for the Home card.
  // Depend on the slices it reads (not the whole `data` ref, which churns on every
  // save) and reuse the streak we already computed.
  const reminders = useMemo(
    () => computeReminders(data, new Date(), { dailyStreak }),
    [profile, accounts, snapshots, transactions, settings, dailyStreak], // eslint-disable-line
  );
  const emergencyTarget = profile?.emergencyTarget || 0;
  const moneyTargets = profile?.moneyTargets; // stable ref (don't `|| []` here — see deps)
  const milestoneList = useMemo(
    () =>
      computeMilestones({
        realNetWorth,
        investedTotal,
        savings: savingsBalance,
        emergencyTarget,
        debts,
        streak: streakNow,
        userTargets: moneyTargets || [],
        earmarked,
        transactions,
      }),
    // depend on the specific profile fields used, not the whole object, so an
    // unrelated save (theme, strategy, month override) doesn't re-walk the ledger
    [
      realNetWorth,
      investedTotal,
      savingsBalance,
      emergencyTarget,
      moneyTargets,
      debts,
      streakNow,
      earmarked,
      transactions,
    ],
  );

  // celebrate milestones newly achieved during this session — pure, no writes.
  // Baseline is captured on first load so we don't re-celebrate old wins.
  const [celebrate, setCelebrate] = useState(null);
  const seenRef = useRef(null);
  useEffect(() => {
    if (loading) {
      return;
    }
    const achieved = milestoneList.filter((m) => m.achieved).map((m) => m.id);
    if (seenRef.current === null) {
      seenRef.current = new Set(achieved);
      return;
    }
    const fresh = achieved.filter((id) => !seenRef.current.has(id));
    if (fresh.length) {
      fresh.forEach((id) => seenRef.current.add(id));
      setCelebrate(milestoneList.filter((m) => fresh.includes(m.id)));
    }
  }, [milestoneList, loading]);

  // ── insight: FIRE inputs + net-worth history ────────────────────────────────
  const annualExpenses = useMemo(() => annualSpend(transactions), [transactions]);
  const monthlyForFire = settings?.monthlyInvest ?? (derivedInvest != null ? derivedInvest : 3000);
  const nwSeries = useMemo(() => {
    if (snapshots.length < 2) {
      return [];
    }
    const sorted = [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date));
    const bal = {},
      out = [];
    for (const s of sorted) {
      bal[s.accountId] = s.balance;
      out.push({
        label: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value: Math.round(Object.values(bal).reduce((x, y) => x + y, 0)),
      });
    }
    return out;
  }, [snapshots]);

  function deleteTx(id) {
    save({ ...data, transactions: transactions.filter((t) => t.id !== id) });
  }
  // append via the lean endpoint instead of re-sending the whole state.
  function logTx({
    type,
    amount,
    cat = null,
    sourceId = null,
    bucket = null,
    goalId = null,
    note = null,
  }) {
    const tx = {
      id: uid(),
      type,
      amount,
      date: new Date().toISOString(),
      cat,
      goalId,
      sourceId,
      bucket,
      note,
    };
    // functional update so rapid successive logs compose (no stale-closure drop)
    setData((d) => ({ ...d, transactions: [...d.transactions, tx] })); // optimistic
    saveChain.current = saveChain.current.then(async () => {
      try {
        const saved = await addTransaction(tx);
        revRef.current = saved.rev ?? revRef.current;
        setToast("Saved");
        setTimeout(() => setToast(""), 1200);
      } catch (e) {
        try {
          const fresh = await getState();
          revRef.current = fresh.rev ?? 0;
          setData({ ...EMPTY, ...fresh });
        } catch (_) {}
        setError(String(e.message || e));
      }
    });
  }
  function finishOnboarding({
    name,
    strategy,
    source,
    accounts: newAccts = [],
    snapshots: newSnaps = [],
    emergencyTarget,
  }) {
    const sources = source
      ? [...(profile.incomeSources || []), source]
      : profile.incomeSources || [];
    const typical = sources.reduce((s, x) => s + (x.typicalMonthly || 0), 0);
    save({
      ...data,
      accounts: [...accounts, ...newAccts],
      snapshots: [...snapshots, ...newSnaps],
      profile: {
        ...profile,
        name,
        strategy,
        incomeSources: sources,
        typicalIncome: typical,
        ...(emergencyTarget != null ? { emergencyTarget } : {}),
      },
      settings: { ...settings, onboarded: true },
    });
    setShowOnboard(false);
  }
  function skipOnboarding() {
    save({ ...data, settings: { ...settings, onboarded: true } });
    setShowOnboard(false);
  }
  // wipe all data on the server, reset the UI, and start onboarding fresh
  async function resetEverything() {
    try {
      const fresh = await resetAll();
      revRef.current = fresh.rev ?? 0;
      setData({ ...EMPTY, ...fresh });
      setTab("home");
      setShowOnboard(true);
      setToast("All data deleted");
      setTimeout(() => setToast(""), 1800);
    } catch (e) {
      setError(String(e.message || e));
    }
  }
  function setNetWorth(value) {
    let acctId = accounts[0]?.id,
      accts = accounts;
    if (!acctId) {
      acctId = "primary";
      accts = [{ id: acctId, name: "Net worth", type: "other", color: "#94A3B8" }];
    }
    save({
      ...data,
      accounts: accts,
      snapshots: [
        ...snapshots,
        { id: uid(), accountId: acctId, date: new Date().toISOString(), balance: value },
      ],
    });
  }

  if (locked) {
    return <Login secure={authSecure} onSuccess={onUnlock} />;
  }
  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
        Loading your data…
      </div>
    );
  }

  const netWorthDisplay = snapshots.length ? realNetWorth : investedTotal;
  const sectionLabel = NAV.find((n) => n[0] === tab)?.[1] || "";

  const blurMoney = !!settings?.blurMoney;
  const toggleBlur = () => save({ ...data, settings: { ...settings, blurMoney: !blurMoney } });

  return (
    <div className={`min-h-screen bg-slate-50 md:flex${blurMoney ? " blur-money" : ""}`}>
      {/* mobile overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-30 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* nav — collapsible icon-rail on desktop, slide-in drawer on mobile */}
      <aside
        className={`fixed z-40 inset-y-0 left-0 bg-white border-r border-slate-200 flex flex-col transform transition-all duration-300 ease-out md:static md:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"} ${collapsed ? "w-60 md:w-16" : "w-60"}`}
      >
        <div className="px-4 py-4 flex items-center gap-2 border-b border-slate-100">
          <svg
            width="22"
            height="22"
            viewBox="0 0 64 64"
            aria-hidden="true"
            className="flex-shrink-0"
          >
            <rect x="6" y="40" width="18" height="18" rx="3" fill="#C9C0FB" />
            <rect x="23" y="26" width="18" height="18" rx="3" fill="#9B8AFA" />
            <rect x="40" y="12" width="18" height="18" rx="3" fill="#7C6FE8" />
          </svg>
          <span className={`font-bold text-slate-800 ${collapsed ? "md:hidden" : ""}`}>
            Tsumiki
          </span>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setMenuOpen(false);
              }}
              title={label}
              className={`press w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${collapsed ? "md:justify-center" : ""} ${tab === key ? "bg-brand-100 text-brand-700" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon size={20} className="flex-shrink-0" />
              <span className={collapsed ? "md:hidden" : ""}>{label}</span>
            </button>
          ))}
        </nav>
        <button
          onClick={toggleRail}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden md:flex items-center gap-2 px-4 py-3 border-t border-slate-100 text-slate-500 hover:text-slate-600 text-sm"
        >
          {collapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <>
              <PanelLeftClose size={18} /> Collapse
            </>
          )}
        </button>
      </aside>

      {/* main column */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {celebrate && (
          <button
            onClick={() => setCelebrate(null)}
            className="w-full flex items-center gap-2 flex-wrap bg-gradient-to-r from-amber-400 to-orange-400 text-white px-5 py-2.5 text-sm font-semibold"
          >
            <PartyPopper size={16} />
            <span>Milestone{celebrate.length > 1 ? "s" : ""}:</span>
            {celebrate.map((m, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <MilestoneIcon name={m.icon} size={14} />
                {m.label}
              </span>
            ))}
            <span className="opacity-70 font-normal">— tap to dismiss</span>
          </button>
        )}
        {error && (
          <div className="bg-rose-50 border-b border-rose-200 text-rose-600 text-xs px-5 py-2">
            {error}
          </div>
        )}

        <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200 flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => setMenuOpen(true)}
            className="md:hidden text-slate-600"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <div className="font-semibold text-slate-800">{sectionLabel}</div>
          <div className="ml-auto flex items-center gap-2">
            {toast ? (
              <span className="anim-fade text-xs text-emerald-500">{toast}</span>
            ) : (
              <span className="text-sm font-mono font-bold text-slate-700">
                <Money n={netWorthDisplay} />{" "}
                <span className="text-xs font-sans font-normal text-slate-500">net worth</span>
              </span>
            )}
            <button
              onClick={toggleBlur}
              aria-pressed={blurMoney}
              aria-label={blurMoney ? "Show amounts" : "Hide amounts"}
              title={blurMoney ? "Show amounts" : "Hide amounts"}
              className="press flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              {blurMoney ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </header>

        <ErrorBoundary key={tab}>
          <main className="anim-in flex-1 px-4 sm:px-6 pt-5 pb-28 space-y-4 w-full max-w-lg md:max-w-2xl lg:max-w-4xl mx-auto">
            {tab === "home" && (
              <Home
                profile={profile}
                transactions={transactions}
                snapshots={snapshots}
                accounts={accounts}
                debts={debts}
                income={income}
                realNetWorth={realNetWorth}
                investedTotal={investedTotal}
                milestoneList={milestoneList}
                freezes={freezes}
                dailyStreak={dailyStreak}
                reminders={reminders}
                onGo={setTab}
              />
            )}

            {tab === "plan" && (
              <Plan
                transactions={transactions}
                accounts={accounts}
                snapshots={snapshots}
                debts={debts}
                profile={profile}
                onGoSetup={() => setTab("settings")}
                onApplyMonth={(s) =>
                  save({
                    ...data,
                    profile: { ...profile, monthOverride: { ym: thisMonth(), strategy: s } },
                  })
                }
                onClearMonth={() => {
                  // drop the monthOverride key, keep the rest of the profile
                  const { monthOverride: _omit, ...rest } = profile;
                  save({ ...data, profile: rest });
                }}
              />
            )}

            {tab === "activity" && (
              <Activity
                transactions={transactions}
                profile={profile}
                sources={incomeSources}
                onDelete={deleteTx}
                onLog={(txs) =>
                  save({
                    ...data,
                    transactions: [...transactions, ...txs.map((t) => ({ id: uid(), ...t }))],
                  })
                }
                onUpdate={(ids, patch) => {
                  const set = new Set(ids);
                  save({
                    ...data,
                    transactions: transactions.map((t) => (set.has(t.id) ? { ...t, ...patch } : t)),
                  });
                }}
              />
            )}

            {tab === "grow" && (
              <>
                {snapshots.length === 0 && transactions.length === 0 && (
                  <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 text-sm text-brand-700">
                    Record your net worth below and log a little income/spending — then the
                    projection, FIRE number, and trend fill in here.
                  </div>
                )}
                {realityCheck && (
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Reality check
                    </div>
                    <div className="text-sm text-slate-600">
                      You contributed <Money n={realityCheck.contribSince} />; net worth changed{" "}
                      <Money n={realityCheck.deltaNW} />.
                    </div>
                    <div
                      className={`text-sm mt-1 font-medium ${realityCheck.gap >= 0 ? "text-emerald-600" : "text-rose-500"}`}
                    >
                      {realityCheck.gap >= 0
                        ? `+${fmt(realityCheck.gap)} on top — markets working for you.`
                        : `${fmt(realityCheck.gap)} — markets or unlogged spending took a bite.`}
                    </div>
                  </div>
                )}
                <Projection
                  start={netWorth}
                  derivedInvest={derivedInvest}
                  settings={settings}
                  onChange={(s) => save({ ...data, settings: s })}
                />
                <NetWorthHistory data={nwSeries} />
                <Fire
                  netWorth={netWorth}
                  monthlyInvest={monthlyForFire}
                  returnRate={settings.returnRate}
                  annualExpenses={annualExpenses}
                  birthYear={profile?.birthYear}
                  retireAge={profile?.retireAge}
                />
                <Portfolio
                  holdings={holdings}
                  prices={prices}
                  onGoSetup={() => setTab("accounts")}
                  onSync={async () => {
                    // surface a toast on failure instead of silently stopping the spinner
                    try {
                      setPrices(await refreshPrices());
                    } catch {
                      setToast("Price sync failed");
                      setTimeout(() => setToast(""), 1800);
                    }
                  }}
                />
                <NetWorthCard realNetWorth={realNetWorth} onSet={setNetWorth} />
              </>
            )}

            {tab === "goals" && (
              <>
                <StreakPanel streak={dailyStreak} transactions={transactions} freezes={freezes} />
                <Milestones list={milestoneList} />
                <MoneyTargets
                  targets={profile?.moneyTargets || []}
                  values={{
                    net_worth: realNetWorth,
                    contributed: investedTotal,
                    emergency: savingsBalance,
                  }}
                  earmarked={earmarked}
                  monthlyPace={monthlyPace}
                  onChange={(list) =>
                    save({ ...data, profile: { ...profile, moneyTargets: list } })
                  }
                />
              </>
            )}

            {tab === "accounts" && (
              <Setup section="accounts" data={data} onSave={save} prices={prices} />
            )}

            {tab === "settings" && (
              <Setup
                section="settings"
                data={data}
                onSave={save}
                onReplayIntro={() => setShowOnboard(true)}
                onReset={resetEverything}
                theme={settings?.theme || "light"}
                onSetTheme={(t) => save({ ...data, settings: { ...settings, theme: t } })}
              />
            )}
          </main>
        </ErrorBoundary>
      </div>

      {/* always-available fast logging */}
      <button
        onClick={() => setShowAdd(true)}
        aria-label="Log a transaction"
        className="press fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full bg-brand-600 hover:bg-brand-700 text-white shadow-lg flex items-center justify-center"
      >
        <Plus size={26} />
      </button>
      <QuickAdd
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onLog={logTx}
        cats={quickAddCats}
        sources={incomeSources}
        goals={(profile?.moneyTargets || []).filter((g) => g.metric === "earmarked")}
        transactions={transactions}
      />
      <Onboarding
        open={showOnboard}
        initial={profile}
        onComplete={finishOnboarding}
        onSkip={skipOnboarding}
      />
    </div>
  );
}

// section nav (clean-rename IA + lucide icons)
const NAV = [
  ["home", "Home", HomeIcon],
  ["plan", "Plan", Target],
  ["activity", "Activity", History],
  ["grow", "Grow", TrendingUp],
  ["goals", "Goals", Trophy],
  ["accounts", "Accounts", Wallet],
  ["settings", "Settings", SettingsIcon],
];
