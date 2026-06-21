import { useState, useMemo } from "react";
import { fmt } from "./format.js";

// M1 — the personalization profile + accounts/debts the engine (M2) runs on.
// Single editable screen (MVP). SPEC.md §11.
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ACCOUNT_TYPES = ["checking", "savings", "brokerage", "ira", "other"];
const INCOME_TYPES = [
  ["salary", "Steady salary"],
  ["hourly", "Hourly / variable"],
  ["irregular", "Irregular mix"],
  ["none", "Little / none right now"],
];
const STRATEGIES = [
  ["short_term", "Safety first", "Kill debt + build a cash buffer before investing."],
  ["balanced", "Balanced", "Split between debt, safety, and investing."],
  ["long_term", "Growth first", "Push into retirement + investments aggressively."],
  ["custom", "Custom", "Define your own priorities later."],
];

const card = "bg-white rounded-xl border border-slate-200 p-4";
const label = "text-xs font-semibold text-slate-400 uppercase tracking-wider";
const field = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700";

function Money({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
      <input type="number" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={field + " pl-7"} />
    </div>
  );
}

export default function Setup({ data, onSave }) {
  const { profile = {}, accounts = [], debts = [], transactions = [], snapshots = [] } = data;

  // smart defaults derived from logged spending (SPEC.md §11)
  const avgMonthlySpend = useMemo(() => {
    const sp = transactions.filter((t) => t.type === "spending");
    if (!sp.length) return 0;
    const months = new Set(sp.map((t) => new Date(t.date).toISOString().slice(0, 7)));
    const total = sp.reduce((s, t) => s + t.amount, 0);
    return total / Math.max(1, months.size);
  }, [transactions]);
  const suggestEmergency = Math.round(avgMonthlySpend * 3);
  const suggestFloor = Math.round(avgMonthlySpend);

  // local profile form, committed with a Save button
  const [form, setForm] = useState({
    incomeType: profile.incomeType ?? "salary",
    typicalIncome: profile.typicalIncome ?? "",
    strategy: profile.strategy ?? "balanced",
    checkingFloor: profile.checkingFloor ?? "",
    emergencyTarget: profile.emergencyTarget ?? "",
    employerMatchPct: profile.employerMatch?.pct ?? "",
  });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v) => (v === "" || v == null ? null : Number(v));

  function saveProfile() {
    const next = {
      ...data,
      profile: {
        ...profile,
        incomeType: form.incomeType,
        typicalIncome: num(form.typicalIncome),
        strategy: form.strategy,
        checkingFloor: num(form.checkingFloor) ?? 0,
        emergencyTarget: num(form.emergencyTarget) ?? 0,
        employerMatch: form.employerMatchPct === "" ? null : { pct: Number(form.employerMatchPct) },
      },
    };
    onSave(next);
  }

  // accounts
  const [acct, setAcct] = useState({ name: "", type: "checking", balance: "" });
  function addAccount() {
    if (!acct.name.trim()) return;
    const id = uid();
    const next = { ...data, accounts: [...accounts, { id, name: acct.name.trim(), type: acct.type, color: "#94A3B8" }] };
    if (acct.balance !== "")
      next.snapshots = [...snapshots, { id: uid(), accountId: id, date: new Date().toISOString(), balance: Number(acct.balance) }];
    onSave(next);
    setAcct({ name: "", type: "checking", balance: "" });
  }
  function removeAccount(id) {
    onSave({ ...data, accounts: accounts.filter((a) => a.id !== id), snapshots: snapshots.filter((s) => s.accountId !== id) });
  }
  const latestBalance = (id) => {
    const ss = snapshots.filter((s) => s.accountId === id);
    if (!ss.length) return null;
    return ss.reduce((a, b) => (new Date(b.date) > new Date(a.date) ? b : a)).balance;
  };

  // debts
  const [debt, setDebt] = useState({ name: "", balance: "", apr: "", minPayment: "" });
  function addDebt() {
    if (!debt.name.trim()) return;
    onSave({
      ...data,
      debts: [...debts, { id: uid(), name: debt.name.trim(), balance: Number(debt.balance || 0), apr: Number(debt.apr || 0), minPayment: Number(debt.minPayment || 0) }],
    });
    setDebt({ name: "", balance: "", apr: "", minPayment: "" });
  }
  function removeDebt(id) {
    onSave({ ...data, debts: debts.filter((d) => d.id !== id) });
  }

  return (
    <>
      {/* Profile */}
      <div className={card}>
        <div className={label + " mb-3"}>Your profile</div>
        <div className="space-y-3">
          <div>
            <div className="text-sm text-slate-600 mb-1">Income type</div>
            <select value={form.incomeType} onChange={(e) => set("incomeType")(e.target.value)} className={field}>
              {INCOME_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <div className="text-sm text-slate-600 mb-1">Typical monthly income (estimate)</div>
            <Money value={form.typicalIncome} onChange={set("typicalIncome")} placeholder="e.g. 7000" />
          </div>
          <div>
            <div className="text-sm text-slate-600 mb-1">Strategy</div>
            <div className="grid grid-cols-2 gap-2">
              {STRATEGIES.map(([v, l, desc]) => (
                <button key={v} onClick={() => set("strategy")(v)} title={desc}
                  className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                    form.strategy === v ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                  <div className="font-medium">{l}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-sm text-slate-600 mb-1">Checking floor</div>
              <Money value={form.checkingFloor} onChange={set("checkingFloor")} placeholder={suggestFloor ? String(suggestFloor) : "1 mo expenses"} />
            </div>
            <div>
              <div className="text-sm text-slate-600 mb-1">Emergency target</div>
              <Money value={form.emergencyTarget} onChange={set("emergencyTarget")} placeholder={suggestEmergency ? String(suggestEmergency) : "3 mo expenses"} />
            </div>
          </div>
          {(suggestFloor > 0 || suggestEmergency > 0) && (
            <button onClick={() => setForm((f) => ({ ...f, checkingFloor: suggestFloor, emergencyTarget: suggestEmergency }))}
              className="text-xs text-indigo-600 hover:text-indigo-700">
              Use suggested from your spending ({fmt(suggestFloor)} / {fmt(suggestEmergency)})
            </button>
          )}
          <div>
            <div className="text-sm text-slate-600 mb-1">Employer 401k match % <span className="text-slate-400">(optional)</span></div>
            <input type="number" value={form.employerMatchPct} onChange={(e) => set("employerMatchPct")(e.target.value)} placeholder="e.g. 4" className={field} />
          </div>
          <button onClick={saveProfile} className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors">
            Save profile
          </button>
        </div>
      </div>

      {/* Accounts */}
      <div className={card}>
        <div className={label + " mb-3"}>Accounts</div>
        {accounts.length > 0 && (
          <div className="divide-y divide-slate-50 mb-3">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="text-sm text-slate-700">{a.name} <span className="text-xs text-slate-400">· {a.type}</span></div>
                  {latestBalance(a.id) != null && <div className="text-xs text-slate-400">{fmt(latestBalance(a.id))}</div>}
                </div>
                <button onClick={() => removeAccount(a.id)} className="text-slate-300 hover:text-rose-400 text-xs">✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input value={acct.name} onChange={(e) => setAcct({ ...acct, name: e.target.value })} placeholder="Account name" className={field} />
          <select value={acct.type} onChange={(e) => setAcct({ ...acct, type: e.target.value })} className={field}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <div className="flex-1"><Money value={acct.balance} onChange={(v) => setAcct({ ...acct, balance: v })} placeholder="Current balance (optional)" /></div>
          <button onClick={addAccount} className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg">Add</button>
        </div>
      </div>

      {/* Debts */}
      <div className={card}>
        <div className={label + " mb-3"}>Debts</div>
        {debts.length > 0 && (
          <div className="divide-y divide-slate-50 mb-3">
            {debts.map((d) => (
              <div key={d.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="text-sm text-slate-700">{d.name}</div>
                  <div className="text-xs text-slate-400">{fmt(d.balance)} · {d.apr}% APR · {fmt(d.minPayment)}/mo min</div>
                </div>
                <button onClick={() => removeDebt(d.id)} className="text-slate-300 hover:text-rose-400 text-xs">✕</button>
              </div>
            ))}
          </div>
        )}
        <input value={debt.name} onChange={(e) => setDebt({ ...debt, name: e.target.value })} placeholder="Debt name (e.g. Chase card)" className={field + " mb-2"} />
        <div className="grid grid-cols-3 gap-2 mb-2">
          <Money value={debt.balance} onChange={(v) => setDebt({ ...debt, balance: v })} placeholder="Balance" />
          <input type="number" value={debt.apr} onChange={(e) => setDebt({ ...debt, apr: e.target.value })} placeholder="APR %" className={field} />
          <Money value={debt.minPayment} onChange={(v) => setDebt({ ...debt, minPayment: v })} placeholder="Min/mo" />
        </div>
        <button onClick={addDebt} className="w-full py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg">Add debt</button>
      </div>
    </>
  );
}
