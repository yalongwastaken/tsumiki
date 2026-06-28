// Ledger.jsx — transaction list with type filter, text search, and bulk
// recategorize (select multiple spending rows → set a new category).
import { useState } from "react";
import Money from "./Money.jsx";
import { X, Check } from "lucide-react";
import { bucketLabel } from "./lib/buckets.js";
import { allCategories } from "./lib/categories.js";

/** Read-only ledger with filter/search/delete + bulk recategorize of spending. */
export default function Ledger({ transactions, sources, onDelete, onUpdate }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [bulkCat, setBulkCat] = useState("");

  const sourceName = (id) => sources.find((s) => s.id === id)?.name || "income";
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

  const q = query.trim().toLowerCase();
  const rows = [...transactions]
    .filter((t) => filter === "all" || t.type === filter)
    .filter(
      (t) =>
        !q ||
        meta(t).toLowerCase().includes(q) ||
        (t.note || "").toLowerCase().includes(q) ||
        String(t.amount).includes(q),
    )
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function applyBulk() {
    const cat = bulkCat.trim();
    if (!cat || !selected.size || !onUpdate) {
      return;
    }
    onUpdate([...selected], { cat });
    setSelected(new Set());
    setBulkCat("");
  }

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
            onClick={() => {
              setFilter(v);
              setSelected(new Set()); // avoid acting on now-hidden rows
            }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${filter === v ? "bg-slate-100 text-slate-800" : "text-slate-500"}`}
          >
            {l}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(new Set()); // selection follows the visible rows
        }}
        placeholder="Search category, note, or amount…"
        aria-label="Search transactions"
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
      />

      {/* bulk recategorize bar — appears once spending rows are selected */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-brand-50 p-2.5">
          <span className="text-xs text-brand-700 flex-shrink-0">{selected.size} selected</span>
          <input
            value={bulkCat}
            onChange={(e) => setBulkCat(e.target.value)}
            placeholder="New category"
            aria-label="New category for selected"
            list="tsumiki-ledger-cats"
            className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-brand-200 rounded-lg bg-white text-slate-700"
          />
          <datalist id="tsumiki-ledger-cats">
            {allCategories(transactions).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button
            onClick={applyBulk}
            className="flex-shrink-0 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg"
          >
            Apply
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="flex-shrink-0 text-xs text-brand-700"
          >
            Clear
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          {transactions.length === 0 ? (
            <>
              Nothing logged yet. Tap <span className="font-semibold text-brand-600">+</span> to
              start.
            </>
          ) : (
            "No transactions match."
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-50">
          {rows.map((t) => {
            const selectable = t.type === "spending" && !!onUpdate;
            return (
              <div key={t.id} className="flex items-center gap-2 px-4 py-2.5">
                {selectable && (
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    aria-label={`Select ${meta(t)}`}
                    className="flex-shrink-0 accent-brand-600"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-700 truncate">{meta(t)}</div>
                  {t.note && <div className="text-xs text-slate-500 truncate">{t.note}</div>}
                  <div className="text-xs text-slate-400">
                    {new Date(t.date).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {t.type === "spending" && t.amount === 0 ? (
                    <span className="text-xs text-emerald-600 inline-flex items-center gap-1">
                      no spend <Check size={12} />
                    </span>
                  ) : (
                    <span className={`text-sm font-mono ${color(t)}`}>
                      {t.type === "spending" ? "−" : "+"}
                      <Money n={t.amount} />
                    </span>
                  )}
                  <button
                    onClick={() => onDelete(t.id)}
                    aria-label="Delete"
                    className="-m-1 flex h-9 w-9 items-center justify-center text-slate-400 hover:text-rose-400"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
