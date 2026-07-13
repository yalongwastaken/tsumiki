// DebtsSection.jsx — debts the engine prioritizes (balance, APR, min payment).
// Self-contained: owns its form state, commits via onSave.
import { useState } from "react";
import Money from "../components/Money.jsx";
import { X } from "lucide-react";
import { uid, field, AmountInput } from "./ui.jsx";

/** Debts editor body (rendered inside the accordion Section). */
export default function DebtsSection({ data, onSave, onSaveEntity, onDeleteEntity }) {
  const debts = data.debts || [];
  const [debt, setDebt] = useState({ name: "", balance: "", apr: "", minPayment: "" });
  // deleting a debt is destructive → in-app two-tap confirm (AUDIT M10)
  const [confirmId, setConfirmId] = useState(null);

  function addDebt() {
    if (!debt.name.trim()) {
      return;
    }
    const item = {
      id: uid(),
      name: debt.name.trim(),
      balance: Number(debt.balance || 0),
      apr: Number(debt.apr || 0),
      minPayment: Number(debt.minPayment || 0),
    };
    // one-row upsert via PATCH /api/debts/:id when available (no full-state rewrite)
    if (onSaveEntity) {
      onSaveEntity("debts", item);
    } else {
      onSave((d) => ({ ...d, debts: [...(d.debts || []), item] }));
    }
    setDebt({ name: "", balance: "", apr: "", minPayment: "" });
  }
  function removeDebt(id) {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId((c) => (c === id ? null : c)), 4000); // disarm
      return;
    }
    setConfirmId(null);
    if (onDeleteEntity) {
      onDeleteEntity("debts", id);
    } else {
      onSave((d) => ({ ...d, debts: (d.debts || []).filter((x) => x.id !== id) }));
    }
  }

  return (
    <>
      {debts.length > 0 && (
        <div className="divide-y divide-slate-50 mb-3">
          {debts.map((d) => (
            <div key={d.id} className="flex items-center justify-between py-2.5">
              <div>
                <div className="text-sm text-slate-700">{d.name}</div>
                <div className="text-xs text-slate-500">
                  <Money n={d.balance} /> · {d.apr}% APR · <Money n={d.minPayment} />
                  /mo min
                </div>
              </div>
              <button
                onClick={() => removeDebt(d.id)}
                className={
                  confirmId === d.id
                    ? "-m-1 flex h-9 items-center px-2 text-xs font-semibold text-rose-600"
                    : "-m-1 flex h-9 w-9 items-center justify-center text-slate-400 hover:text-rose-400"
                }
                aria-label={confirmId === d.id ? `Confirm: remove ${d.name}` : `Remove ${d.name}`}
              >
                {confirmId === d.id ? "Remove?" : <X size={14} />}
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
        <AmountInput
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
        <AmountInput
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
