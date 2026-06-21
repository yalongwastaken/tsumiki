import { useState, useMemo, useRef, useEffect } from "react";
import { fmt } from "./format.js";
import { bucketLabel } from "./buckets.js";

// M3 — fast logging (SPEC §9). Always-available bottom sheet: amount first,
// frequency-sorted categories, recents to repeat. Goal: ~3 taps, <15s.
const TYPES = [
  ["spending", "Spending", "#F59E0B"],
  ["income", "Income", "#10B981"],
  ["contribution", "Contribution", "#6366F1"],
];
// contributions target an engine bucket; labels come from buckets.js (single source)
const BUCKET_KEYS = ["emergency", "retirement", "invest", "debt"];

export default function QuickAdd({ open, onClose, onLog, cats, sources = [], transactions }) {
  const [type, setType] = useState("spending");
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState(null);
  const [bucket, setBucket] = useState("invest");
  const [sourceId, setSourceId] = useState(null);
  const [note, setNote] = useState("");
  const amountRef = useRef(null);

  // categories sorted by how often you use them (most-used float to top)
  const orderedCats = useMemo(() => {
    const count = {};
    for (const t of transactions) if (t.type === "spending" && t.cat) count[t.cat] = (count[t.cat] || 0) + 1;
    const seen = new Set();
    const ranked = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const out = [];
    for (const c of ranked) { out.push(c); seen.add(c); }
    for (const c of cats) if (!seen.has(c)) out.push(c);
    return out;
  }, [transactions, cats]);

  // recent entries you can repeat in one tap
  const recents = useMemo(() => {
    const out = [], seen = new Set();
    for (const t of [...transactions].reverse()) {
      const sig = `${t.type}|${t.cat || t.bucket || ""}|${t.amount}`;
      if (seen.has(sig)) continue;
      seen.add(sig); out.push(t);
      if (out.length >= 4) break;
    }
    return out;
  }, [transactions]);

  // reset + focus when opened
  useEffect(() => {
    if (open) {
      setType("spending"); setAmount(""); setCat(orderedCats[0] || null); setBucket("invest"); setSourceId(sources[0]?.id || null); setNote("");
      setTimeout(() => amountRef.current?.focus(), 50);
    }
  }, [open]); // eslint-disable-line

  if (!open) return null;

  function repeat(t) {
    setType(t.type); setAmount(String(t.amount));
    if (t.type === "spending") setCat(t.cat);
    if (t.type === "contribution") setBucket(t.bucket || "invest");
    setNote(t.note || "");
  }
  function submit() {
    const n = parseFloat(amount);
    if (!(n > 0)) return;
    onLog({
      type, amount: n, note: note || null,
      cat: type === "spending" ? cat : null,
      bucket: type === "contribution" ? bucket : null,
      sourceId: type === "income" ? sourceId : null,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-t-2xl p-4 pb-6 shadow-xl"
        style={{ animation: "qa-up 160ms ease-out" }}>
        <style>{`@keyframes qa-up{from{transform:translateY(16px);opacity:.6}to{transform:translateY(0);opacity:1}}`}</style>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />

        {/* type toggle */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-4">
          {TYPES.map(([v, l, color]) => (
            <button key={v} onClick={() => setType(v)}
              className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${type === v ? "bg-white shadow-sm" : "text-slate-500"}`}
              style={type === v ? { color } : undefined}>{l}</button>
          ))}
        </div>

        {/* amount — first thing focused */}
        <div className="relative mb-4">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-slate-300">$</span>
          <input ref={amountRef} type="number" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="0" className="w-full pl-10 pr-3 py-3 text-3xl font-mono font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-xl" />
        </div>

        {/* context: categories / goals */}
        {type === "spending" && (
          <div className="flex flex-wrap gap-2 mb-4">
            {orderedCats.map((c) => (
              <button key={c} onClick={() => setCat(c)}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${cat === c ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-600"}`}>{c}</button>
            ))}
          </div>
        )}
        {type === "contribution" && (
          <div className="flex flex-wrap gap-2 mb-4">
            {BUCKET_KEYS.map((v) => (
              <button key={v} onClick={() => setBucket(v)}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${bucket === v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}>{bucketLabel(v)}</button>
            ))}
          </div>
        )}
        {type === "income" && sources.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {sources.map((s) => (
              <button key={s.id} onClick={() => setSourceId(s.id)}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${sourceId === s.id ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>{s.name}</button>
            ))}
          </div>
        )}
        {type === "income" && sources.length === 0 && (
          <div className="text-xs text-slate-400 mb-4">Tip: add income sources in Setup to tag where this came from.</div>
        )}

        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700 mb-4" />

        {/* recents to repeat */}
        {recents.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-slate-400 mb-1.5">Repeat recent</div>
            <div className="flex flex-wrap gap-2">
              {recents.map((t) => (
                <button key={t.id} onClick={() => repeat(t)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                  {fmt(t.amount)} · {t.type === "spending" ? t.cat : t.type === "contribution" ? bucketLabel(t.bucket) : "income"}
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={submit} disabled={!(parseFloat(amount) > 0)}
          className="w-full py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors">
          Log {amount && parseFloat(amount) > 0 ? fmt(parseFloat(amount)) : ""}
        </button>
      </div>
    </div>
  );
}
