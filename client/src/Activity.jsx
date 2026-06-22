// Activity.jsx — history view with two modes: calendar or list.
import { useState } from "react";
import { CalendarDays, List, Plus } from "lucide-react";
import { fmt } from "./lib/format.js";
import { pendingPaychecks } from "./lib/recurring.js";
import Calendar from "./Calendar.jsx";
import Ledger from "./Ledger.jsx";

/** Merged history view: one place, two ways to look at it (calendar or list). */
export default function Activity({ transactions, profile, sources, onDelete, onLog, onUpdate }) {
  const [view, setView] = useState("calendar");
  // expected paychecks this month that aren't logged yet → one-tap to log them all
  const pending = pendingPaychecks(profile, transactions);
  const pendingTotal = pending.reduce((s, t) => s + t.amount, 0);
  return (
    <>
      {pending.length > 0 && onLog && (
        <button
          onClick={() => onLog(pending)}
          className="press flex w-full items-center gap-2 rounded-xl bg-emerald-50 p-3 text-left text-sm text-emerald-800 hover:bg-emerald-100"
        >
          <Plus size={16} className="flex-shrink-0" />
          <span className="flex-1">
            Log {pending.length} expected paycheck{pending.length === 1 ? "" : "s"} this month (
            {fmt(pendingTotal)})
          </span>
        </button>
      )}
      <div className="flex gap-1 p-1 bg-white border border-slate-200 rounded-xl">
        {[
          ["calendar", "Calendar", CalendarDays],
          ["list", "List", List],
        ].map(([v, label, Icon]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium rounded-lg transition-colors ${view === v ? "bg-brand-100 text-brand-700" : "text-slate-500"}`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      {view === "calendar" ? (
        <Calendar transactions={transactions} profile={profile} />
      ) : (
        <Ledger
          transactions={transactions}
          sources={sources}
          onDelete={onDelete}
          onUpdate={onUpdate}
        />
      )}
    </>
  );
}
