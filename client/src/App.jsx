// App.jsx — root component: loads/saves state, owns nav, and routes the tabs.
import { useState, useEffect, useRef, useMemo } from "react";
import {
  getState,
  putState,
  patchState,
  patchEntity,
  deleteEntity,
  getPlan,
  addTransaction,
  resetAll,
  getPrices,
  refreshPrices,
  authStatus,
  setOnLocked,
} from "./lib/core/api.js";
import { createPersistence } from "./lib/core/persist.js";
import { readLastGood, writeLastGood, clearLastGood } from "./lib/core/lastgood.js";
import { fmt } from "./lib/core/format.js";
import { typicalIncome } from "./lib/finance/income.js";
import {
  netWorthFromSnapshots,
  sumLatestByType,
  annualSpend,
  thisMonth,
  avgMonthlyContribution,
  appendBalanceChange,
} from "./lib/core/selectors.js";
import { computeDailyStreak } from "./lib/insights/streak.js";
import { reconcileInvestmentSnapshots } from "./lib/finance/portfolio.js";
import { computeReminders } from "./lib/insights/reminders.js";
import { earmarkedByGoal } from "./lib/finance/goals.js";
import { allCategories } from "./lib/core/categories.js";
import { uid } from "./lib/core/uid.js";
import Setup from "./views/Setup.jsx";
import Plan from "./views/Plan.jsx";
import QuickAdd from "./components/QuickAdd.jsx";
import Activity from "./views/Activity.jsx";
import Onboarding from "./views/Onboarding.jsx";
import Login from "./views/Login.jsx";
import Home from "./views/Home.jsx";
import NetWorthCard from "./components/NetWorthCard.jsx";
import { Menu, PartyPopper, Plus, Eye, EyeOff } from "lucide-react";
import Money, { BlurAmounts } from "./components/Money.jsx";
import StreakPanel from "./components/StreakPanel.jsx";
import NavRail, { NAV } from "./components/NavRail.jsx";
import MilestoneIcon from "./components/MilestoneIcon.jsx";
import Milestones from "./views/Milestones.jsx";
import MoneyTargets from "./views/MoneyTargets.jsx";
import { computeMilestones } from "./lib/insights/milestones.js";

import Fire from "./views/Fire.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import Projection from "./views/Projection.jsx";
import NetWorthHistory from "./charts/NetWorthHistory.jsx";
import Portfolio from "./views/Portfolio.jsx";

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

// offline read cache (AUDIT M8) — helpers live in lib/core/lastgood.js so AppLock
// can clear the cache the moment a lock is enabled. Writes here are gated on
// cacheAllowedRef (CONFIRMED lock-off); reads are always safe (see lastgood.js).

