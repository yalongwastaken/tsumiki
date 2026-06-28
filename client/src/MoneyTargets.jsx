// MoneyTargets.jsx — manage user-defined "save $X" goals with optional deadlines.
import { useState } from "react";
import Money, { BlurAmounts } from "./Money.jsx";
import { X } from "lucide-react";
import { fmt } from "./lib/format.js";
import { goalProgress } from "./lib/goals.js";
import { uid } from "./lib/uid.js";

const METRICS = [
  ["earmarked", "Earmarked savings"],
  ["net_worth", "Net worth"],
  ["contributed", "Total contributed"],
  ["emergency", "Emergency fund"],
];

/**
 * Manage user-defined "save $X" targets (add / remove) with progress + pace.
 * `values` maps each metric to its current dollar value so we can show how close
 * you are and what monthly saving lands a dated goal on time.
 */
export default function MoneyTargets({
  targets = [],
  values = {},
  earmarked = {},
  monthlyPace = null,
  onChange,
}) {
  const [form, setForm] = useState({ label: "", amount: "", metric: "earmarked", targetDate: "" });
  // current dollar value of a target's metric (per-goal balance for "earmarked")
  const currentOf = (t) =>
    t.metric === "earmarked" ? earmarked[t.id] || 0 : values[t.metric] || 0;
  function add() {
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      return;
    }
    onChange([
      ...targets,
      {
        id: uid(),
        label: form.label.trim() || `${fmt(amount)} ${metricLabel(form.metric)}`,
        amount,
        metric: form.metric,
        targetDate: form.targetDate || null,
      },
    ]);
    setForm({ label: "", amount: "", metric: "earmarked", targetDate: "" });
  }
  const metricLabel = (m) => METRICS.find(([v]) => v === m)?.[1] || m;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Your money goals
      </div>
      {targets.length > 0 && (
        <div className="divide-y divide-slate-50 mb-3">
          {targets.map((t) => {
            const cur = currentOf(t);
            const p = goalProgress(t, cur, new Date(), monthlyPace);
            return (
              <div key={t.id} className="py-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-700">
                    <BlurAmounts text={t.label} />{" "}
                    <span className="text-xs text-slate-500">· {metricLabel(t.metric)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-500">
                      <Money n={cur} />
                      <span className="text-slate-500">
                        {" "}
                        / <Money n={t.amount} />
                      </span>
                    </span>
                    <button
                      onClick={() => onChange(targets.filter((x) => x.id !== t.id))}
                      className="-m-1.5 flex h-11 w-11 items-center justify-center text-slate-400 hover:text-rose-500"
                      aria-label={`Remove ${t.label}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1.5">
                  <div
                    className={`h-full rounded-full ${p.reached ? "bg-emerald-500" : "bg-brand-500"}`}
                    style={{ width: `${p.pct * 100}%` }}
                  />
                </div>
                <div className="text-xs mt-1">
                  {p.reached ? (
                    <span className="text-emerald-600">Reached 🎉</span>
                  ) : p.overdue ? (
                    <span className="text-rose-500">
                      Target date passed — <Money n={p.remaining} /> to go.
                    </span>
                  ) : p.requiredMonthly ? (
                    <span className={p.onTrack ? "text-emerald-600" : "text-slate-500"}>
                      Save <Money n={p.requiredMonthly} />
                      /mo to hit it in {p.monthsLeft} mo.
                      {p.onTrack === true && " On track 🎉"}
                      {p.onTrack === false && monthlyPace > 0 && (
                        <BlurAmounts
                          text={` You're saving ~${fmt(monthlyPace)}/mo — ${fmt(p.behindBy)}/mo short.`}
                        />
                      )}
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      <Money n={p.remaining} /> to go.
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="Label (optional)"
          aria-label="Goal label"
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
        />
        <select
          value={form.metric}
          onChange={(e) => setForm({ ...form, metric: e.target.value })}
          aria-label="Goal metric"
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
        >
          {METRICS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {form.metric === "earmarked" && (
        <div className="mb-2 text-xs text-slate-500">
          Funded by tagging contributions “toward this goal” in the + Add sheet.
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">By (optional)</span>
        <input
          type="date"
          value={form.targetDate}
          onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
          aria-label="Goal target date"
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
        />
        <span className="text-xs text-slate-500">— adds a savings-pace target</span>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-2.5 text-slate-500 text-sm">$</span>
          <input
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="Target amount"
            aria-label="Target amount"
            className="w-full pl-7 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
          />
        </div>
        <button
          onClick={add}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
        >
          Add
        </button>
      </div>
    </div>
  );
}
