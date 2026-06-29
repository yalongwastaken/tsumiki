// QuickAdd.jsx — fast-logging bottom sheet (amount first, ~3 taps, <15s).
import { useState, useMemo, useRef, useEffect } from "react";
import Money, { BlurAmounts } from "./Money.jsx";
import { Ban } from "lucide-react";
import { bucketLabel } from "../lib/plan/buckets.js";
import { useFocusTrap } from "../useFocusTrap.js";

export const NO_SPEND_CAT = "No-spend day";

// amount first, frequency-sorted categories, recents to repeat
// selected-tab label colors are the -700 shades so the text clears WCAG AA on the
// white pill (the lighter brand hues failed contrast)
const TYPES = [
  ["spending", "Spending", "#B45309"],
  ["income", "Income", "#047857"],
  ["contribution", "Contribution", "#4F46E5"],
  ["transfer", "Transfer", "#0E7490"],
];
// contributions target an engine bucket; labels come from buckets.js (single source)
const BUCKET_KEYS = ["emergency", "retirement", "invest", "debt"];

/** Always-available bottom sheet for logging spending / income / contributions fast. */
export default function QuickAdd({
  open,
  onClose,
  onLog,
  cats,
  sources = [],
  goals = [],
  accounts = [],
  transactions,
}) {
  const [type, setType] = useState("spending");
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState(null);
  const [bucket, setBucket] = useState("invest");
  const [sourceId, setSourceId] = useState(null);
  const [goalId, setGoalId] = useState(null);
  const [fromId, setFromId] = useState(null);
  const [toId, setToId] = useState(null);
  const [note, setNote] = useState("");
  const amountRef = useRef(null);
  const panelRef = useFocusTrap(open, onClose); // trap Tab + Escape; restore focus on close

  // categories sorted by how often you use them (most-used float to top)
  const orderedCats = useMemo(() => {
    const count = {};
    for (const t of transactions) {
      // ignore no-spend days ($0) so they don't rank as a real category
      if (t.type === "spending" && t.cat && t.amount > 0 && t.cat !== NO_SPEND_CAT) {
        count[t.cat] = (count[t.cat] || 0) + 1;
      }
    }
    const seen = new Set();
    const ranked = Object.entries(count)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
    const out = [];
    for (const c of ranked) {
      out.push(c);
      seen.add(c);
    }
    for (const c of cats) {
      if (!seen.has(c)) {
        out.push(c);
      }
    }
    return out;
  }, [transactions, cats]);

  // recent entries you can repeat in one tap
  const recents = useMemo(() => {
    const out = [],
      seen = new Set();
    for (const t of [...transactions].reverse()) {
      // skip no-spend days — there's a dedicated button, no point repeating a $0
      if (t.type === "spending" && t.amount <= 0) {
        continue;
      }
      const sig = `${t.type}|${t.cat || t.bucket || ""}|${t.amount}`;
      if (seen.has(sig)) {
        continue;
      }
      seen.add(sig);
      out.push(t);
      if (out.length >= 4) {
        break;
      }
    }
    return out;
  }, [transactions]);

  // reset + focus when opened
  useEffect(() => {
    if (open) {
      setType("spending");
      setAmount("");
      setCat(orderedCats[0] || null);
      setBucket("invest");
      setSourceId(sources[0]?.id || null);
      setGoalId(null);
      setFromId(accounts[0]?.id || null);
      setToId(accounts[1]?.id || accounts[0]?.id || null);
      setNote("");
      setTimeout(() => amountRef.current?.focus(), 50);
    }
  }, [open]); // eslint-disable-line

  if (!open) {
    return null;
  }

  function repeat(t) {
    setType(t.type);
    setAmount(String(t.amount));
    if (t.type === "spending") {
      setCat(t.cat);
    }
    if (t.type === "contribution") {
      setBucket(t.bucket || "invest");
    }
    setGoalId(t.type === "contribution" ? t.goalId || null : null);
    setNote(t.note || "");
  }
  function submit() {
    const n = parseFloat(amount);
    if (!(n > 0)) {
      return;
    }
    // a transfer needs two distinct accounts to move between
    if (type === "transfer" && (!fromId || !toId || fromId === toId)) {
      return;
    }
    onLog({
      type,
      amount: n,
      note: note || null,
      cat: type === "spending" ? cat : null,
      bucket: type === "contribution" ? bucket : null,
      goalId: type === "contribution" ? goalId : null,
      sourceId: type === "income" ? sourceId : null,
      fromId: type === "transfer" ? fromId : null,
      toId: type === "transfer" ? toId : null,
    });
    onClose();
  }
  // log a day with no spending — keeps your logging streak without an amount
  function logNoSpend() {
    onLog({ type: "spending", amount: 0, cat: NO_SPEND_CAT, note: note || null });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Log a transaction"
    >
      <div className="anim-fade absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div
        ref={panelRef}
        className="relative w-full max-w-lg bg-white rounded-t-2xl p-4 pb-6 shadow-xl max-h-[90vh] overflow-y-auto"
        style={{ animation: "qa-up 160ms ease-out" }}
      >
        <style>{`@keyframes qa-up{from{transform:translateY(16px);opacity:.6}to{transform:translateY(0);opacity:1}}`}</style>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />

        {/* type toggle */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-4">
          {TYPES.map(([v, l, color]) => (
            <button
              key={v}
              onClick={() => setType(v)}
              aria-pressed={type === v}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${type === v ? "bg-white dark:bg-slate-600 shadow-sm" : "text-slate-500"}`}
              style={type === v ? { color } : undefined}
            >
              {l}
            </button>
          ))}
        </div>

        {/* amount — first thing focused */}
        <div className="relative mb-4">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-slate-400">
            $
          </span>
          <input
            ref={amountRef}
            type="number"
            inputMode="decimal"
            aria-label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="0"
            className="w-full pl-10 pr-3 py-3 text-3xl font-mono font-bold text-slate-900 bg-slate-50 border border-slate-200 rounded-xl"
          />
        </div>

        {/* context: categories / goals */}
        {type === "spending" && (
          <div className="flex flex-wrap gap-2 mb-4">
            {orderedCats.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                aria-pressed={cat === c}
                className={`px-3 py-2 text-sm rounded-full border transition-colors ${cat === c ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-600"}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {type === "contribution" && (
          <div className="flex flex-wrap gap-2 mb-4">
            {BUCKET_KEYS.map((v) => (
              <button
                key={v}
                onClick={() => setBucket(v)}
                aria-pressed={bucket === v}
                className={`px-3 py-2 text-sm rounded-full border transition-colors ${bucket === v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}
              >
                {bucketLabel(v)}
              </button>
            ))}
          </div>
        )}
        {/* optionally earmark a contribution toward a specific goal */}
        {type === "contribution" && goals.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-slate-500 mb-1.5">Toward a goal (optional)</div>
            <div className="flex flex-wrap gap-2">
              {goals.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGoalId(goalId === g.id ? null : g.id)}
                  aria-pressed={goalId === g.id}
                  title={g.label}
                  className={`max-w-[12rem] truncate px-3 py-2 text-sm rounded-full border transition-colors ${goalId === g.id ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}
                >
                  <BlurAmounts text={g.label} />
                </button>
              ))}
            </div>
          </div>
        )}
        {type === "income" && sources.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {sources.map((s) => (
              <button
                key={s.id}
                onClick={() => setSourceId(s.id)}
                aria-pressed={sourceId === s.id}
                className={`px-3 py-2 text-sm rounded-full border transition-colors ${sourceId === s.id ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        {type === "income" && sources.length === 0 && (
          <div className="text-xs text-slate-500 mb-4">
            Tip: add income sources in Setup to tag where this came from.
          </div>
        )}
        {type === "transfer" &&
          (accounts.length >= 2 ? (
            <div className="mb-4 flex items-center gap-2">
              <select
                value={fromId || ""}
                onChange={(e) => setFromId(e.target.value)}
                aria-label="From account"
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <span className="text-slate-400" aria-hidden="true">
                →
              </span>
              <select
                value={toId || ""}
                onChange={(e) => setToId(e.target.value)}
                aria-label="To account"
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="text-xs text-slate-500 mb-4">
              Add at least two accounts in Accounts to record a transfer between them.
            </div>
          ))}

        <input
          type="text"
          aria-label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700 mb-4"
        />

        {/* recents to repeat */}
        {recents.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-slate-500 mb-1.5">Repeat recent</div>
            <div className="flex flex-wrap gap-2">
              {recents.map((t) => (
                <button
                  key={t.id}
                  onClick={() => repeat(t)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
                >
                  <Money n={t.amount} /> ·{" "}
                  {t.type === "spending"
                    ? t.cat
                    : t.type === "contribution"
                      ? bucketLabel(t.bucket)
                      : "income"}
                </button>
              ))}
            </div>
          </div>
        )}

        {type === "spending" && !(parseFloat(amount) > 0) && (
          <button
            onClick={logNoSpend}
            className="w-full py-2 mb-2 text-sm text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-50 inline-flex items-center justify-center gap-1.5"
          >
            <Ban size={14} /> Log a no-spend day
          </button>
        )}
        <button
          onClick={submit}
          disabled={!(parseFloat(amount) > 0)}
          className="press w-full py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          Log {amount && parseFloat(amount) > 0 ? <Money n={parseFloat(amount)} /> : ""}
        </button>
      </div>
    </div>
  );
}
