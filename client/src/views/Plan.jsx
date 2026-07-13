// Plan.jsx — the living monthly plan: targets vs actuals, recurring transfers, chart.
import { useState, useEffect, useMemo, useRef } from "react";
import Money from "../components/Money.jsx";
import { Check } from "lucide-react";
import { getPlan } from "../lib/core/api.js";
import { typicalIncome } from "../lib/finance/income.js";
import { nonTaxableMonthly, taxableShare } from "../lib/finance/finance.js";
import { BUCKETS, bucketOf } from "../lib/plan/buckets.js";
import { thisMonth, monthKey, sumLatestByType, monthTotals } from "../lib/core/selectors.js";
import { estimateTax, nextQuarterlyDue, TAX_YEAR } from "../lib/finance/tax.js";
import { payoffPlan } from "../lib/finance/debt.js";
import PlanSplitChart from "../charts/PlanSplitChart.jsx";
import Recurring from "../components/Recurring.jsx";

const fmtMonths = (m) => (m >= 12 ? `${Math.floor(m / 12)}y ${m % 12}mo` : `${m}mo`);
const monthYear = (d) => d.toLocaleDateString(undefined, { month: "short", year: "numeric" });

// this month's pooled income → engine targets per bucket vs your actual
// contributions, what's left to allocate, and a forward-looking checking watch
const BUCKET_META = BUCKETS.map((b) => [b.key, b.label, b.color]);
const monthName = () => new Date().toLocaleDateString(undefined, { month: "long" });
const STRAT_LABEL = { short_term: "Safety", balanced: "Balanced", long_term: "Growth" };
const stratLabel = (s) => STRAT_LABEL[s] || "Balanced";