// re-confirm whether the offline cache may exist: allowed ONLY when the server
// positively says the app lock is off. Unknown (unreachable) leaves the current
// (conservative) permission untouched. Module-level so loadData stays dep-stable.
async function confirmCachePermission(cacheAllowedRef) {
  try {
    const st = await authStatus();
    cacheAllowedRef.current = !st.enabled;
    if (st.enabled) {
      clearLastGood();
    }
  } catch {
    /* status unreachable — keep the current permission */
  }
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
  const [offline, setOffline] = useState(false); // showing cached data / writes pending
  const cacheAllowedRef = useRef(false); // last-good cache only while the app lock is OFF
  const dirtyRef = useRef(false); // a write failed to persist → push local state on reconnect

  const flashToast = (msg, ms) => {
    setToast(msg);
    setTimeout(() => setToast(""), ms);
  };
  // persistence store: optimistic writes + serialized rev-checked save chain + 409
  // rebase/re-sync — extracted to lib/core/persist.js so it's pure and unit-tested.
  // Its synchronous mirror (store.snapshot()) is what every write rebases onto, so a
  // save queued behind another — or fired from an effect with intentionally-narrow
  // deps (e.g. the auto price-sync reconcile) — can't persist a stale snapshot.
  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createPersistence({
      api: { putState, patchState, patchEntity, deleteEntity, addTransaction, getState },
      empty: EMPTY,
      onChange: setData,
      onSaved: () => {
        flashToast("Saved", 1200);
        setOffline(false);
        dirtyRef.current = false;
        if (cacheAllowedRef.current) {
          // refresh the offline cache with the just-acked state
          writeLastGood({ ...storeRef.current.snapshot(), rev: storeRef.current.getRev() });
        }
      },
      onResync: ({ conflict, message }) => {
        setError(conflict ? "" : message);
        flashToast(conflict ? "Reloaded — changed elsewhere" : "Couldn't save — reloaded", 1800);
      },
      onError: (message) => {
        // write + re-sync both failed → almost certainly offline. The optimistic state
        // is still on screen; mark it dirty so reconnecting pushes it (AUDIT M9).
        dirtyRef.current = true;
        setOffline(true);
        setError(message);
      },
    });
  }
  const store = storeRef.current;
  const { save, saveMeta } = store;

  // load the full model + plan + prices (called after boot and after a successful unlock)
  async function loadData() {
    try {
      const fresh = await getState();
      storeRef.current.setCommitted(fresh); // via the ref: keeps this fn dep-stable for the boot effect
      setOffline(false);
      setError("");
      // an offline boot couldn't confirm the lock state — confirm it now that the
      // server is answering, THEN cache (never latch "allowed" from a failed check)
      await confirmCachePermission(cacheAllowedRef);
      if (cacheAllowedRef.current) {
        writeLastGood(fresh); // keep the offline copy current
      }
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
      // server unreachable — fall back to the last synced copy so the installed PWA
      // still shows your money instead of an error and $0 everywhere (AUDIT M8).
      // READING is safe regardless of the (unknown) lock state: a cache can only
      // have been written while the lock was confirmed off, and enabling the lock
      // clears it — so an existing cache is lock-off data by construction.
      const cached = readLastGood();
      if (cached) {
        storeRef.current.setCommitted(cached);
        setOffline(true);
      } else {
        setError(String(e.message || e));
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    setOnLocked(() => setLocked(true)); // any later 401 flips to the login screen
    (async () => {
      try {
        const st = await authStatus();
        setAuthSecure(st.secure);
        // the offline cache is a plaintext local copy — only keep one while the app
        // lock is off (otherwise it would let anyone with the browser bypass the lock)
        cacheAllowedRef.current = !st.enabled;
        if (st.enabled) {
          clearLastGood();
          if (!st.authed) {
            setLocked(true);
            setLoading(false);
            return; // hold at the login screen; don't fetch gated data yet
          }
        }
      } catch (_) {
        // status unreachable (offline boot): leave cacheAllowedRef FALSE — never
        // latch "allowed" from a failed check (a lock could be enabled server-side).
        // loadData still falls back to READING an existing cache, which is safe by
        // construction; caching resumes only once the lock is confirmed off.
      }
      await loadData();
    })();
  }, []);

  // reconnect: if a write failed while offline, PUSH the local state (it rebases via
  // the normal rev check — a 409 re-syncs instead of clobbering); otherwise just
  // re-pull fresh data. Also lets the banner clear without a manual reload.
  useEffect(() => {
    const goOnline = () => {
      if (dirtyRef.current) {
        storeRef.current.save((d) => d); // re-sends everything the failed writes changed
      } else {
        loadData();
      }
    };
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
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
    // build from the LATEST state (the store's mirror), not this effect's closure — its
    // deps omit data.transactions, so the closure can be stale after a log; rebasing
    // prevents the snapshot write from clobbering a just-logged transaction.
    const { snapshots, changed } = reconcileInvestmentSnapshots(
      store.snapshot(),
      prices.prices || {},
    );
    if (changed) {
      save((d) => ({ ...d, snapshots }));
    }
  }, [prices, data.holdings, data.accounts, data.snapshots]); // eslint-disable-line

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
    // running total adjusted by each account's delta — O(N) instead of re-summing all
    // accounts per snapshot (which is O(N·accounts) and bites at years of daily history)
    let total = 0;
    for (const s of sorted) {
      total += s.balance - (bal[s.accountId] ?? 0);
      bal[s.accountId] = s.balance;
      out.push({
        label: new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value: Math.round(total),
      });
    }
    return out;
  }, [snapshots]);

  // delete with undo: removing a ledger entry was one tap and permanent (AUDIT H6) —
  // keep the deleted tx around briefly and offer an Undo in the toast area
  const [undoTx, setUndoTx] = useState(null);
  function deleteTx(id) {
    const tx = store.snapshot().transactions.find((t) => t.id === id);
    save((d) => ({ ...d, transactions: d.transactions.filter((t) => t.id !== id) }));
    if (tx) {
      setUndoTx(tx);
      setTimeout(() => setUndoTx((u) => (u?.id === tx.id ? null : u)), 6000);
    }
  }
  function undoDelete() {
    const tx = undoTx;
    setUndoTx(null);
    // guard: if the delete 409-resynced, the tx may already be back — re-adding
    // it would duplicate the id (double-counted totals, duplicate React keys)
    if (tx) {
      save((d) =>
        d.transactions.some((t) => t.id === tx.id)
          ? d
          : { ...d, transactions: [...d.transactions, tx] },
      );
    }
  }
  function logTx({
    type,
    amount,
    cat = null,
    sourceId = null,
    bucket = null,
    goalId = null,
    note = null,
    fromId = null,
    toId = null,
    accountId = null,
    date = null, // optional backdate (QuickAdd's Today/Yesterday/date picker)
  }) {
    const tx = {
      id: uid(),
      type,
      amount,
      date: date || new Date().toISOString(),
      cat,
      goalId,
      sourceId,
      bucket,
      note,
      fromId,
      toId,
    };
    // does this entry move an account balance? spending charged to an account lowers it,
    // income deposited raises it, a transfer moves between two (paying a card if to one)
    const moves = [];
    if (type === "spending" && accountId) {
      moves.push([accountId, -amount]);
    } else if (type === "income" && accountId) {
      moves.push([accountId, amount]);
    } else if (type === "transfer" && fromId && toId) {
      moves.push([fromId, -amount], [toId, amount]);
    }

    if (moves.length) {
      // full-state write (tx + the balance snapshot(s)) so they land atomically; rebased
      // on the latest state via the functional updater
      save((d) => {
        let snaps = d.snapshots;
        for (const [acc, delta] of moves) {
          snaps = appendBalanceChange(snaps, acc, delta);
        }
        return { ...d, transactions: [...d.transactions, tx], snapshots: snaps };
      });
      return;
    }

    // no balance move → the lean append endpoint (cheaper than re-sending the whole
    // state); the store advances its mirror + optimistic UI so rapid logs (and any
    // full-state save queued behind this) compose on the new tx instead of dropping it
    store.appendTx(tx);
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
    save((d) => ({
      ...d,
      accounts: [...d.accounts, ...newAccts],
      snapshots: [...d.snapshots, ...newSnaps],
      profile: {
        ...d.profile,
        name,
        strategy,
        incomeSources: sources,
        typicalIncome: typical,
        ...(emergencyTarget != null ? { emergencyTarget } : {}),
      },
      settings: { ...d.settings, onboarded: true },
    }));
    setShowOnboard(false);
  }
  function skipOnboarding() {
    save((d) => ({ ...d, settings: { ...d.settings, onboarded: true } }));
    setShowOnboard(false);
  }
  // wipe all data on the server, reset the UI, and start onboarding fresh
  async function resetEverything() {
    try {
      store.setCommitted(await resetAll());
      setTab("home");
      setShowOnboard(true);
      flashToast("All data deleted", 1800);
    } catch (e) {
      setError(String(e.message || e));
    }
  }
  function setNetWorth(value) {
    const snap = { accountId: null, date: new Date().toISOString(), balance: value };
    save((d) => {
      let acctId = d.accounts[0]?.id;
      let accts = d.accounts;
      if (!acctId) {
        acctId = "primary";
        accts = [{ id: acctId, name: "Net worth", type: "other", color: "#94A3B8" }];
      }
      return {
        ...d,
        accounts: accts,
        snapshots: [...d.snapshots, { id: uid(), ...snap, accountId: acctId }],
      };
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
  const toggleBlur = () =>
    saveMeta((d) => ({ settings: { ...d.settings, blurMoney: !blurMoney } }));

  return (
    <div className={`min-h-screen bg-slate-50 md:flex${blurMoney ? " blur-money" : ""}`}>
      {/* mobile overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-30 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <NavRail
        tab={tab}
        setTab={setTab}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        collapsed={collapsed}
        toggleRail={toggleRail}
      />

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
                <BlurAmounts text={m.label} />
              </span>
            ))}
            <span className="opacity-70 font-normal">— tap to dismiss</span>
          </button>
        )}
        {offline && (
          <div
            role="status"
            className="bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-5 py-2"
          >
            Offline — showing your last synced data.{" "}
            {dirtyRef.current
              ? "Unsaved changes will sync when the server is reachable again."
              : "Changes may not save until the server is reachable."}
          </div>
        )}
        {error && !offline && (
          <div
            role="alert"
            className="bg-rose-50 border-b border-rose-200 text-rose-600 text-xs px-5 py-2"
          >
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
            <span className="text-sm font-mono font-bold text-slate-700">
              <Money n={netWorthDisplay} />{" "}
              <span className="text-xs font-sans font-normal text-slate-500">net worth</span>
            </span>
            <button
              onClick={toggleBlur}
              aria-pressed={blurMoney}
              aria-label={blurMoney ? "Show amounts" : "Hide amounts"}
              title={blurMoney ? "Show amounts" : "Hide amounts"}
              className="press flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              {blurMoney ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </header>

        {undoTx ? (
          <div
            role="status"
            aria-live="polite"
            className="anim-fade fixed bottom-24 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-full bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow-lg"
          >
            <span>Deleted</span>
            <button
              onClick={undoDelete}
              className="font-semibold text-amber-300 hover:text-amber-200"
            >
              Undo
            </button>
          </div>
        ) : (
          toast && (
            <div
              role="status"
              aria-live="polite"
              className="anim-fade fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow-lg"
            >
              {toast}
            </div>
          )
        )}

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
                  save((d) => ({
                    ...d,
                    profile: { ...d.profile, monthOverride: { ym: thisMonth(), strategy: s } },
                  }))
                }
                onClearMonth={() =>
                  save((d) => {
                    // drop the monthOverride key, keep the rest of the profile
                    const { monthOverride: _omit, ...rest } = d.profile;
                    return { ...d, profile: rest };
                  })
                }
                onLogContributions={(gaps) =>
                  // "I moved it": record the plan's remaining transfers as contributions
                  save((d) => ({
                    ...d,
                    transactions: [
                      ...d.transactions,
                      ...gaps.map((g) => ({
                        id: uid(),
                        type: "contribution",
                        amount: g.amount,
                        bucket: g.bucket,
                        date: new Date().toISOString(),
                        note: "Logged from plan",
                      })),
                    ],
                  }))
                }
              />
            )}

            {tab === "activity" && (
              <Activity
                transactions={transactions}
                profile={profile}
                sources={incomeSources}
                accounts={accounts}
                onDelete={deleteTx}
                onLog={(txs) =>
                  save((d) => ({
                    ...d,
                    transactions: [...d.transactions, ...txs.map((t) => ({ id: uid(), ...t }))],
                  }))
                }
                onUpdate={(ids, patch) => {
                  const set = new Set(ids);
                  save((d) => ({
                    ...d,
                    transactions: d.transactions.map((t) =>
                      set.has(t.id) ? { ...t, ...patch } : t,
                    ),
                  }));
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
                      <BlurAmounts
                        text={
                          realityCheck.gap >= 0
                            ? `+${fmt(realityCheck.gap)} on top — markets working for you.`
                            : `${fmt(realityCheck.gap)} — markets or unlogged spending took a bite.`
                        }
                      />
                    </div>
                  </div>
                )}
                <Projection
                  start={netWorth}
                  derivedInvest={derivedInvest}
                  settings={settings}
                  onChange={(s) => save((d) => ({ ...d, settings: s }))}
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
                {/* only while no accounts exist: once real accounts are set up, net worth
                    comes from their snapshots — writing a whole-net-worth figure here would
                    corrupt accounts[0]'s balance history (AUDIT H5) */}
                {accounts.length === 0 && (
                  <NetWorthCard realNetWorth={realNetWorth} onSet={setNetWorth} />
                )}
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
                    saveMeta((d) => ({ profile: { ...d.profile, moneyTargets: list } }))
                  }
                />
              </>
            )}

            {tab === "accounts" && (
              <Setup
                section="accounts"
                data={data}
                onSave={save}
                onSaveEntity={store.saveEntity}
                onDeleteEntity={store.deleteEntity}
                prices={prices}
              />
            )}

            {tab === "settings" && (
              <Setup
                section="settings"
                data={data}
                onSave={save}
                onReplayIntro={() => setShowOnboard(true)}
                onReset={resetEverything}
                theme={settings?.theme || "light"}
                onSetTheme={(t) => saveMeta((d) => ({ settings: { ...d.settings, theme: t } }))}
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
        accounts={accounts}
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
