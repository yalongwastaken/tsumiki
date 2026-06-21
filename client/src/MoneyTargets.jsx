// MoneyTargets.jsx — manage user-defined "save $X" goals (the gamified targets).
import { useState } from "react";
import { X } from "lucide-react";
import { fmt } from "./format.js";

// progress + celebration come via the milestones engine; this just manages the list
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const METRICS = [
  ["net_worth", "Net worth"],
  ["contributed", "Total contributed"],
  ["emergency", "Emergency fund"],
];

/** Manage the list of user-defined "save $X" targets (add / edit / remove). */
export default function MoneyTargets({ targets = [], onChange }) {
  const [form, setForm] = useState({ label: "", amount: "", metric: "net_worth" });
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
      },
    ]);
    setForm({ label: "", amount: "", metric: "net_worth" });
  }
  const metricLabel = (m) => METRICS.find(([v]) => v === m)?.[1] || m;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Your money goals
      </div>
      {targets.length > 0 && (
        <div className="divide-y divide-slate-50 mb-3">
          {targets.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-2">
              <div className="text-sm text-slate-700">
                {t.label} <span className="text-xs text-slate-400">· {metricLabel(t.metric)}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-slate-500">{fmt(t.amount)}</span>
                <button
                  onClick={() => onChange(targets.filter((x) => x.id !== t.id))}
                  className="text-slate-300 hover:text-rose-400"
                  aria-label="Remove"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="Label (optional)"
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
        />
        <select
          value={form.metric}
          onChange={(e) => setForm({ ...form, metric: e.target.value })}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
        >
          {METRICS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
          <input
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="Target amount"
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
