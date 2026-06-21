// Plan.jsx — the living monthly plan: targets vs actuals, recurring transfers, chart.
import { useState, useEffect, useMemo } from "react";
import { Check } from "lucide-react";
import { getPlan } from "./api.js";
import { fmt } from "./format.js";
import { typicalIncome } from "./income.js";
import { BUCKETS, bucketOf } from "./buckets.js";
import { thisMonth, monthKey, sumLatestByType } from "./selectors.js";
import PlanSplitChart from "./PlanSplitChart.jsx";

// this month's pooled income → engine targets per bucket vs your actual
// contributions, what's left to allocate, and a forward-looking checking watch
const BUCKET_META = BUCKETS.map((b) => [b.key, b.label, b.color]);
const monthName = () => new Date().toLocaleDateString(undefined, { month: "long" });
const STRAT_LABEL = { short_term: "Safety", balanced: "Balanced", long_term: "Growth" };
const stratLabel = (s) => STRAT_LABEL[s] || "Balanced";
const cadenceLabel = (c) =>
  ({
    weekly: "weekly",
    biweekly: "every 2 weeks",
    semimonthly: "twice a month",
    monthly: "monthly",
  })[c] || "monthly";

/** The living monthly plan: recurring transfers, split chart, plan-vs-actual, and the strategy preview. */
export default function Plan({
  transactions = [],
  accounts = [],
  snapshots = [],
  profile = {},
  onGoSetup,
  onApplyMonth,
  onClearMonth,
}) {
  const ym = thisMonth();
  const monthTx = useMemo(
    () => transactions.filter((t) => monthKey(t.date) === ym),
    [transactions, ym],
  );
  const incomeThisMonth = monthTx
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + t.amount, 0);
  const spendThisMonth = monthTx
    .filter((t) => t.type === "spending")
    .reduce((s, t) => s + t.amount, 0);

  const typical = useMemo(() => typicalIncome(profile, transactions), [profile, transactions]);
  const planIncome = incomeThisMonth > 0 ? incomeThisMonth : typical;

  const [amount, setAmount] = useState(planIncome);
  useEffect(() => {
    setAmount(planIncome);
  }, [planIncome]);

  // saved strategy stays put; an optional one-month override applies this month;
  // a preview lets you *look* at another strategy without saving anything.
  const savedStrategy = profile.strategy || "balanced";
  const monthStrategy =
    (profile.monthOverride?.ym === ym && profile.monthOverride?.strategy) || null;
  const effective = monthStrategy || savedStrategy;
  const [preview, setPreview] = useState(effective);
  useEffect(() => {
    setPreview(effective);
  }, [effective]);
  const previewing = preview !== effective;

  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState("");
  const [perCheck, setPerCheck] = useState(true); // recurring per-paycheck is the default frame
  useEffect(() => {
    const n = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    getPlan(n, preview)
      .then(setPlan)
      .catch((e) => setErr(String(e.message || e)));
  }, [amount, preview]);

  // actuals this month, by bucket
  const actual = useMemo(() => {
    const a = { debt: 0, emergency: 0, retirement: 0, invest: 0 };
    for (const t of monthTx) {
      if (t.type === "contribution") {
        a[bucketOf(t)] += t.amount;
      }
    }
    return a;
  }, [monthTx]);

  // targets from the engine plan, collapsed to display buckets
  const target = useMemo(() => {
    const t = { debt: 0, emergency: 0, retirement: 0, invest: 0, floor: 0 };
    for (const s of plan?.steps || []) {
      if (s.key === "min_debt" || s.key === "high_debt") {
        t.debt += s.amount;
      } else if (s.key === "emergency") {
        t.emergency += s.amount;
      } else if (s.key === "match" || s.key === "retirement") {
        t.retirement += s.amount;
      } else if (s.key === "brokerage") {
        t.invest += s.amount;
      } else if (s.key === "floor") {
        t.floor += s.amount;
      }
    }
    return t;
  }, [plan]);

  // checking buffer + forward-looking minimum watch
  const checkingBalance = useMemo(
    () => sumLatestByType(accounts, snapshots, ["checking"]),
    [accounts, snapshots],
  );
  const floor = profile.checkingFloor || 0;
  const hasCheckingContext = accounts.some((a) => a.type === "checking") || floor > 0;
  const dayOfMonth = new Date().getDate();
  const dailySpend = spendThisMonth / Math.max(1, dayOfMonth);
  const daysToFloor = dailySpend > 0 ? (checkingBalance - floor) / dailySpend : Infinity;

  const assigned = actual.debt + actual.emergency + actual.retirement + actual.invest;
  const leftToAllocate = incomeThisMonth - assigned - spendThisMonth;

  const rows = BUCKET_META.filter(([k]) => target[k] > 0 || actual[k] > 0);

  // where each step's money should physically go (the core "split my paycheck" advice)
  const STEP_COLOR = (k) =>
    ({
      essentials: "#94A3B8",
      min_debt: "#E05656",
      high_debt: "#E05656",
      floor: "#378ADD",
      checking_flex: "#378ADD",
      emergency: "#3FA9C9",
      match: "#A78BFA",
      retirement: "#A78BFA",
      brokerage: "#1D9E75",
    })[k] || "#94A3B8";
  const acctName = (type) => accounts.find((a) => a.type === type)?.name;
  const routeFor = (k) => {
    if (k === "essentials" || k === "floor" || k === "min_debt" || k === "checking_flex") {
      return acctName("checking") || "your checking";
    }
    if (k === "emergency") {
      return acctName("savings") || "a savings account";
    }
    if (k === "match" || k === "retirement") {
      return acctName("ira") || "your 401k / IRA";
    }
    if (k === "brokerage") {
      return acctName("brokerage") || "a brokerage account";
    }
    if (k === "high_debt") {
      return "your highest-rate debt";
    }
    return "—";
  };

  return (
    <>
      {/* header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {monthName()} — your plan
          </div>
          {plan && (
            <button onClick={onGoSetup} className="text-xs text-slate-400 hover:text-brand-600">
              {plan.strategy?.replace("_", " ")} ›
            </button>
          )}
        </div>
        <div className="flex items-baseline gap-2 mb-3">
          <div className="text-3xl font-mono font-bold text-slate-900">{fmt(incomeThisMonth)}</div>
          <div className="text-xs text-slate-400">
            earned this month{typical ? ` · ~${fmt(typical)} typical` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Plan for</span>
          <div className="relative" style={{ width: 120 }}>
            <span className="absolute left-3 top-2 text-slate-400 text-sm">$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => {
                const v = e.target.value;
                setAmount(v === "" || Number.isNaN(Number(v)) ? "" : Number(v));
              }}
              className="w-full pl-7 pr-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
            />
          </div>
          {incomeThisMonth > 0 && Number(amount) !== incomeThisMonth && (
            <button onClick={() => setAmount(incomeThisMonth)} className="text-xs text-brand-600">
              use this month
            </button>
          )}
        </div>
        {plan?.essentials > 0 && (
          <div className="text-xs text-slate-400 mt-2">
            {fmt(plan.essentials)} reserved for essentials{" "}
            {plan.essentialsSource === "bills" ? "(your bills)" : "(est. from spending)"} — the rest
            is allocated below.
          </div>
        )}
      </div>

      {/* preview / one-month override banner — main strategy is never changed by previewing */}
      {previewing ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-amber-800 flex-1">
            Previewing <b>{stratLabel(preview)}</b> — not saved. Your strategy stays{" "}
            <b>{stratLabel(savedStrategy)}</b>.
          </span>
          {onApplyMonth && (
            <button
              onClick={() => onApplyMonth(preview)}
              className="text-xs font-medium bg-amber-600 text-white rounded-lg px-2.5 py-1 hover:bg-amber-700"
            >
              Use for {monthName()} only
            </button>
          )}
          <button
            onClick={() => setPreview(effective)}
            className="text-xs text-amber-700 hover:text-amber-900"
          >
            Reset
          </button>
        </div>
      ) : monthStrategy ? (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-brand-800 flex-1">
            Using <b>{stratLabel(monthStrategy)}</b> for {monthName()} only · your default is{" "}
            <b>{stratLabel(savedStrategy)}</b>.
          </span>
          {onClearMonth && (
            <button onClick={onClearMonth} className="text-xs text-brand-700 hover:text-brand-900">
              Back to default
            </button>
          )}
        </div>
      ) : null}

      {err && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 text-xs rounded-xl p-3">
          {err}
        </div>
      )}

      {/* recurring transfers — paycheck-cadence-aware, framed as repeatable auto-transfers */}
      {plan?.steps?.length > 0 &&
        (() => {
          const per = plan.paychecksPerMonth || 1;
          const canSplit = per > 1.05; // monthly pay → only one view
          const show = perCheck && canSplit ? per : 1; // divisor: per-paycheck vs monthly
          const each = show > 1;
          const sumKeys = (...ks) =>
            plan.steps.filter((s) => ks.includes(s.key)).reduce((a, s) => a + s.amount, 0);
          // money that stays put in checking to cover bills & everyday spending
          const stays =
            sumKeys("essentials", "floor", "checking_flex", "min_debt") + (plan.leftover || 0);
          // recurring transfers OUT of checking, one per destination account
          const transfers = [
            {
              label: "Extra debt payment",
              color: STEP_COLOR("high_debt"),
              to: routeFor("high_debt"),
              amt: sumKeys("high_debt"),
            },
            {
              label: "Savings",
              color: STEP_COLOR("emergency"),
              to: routeFor("emergency"),
              amt: sumKeys("emergency"),
            },
            {
              label: "Retirement",
              color: STEP_COLOR("retirement"),
              to: routeFor("retirement"),
              amt: sumKeys("match", "retirement"),
            },
            {
              label: "Personal investment",
              color: STEP_COLOR("brokerage"),
              to: routeFor("brokerage"),
              amt: sumKeys("brokerage"),
            },
          ].filter((t) => t.amt > 0.5);
          return (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Recurring transfers
                </div>
                {canSplit && (
                  <div className="flex text-xs rounded-lg overflow-hidden border border-slate-200">
                    <button
                      onClick={() => setPerCheck(true)}
                      className={`px-2 py-1 ${perCheck ? "bg-brand-600 text-white" : "text-slate-500"}`}
                    >
                      Per paycheck
                    </button>
                    <button
                      onClick={() => setPerCheck(false)}
                      className={`px-2 py-1 ${!perCheck ? "bg-brand-600 text-white" : "text-slate-500"}`}
                    >
                      Monthly
                    </button>
                  </div>
                )}
              </div>
              <div className="text-xs text-slate-400 mb-3">
                {each
                  ? `You're paid ${cadenceLabel(plan.cadence)} (~${per.toFixed(1)}× / month). Set these to auto-transfer every payday — same amounts each time.`
                  : `Set these to auto-transfer each month — same amounts each time.`}
              </div>
              {transfers.length > 0 ? (
                <div className="space-y-2.5">
                  {transfers.map((t, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span
                        className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                        style={{ background: t.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-700">{t.label}</div>
                        <div className="text-xs text-slate-400 truncate">→ {t.to}</div>
                      </div>
                      <span className="text-sm font-mono font-semibold text-slate-900">
                        {fmt(t.amt / show)}
                        <span className="text-slate-300 text-xs">{each ? "/check" : "/mo"}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">
                  Nothing to transfer out {each ? "per paycheck" : "this month"} yet — it all stays
                  in checking for now.
                </div>
              )}
              {stays > 0.5 && (
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-50">
                  <span
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ background: STEP_COLOR("checking_flex") }}
                  />
                  <div className="flex-1 text-sm text-slate-500">
                    Stays in checking · bills & everyday spending
                  </div>
                  <span className="text-sm font-mono text-slate-500">
                    {fmt(stays / show)}
                    <span className="text-slate-300 text-xs">{each ? "/check" : "/mo"}</span>
                  </span>
                </div>
              )}
            </div>
          );
        })()}

      {/* donut of the split + strategy alternatives (tap to preview) */}
      <PlanSplitChart
        plan={plan}
        strategy={preview}
        saved={savedStrategy}
        onSetStrategy={setPreview}
      />

      {/* per-bucket plan vs actual */}
      {rows.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Plan vs. actual
          </div>
          {rows.map(([k, label, color]) => {
            const tgt = target[k],
              act = actual[k];
            const pct = tgt > 0 ? Math.min(100, (act / tgt) * 100) : act > 0 ? 100 : 0;
            const done = tgt > 0 && act >= tgt;
            return (
              <div key={k}>
                <div className="flex items-baseline justify-between text-sm mb-1">
                  <span className="font-medium text-slate-700">{label}</span>
                  <span className="font-mono text-slate-600">
                    {fmt(act)}
                    <span className="text-slate-300"> / {fmt(tgt)}</span>
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
                {tgt > 0 && !done && (
                  <div className="text-xs text-slate-400 mt-1">
                    {fmt(tgt - act)} to go this month
                  </div>
                )}
                {done && (
                  <div className="text-xs text-emerald-600 mt-1 inline-flex items-center gap-1">
                    <Check size={13} /> target met
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* what's left to allocate (flexible money) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Flexible / unassigned
            </div>
            <div className="text-xs text-slate-400">
              income earned − assigned − spent, this month
            </div>
          </div>
          <div
            className={`text-2xl font-mono font-bold ${leftToAllocate >= 0 ? "text-slate-900" : "text-rose-500"}`}
          >
            {fmt(leftToAllocate)}
          </div>
        </div>
      </div>

      {/* checking minimum watch — only when there's something to watch */}
      {hasCheckingContext && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Checking buffer
          </div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-sm text-slate-600">Balance vs. floor</span>
            <span className="font-mono text-sm text-slate-700">
              {fmt(checkingBalance)}
              <span className="text-slate-300"> / {fmt(floor)} min</span>
            </span>
          </div>
          {checkingBalance < floor ? (
            <div className="text-sm text-rose-500 font-medium">
              Below your floor by {fmt(floor - checkingBalance)}.
            </div>
          ) : dailySpend > 0 && isFinite(daysToFloor) ? (
            <div
              className={`text-sm font-medium ${daysToFloor < 14 ? "text-amber-600" : "text-emerald-600"}`}
            >
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
