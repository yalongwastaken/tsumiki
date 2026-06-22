// DebtsSection.jsx — debts the engine prioritizes (balance, APR, min payment).
// Self-contained: owns its form state, commits via onSave.
import { useState } from "react";
import { X } from "lucide-react";
import { fmt } from "../lib/format.js";
import { uid, field, Money } from "./ui.jsx";

/** Debts editor body (rendered inside the accordion Section). */
export default function DebtsSection({ data, onSave }) {
  const debts = data.debts || [];
  const [debt, setDebt] = useState({ name: "", balance: "", apr: "", minPayment: "" });

  function addDebt() {
    if (!debt.name.trim()) {
      return;
    }
    onSave({
      ...data,
      debts: [
        ...debts,
        {
          id: uid(),
          name: debt.name.trim(),
          balance: Number(debt.balance || 0),
          apr: Number(debt.apr || 0),
          minPayment: Number(debt.minPayment || 0),
        },
      ],
    });
    setDebt({ name: "", balance: "", apr: "", minPayment: "" });
  }
  function removeDebt(id) {
    onSave({ ...data, debts: debts.filter((d) => d.id !== id) });
  }

  return (
    <>
      {debts.length > 0 && (
        <div className="divide-y divide-slate-50 mb-3">
          {debts.map((d) => (
            <div key={d.id} className="flex items-center justify-between py-2.5">
              <div>
                <div className="text-sm text-slate-700">{d.name}</div>
                <div className="text-xs text-slate-400">
                  {fmt(d.balance)} · {d.apr}% APR · {fmt(d.minPayment)}/mo min
                </div>
              </div>
              <button
                onClick={() => removeDebt(d.id)}
                className="-m-1 flex h-9 w-9 items-center justify-center text-slate-300 hover:text-rose-400"
                aria-label="Remove"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        value={debt.name}
        onChange={(e) => setDebt({ ...debt, name: e.target.value })}
        placeholder="Debt name (e.g. Chase card)"
        className={field + " mb-2"}
      />
      <div className="grid grid-cols-3 gap-2 mb-2">
        <Money
          value={debt.balance}
          onChange={(v) => setDebt({ ...debt, balance: v })}
          placeholder="Balance"
        />
        <input
          type="number"
          value={debt.apr}
          onChange={(e) => setDebt({ ...debt, apr: e.target.value })}
          placeholder="APR %"
          className={field}
        />
        <Money
          value={debt.minPayment}
          onChange={(v) => setDebt({ ...debt, minPayment: v })}
          placeholder="Min/mo"
        />
      </div>
      <button
        onClick={addDebt}
        className="w-full py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
      >
        Add debt
      </button>
    </>
  );
}