/** The living monthly plan: recurring transfers, split chart, plan-vs-actual, and the strategy preview. */
export default function Plan({
  transactions = [],
  accounts = [],
  snapshots = [],
  debts = [],
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
  const { income: incomeThisMonth, spending: spendThisMonth } = useMemo(
    () => monthTotals(transactions, ym),
    [transactions, ym],
  );

  const typical = useMemo(() => typicalIncome(profile, transactions), [profile, transactions]);
  const planIncome = incomeThisMonth > 0 ? incomeThisMonth : typical;

  // tax estimate on annualized income (take-home + bracket); see tax.js
  const yr = new Date().getFullYear();
  const age = profile.birthYear ? yr - profile.birthYear : null;
  const spouseAge = profile.spouseBirthYear ? yr - profile.spouseBirthYear : null;
  // self-employed income has no withholding → estimated payments + SE-tax handling
  const selfEmployed = (profile.incomeSources || []).some((s) => s.type === "self_employed");
  // income flagged non-taxable is excluded from the tax base but still planned for.
  // Scale by the taxable SHARE (not a fixed subtraction) so it's correct whether
  // `typical` is the typed source total or a learned rolling average.
  const nonTaxable = nonTaxableMonthly(profile);
  const taxableAnnual = Math.max(0, (typical || 0) * taxableShare(profile)) * 12;
  const tax = useMemo(
    () =>
      estimateTax({
        income: taxableAnnual,
        filingStatus: profile.filingStatus,
        state: profile.state,
        age,
        spouseAge,
        stateRate: profile.stateTaxRate,
        selfEmployed,
      }),
    [
      taxableAnnual,
      profile.filingStatus,
      profile.state,
      age,
      spouseAge,
      profile.stateTaxRate,
      selfEmployed,
    ],
  );

  // self-employed income has no withholding → surface a quarterly estimated-tax nudge
  const quarterlyDue = selfEmployed ? nextQuarterlyDue() : null;

  const [amount, setAmount] = useState(planIncome);
  // follow the recomputed typical income ONLY until the user types their own what-if
  // figure — a background save used to recompute planIncome and clobber the field
  // mid-typing (AUDIT L9)
  const amountTouched = useRef(false);
  useEffect(() => {
    if (!amountTouched.current) {
      setAmount(planIncome);
    }
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
  const [applyWindfall, setApplyWindfall] = useState(false); // confirm-first, per-session
  useEffect(() => {
    const n = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    // debounce the (per-keystroke) fetch + ignore stale responses so a slow earlier
    // request can't clobber a newer one
    let stale = false;
    const t = setTimeout(() => {
      getPlan(n, preview, { windfall: applyWindfall })
        .then((p) => {
          if (!stale) {
            setPlan(p);
            setErr("");
          }
        })
        .catch((e) => {
          if (!stale) {
            setErr(String(e.message || e));
          }
        });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [amount, preview, applyWindfall]);

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

  // debt-free timeline: minimums-only vs the plan's suggested debt budget, so the
  // payoff date and interest saved are concrete. strategy mirrors the engine's.
  const debtStrategy = profile.debtStrategy === "snowball" ? "snowball" : "avalanche";
  const minPay = debts.reduce((s, d) => s + (d.minPayment || 0), 0);
  const planDebtExtra = Math.max(0, Math.round(target.debt - minPay));
  const payoff = useMemo(() => {
    const live = debts.filter((d) => (d.balance || 0) > 0);
    if (!live.length) {
      return null;
    }
    const base = payoffPlan(live, { strategy: debtStrategy });
    const boosted =
      planDebtExtra > 0 ? payoffPlan(live, { extra: planDebtExtra, strategy: debtStrategy }) : null;
    return { base, boosted };
  }, [debts, debtStrategy, planDebtExtra]);

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

  return (
    <>
      {/* header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {monthName()} — your plan
          </div>
          {plan && (
            <button onClick={onGoSetup} className="text-xs text-slate-500 hover:text-brand-600">
              {plan.strategy?.replace("_", " ")} ›
            </button>
          )}
        </div>
        <div className="flex items-baseline gap-2 mb-3">
          <div className="text-3xl font-mono font-bold text-slate-900">
            {incomeThisMonth > 0 ? <Money n={incomeThisMonth} /> : "—"}
          </div>
          <div className="text-xs text-slate-500">
            earned this month
            {typical ? (
              <>
                {" · ~"}
                <Money n={typical} /> typical
              </>
            ) : (
              ""
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Plan for</span>
          <div className="relative" style={{ width: 120 }}>
            <span className="absolute left-3 top-2 text-slate-500 text-sm">$</span>
            <input
              type="number"
              aria-label="Income to plan for"
              value={amount}
              onChange={(e) => {
                const v = e.target.value;
                amountTouched.current = true;
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
          <div className="text-xs text-slate-500 mt-2">
            <Money n={plan.essentials} /> reserved for essentials{" "}
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

      {/* windfall — detected when income is well above typical; aggressive split is opt-in */}
      {plan?.windfall?.detected && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-emerald-800 flex-1">
            {plan.windfall.applied ? (
              <>
                Windfall mode on — the extra{" "}
                <b>
                  <Money n={plan.windfall.amount} />
                </b>{" "}
                above your ~
                <Money n={plan.windfall.typical} /> typical is going aggressive (finish savings,
                then invest).
              </>
            ) : (
              <>
                Looks like a{" "}
                <b>
                  <Money n={plan.windfall.amount} />
                </b>{" "}
                windfall above your ~
                <Money n={plan.windfall.typical} /> typical. Split the extra aggressively toward
                savings + investing?
              </>
            )}
          </span>
          <button
            onClick={() => setApplyWindfall(!applyWindfall)}
            className={`text-xs font-medium rounded-lg px-2.5 py-1 ${plan.windfall.applied ? "text-emerald-700 hover:text-emerald-900" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
          >
            {plan.windfall.applied ? "Use normal split" : "Use windfall split"}
          </button>
        </div>
      )}

      {err && (
        <div className="bg-rose-50 border border-rose-200 text-rose-600 text-xs rounded-xl p-3">
          {err}
        </div>
      )}

      {/* tax estimate on annualized income → take-home + bracket */}
      {typical > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Taxes (estimate)
            </div>
            <button onClick={onGoSetup} className="text-xs text-slate-500 hover:text-brand-600">
              {profile.state || "set filing & state"} ›
            </button>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <div className="text-2xl font-mono font-bold text-slate-900">
              <Money n={tax.takeHomeMonthly} />
              <span className="text-xs font-sans font-normal text-slate-500"> /mo take-home</span>
            </div>
            <div className="text-xs text-slate-500">
              ~{Math.round(tax.effectiveRate * 100)}% effective ·{" "}
              {Math.round(tax.marginalRate * 100)}% bracket
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>
              Federal <Money n={tax.federal} />
            </span>
            <span>
              FICA <Money n={tax.fica} />
            </span>
            <span>State {tax.stateNoTax ? "none" : <Money n={tax.state} />}</span>
            <span className="text-slate-500">
              on ~<Money n={tax.gross} />
              /yr
            </span>
          </div>
          {quarterlyDue && tax.total > 0 && (
            <div className="mt-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
              Self-employed: no tax is withheld, so set aside ~
              <b>
                <Money n={Math.round(tax.total / 4)} />
              </b>{" "}
              each quarter. Next estimated payment due{" "}
              <b>
                {quarterlyDue.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </b>
              .
            </div>
          )}
          {nonTaxable > 0 && (
            <div className="text-xs text-slate-500 mt-2">
              Excludes ~<Money n={nonTaxable} />
              /mo of income you marked non-taxable.
            </div>
          )}
          <div className="text-xs text-slate-500 mt-2">
            {TAX_YEAR} estimate{tax.stateNoTax ? ` · ${profile.state} has no income tax` : ""}
            {!profile.state ? " — set your filing status & state in Settings for accuracy." : "."}
          </div>
          {new Date().getFullYear() > TAX_YEAR && (
            <div className="mt-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-800" role="note">
              These figures still use {TAX_YEAR} tax law — the brackets and contribution limits need
              updating for the current year.
            </div>
          )}
        </div>
      )}

      {/* debt-free timeline — payoff date + interest, minimums vs the plan's extra */}
      {payoff && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Debt-free timeline
            </div>
            <span className="text-xs text-slate-500">{debtStrategy}</span>
          </div>
          {payoff.base.debtFree ? (
            <div className="mb-1">
              <div className="text-2xl font-mono font-bold text-slate-900">
                {monthYear(payoff.base.payoffDate)}
              </div>
              <div className="text-xs text-slate-500">
                at your <Money n={payoff.base.monthlyPayment} />
                /mo minimums · {fmtMonths(payoff.base.months)} ·{" "}
                <Money n={payoff.base.totalInterest} /> interest
              </div>
            </div>
          ) : (
            <div className="text-sm text-rose-500 mb-1">
              At the current minimums your balances barely move — add even a little extra to start
              making real progress.
            </div>
          )}
          {payoff.boosted?.debtFree && payoff.base.debtFree && (
            <div className="rounded-lg bg-emerald-50 p-2.5 text-sm text-emerald-800">
              With the plan&apos;s extra{" "}
              <b>
                <Money n={planDebtExtra} />
                /mo
              </b>
              : debt-free <b>{monthYear(payoff.boosted.payoffDate)}</b> (
              {fmtMonths(Math.max(0, payoff.base.months - payoff.boosted.months))} sooner), saving{" "}
              <b>
                <Money n={Math.max(0, payoff.base.totalInterest - payoff.boosted.totalInterest)} />
              </b>{" "}
              in interest.
            </div>
          )}
          {payoff.base.order.length > 1 && (
            <div className="text-xs text-slate-500 mt-2">
              Order: {payoff.base.order.map((o) => o.name).join(" → ")}
            </div>
          )}
        </div>
      )}

      {/* recurring transfers, split per income source by its own paycheck cadence */}
      <Recurring plan={plan} profile={profile} accounts={accounts} />

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
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
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
                    <Money n={act} />
                    <span className="text-slate-500">
                      {" "}
                      / <Money n={tgt} />
                    </span>
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
                {tgt > 0 && !done && (
                  <div className="text-xs text-slate-500 mt-1">
                    <Money n={tgt - act} /> to go this month
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
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Flexible / unassigned
            </div>
            <div className="text-xs text-slate-500">
              income earned − assigned − spent, this month
            </div>
          </div>
          <div
            className={`text-2xl font-mono font-bold ${leftToAllocate >= 0 ? "text-slate-900" : "text-rose-500"}`}
          >
            <Money n={leftToAllocate} />
          </div>
        </div>
      </div>

      {/* checking minimum watch — only when there's something to watch */}
      {hasCheckingContext && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Checking buffer
          </div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-sm text-slate-600">Balance vs. floor</span>
            <span className="font-mono text-sm text-slate-700">
              <Money n={checkingBalance} />
              <span className="text-slate-500">
                {" "}
                / <Money n={floor} /> min
              </span>
            </span>
          </div>
          {checkingBalance < floor ? (
            <div className="text-sm text-rose-500 font-medium">
              Below your floor by <Money n={floor - checkingBalance} />.
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
