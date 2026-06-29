// BillsSection.jsx — recurring essentials (inform-only; reserved before the plan
// allocates). Self-contained: owns its form state, commits via onSave, and offers
// to add charges that look recurring in the ledger.
import { useState } from "react";
import Money from "../components/Money.jsx";
import { X } from "lucide-react";
import { detectRecurring } from "../lib/insights/insights.js";
import { scheduleLabel } from "../lib/plan/billdates.js";
import { uid, field, AmountInput } from "./ui.jsx";

const WEEKDAYS = [
  ["1", "Monday"],
  ["2", "Tuesday"],
  ["3", "Wednesday"],
  ["4", "Thursday"],
  ["5", "Friday"],
  ["6", "Saturday"],
  ["0", "Sunday"],
];
const NTHS = [
  ["1", "First"],
  ["2", "Second"],
  ["3", "Third"],
  ["4", "Fourth"],
  ["5", "Last"], // "5" reads as last; stored as a lastWeekday below
];

const blank = { name: "", amount: "", kind: "day", day: "", n: "1", weekday: "1" };

// turn the form's flat fields into a stored schedule descriptor (or null)
function buildDue(b) {
  switch (b.kind) {
    case "day": {
      const day = Number(b.day);
      return day >= 1 && day <= 31 ? { kind: "day", day } : null;
    }
    case "lastDay":
      return { kind: "lastDay" };
    case "lastBusinessDay":
      return { kind: "lastBusinessDay" };
    case "weekday": {
      const weekday = Number(b.weekday);
      return b.n === "5"
        ? { kind: "lastWeekday", weekday }
        : { kind: "nthWeekday", n: Number(b.n), weekday };
    }
    default:
      return null;
  }
}

/** Recurring-bills editor body (rendered inside the accordion Section). */
export default function BillsSection({ data, onSave }) {
  const profile = data.profile || {};
  const transactions = data.transactions || [];
  const bills = profile.bills || [];
  const [bill, setBill] = useState(blank);
  // charges that look recurring but aren't billed yet — offer to add them
  const detected = detectRecurring(transactions, bills);

  function addBill() {
    if (!bill.name.trim()) {
      return;
    }
    onSave({
      ...data,
      profile: {
        ...profile,
        bills: [
          ...bills,
          {
            id: uid(),
            name: bill.name.trim(),
            amount: Number(bill.amount || 0),
            due: buildDue(bill),
          },
        ],
      },
    });
    setBill(blank);
  }
  function removeBill(id) {
    onSave({ ...data, profile: { ...profile, bills: bills.filter((b) => b.id !== id) } });
  }
  function addDetectedBill(d) {
    onSave({
      ...data,
      profile: {
        ...profile,
        bills: [...bills, { id: uid(), name: d.label, amount: d.amount, due: null }],
      },
    });
  }

  return (
    <>
      {detected.length > 0 && (
        <div className="mb-3 rounded-lg bg-brand-50 p-3">
          <div className="text-xs font-medium text-brand-700 mb-2">
            Looks recurring in your spending — add as bills?
          </div>
          <div className="space-y-1.5">
            {detected.map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-slate-700 flex-1 truncate">
                  {d.label}{" "}
                  <span className="text-xs text-slate-500">
                    · <Money n={d.amount} /> · {d.months} months
                  </span>
                </span>
                <button
                  onClick={() => addDetectedBill(d)}
                  className="text-xs font-medium text-brand-700 border border-brand-300 rounded-lg px-2 py-0.5 hover:bg-brand-100"
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {bills.length > 0 && (
        <div className="divide-y divide-slate-50 mb-3">
          {bills.map((b) => {
            const label = scheduleLabel(b);
            return (
              <div key={b.id} className="flex items-center justify-between py-2">
                <div className="text-sm text-slate-700">
                  {b.name}
                  {label ? <span className="text-xs text-slate-500"> · due {label}</span> : null}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-slate-500">
                    <Money n={b.amount} />
                  </span>
                  <button
                    onClick={() => removeBill(b.id)}
                    className="-m-1 flex h-9 w-9 items-center justify-center text-slate-400 hover:text-rose-400"
                    aria-label="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={bill.name}
          onChange={(e) => setBill({ ...bill, name: e.target.value })}
          placeholder="Bill (e.g. Rent)"
          className={field + " flex-1"}
        />
        <div className="relative" style={{ width: 100 }}>
          <AmountInput
            value={bill.amount}
            onChange={(v) => setBill({ ...bill, amount: v })}
            placeholder="/mo"
          />
        </div>
        <button
          onClick={addBill}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
        >
          Add
        </button>
      </div>
      {/* schedule picker — fixed day, last (business) day, or an Nth/last weekday */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={bill.kind}
          onChange={(e) => setBill({ ...bill, kind: e.target.value })}
          aria-label="Bill schedule"
          className={field}
        >
          <option value="day">Day of month</option>
          <option value="lastDay">Last day</option>
          <option value="lastBusinessDay">Last business day</option>
          <option value="weekday">Nth weekday</option>
        </select>
        {bill.kind === "day" && (
          <input
            type="number"
            min="1"
            max="31"
            value={bill.day}
            onChange={(e) => setBill({ ...bill, day: e.target.value })}
            placeholder="day"
            aria-label="Day of month"
            className={field}
            style={{ width: 64 }}
          />
        )}
        {bill.kind === "weekday" && (
          <>
            <select
              value={bill.n}
              onChange={(e) => setBill({ ...bill, n: e.target.value })}
              aria-label="Which week"
              className={field}
            >
              {NTHS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select
              value={bill.weekday}
              onChange={(e) => setBill({ ...bill, weekday: e.target.value })}
              aria-label="Weekday"
              className={field}
            >
              {WEEKDAYS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div className="text-xs text-slate-500 mt-2">
        Reserved before the plan allocates. Not logged — you still log real spending.
      </div>
    </>
  );
}
