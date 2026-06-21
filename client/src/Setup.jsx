import { useState, useMemo, useRef } from "react";
import { X } from "lucide-react";
import { fmt } from "./format.js";
import { importData, exportUrl } from "./api.js";

// M1 — the personalization profile + accounts/debts the engine (M2) runs on.
// Single editable screen (MVP). SPEC.md §11.
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ordinal = (n) => (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
const ACCOUNT_TYPES = ["checking", "savings", "brokerage", "ira", "other"];
const SOURCE_TYPES = ["salary", "hourly", "self_employed", "passive", "other"];
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

export default function Setup({ data, onSave, onReplayIntro, theme = "light", onSetTheme, section = "settings" }) {
  const { profile = {}, accounts = [], debts = [], transactions = [], snapshots = [] } = data;
  const incomeSources = profile.incomeSources || [];
  const totalTypical = incomeSources.reduce((s, x) => s + (x.typicalMonthly || 0), 0);

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
    name: profile.name ?? "",
    birthYear: profile.birthYear ?? "",
    retireAge: profile.retireAge ?? "",
    strategy: profile.strategy ?? "balanced",
    debtStrategy: profile.debtStrategy ?? "avalanche",
    checkingFloor: profile.checkingFloor ?? "",
    emergencyTarget: profile.emergencyTarget ?? "",
    employerMatchPct: profile.employerMatch?.pct ?? "",
    highApr: profile.highApr ?? "",
    iraLimit: profile.retirementLimits?.ira ?? profile.iraLimit ?? "",
  });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v) => (v === "" || v == null ? null : Number(v));

  function saveProfile() {
    const next = {
      ...data,
      profile: {
        ...profile,
        name: form.name.trim(),
        birthYear: num(form.birthYear),
        retireAge: num(form.retireAge),
        strategy: form.strategy,
        debtStrategy: form.debtStrategy,
        checkingFloor: num(form.checkingFloor) ?? 0,
        emergencyTarget: num(form.emergencyTarget) ?? 0,
        employerMatch: form.employerMatchPct === "" ? null : { pct: Number(form.employerMatchPct) },
        highApr: num(form.highApr),
        iraLimit: num(form.iraLimit),
      },
    };
    onSave(next);
  }

  // income sources (commit immediately; keep profile.typicalIncome = derived sum)
  const [src, setSrc] = useState({ name: "", type: "salary", basis: "annual", amount: "", hours: "40" });
  // convert any pay basis to a monthly figure
  const toMonthly = (s) => {
    const a = Number(s.amount || 0);
    if (s.basis === "annual") return Math.round(a / 12);
    if (s.basis === "hourly") return Math.round((a * Number(s.hours || 0) * 52) / 12);
    return Math.round(a); // monthly
  };
  const basisForType = (type) => (type === "hourly" ? "hourly" : type === "salary" ? "annual" : "monthly");
  function commitSources(list) {
    const total = list.reduce((s, x) => s + (x.typicalMonthly || 0), 0);
    onSave({ ...data, profile: { ...profile, incomeSources: list, typicalIncome: total } });
  }
  function addSource() {
    if (!src.name.trim()) return;
    commitSources([...incomeSources, { id: uid(), name: src.name.trim(), type: src.type, basis: src.basis, amount: Number(src.amount || 0), hours: Number(src.hours || 0), typicalMonthly: toMonthly(src) }]);
    setSrc({ name: "", type: "salary", basis: "annual", amount: "", hours: "40" });
  }
  const srcDetail = (s) => s.basis === "hourly" ? `$${s.amount}/hr · ${s.hours}h/wk` : s.basis === "annual" ? `${fmt(s.amount)}/yr` : `${fmt(s.amount)}/mo`;
  function removeSource(id) { commitSources(incomeSources.filter((s) => s.id !== id)); }

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

  // recurring bills (essentials — inform-only, A1/S4)
  const bills = profile.bills || [];
  const billsTotal = bills.reduce((s, b) => s + (b.amount || 0), 0);
  const [bill, setBill] = useState({ name: "", amount: "", dayOfMonth: "" });
  function addBill() {
    if (!bill.name.trim()) return;
    const day = Number(bill.dayOfMonth);
    onSave({ ...data, profile: { ...profile, bills: [...bills, { id: uid(), name: bill.name.trim(), amount: Number(bill.amount || 0), dayOfMonth: day >= 1 && day <= 31 ? day : null }] } });
    setBill({ name: "", amount: "", dayOfMonth: "" });
  }
  function removeBill(id) { onSave({ ...data, profile: { ...profile, bills: bills.filter((b) => b.id !== id) } }); }

  // backup: export (download) + import (replace)
  const fileRef = useRef(null);
  async function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!window.confirm("Import will REPLACE all current data. Continue?")) { e.target.value = ""; return; }
    try { await importData(JSON.parse(await file.text())); location.reload(); }
    catch (err) { window.alert("Import failed: " + (err.message || err)); }
    e.target.value = "";
  }

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
      {section === "accounts" && (<>
      {/* Income sources */}
      <div className={card}>
        <div className="flex items-baseline justify-between mb-3">
          <div className={label}>Income sources</div>
          <div className="text-xs text-slate-400">~{fmt(totalTypical)}/mo total</div>
        </div>
        {incomeSources.length > 0 && (
          <div className="divide-y divide-slate-50 mb-3">
            {incomeSources.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="text-sm text-slate-700">{s.name} <span className="text-xs text-slate-400">· {s.type.replace("_", " ")}</span></div>
                  <div className="text-xs text-slate-400">{s.basis ? `${srcDetail(s)} → ` : ""}~{fmt(s.typicalMonthly || 0)}/mo</div>
                </div>
                <button onClick={() => removeSource(s.id)} className="text-slate-300 hover:text-rose-400" aria-label="Remove"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input value={src.name} onChange={(e) => setSrc({ ...src, name: e.target.value })} placeholder="Source name" className={field} />
          <select value={src.type} onChange={(e) => setSrc({ ...src, type: e.target.value, basis: basisForType(e.target.value) })} className={field}>
            {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <select value={src.basis} onChange={(e) => setSrc({ ...src, basis: e.target.value })} className={field}>
            <option value="monthly">per month</option>
            <option value="annual">per year</option>
            <option value="hourly">per hour</option>
          </select>
          <Money value={src.amount} onChange={(v) => setSrc({ ...src, amount: v })} placeholder={src.basis === "hourly" ? "rate" : "amount"} />
          {src.basis === "hourly"
            ? <input type="number" value={src.hours} onChange={(e) => setSrc({ ...src, hours: e.target.value })} placeholder="hrs/wk" className={field} />
            : <div className="flex items-center text-xs text-slate-400">≈ {fmt(toMonthly(src))}/mo</div>}
        </div>
        <div className="flex items-center justify-between gap-2">
          {src.basis === "hourly" && <span className="text-xs text-slate-400">≈ {fmt(toMonthly(src))}/mo</span>}
          <button onClick={addSource} className="ml-auto px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg">Add</button>
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
                <button onClick={() => removeAccount(a.id)} className="text-slate-300 hover:text-rose-400" aria-label="Remove"><X size={14} /></button>
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

      {/* Recurring bills (essentials) */}
      <div className={card}>
        <div className="flex items-baseline justify-between mb-3">
          <div className={label}>Recurring bills</div>
          <div className="text-xs text-slate-400">~{fmt(billsTotal)}/mo reserved</div>
        </div>
        {bills.length > 0 && (
          <div className="divide-y divide-slate-50 mb-3">
            {bills.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-2">
                <div className="text-sm text-slate-700">{b.name}{b.dayOfMonth ? <span className="text-xs text-slate-400"> · due {b.dayOfMonth}{ordinal(b.dayOfMonth)}</span> : null}</div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-slate-500">{fmt(b.amount)}</span>
                  <button onClick={() => removeBill(b.id)} className="text-slate-300 hover:text-rose-400" aria-label="Remove"><X size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={bill.name} onChange={(e) => setBill({ ...bill, name: e.target.value })} placeholder="Bill (e.g. Rent)" className={field + " flex-1"} />
          <div className="relative" style={{ width: 100 }}><Money value={bill.amount} onChange={(v) => setBill({ ...bill, amount: v })} placeholder="/mo" /></div>
          <input type="number" min="1" max="31" value={bill.dayOfMonth} onChange={(e) => setBill({ ...bill, dayOfMonth: e.target.value })} placeholder="day" className={field} style={{ width: 64 }} />
          <button onClick={addBill} className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg">Add</button>
        </div>
        <div className="text-xs text-slate-400 mt-2">Reserved before the plan allocates. Not logged — you still log real spending.</div>
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
                <button onClick={() => removeDebt(d.id)} className="text-slate-300 hover:text-rose-400" aria-label="Remove"><X size={14} /></button>
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

      </>)}

      {section === "settings" && (<>
      {/* Profile */}
      <div className={card}>
        <div className={label + " mb-3"}>Your profile</div>
        <div className="space-y-3">
          <div>
            <div className="text-sm text-slate-600 mb-1">Name</div>
            <input value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="What should we call you?" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-sm text-slate-600 mb-1">Birth year <span className="text-slate-400">(opt)</span></div>
              <input type="number" value={form.birthYear} onChange={(e) => set("birthYear")(e.target.value)} placeholder="e.g. 1995" className={field} />
            </div>
            <div>
              <div className="text-sm text-slate-600 mb-1">Retire at age</div>
              <input type="number" value={form.retireAge} onChange={(e) => set("retireAge")(e.target.value)} placeholder="65" className={field} />
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-600 mb-1">Strategy</div>
            <div className="grid grid-cols-2 gap-2">
              {STRATEGIES.map(([v, l, desc]) => (
                <button key={v} onClick={() => set("strategy")(v)} title={desc}
                  className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                    form.strategy === v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
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
              className="text-xs text-brand-600 hover:text-brand-700">
              Use suggested from your spending ({fmt(suggestFloor)} / {fmt(suggestEmergency)})
            </button>
          )}
          <div>
            <div className="text-sm text-slate-600 mb-1">Employer 401k match % <span className="text-slate-400">(optional)</span></div>
            <input type="number" value={form.employerMatchPct} onChange={(e) => set("employerMatchPct")(e.target.value)} placeholder="e.g. 4" className={field} />
          </div>
          <div>
            <div className="text-sm text-slate-600 mb-1">Debt payoff order</div>
            <div className="grid grid-cols-2 gap-2">
              {[["avalanche", "Avalanche", "Highest APR first — least interest."], ["snowball", "Snowball", "Smallest balance first — quick wins."]].map(([v, l, desc]) => (
                <button key={v} onClick={() => set("debtStrategy")(v)} title={desc}
                  className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${form.debtStrategy === v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                  <div className="font-medium">{l}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-sm text-slate-600 mb-1">High-interest APR <span className="text-slate-400">(opt)</span></div>
              <input type="number" value={form.highApr} onChange={(e) => set("highApr")(e.target.value)} placeholder="10%" className={field} />
            </div>
            <div>
              <div className="text-sm text-slate-600 mb-1">IRA annual limit <span className="text-slate-400">(opt)</span></div>
              <input type="number" value={form.iraLimit} onChange={(e) => set("iraLimit")(e.target.value)} placeholder="7000" className={field} />
            </div>
          </div>
          <button onClick={saveProfile} className="w-full py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg transition-colors">
            Save profile
          </button>
        </div>
      </div>

      {/* Appearance */}
      <div className={card}>
        <div className={label + " mb-3"}>Appearance</div>
        <div className="flex gap-1 p-1 bg-slate-50 rounded-xl">
          {[["light", "Light"], ["dark", "Dark"], ["system", "System"]].map(([v, l]) => (
            <button key={v} onClick={() => onSetTheme?.(v)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${theme === v ? "bg-white shadow-sm text-brand-700" : "text-slate-500"}`}>{l}</button>
          ))}
        </div>
      </div>

      {/* Backup: export / import */}
      <div className={card}>
        <div className={label + " mb-3"}>Backup</div>
        <div className="flex gap-2">
          <a href={exportUrl()} className="flex-1 text-center py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg">Export data</a>
          <button onClick={() => fileRef.current?.click()} className="flex-1 py-2 border border-slate-300 text-slate-700 hover:border-slate-400 text-sm font-semibold rounded-lg">Import data</button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImportFile} className="hidden" />
        </div>
        <div className="text-xs text-slate-400 mt-2">Export downloads everything as JSON. Import replaces all current data.</div>
      </div>

      {/* Help */}
      <div className={card}>
        <div className={label + " mb-3"}>Help</div>
        <button onClick={() => onReplayIntro?.()} className="w-full py-2 border border-slate-300 text-slate-700 hover:border-slate-400 text-sm font-semibold rounded-lg">Replay intro & tips</button>
      </div>
      </>)}
    </>
  );
}
