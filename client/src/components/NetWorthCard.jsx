// NetWorthCard.jsx — records a current-net-worth balance snapshot (the starting point).
import { useState } from "react";

/** Input + button that records the user's current net worth as a balance snapshot. */
export default function NetWorthCard({ realNetWorth, onSet }) {
  const [v, setV] = useState("");
  const [msg, setMsg] = useState(null); // {tone:"error"|"ok", text}
  function submit() {
    const n = parseFloat(v);
    if (Number.isNaN(n)) {
      setMsg({ tone: "error", text: "Enter a dollar amount first." });
      return;
    }
    onSet(n);
    setV("");
    setMsg({ tone: "ok", text: "Saved your starting net worth." });
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Starting point
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-600 flex-1">
          Record your current net worth (a balance snapshot)
        </span>
        <div className="relative" style={{ width: 130 }}>
          <span className="absolute left-3 top-2.5 text-slate-500 text-sm">$</span>
          <input
            type="number"
            aria-label="Current net worth"
            placeholder={String(Math.round(Number.isFinite(realNetWorth) ? realNetWorth : 0))}
            value={v}
            onChange={(e) => {
              setV(e.target.value);
              if (msg) {
                setMsg(null);
              }
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full pl-7 pr-2 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700"
          />
        </div>
        <button
          onClick={submit}
          className="px-3 py-2 text-sm font-semibold text-white rounded-lg bg-brand-600 hover:bg-brand-700"
        >
          Set
        </button>
      </div>
      {msg && (
        <div
          role={msg.tone === "error" ? "alert" : "status"}
          className={`mt-2 text-xs ${msg.tone === "error" ? "text-rose-600" : "text-emerald-600"}`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
