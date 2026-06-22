// AccountsSection.jsx — bank/brokerage accounts + balance snapshots. Self-contained:
// owns its add-form + balance-edit state, commits via onSave.
import { useState, useMemo } from "react";
import { X, Pencil } from "lucide-react";
import { fmt } from "../lib/format.js";
import { uid, field, Money } from "./ui.jsx";

const ACCOUNT_TYPES = ["checking", "savings", "brokerage", "ira", "other"];

/** Accounts editor body (rendered inside the accordion Section). */
export default function AccountsSection({ data, onSave }) {
  const accounts = data.accounts || [];
  const snapshots = useMemo(() => data.snapshots || [], [data.snapshots]);
  const [acct, setAcct] = useState({ name: "", type: "checking", balance: "" });
  const [balEdit, setBalEdit] = useState({ id: null, value: "" });

  // latest balance per account (single pass)
  const latestBalances = useMemo(() => {
    const m = new Map();
    for (const s of snapshots) {
      const cur = m.get(s.accountId);
      if (!cur || new Date(s.date) > new Date(cur.date)) {
        m.set(s.accountId, s);
      }
    }
    return m;
  }, [snapshots]);
  const latestBalance = (id) => (latestBalances.has(id) ? latestBalances.get(id).balance : null);

  function addAccount() {
    if (!acct.name.trim()) {
      return;
    }
    const id = uid();
    const next = {
      ...data,
      accounts: [...accounts, { id, name: acct.name.trim(), type: acct.type, color: "#94A3B8" }],
    };
    if (acct.balance !== "") {
      next.snapshots = [
        ...snapshots,
        { id: uid(), accountId: id, date: new Date().toISOString(), balance: Number(acct.balance) },
      ];
    }
    onSave(next);
    setAcct({ name: "", type: "checking", balance: "" });
  }
  function removeAccount(id) {
    onSave({
      ...data,
      accounts: accounts.filter((a) => a.id !== id),
      snapshots: snapshots.filter((s) => s.accountId !== id),
    });
  }
  function updateBalance(id) {
    const v = Number(balEdit.value);
    if (Number.isNaN(v) || balEdit.value === "") {
      return;
    }
    onSave({
      ...data,
      snapshots: [
        ...snapshots,
        { id: uid(), accountId: id, date: new Date().toISOString(), balance: v },
      ],
    });
    setBalEdit({ id: null, value: "" });
  }

  return (
    <>
      {accounts.length > 0 && (
        <div className="divide-y divide-slate-50 mb-3">
          {accounts.map((a) => (
            <div key={a.id} className="py-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-700">
                    {a.name} <span className="text-xs text-slate-400">· {a.type}</span>
                  </div>
                  {latestBalance(a.id) != null && (
                    <div className="text-xs text-slate-400">{fmt(latestBalance(a.id))}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setBalEdit(
                        balEdit.id === a.id ? { id: null, value: "" } : { id: a.id, value: "" },
                      )
                    }
                    className="text-slate-300 hover:text-brand-600"
                    aria-label="Update balance"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => removeAccount(a.id)}
                    className="text-slate-300 hover:text-rose-400"
                    aria-label="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              {balEdit.id === a.id && (
                <div className="flex gap-2 mt-2">
                  <div className="flex-1">
                    <Money
                      value={balEdit.value}
                      onChange={(v) => setBalEdit({ id: a.id, value: v })}
                      placeholder="New balance"
                    />
                  </div>
                  <button
                    onClick={() => updateBalance(a.id)}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <input
          value={acct.name}
          onChange={(e) => setAcct({ ...acct, name: e.target.value })}
          placeholder="Account name"
          className={field}
        />
        <select
          value={acct.type}
          onChange={(e) => setAcct({ ...acct, type: e.target.value })}
          className={field}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <Money
            value={acct.balance}
            onChange={(v) => setAcct({ ...acct, balance: v })}
            placeholder="Current balance (optional)"
          />
        </div>
        <button
          onClick={addAccount}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
        >
          Add
        </button>
      </div>
    </>
  );
}
