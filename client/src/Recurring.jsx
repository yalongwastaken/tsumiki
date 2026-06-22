// Recurring.jsx — per-income recurring transfers, split by each source's cadence.
import { useState } from "react";
import { fmt } from "./lib/format.js";
import { nextPaydays } from "./lib/paydays.js";
import { CADENCE, CADENCE_LABEL, isCadence } from "./lib/cadence.js";

const fmtDate = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

// destination groups, in display order, mapped from engine step keys
const DESTINATIONS = [
  { key: "debt", label: "Extra debt payment", color: "#E05656", steps: ["high_debt"] },
  { key: "savings", label: "Savings", color: "#3FA9C9", steps: ["emergency"] },
  { key: "retirement", label: "Retirement", color: "#A78BFA", steps: ["match", "retirement"] },
  { key: "invest", label: "Personal investment", color: "#1D9E75", steps: ["brokerage"] },
];

/**
 * Per-income recurring transfer schedule: each paycheck is split by the same plan
 * percentages, shown on that income source's own cadence. Collapses to a single
 * block when there's only one income.
 */
export default function Recurring({ plan, profile = {}, accounts = [] }) {
  const [perCheck, setPerCheck] = useState(true);
  // round transfers to clean $10s for real-world auto-transfers (sticky preference)
  const [round, setRound] = useState(() => {
    try {
      return localStorage.getItem("tsumiki-round") === "1";
    } catch {
      return false;
    }
  });
  const toggleRound = () =>
    setRound((r) => {
      const n = !r;
      try {
        localStorage.setItem("tsumiki-round", n ? "1" : "0");
      } catch {
        // ignore storage failures (private mode, etc.)
      }
      return n;
    });
  const roundAmt = (a) => (round ? Math.round(a / 10) * 10 : a);

  if (!plan?.steps?.length || !plan.income) {
    return null;
  }

  // monthly $ per destination (and what stays in checking), as a share of income
  const sumSteps = (keys) =>
    plan.steps.filter((s) => keys.includes(s.key)).reduce((a, s) => a + s.amount, 0);
  const income = plan.income;
  const dests = DESTINATIONS.map((d) => ({ ...d, pct: sumSteps(d.steps) / income })).filter(
    (d) => d.pct > 0.001,
  );

  const acctName = (type) => accounts.find((a) => a.type === type)?.name;
  const routeFor = (key) =>
    key === "savings"
      ? acctName("savings") || "a savings account"
      : key === "retirement"
        ? acctName("ira") || "your 401k / IRA"
        : key === "invest"
          ? acctName("brokerage") || "a brokerage account"
          : "your highest-rate debt";

  // income sources scaled so they sum to the planned income; synthesize one if none
  const raw = (profile.incomeSources || []).filter((s) => (s.typicalMonthly || 0) > 0);
  const totalSrc = raw.reduce((a, s) => a + (s.typicalMonthly || 0), 0);
  const scale = totalSrc > 0 ? income / totalSrc : 1;
  const sources =
    raw.length > 0
      ? raw.map((s) => ({
          name: s.name || "Income",
          cadence: isCadence(s.cadence) ? s.cadence : "monthly",
          monthly: (s.typicalMonthly || 0) * scale,
          payday: s.payday || null,
        }))
      : [
          {
            name: "Your income",
            cadence: plan.cadence || "monthly",
            monthly: income,
            payday: null,
          },
        ];

  // dated payday actions across sources (only those with a payday set);
  // "move" is the rounded sum of the transfers out of checking that payday
  const upcoming = sources
    .filter((s) => s.payday)
    .flatMap((s) => {
      const paycheck = s.monthly / CADENCE[s.cadence];
      const move = dests.reduce((a, d) => a + roundAmt(paycheck * d.pct), 0);
      return nextPaydays(s.payday, s.cadence, 3).map((date) => ({ date, name: s.name, move }));
    })
    .sort((a, b) => a.date - b.date)
    .slice(0, 4);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Recurring by paycheck
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={toggleRound}
            title="Round transfers to clean $10s"
            className={`text-xs px-2 py-1 rounded-lg border ${round ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}
          >
            Round $10
          </button>
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
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="mb-4 rounded-lg bg-slate-50 p-3">
          <div className="text-xs font-medium text-slate-500 mb-2">Upcoming paydays</div>
          <div className="space-y-1.5">
            {upcoming.map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="font-mono text-slate-700 w-14 flex-shrink-0">
                  {fmtDate(e.date)}
                </span>
                <span className="text-slate-600 flex-1 truncate">{e.name}</span>
                <span className="text-slate-400">move</span>
                <span className="font-mono font-semibold text-slate-800">{fmt(e.move)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {sources.map((src, i) => {
          const per = CADENCE[src.cadence];
          const divisor = perCheck ? per : 1;
          const suffix = perCheck && per > 1.05 ? "/check" : "/mo";
          const paycheckIncome = src.monthly / divisor;
          const next = src.payday ? nextPaydays(src.payday, src.cadence, 1)[0] : null;
          // round each transfer; checking absorbs the remainder so the paycheck stays whole
          const rdest = dests.map((d) => ({ ...d, amt: roundAmt(paycheckIncome * d.pct) }));
          const stays = Math.max(0, paycheckIncome - rdest.reduce((a, d) => a + d.amt, 0));
          return (
            <div key={i} className={i > 0 ? "pt-4 border-t border-slate-100" : ""}>
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-sm font-semibold text-slate-700">{src.name}</div>
                <div className="text-xs text-slate-400">
                  {perCheck ? CADENCE_LABEL[src.cadence] : "monthly"}
                  {next ? ` · next ${fmtDate(next)}` : ""} ·{" "}
                  <span className="font-mono text-slate-500">
                    {fmt(paycheckIncome)}
                    {suffix}
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                {rdest
                  .filter((d) => d.amt > 0.5)
                  .map((d) => (
                    <div key={d.key} className="flex items-center gap-3">
                      <span
                        className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                        style={{ background: d.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-700">{d.label}</div>
                        <div className="text-xs text-slate-400 truncate">→ {routeFor(d.key)}</div>
                      </div>
                      <span className="text-sm font-mono font-semibold text-slate-900">
                        {fmt(d.amt)}
                        <span className="text-slate-300 text-xs">{suffix}</span>
                      </span>
                    </div>
                  ))}
                {stays > 0.5 && (
                  <div className="flex items-center gap-3 pt-1">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-[#378ADD]" />
                    <div className="flex-1 text-sm text-slate-500">
                      Stays in checking · bills & spending
                    </div>
                    <span className="text-sm font-mono text-slate-500">
                      {fmt(stays)}
                      <span className="text-slate-300 text-xs">{suffix}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {sources.length > 1 && (
        <div className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-50">
          Each paycheck is split by the same plan percentages — set them up as automatic transfers
          on each payday.
        </div>
      )}
    </div>
  );
}
