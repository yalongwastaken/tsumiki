// Home.jsx — landing screen: the valuable stuff at a glance, tap-through to detail.
import { useState, useEffect, useMemo } from "react";
import Money, { BlurAmounts } from "../components/Money.jsx";
import { fmt } from "../lib/core/format.js";
import { getPlan, getNews } from "../lib/core/api.js";
import {
  thisMonth,
  monthKey,
  annualSpend,
  sumLatestByType,
  monthTotals,
} from "../lib/core/selectors.js";
import { computeDailyStreak } from "../lib/insights/streak.js";
import { nextMilestone } from "../lib/insights/milestones.js";
import { nextPaydays } from "../lib/plan/paydays.js";
import { cashflowForecast, spendingTrends, coachNudges } from "../lib/insights/insights.js";
import { budgetStatus, budgetAlert } from "../lib/finance/budgets.js";
import { learnFeed } from "../lib/insights/learn.js";
import { Flame, Check, TrendingUp, TrendingDown, ArrowRight, Bell, X } from "lucide-react";
import SankeyFlow from "../charts/Sankey.jsx";
import Calendar from "../components/Calendar.jsx";
import MilestoneIcon from "../components/MilestoneIcon.jsx";
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
const fmtDate = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

const REMINDER_TONE = {
  urgent: "bg-rose-50 text-rose-700",
  warn: "bg-amber-50 text-amber-700",
  info: "bg-brand-50 text-brand-800", // brand-800 clears AA on brand-50; 700 was borderline
};
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
    <div
      className={`bg-white rounded-xl border border-slate-200 p-4 ${span ? "lg:col-span-2" : ""}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</div>
        {onGo && (
          <button onClick={onGo} className="text-xs text-slate-500 hover:text-brand-600">
            open ›
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** Landing screen: net worth, key stats, plan snapshot, streak, flow, and calendar. */
export default function Home({
  profile = {},
  transactions = [],
  snapshots = [],
  accounts = [],
  debts = [],
  income = 0,
  realNetWorth = 0,
  investedTotal = 0,
  milestoneList = [],
  freezes = 2,
  dailyStreak = null,
  reminders = [],
  onGo,
}) {
  const [dismissed, setDismissed] = useState(() => new Set());
  const activeReminders = reminders.filter((r) => !dismissed.has(r.id));
  const ym = thisMonth();
  const {
    income: incomeThisMonth,
    spending: spendThisMonth,
    contribution: contribThisMonth,
  } = useMemo(() => monthTotals(transactions, ym), [transactions, ym]);

  const annualExpenses = useMemo(() => annualSpend(transactions), [transactions]);

  // ── last month in review — a "report card" from the pure month selectors ─────
  const monthShift = (yymm, delta) => {
    const [y, m] = yymm.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const prevYm = monthShift(ym, -1);
  const lastMonth = useMemo(() => monthTotals(transactions, prevYm), [transactions, prevYm]);
  const monthBefore = useMemo(
    () => monthTotals(transactions, monthShift(ym, -2)),
    [transactions, ym],
  );
  const lastCats = useMemo(() => {
    const m = {};
    for (const t of transactions) {
      if (t.type === "spending" && t.amount > 0 && monthKey(t.date) === prevYm) {
        m[t.cat || "Other"] = (m[t.cat || "Other"] || 0) + t.amount;
      }
    }
    return Object.entries(m)
      .map(([cat, amount]) => ({ cat, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions, prevYm]);
  const lastRate =
    lastMonth.income > 0
      ? Math.max(0, (lastMonth.income - lastMonth.spending) / lastMonth.income)
      : null;
  const spendShift =
    monthBefore.spending > 0 && lastMonth.spending > 0
      ? (lastMonth.spending - monthBefore.spending) / monthBefore.spending
      : null;
  const prevMonthName = (() => {
    const [y, m] = prevYm.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long" });
  })();
  const hasReview = lastMonth.income > 0 || lastMonth.spending > 0;

  const savingsRate =
    incomeThisMonth > 0 ? Math.max(0, (incomeThisMonth - spendThisMonth) / incomeThisMonth) : null;
  const firePct = annualExpenses > 0 ? Math.max(0, realNetWorth / (annualExpenses * 25)) : null;

  const planIncome = incomeThisMonth > 0 ? incomeThisMonth : income;
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    // ignore stale responses so a slow earlier request can't clobber a newer one
    // (same guard Plan.jsx uses)
    let stale = false;
    getPlan(planIncome)
      .then((p) => {
        if (!stale) {
          setPlan(p);
        }
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [planIncome]);

  // opt-in money-news headlines (empty unless the server has TSUMIKI_NEWS_FEED set)
  const [news, setNews] = useState(null);
  useEffect(() => {
    getNews()
      .then(setNews)
      .catch(() => {});
  }, []);
  const leftToAllocate = incomeThisMonth - contribThisMonth - spendThisMonth;

  // reuse the streak App already computed; fall back to deriving it if rendered standalone
  const adh = useMemo(
    () => dailyStreak || computeDailyStreak(transactions, freezes),
    [dailyStreak, transactions, freezes],
  );
  const next = nextMilestone(milestoneList);
  const nw = snapshots.length ? realNetWorth : investedTotal;

  // soonest upcoming payday across income sources that have a date set
  const nextPay = useMemo(() => {
    const events = (profile.incomeSources || [])
      .filter((s) => s.payday)
      .flatMap((s) =>
        nextPaydays(s.payday, s.cadence, 1).map((date) => ({ date, name: s.name || "Income" })),
      )
      .sort((a, b) => a.date - b.date);
    return events[0] || null;
  }, [profile.incomeSources]);

  // smart, explainable insights (all deterministic — see insights.js)
  const forecast = useMemo(
    () => cashflowForecast({ accounts, snapshots, profile, transactions }, {}),
    [accounts, snapshots, profile, transactions],
  );
  const trends = useMemo(() => spendingTrends(transactions).slice(0, 4), [transactions]);
  const savingsBal = useMemo(
    () => sumLatestByType(accounts, snapshots, ["savings"]),
    [accounts, snapshots],
  );
  // months of runway = liquid safety net ÷ typical monthly essentials (bills or learned spend)
  const monthlyEssentials = plan?.essentials > 0 ? plan.essentials : annualExpenses / 12;
  const runwayMonths = monthlyEssentials > 0 ? savingsBal / monthlyEssentials : null;
  const highApr = profile.highApr ?? 10;
  const highDebt = (debts || [])
    .filter((d) => (d.apr || 0) >= highApr)
    .reduce((s, d) => s + (d.balance || 0), 0);
  const sources = profile.incomeSources || [];
  // category budgets: this month's spend vs each cap + the most-pressing alert
  const budgetRows = useMemo(
    () =>
      budgetStatus(
        transactions,
        profile.budgets || {},
        thisMonth(),
        new Date(),
        profile.budgetOpts,
      ),
    [transactions, profile.budgets, profile.budgetOpts],
  );
  const budgetWarn = budgetAlert(budgetRows);
  // this month's spending split by category (for the "where it went" breakdown)
  const catSpend = useMemo(() => {
    const m = {};
    for (const t of transactions) {
      if (t.type === "spending" && t.amount > 0 && monthKey(t.date) === ym) {
        m[t.cat || "Other"] = (m[t.cat || "Other"] || 0) + t.amount;
      }
    }
    return Object.entries(m)
      .map(([cat, amount]) => ({ cat, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions, ym]);
  const coachList = coachNudges({
    savings: savingsBal,
    emergencyTarget: profile.emergencyTarget || 0,
    strategy: profile.strategy || "balanced",
    hasIncome: sources.length > 0 || income > 0,
    hasPaydays: sources.some((s) => s.payday),
    highDebt,
    leftToAllocate,
    forecast,
  });
  // a budget overrun is timely + actionable → surface it first
  const budgetNudge = budgetWarn
    ? {
        id: "budget",
        tone: budgetWarn.over ? "warn" : "info",
        tab: "activity",
        text: budgetWarn.over
          ? `${budgetWarn.cat} is over budget — ${fmt(budgetWarn.spent)} of ${fmt(budgetWarn.budget)} this month.`
          : `${budgetWarn.cat} is at ${Math.round(budgetWarn.pct * 100)}% of its ${fmt(budgetWarn.budget)} budget.`,
      }
    : null;
  const nudges = [...(budgetNudge ? [budgetNudge] : []), ...coachList].slice(0, 2);

  // curated money tips, chosen by your current situation (see learn.js)
  const floorAmt = profile.checkingFloor || 0;
  const tips = learnFeed({
    hasMatch: !!profile.employerMatch?.pct,
    idleCash:
      sumLatestByType(accounts, snapshots, ["checking"]) > Math.max(floorAmt * 2, floorAmt + 3000),
    investedTotal,
    hasRetirement: transactions.some((t) => t.type === "contribution" && t.bucket === "retirement"),
    windfall: !!plan?.windfall?.detected,
    spendingUp: trends.some((t) => t.dir === "up"),
    hasPaydays: sources.some((s) => s.payday),
  });

  // getting-started checklist — drives activation, hides once complete
  const checklist = [
    { done: sources.length > 0, label: "Add an income source", tab: "accounts" },
    { done: sources.some((s) => s.payday), label: "Set your payday date", tab: "accounts" },
    { done: accounts.length > 0, label: "Add your accounts", tab: "accounts" },
    { done: (profile.emergencyTarget || 0) > 0, label: "Set an emergency target", tab: "settings" },
    { done: transactions.length > 0, label: "Log your first transaction", tab: "activity" },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const setupComplete = doneCount === checklist.length;

  const TREND_TONE = {
    warn: "bg-amber-50 text-amber-800",
    good: "bg-emerald-50 text-emerald-700",
    info: "bg-brand-50 text-brand-800",
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* getting-started checklist — only until setup is complete */}
      {!setupComplete && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Get set up ({doneCount}/{checklist.length})
            </div>
            <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500 rounded-full transition-all"
                style={{ width: `${(doneCount / checklist.length) * 100}%` }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            {checklist.map((c, i) => (
              <button
                key={i}
                onClick={() => !c.done && onGo?.(c.tab)}
                disabled={c.done}
                className={`w-full flex items-center gap-2 text-sm text-left ${c.done ? "text-slate-500" : "text-slate-700 hover:text-brand-600"}`}
              >
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${c.done ? "bg-emerald-500 text-white" : "border border-slate-300"}`}
                >
                  {c.done && <Check size={11} />}
                </span>
                <span className={`flex-1 ${c.done ? "line-through" : ""}`}>{c.label}</span>
                {!c.done && <ArrowRight size={14} className="text-slate-400" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* coach — context-aware nudges */}
      {nudges.length > 0 && (
        <div className="lg:col-span-2 space-y-2">
          {nudges.map((n) => (
            <button
              key={n.id}
              onClick={() => onGo?.(n.tab)}
              className={`w-full text-left rounded-xl p-3 text-sm flex items-center gap-2 ${TREND_TONE[n.tone] || TREND_TONE.info}`}
            >
              <span className="flex-1">
                <BlurAmounts text={n.text} />
              </span>
              <ArrowRight size={15} className="flex-shrink-0 opacity-60" />
            </button>
          ))}
        </div>
      )}

      {/* hero */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 lg:col-span-2 relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1.5 bg-brand-500" />
        {profile.name && (
          <div className="text-sm text-slate-500 mb-1">
            {greeting()}, {profile.name}.
          </div>
        )}
        <div className="text-xs text-slate-500 tracking-widest uppercase font-medium">
          {snapshots.length ? "Net worth" : "Contributed"}
        </div>
        <div className="text-4xl font-mono font-bold text-slate-900 tabular-nums">
          <Money n={nw} />
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {investedTotal > 0 ? (
            <>
              <Money n={investedTotal} /> contributed by you
            </>
          ) : (
            "log a balance in Setup for real net worth"
          )}
        </div>
      </div>

      {/* reminders — time-based alerts (paydays, bills, buffer, est. taxes, streak) */}
      {activeReminders.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 lg:col-span-2">
          <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <Bell size={13} /> Reminders
          </div>
          <div className="space-y-2">
            {activeReminders.map((r) => (
              <div
                key={r.id}
                className={`flex items-start gap-2 rounded-lg p-2.5 ${REMINDER_TONE[r.severity] || REMINDER_TONE.info}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{r.title}</div>
                  {r.detail && (
                    <div className="text-xs text-slate-600">
                      <BlurAmounts text={r.detail} />
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setDismissed((s) => new Set(s).add(r.id))}
                  aria-label={`Dismiss: ${r.title}`}
                  className="-m-1.5 flex h-11 w-11 flex-shrink-0 items-center justify-center opacity-70 hover:opacity-100"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* key numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 lg:col-span-2">
        <Stat label="Income / mo" value={income > 0 ? <Money n={income} /> : "—"} tone="emerald" />
        <Stat
          label="Spent this month"
          value={spendThisMonth > 0 ? <Money n={spendThisMonth} /> : "—"}
          tone="amber"
        />
        <Stat
          label="Savings rate"
          value={savingsRate == null ? "—" : `${Math.round(savingsRate * 100)}%`}
          tone="brand"
        />
        <Stat
          label="FIRE progress"
          value={firePct == null ? "—" : `${(firePct * 100).toFixed(1)}%`}
          tone="blue"
        />
      </div>

      {/* last month in review — a coach-style report card */}
      {hasReview && (
        <Card title={`${prevMonthName} in review`} onGo={() => onGo?.("activity")}>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div>
              <div className="text-xs text-slate-500">Earned</div>
              <div className="font-mono font-semibold text-slate-800">
                {lastMonth.income > 0 ? <Money n={lastMonth.income} /> : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Spent</div>
              <div className="font-mono font-semibold text-slate-800">
                {lastMonth.spending > 0 ? <Money n={lastMonth.spending} /> : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Saved</div>
              <div
                className={`font-mono font-semibold ${lastRate == null ? "text-slate-800" : lastRate >= 0.2 ? "text-emerald-600" : "text-slate-800"}`}
              >
                {lastRate == null ? "—" : `${Math.round(lastRate * 100)}%`}
              </div>
            </div>
          </div>
          {lastMonth.contribution > 0 && (
            <div className="text-sm text-slate-600">
              <Money n={lastMonth.contribution} /> put toward savings and investments.
            </div>
          )}
          {lastCats.length > 0 && (
            <div className="text-sm text-slate-600">
              Biggest category: {lastCats[0].cat} (<Money n={lastCats[0].amount} />
              {lastMonth.spending > 0 &&
                ` · ${Math.round((lastCats[0].amount / lastMonth.spending) * 100)}%`}
              ).
            </div>
          )}
          {spendShift != null && Math.abs(spendShift) >= 0.05 && (
            <div
              className={`text-sm mt-0.5 ${spendShift > 0 ? "text-amber-700" : "text-emerald-600"}`}
            >
              Spending {spendShift > 0 ? "up" : "down"} {Math.round(Math.abs(spendShift) * 100)}% vs
              the month before.
            </div>
          )}
        </Card>
      )}

      {/* plan snapshot */}
      <Card
        title={`${new Date().toLocaleDateString(undefined, { month: "long" })} plan`}
        onGo={() => onGo?.("plan")}
      >
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-sm text-slate-600">Earned this month</span>
          <span className="font-mono text-slate-800">
            {incomeThisMonth > 0 ? <Money n={incomeThisMonth} /> : "—"}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-600">Flexible / unassigned</span>
          <span
            className={`font-mono font-semibold ${leftToAllocate >= 0 ? "text-slate-900" : "text-rose-500"}`}
          >
            <Money n={leftToAllocate} />
          </span>
        </div>
        {runwayMonths != null && savingsBal > 0 && (
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-sm text-slate-600">Safety runway</span>
            <span
              className={`font-mono font-semibold ${runwayMonths >= 3 ? "text-emerald-600" : "text-amber-600"}`}
            >
              {runwayMonths >= 10 ? Math.round(runwayMonths) : runwayMonths.toFixed(1)} mo
            </span>
          </div>
        )}
        {plan?.steps?.length > 0 && (
          <div className="text-xs text-slate-500 mt-2">
            Next move:{" "}
            {plan.steps.find((s) => s.key !== "essentials")?.label || plan.steps[0].label}
          </div>
        )}
        {nextPay && (
          <div className="text-xs text-emerald-600 mt-1">
            Next payday: {fmtDate(nextPay.date)} · {nextPay.name}
          </div>
        )}
      </Card>

      {/* game summary */}
      <Card title="Your progress" onGo={() => onGo?.("goals")}>
        <div className="flex items-center gap-3 mb-2">
          <Flame size={28} className={adh.current > 0 ? "text-orange-500" : "text-slate-400"} />
          <div>
            <div className="text-2xl font-mono font-bold text-slate-900">
              {adh.current}
              <span className="text-sm font-sans font-normal text-slate-500"> day streak</span>
            </div>
            <div className="text-xs text-slate-500 inline-flex items-center gap-1">
              {adh.loggedToday ? (
                <>
                  Logged today <Check size={13} className="text-emerald-600" />
                </>
              ) : (
                "Log anything today to keep it"
              )}
            </div>
          </div>
        </div>
        {next && (
          <div>
            <div className="flex items-baseline justify-between text-xs text-slate-500 mb-1">
              <span className="inline-flex items-center gap-1">
                Next: <MilestoneIcon name={next.icon} size={12} /> <BlurAmounts text={next.label} />
              </span>
              <span className="font-mono">
                <Money n={next.cur} /> / <Money n={next.target} />
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full"
                style={{ width: `${Math.min(100, (next.cur / next.target) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* spending insights — this month vs your average */}
      {trends.length > 0 && (
        <Card title="Spending vs your average" onGo={() => onGo?.("activity")}>
          <div className="space-y-2">
            {trends.map((t) => (
              <div key={t.cat} className="flex items-center gap-2 text-sm">
                <span className="text-slate-600 flex-1 truncate">{t.cat}</span>
                {t.dir === "up" ? (
                  <TrendingUp size={14} className="text-rose-500" />
                ) : t.dir === "down" ? (
                  <TrendingDown size={14} className="text-emerald-600" />
                ) : (
                  <span className="text-slate-500 text-xs">flat</span>
                )}
                <span className="font-mono text-slate-800 w-16 text-right">
                  <Money n={t.now} />
                </span>
                {t.avg > 0 && (
                  <span
                    className={`text-xs w-12 text-right ${t.dir === "up" ? "text-rose-500" : t.dir === "down" ? "text-emerald-600" : "text-slate-500"}`}
                  >
                    {t.delta > 0 ? "+" : ""}
                    {Math.round(t.delta * 100)}%
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            vs your prior-month average per category
          </div>
        </Card>
      )}

      {/* where this month's spending went, by category */}
      {catSpend.length > 1 && spendThisMonth > 0 && (
        <Card title="Where it went" onGo={() => onGo?.("activity")}>
          <div className="space-y-2">
            {catSpend.slice(0, 6).map((c) => (
              <div key={c.cat}>
                <div className="flex items-baseline justify-between text-sm mb-1">
                  <span className="text-slate-600 truncate">{c.cat}</span>
                  <span className="font-mono text-xs text-slate-500">
                    <Money n={c.amount} />
                    <span className="text-slate-500">
                      {" "}
                      · {Math.round((c.amount / spendThisMonth) * 100)}%
                    </span>
                  </span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-400 rounded-full"
                    style={{ width: `${(c.amount / spendThisMonth) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            <Money n={spendThisMonth} /> spent this month
          </div>
        </Card>
      )}

      {/* budgets — this month's spend vs each category cap */}
      {budgetRows.length > 0 && (
        <Card title="Budgets this month" onGo={() => onGo?.("settings")}>
          <div className="space-y-2.5">
            {budgetRows.slice(0, 5).map((b) => (
              <div key={b.cat}>
                <div className="flex items-baseline justify-between text-sm mb-1">
                  <span className="text-slate-600">
                    {b.cat}
                    {b.period === "annual" && <span className="text-slate-500"> · yearly</span>}
                    {b.rollover && b.carry !== 0 && (
                      <span className={b.carry > 0 ? "text-emerald-600" : "text-rose-500"}>
                        {" "}
                        · rollover {b.carry > 0 ? "+" : "−"}
                        <Money n={Math.abs(b.carry)} />
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-xs text-slate-500">
                    <Money n={b.spent} />
                    <span className="text-slate-500">
                      {" "}
                      / <Money n={b.budget} />
                    </span>
                  </span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${b.over ? "bg-rose-400" : b.pct >= 0.9 ? "bg-amber-400" : "bg-emerald-400"}`}
                    style={{ width: `${Math.min(100, b.pct * 100)}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {b.over ? (
                    <>
                      <Money n={-b.remaining} /> over
                    </>
                  ) : b.perDayLeft > 0 ? (
                    <>
                      <Money n={b.perDayLeft} />
                      /day left
                    </>
                  ) : (
                    <>
                      <Money n={b.remaining} /> left
                    </>
                  )}
                  {b.lastMonth > 0 && (
                    <>
                      {" · "}
                      <Money n={b.lastMonth} /> last month
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* cashflow forecast — lowest projected checking before it recovers */}
      {forecast.hasData && forecast.floor > 0 && forecast.inflowsKnown && (
        <Card title="Cashflow forecast" onGo={() => onGo?.("plan")}>
          <div className="flex items-baseline gap-2 mb-1">
            <span
              className={`text-2xl font-mono font-bold ${forecast.dipsBelow ? "text-rose-500" : "text-slate-900"}`}
            >
              <Money n={forecast.min} />
            </span>
            <span className="text-xs text-slate-500">
              lowest checking, ~{fmtDate(forecast.minDate)}
            </span>
          </div>
          {forecast.dipsBelow ? (
            <div className="text-sm text-rose-500">
              Dips below your <Money n={forecast.floor} /> floor around {fmtDate(forecast.dipDate)}{" "}
              at your usual pace.
            </div>
          ) : (
            <div className="text-sm text-emerald-600">
              Stays above your <Money n={forecast.floor} /> floor for the next 45 days.
            </div>
          )}
          <div className="text-xs text-slate-500 mt-1">
            From your bills, paydays, and typical daily spending.
          </div>
        </Card>
      )}

      {/* curated money tips, tied to your situation */}
      {tips.length > 0 && (
        <Card title="Money tips for you" span>
          <div className="space-y-3">
            {tips.map((t) => (
              <div key={t.id}>
                <div className="text-sm font-semibold text-slate-700">{t.topic}</div>
                <div className="text-sm text-slate-500 mt-0.5">{t.blurb}</div>
                <button
                  onClick={() => onGo?.(t.tab)}
                  className="text-xs text-brand-600 hover:text-brand-700 mt-1 inline-flex items-center gap-1"
                >
                  {t.action} <ArrowRight size={13} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* opt-in money news — only when the server has a feed configured */}
      {news?.enabled && news.items?.length > 0 && (
        <Card title="Money news">
          <div className="space-y-2">
            {news.items.slice(0, 5).map((n, i) => (
              <a
                key={i}
                href={n.link || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-slate-700 hover:text-brand-600"
              >
                {n.title}
              </a>
            ))}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            Headlines only · general info, not advice.
          </div>
        </Card>
      )}

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
