import { useState } from "react";
import { CalendarDays, List } from "lucide-react";
import Calendar from "./Calendar.jsx";
import Ledger from "./Ledger.jsx";

// Merged history view: one place, two ways to look at it (calendar or list).
export default function Activity({ transactions, profile, sources, onDelete }) {
  const [view, setView] = useState("calendar");
  return (
    <>
      <div className="flex gap-1 p-1 bg-white border border-slate-200 rounded-xl">
        {[["calendar", "Calendar", CalendarDays], ["list", "List", List]].map(([v, label, Icon]) => (
          <button key={v} onClick={() => setView(v)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium rounded-lg transition-colors ${view === v ? "bg-brand-100 text-brand-700" : "text-slate-500"}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>
      {view === "calendar"
        ? <Calendar transactions={transactions} profile={profile} />
        : <Ledger transactions={transactions} sources={sources} onDelete={onDelete} />}
    </>
  );
}
