// BillsSection.jsx — recurring essentials (inform-only; reserved before the plan
// allocates). Self-contained: owns its form state, commits via onSave, and offers
// to add charges that look recurring in the ledger.
import { useState } from "react";
import Cash from "../components/Money.jsx";
import { X } from "lucide-react";
import { detectRecurring } from "../lib/insights.js";
import { uid, field, Money } from "./ui.jsx";

const ordinal = (n) =>
  n % 10 === 1 && n !== 11
    ? "st"
    : n % 10 === 2 && n !== 12
      ? "nd"
      : n % 10 === 3 && n !== 13
        ? "rd"
        : "th";

/** Recurring-bills editor body (rendered inside the accordion Section). */
export default function BillsSection({ data, onSave }) {
  const profile = data.profile || {};
  const transactions = data.transactions || [];
  const bills = profile.bills || [];
  const [bill, setBill] = useState({ name: "", amount: "", dayOfMonth: "" });
  // charges that look recurring but aren't billed yet — offer to add them
  const detected = detectRecurring(transactions, bills);

  function addBill() {
    if (!bill.name.trim()) {
      return;
    }
    const day = Number(bill.dayOfMonth);
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
            dayOfMonth: day >= 1 && day <= 31 ? day : null,
          },
        ],
      },
    });
    setBill({ name: "", amount: "", dayOfMonth: "" });
  }
  function removeBill(id) {
    onSave({ ...data, profile: { ...profile, bills: bills.filter((b) => b.id !== id) } });
  }
  function addDetectedBill(d) {
    onSave({
      ...data,
      profile: {
        ...profile,
        bills: [...bills, { id: uid(), name: d.label, amount: d.amount, dayOfMonth: null }],
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
                    · <Cash n={d.amount} /> · {d.months} months
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
          {bills.map((b) => (
            <div key={b.id} className="flex items-center justify-between py-2">
              <div className="text-sm text-slate-700">
                {b.name}
                {b.dayOfMonth ? (
                  <span className="text-xs text-slate-500">
                    {" "}
                    · due {b.dayOfMonth}
                    {ordinal(b.dayOfMonth)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-slate-500">
                  <Cash n={b.amount} />
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
          ))}
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
          <Money
            value={bill.amount}
            onChange={(v) => setBill({ ...bill, amount: v })}
            placeholder="/mo"
          />
        </div>
        <input
          type="number"
          min="1"
          max="31"
          value={bill.dayOfMonth}
          onChange={(e) => setBill({ ...bill, dayOfMonth: e.target.value })}
          placeholder="day"
          className={field}
          style={{ width: 64 }}
        />
        <button
          onClick={addBill}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
        >
          Add
        </button>
      </div>
      <div className="text-xs text-slate-500 mt-2">
        Reserved before the plan allocates. Not logged — you still log real spending.
      </div>
    </>
  );
}
