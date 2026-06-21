// Ledger.jsx — read-only transaction list with filter + delete.
import { useState } from "react";
import { X } from "lucide-react";
import { fmt } from "./format.js";
import { bucketLabel } from "./buckets.js";

/** Read-only ledger (logging happens via the + button). Filter + delete. */
export default function Ledger({ transactions, sources, onDelete }) {
  const [filter, setFilter] = useState("all");
  const sourceName = (id) => sources.find((s) => s.id === id)?.name || "income";
  const rows = [...transactions]
    .filter((t) => filter === "all" || t.type === filter)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const meta = (t) =>
    t.type === "spending"
      ? t.cat || "Spending"
      : t.type === "income"
        ? sourceName(t.sourceId)
        : bucketLabel(t.bucket);
  const color = (t) =>
    t.type === "income"
      ? "text-emerald-600"
      : t.type === "contribution"
        ? "text-brand-600"
        : "text-slate-700";
  return (
    <>
      <div className="flex gap-1 p-1 bg-white border border-slate-200 rounded-xl">
        {[
          ["all", "All"],
          ["income", "Income"],
          ["spending", "Spending"],
          ["contribution", "Saved"],
        ].map(([v, l]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${filter === v ? "bg-slate-100 text-slate-800" : "text-slate-500"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          Nothing logged yet. Tap <span className="font-semibold text-brand-600">+</span> to start.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-50">
          {rows.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-2.5">
              <div>
                <div className="text-sm text-slate-700">{meta(t)}</div>
                {t.note && <div className="text-xs text-slate-400">{t.note}</div>}
                <div className="text-xs text-slate-300">
                  {new Date(t.date).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {t.type === "spending" && t.amount === 0 ? (
                  <span className="text-xs text-emerald-600">no spend ✓</span>
                ) : (
                  <span className={`text-sm font-mono ${color(t)}`}>
                    {t.type === "spending" ? "−" : "+"}
                    {fmt(t.amount)}
                  </span>
                )}
                <button
                  onClick={() => onDelete(t.id)}
                  aria-label="Delete"
                  className="text-slate-300 hover:text-rose-400"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
