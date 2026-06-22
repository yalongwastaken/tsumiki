// Setup.jsx — profile + accounts/debts the engine runs on (accounts vs settings section).
import { useState, useMemo, useRef } from "react";
import { X, Pencil, ChevronDown } from "lucide-react";
import { fmt } from "./lib/format.js";
import { importData, exportUrl } from "./lib/api.js";
import { annualSpend } from "./lib/selectors.js";
import { detectRecurring, detectIncomeSchedule } from "./lib/insights.js";
import { FILING_STATUSES } from "./lib/tax.js";
import { CADENCE_LABEL } from "./lib/cadence.js";
import { nextPaydays } from "./lib/paydays.js";
import CsvImport from "./CsvImport.jsx";

// format a Date to the YYYY-MM-DD a <input type="date"> expects (local)
const toDateInput = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ordinal = (n) =>
  n % 10 === 1 && n !== 11
    ? "st"
    : n % 10 === 2 && n !== 12
      ? "nd"
      : n % 10 === 3 && n !== 13
        ? "rd"
        : "th";
const ACCOUNT_TYPES = ["checking", "savings", "brokerage", "ira", "other"];
const SOURCE_TYPES = ["salary", "hourly", "self_employed", "passive", "other"];
const HOLDING_ACCOUNTS = [
  ["taxable", "Taxable"],
  ["401k", "401(k)"],
  ["ira", "IRA"],
  ["roth", "Roth IRA"],
];
const ACCT_LABEL = Object.fromEntries(HOLDING_ACCOUNTS);
const STRATEGIES = [
  ["short_term", "Safety first", "Kill debt + build a cash buffer before investing."],
  ["balanced", "Balanced", "Split between debt, safety, and investing."],
  ["long_term", "Growth first", "Push into retirement + investments aggressively."],
  ["custom", "Custom", "Define your own priorities later."],
];

const card = "bg-white rounded-xl border border-slate-200 p-4";
const label = "text-xs font-semibold text-slate-400 uppercase tracking-wider";
const field =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700";

function Money({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
      <input
        type="number"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={field + " pl-7"}
      />
    </div>
  );
}

/** Collapsible card: title + one-line summary collapsed, full form when open. */
function Section({ title, summary, open, onToggle, children }) {
  return (
    <div className={card}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="press flex w-full items-center justify-between text-left"
      >
        <span className={label}>{title}</span>
        <span className="flex items-center gap-2 text-xs text-slate-400">
          {summary}
          <ChevronDown
            size={15}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && <div className="anim-fade mt-3">{children}</div>}
    </div>
  );
}

/** Profile + accounts/debts editor; renders the "accounts" or "settings" section. */
export default function Setup({
  data,
  onSave,
  onReplayIntro,
  onReset,
  theme = "light",
  onSetTheme,
  section = "settings",
}) {
  const {
    profile = {},
    accounts = [],
    debts = [],
    transactions = [],
    snapshots = [],
    holdings = [],
  } = data;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const incomeSources = profile.incomeSources || [];
  const totalTypical = incomeSources.reduce((s, x) => s + (x.typicalMonthly || 0), 0);

  // accordion: each accounts group collapses to a one-line summary; empty groups
  // default open so a fresh setup shows the forms, filled ones start calm/closed.
  const [open, setOpen] = useState({});
  const isOpen = (id, empty) => open[id] ?? empty;
  const toggle = (id, empty) => setOpen((o) => ({ ...o, [id]: !(o[id] ?? empty) }));

  // smart defaults derived from logged spending
  const avgMonthlySpend = useMemo(() => annualSpend(transactions) / 12, [transactions]);
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
    filingStatus: profile.filingStatus ?? "single",
    state: profile.state ?? "",
    stateTaxRate: profile.stateTaxRate != null ? profile.stateTaxRate * 100 : "",
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
        filingStatus: form.filingStatus,
        state: form.state.trim().toUpperCase(),
        stateTaxRate: form.stateTaxRate === "" ? null : Number(form.stateTaxRate) / 100,
      },
    };
    onSave(next);
  }

  // income sources (commit immediately; keep profile.typicalIncome = derived sum)
  const [src, setSrc] = useState({
    name: "",
    type: "salary",
    basis: "annual",
    amount: "",
    hours: "40",
    cadence: "biweekly",
    payday: "",
  });
  const [editingSrc, setEditingSrc] = useState(null);
  // convert any pay basis to a monthly figure
  const toMonthly = (s) => {
    const a = Number(s.amount || 0);
    if (s.basis === "annual") {
      return Math.round(a / 12);
    }
    if (s.basis === "hourly") {
      return Math.round((a * Number(s.hours || 0) * 52) / 12);
    }
    return Math.round(a); // monthly
  };
  const basisForType = (type) =>
    type === "hourly" ? "hourly" : type === "salary" ? "annual" : "monthly";
  function commitSources(list) {
    const total = list.reduce((s, x) => s + (x.typicalMonthly || 0), 0);
    onSave({ ...data, profile: { ...profile, incomeSources: list, typicalIncome: total } });
  }
  function addSource() {
    if (!src.name.trim()) {
      return;
    }
    const fields = {
      name: src.name.trim(),
      type: src.type,
      basis: src.basis,
      amount: Number(src.amount || 0),
      hours: Number(src.hours || 0),
      cadence: src.cadence || "biweekly",
      payday: src.payday || null,
      typicalMonthly: toMonthly(src),
    };
    commitSources(
      editingSrc
        ? incomeSources.map((s) => (s.id === editingSrc ? { ...s, ...fields } : s))
        : [...incomeSources, { id: uid(), ...fields }],
    );
    setSrc({
      name: "",
      type: "salary",
      basis: "annual",
      amount: "",
      hours: "40",
      cadence: "biweekly",
      payday: "",
    });
    setEditingSrc(null);
  }
  function editSource(s) {
    setSrc({
      name: s.name,
      type: s.type,
      basis: s.basis || "monthly",
      amount: String(s.amount ?? s.typicalMonthly ?? ""),
      hours: String(s.hours || 40),
      cadence: s.cadence || "biweekly",
      payday: s.payday || "",
    });
    setEditingSrc(s.id);
  }
  const srcDetail = (s) =>
    s.basis === "hourly"
      ? `$${s.amount}/hr · ${s.hours}h/wk`
      : s.basis === "annual"
        ? `${fmt(s.amount)}/yr`
        : `${fmt(s.amount)}/mo`;
  function removeSource(id) {
    commitSources(incomeSources.filter((s) => s.id !== id));
    if (editingSrc === id) {
      setEditingSrc(null);
      setSrc({
        name: "",
        type: "salary",
        basis: "annual",
        amount: "",
        hours: "40",
        cadence: "biweekly",
        payday: "",
      });
    }
  }

  // accounts
  const [acct, setAcct] = useState({ name: "", type: "checking", balance: "" });
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
  const latestBalance = (id) => {
    const ss = snapshots.filter((s) => s.accountId === id);
    if (!ss.length) {
      return null;
    }
    return ss.reduce((a, b) => (new Date(b.date) > new Date(a.date) ? b : a)).balance;
  };
  const [balEdit, setBalEdit] = useState({ id: null, value: "" });
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

  // recurring bills (essentials — inform-only)
  const bills = profile.bills || [];
  const billsTotal = bills.reduce((s, b) => s + (b.amount || 0), 0);
  // accordion summaries: known balances total (null if none snapshotted) + total debt owed
  const accountsTotal = accounts.some((a) => latestBalance(a.id) != null)
    ? accounts.reduce((s, a) => s + (latestBalance(a.id) || 0), 0)
    : null;
  const debtsTotal = debts.reduce((s, d) => s + (d.balance || 0), 0);
  const [bill, setBill] = useState({ name: "", amount: "", dayOfMonth: "" });
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
  // charges that look recurring but aren't billed yet — offer to add them
  const detected = detectRecurring(transactions, bills);
  // pay schedule inferred from logged income → one-tap fill of cadence + payday
  const incomeSchedule = detectIncomeSchedule(transactions);
  function addDetectedBill(d) {
    onSave({
      ...data,
      profile: {
        ...profile,
        bills: [...bills, { id: uid(), name: d.label, amount: d.amount, dayOfMonth: null }],
      },
    });
  }

  // backup: export (download) + import (replace)
  const fileRef = useRef(null);
  async function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    if (!window.confirm("Import will REPLACE all current data. Continue?")) {
      e.target.value = "";
      return;
    }
    try {
      await importData(JSON.parse(await file.text()));
      location.reload();
    } catch (err) {
      window.alert("Import failed: " + (err.message || err));
    }
    e.target.value = "";
  }

  // debts
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

  // stock holdings (manually entered; prices sync nightly when enabled)
  const [hold, setHold] = useState({ ticker: "", shares: "", costBasis: "", account: "taxable" });
  function addHolding() {
    const ticker = hold.ticker.trim().toUpperCase();
    if (!ticker || !(Number(hold.shares) > 0)) {
      return;
    }
    onSave({
      ...data,
      holdings: [
        ...holdings,
        {
          id: uid(),
          ticker,
          shares: Number(hold.shares),
          costBasis: hold.costBasis === "" ? null : Number(hold.costBasis),
          account: hold.account || "taxable",
        },
      ],
    });
    setHold({ ticker: "", shares: "", costBasis: "", account: "taxable" });
  }
  function removeHolding(id) {
    onSave({ ...data, holdings: holdings.filter((h) => h.id !== id) });
  }

  // category budgets (envelope caps), stored as profile.budgets = { cat: monthlyCap }
  const budgets = profile.budgets || {};
  const [budgetForm, setBudgetForm] = useState({ cat: "", amount: "" });
  function addBudget() {
    const cat = budgetForm.cat.trim();
    const amount = Number(budgetForm.amount);
    if (!cat || !(amount > 0)) {
      return;
    }
    onSave({ ...data, profile: { ...profile, budgets: { ...budgets, [cat]: amount } } });
    setBudgetForm({ cat: "", amount: "" });
  }
  function removeBudget(cat) {
    const next = { ...budgets };
    delete next[cat];
    onSave({ ...data, profile: { ...profile, budgets: next } });
  }

  return (
    <>
      {section === "accounts" && (
        <>
          {incomeSources.length === 0 &&
            accounts.length === 0 &&
            debts.length === 0 &&
            bills.length === 0 && (
              <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 text-sm text-brand-700">
                Set up your money here — add your income, bank accounts, recurring bills, and any
                debts. The plan uses these to tell you where each paycheck should go.
              </div>
            )}
          {/* Income sources */}
          <Section
            title="Income sources"
            summary={`${incomeSources.length} ${incomeSources.length === 1 ? "source" : "sources"} · ${fmt(totalTypical)}/mo`}
            open={isOpen("income", incomeSources.length === 0)}
            onToggle={() => toggle("income", incomeSources.length === 0)}
          >
            {incomeSources.length > 0 && (
              <div className="divide-y divide-slate-50 mb-3">
                {incomeSources.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <div className="text-sm text-slate-700">
                        {s.name}{" "}
                        <span className="text-xs text-slate-400">· {s.type.replace("_", " ")}</span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {s.basis ? `${srcDetail(s)} → ` : ""}~{fmt(s.typicalMonthly || 0)}/mo
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => editSource(s)}
                        className="text-slate-300 hover:text-brand-600"
                        aria-label="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => removeSource(s.id)}
                        className="text-slate-300 hover:text-rose-400"
                        aria-label="Remove"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input
                value={src.name}
                onChange={(e) => setSrc({ ...src, name: e.target.value })}
                placeholder="Source name"
                className={field}
              />
              <select
                value={src.type}
                onChange={(e) =>
                  setSrc({ ...src, type: e.target.value, basis: basisForType(e.target.value) })
                }
                className={field}
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <select
                value={src.basis}
                onChange={(e) => setSrc({ ...src, basis: e.target.value })}
                className={field}
              >
                <option value="monthly">per month</option>
                <option value="annual">per year</option>
                <option value="hourly">per hour</option>
              </select>
              <Money
                value={src.amount}
                onChange={(v) => setSrc({ ...src, amount: v })}
                placeholder={src.basis === "hourly" ? "rate" : "amount"}
              />
              {src.basis === "hourly" ? (
                <input
                  type="number"
                  value={src.hours}
                  onChange={(e) => setSrc({ ...src, hours: e.target.value })}
                  placeholder="hrs/wk"
                  className={field}
                />
              ) : (
                <div className="flex items-center text-xs text-slate-400">
                  ≈ {fmt(toMonthly(src))}/mo
                </div>
              )}
            </div>
            {incomeSchedule && !src.payday && (
              <button
                onClick={() => {
                  // project the last detected payday forward to the next upcoming one
                  const next = nextPaydays(incomeSchedule.lastPayday, incomeSchedule.cadence, 1)[0];
                  setSrc({
                    ...src,
                    cadence: incomeSchedule.cadence,
                    payday: next ? toDateInput(next) : incomeSchedule.lastPayday,
                  });
                }}
                className="mb-2 w-full text-left rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 hover:bg-brand-100"
              >
                Detected ~{CADENCE_LABEL[incomeSchedule.cadence]} pay from your history (last on{" "}
                {incomeSchedule.lastPayday}). Tap to fill your cadence + next payday.
              </button>
            )}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-slate-500">Paid</span>
              <select
                value={src.cadence}
                onChange={(e) => setSrc({ ...src, cadence: e.target.value })}
                className={field}
              >
                {Object.entries(CADENCE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-400">
                — sets per-paycheck amounts on your plan
              </span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-slate-500">Next payday</span>
              <input
                type="date"
                value={src.payday || ""}
                onChange={(e) => setSrc({ ...src, payday: e.target.value })}
                className={field}
              />
              <span className="text-xs text-slate-400">— optional, shows dated reminders</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              {src.basis === "hourly" && (
                <span className="text-xs text-slate-400">≈ {fmt(toMonthly(src))}/mo</span>
              )}
              <button
                onClick={addSource}
                className="ml-auto px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
              >
                {editingSrc ? "Save" : "Add"}
              </button>
            </div>
          </Section>

          {/* Accounts */}
          <Section
            title="Accounts"
            summary={`${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}${
              accountsTotal != null ? ` · ${fmt(accountsTotal)}` : ""
            }`}
            open={isOpen("accounts", accounts.length === 0)}
            onToggle={() => toggle("accounts", accounts.length === 0)}
          >
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
                              balEdit.id === a.id
                                ? { id: null, value: "" }
                                : { id: a.id, value: "" },
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
          </Section>

          {/* Recurring bills (essentials) */}
          <Section
            title="Recurring bills"
            summary={`${bills.length} ${bills.length === 1 ? "bill" : "bills"} · ${fmt(billsTotal)}/mo`}
            open={isOpen("bills", bills.length === 0)}
            onToggle={() => toggle("bills", bills.length === 0)}
          >
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
                        <span className="text-xs text-slate-400">
                          · {fmt(d.amount)} · {d.months} months
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
                        <span className="text-xs text-slate-400">
                          {" "}
                          · due {b.dayOfMonth}
                          {ordinal(b.dayOfMonth)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-slate-500">{fmt(b.amount)}</span>
                      <button
                        onClick={() => removeBill(b.id)}
                        className="text-slate-300 hover:text-rose-400"
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
            <div className="text-xs text-slate-400 mt-2">
              Reserved before the plan allocates. Not logged — you still log real spending.
            </div>
          </Section>

          {/* Debts */}
          <Section
            title="Debts"
            summary={`${debts.length} ${debts.length === 1 ? "debt" : "debts"}${
              debtsTotal > 0 ? ` · ${fmt(debtsTotal)}` : ""
            }`}
            open={isOpen("debts", debts.length === 0)}
            onToggle={() => toggle("debts", debts.length === 0)}
          >
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
                      className="text-slate-300 hover:text-rose-400"
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
          </Section>

          {/* Stock holdings (prices sync nightly when enabled on the server) */}
          <Section
            title="Stock holdings"
            summary={`${holdings.length} ${holdings.length === 1 ? "holding" : "holdings"}`}
            open={isOpen("holdings", holdings.length === 0)}
            onToggle={() => toggle("holdings", holdings.length === 0)}
          >
            <div className="text-xs text-slate-400 mb-3">
              Track individual stocks by ticker + shares. Cost basis (avg price/share) is optional —
              it powers gain/loss.
            </div>
            {holdings.length > 0 && (
              <div className="divide-y divide-slate-50 mb-3">
                {holdings.map((h) => (
                  <div key={h.id} className="flex items-center justify-between py-2">
                    <div className="text-sm text-slate-700">
                      {h.ticker}
                      {h.account && h.account !== "taxable" && (
                        <span className="ml-1.5 text-[10px] font-semibold text-brand-700 bg-brand-50 rounded px-1 py-0.5 align-middle">
                          {ACCT_LABEL[h.account] || h.account}
                        </span>
                      )}
                      <span className="text-xs text-slate-400">
                        {" "}
                        · {h.shares} sh{h.costBasis != null ? ` @ ${fmt(h.costBasis)}` : ""}
                      </span>
                    </div>
                    <button
                      onClick={() => removeHolding(h.id)}
                      aria-label="Remove holding"
                      className="p-1.5 -m-1 text-slate-300 hover:text-rose-400"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <input
                value={hold.ticker}
                onChange={(e) => setHold({ ...hold, ticker: e.target.value })}
                placeholder="Ticker"
                aria-label="Ticker"
                className={field + " uppercase"}
              />
              <input
                type="number"
                value={hold.shares}
                onChange={(e) => setHold({ ...hold, shares: e.target.value })}
                placeholder="shares"
                aria-label="Shares"
                className={field}
              />
              <Money
                value={hold.costBasis}
                onChange={(v) => setHold({ ...hold, costBasis: v })}
                placeholder="cost/sh"
              />
            </div>
            <select
              value={hold.account}
              onChange={(e) => setHold({ ...hold, account: e.target.value })}
              aria-label="Account type"
              className={field + " mt-2"}
            >
              {HOLDING_ACCOUNTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button
              onClick={addHolding}
              className="w-full mt-2 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
            >
              Add holding
            </button>
          </Section>
        </>
      )}

      {section === "settings" && (
        <>
          {/* Profile */}
          <div className={card}>
            <div className={label + " mb-3"}>Your profile</div>
            <div className="space-y-3">
              <div>
                <div className="text-sm text-slate-600 mb-1">Name</div>
                <input
                  value={form.name}
                  onChange={(e) => set("name")(e.target.value)}
                  placeholder="What should we call you?"
                  className={field}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-sm text-slate-600 mb-1">
                    Birth year <span className="text-slate-400">(opt)</span>
                  </div>
                  <input
                    type="number"
                    value={form.birthYear}
                    onChange={(e) => set("birthYear")(e.target.value)}
                    placeholder="e.g. 1995"
                    className={field}
                  />
                </div>
                <div>
                  <div className="text-sm text-slate-600 mb-1">Retire at age</div>
                  <input
                    type="number"
                    value={form.retireAge}
                    onChange={(e) => set("retireAge")(e.target.value)}
                    placeholder="65"
                    className={field}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <div className="text-sm text-slate-600 mb-1">Tax filing status</div>
                  <select
                    value={form.filingStatus}
                    onChange={(e) => set("filingStatus")(e.target.value)}
                    aria-label="Tax filing status"
                    className={field}
                  >
                    {FILING_STATUSES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="text-sm text-slate-600 mb-1">State</div>
                  <input
                    value={form.state}
                    onChange={(e) => set("state")(e.target.value)}
                    placeholder="CA"
                    maxLength={2}
                    aria-label="State (2-letter)"
                    className={field + " uppercase"}
                  />
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-600 mb-1">
                  State tax rate{" "}
                  <span className="text-slate-400">(opt — overrides the estimate)</span>
                </div>
                <input
                  type="number"
                  value={form.stateTaxRate}
                  onChange={(e) => set("stateTaxRate")(e.target.value)}
                  placeholder="e.g. 5 (%)"
                  className={field}
                />
              </div>
              <div>
                <div className="text-sm text-slate-600 mb-1">Strategy</div>
                <div className="grid grid-cols-2 gap-2">
                  {STRATEGIES.map(([v, l, desc]) => (
                    <button
                      key={v}
                      onClick={() => set("strategy")(v)}
                      title={desc}
                      className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                        form.strategy === v
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-slate-200 text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <div className="font-medium">{l}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-sm text-slate-600 mb-1">Checking floor</div>
                  <Money
                    value={form.checkingFloor}
                    onChange={set("checkingFloor")}
                    placeholder={suggestFloor ? String(suggestFloor) : "1 mo expenses"}
                  />
                </div>
                <div>
                  <div className="text-sm text-slate-600 mb-1">Emergency target</div>
                  <Money
                    value={form.emergencyTarget}
                    onChange={set("emergencyTarget")}
                    placeholder={suggestEmergency ? String(suggestEmergency) : "3 mo expenses"}
                  />
                </div>
              </div>
              {(suggestFloor > 0 || suggestEmergency > 0) && (
                <button
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      checkingFloor: suggestFloor,
                      emergencyTarget: suggestEmergency,
                    }))
                  }
                  className="text-xs text-brand-600 hover:text-brand-700"
                >
                  Use suggested from your spending ({fmt(suggestFloor)} / {fmt(suggestEmergency)})
                </button>
              )}
              <div>
                <div className="text-sm text-slate-600 mb-1">
                  Employer 401k match % <span className="text-slate-400">(optional)</span>
                </div>
                <input
                  type="number"
                  value={form.employerMatchPct}
                  onChange={(e) => set("employerMatchPct")(e.target.value)}
                  placeholder="e.g. 4"
                  className={field}
                />
              </div>
              <div>
                <div className="text-sm text-slate-600 mb-1">Debt payoff order</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["avalanche", "Avalanche", "Highest APR first — least interest."],
                    ["snowball", "Snowball", "Smallest balance first — quick wins."],
                  ].map(([v, l, desc]) => (
                    <button
                      key={v}
                      onClick={() => set("debtStrategy")(v)}
                      title={desc}
                      className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${form.debtStrategy === v ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                    >
                      <div className="font-medium">{l}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-sm text-slate-600 mb-1">
                    High-interest APR <span className="text-slate-400">(opt)</span>
                  </div>
                  <input
                    type="number"
                    value={form.highApr}
                    onChange={(e) => set("highApr")(e.target.value)}
                    placeholder="10%"
                    className={field}
                  />
                </div>
                <div>
                  <div className="text-sm text-slate-600 mb-1">
                    IRA annual limit <span className="text-slate-400">(opt)</span>
                  </div>
                  <input
                    type="number"
                    value={form.iraLimit}
                    onChange={(e) => set("iraLimit")(e.target.value)}
                    placeholder="7000"
                    className={field}
                  />
                </div>
              </div>
              <button
                onClick={saveProfile}
                className="w-full py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Save profile
              </button>
            </div>
          </div>

          {/* Appearance */}
          <div className={card}>
            <div className={label + " mb-3"}>Appearance</div>
            <div className="flex gap-1 p-1 bg-slate-50 rounded-xl">
              {[
                ["light", "Light"],
                ["dark", "Dark"],
                ["system", "System"],
              ].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => onSetTheme?.(v)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${theme === v ? "bg-white shadow-sm text-brand-700" : "text-slate-500"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Category budgets (envelope caps) */}
          <div className={card}>
            <div className={label + " mb-1"}>Monthly budgets</div>
            <div className="text-xs text-slate-400 mb-3">
              Set a monthly cap per spending category — the coach warns you as you approach it.
            </div>
            {Object.keys(budgets).length > 0 && (
              <div className="divide-y divide-slate-50 mb-3">
                {Object.entries(budgets).map(([cat, amount]) => (
                  <div key={cat} className="flex items-center justify-between py-2">
                    <div className="text-sm text-slate-700">{cat}</div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-slate-500">{fmt(amount)}/mo</span>
                      <button
                        onClick={() => removeBudget(cat)}
                        aria-label="Remove budget"
                        className="text-slate-300 hover:text-rose-400"
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
                value={budgetForm.cat}
                onChange={(e) => setBudgetForm({ ...budgetForm, cat: e.target.value })}
                placeholder="Category (e.g. Dining)"
                className={field + " flex-1"}
              />
              <div className="relative" style={{ width: 110 }}>
                <Money
                  value={budgetForm.amount}
                  onChange={(v) => setBudgetForm({ ...budgetForm, amount: v })}
                  placeholder="/mo"
                />
              </div>
              <button
                onClick={addBudget}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
              >
                Add
              </button>
            </div>
          </div>

          {/* Import transactions from a bank CSV */}
          <div className={card}>
            <div className={label + " mb-3"}>Import transactions (CSV)</div>
            <CsvImport
              existing={transactions}
              onImport={(txs) => onSave({ ...data, transactions: [...transactions, ...txs] })}
            />
          </div>

          {/* Backup: export / import */}
          <div className={card}>
            <div className={label + " mb-3"}>Backup</div>
            <div className="flex gap-2">
              <a
                href={exportUrl()}
                className="flex-1 text-center py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
              >
                Export data
              </a>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 py-2 border border-slate-300 text-slate-700 hover:border-slate-400 text-sm font-semibold rounded-lg"
              >
                Import data
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                onChange={onImportFile}
                className="hidden"
              />
            </div>
            <div className="text-xs text-slate-400 mt-2">
              Export downloads everything as JSON. Import replaces all current data.
            </div>
          </div>

          {/* Danger zone: wipe everything and start over */}
          <div className={card + " border-rose-200"}>
            <div className={label + " mb-1"}>Danger zone</div>
            <div className="text-xs text-slate-400 mb-3">
              Permanently erase all your data — accounts, transactions, profile, everything — and
              start fresh. Export first if you might want it back.
            </div>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full py-2 border border-rose-300 text-rose-600 hover:bg-rose-50 text-sm font-semibold rounded-lg"
              >
                Delete all my data
              </button>
            ) : (
              <div className="space-y-2">
                <div className="text-sm text-rose-600 font-medium">
                  This can't be undone. Really delete everything?
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 py-2 border border-slate-300 text-slate-700 hover:border-slate-400 text-sm font-semibold rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setConfirmDelete(false);
                      onReset?.();
                    }}
                    className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg"
                  >
                    Yes, delete everything
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Help */}
          <div className={card}>
            <div className={label + " mb-3"}>Help</div>
            <button
              onClick={() => onReplayIntro?.()}
              className="w-full py-2 border border-slate-300 text-slate-700 hover:border-slate-400 text-sm font-semibold rounded-lg"
            >
              Replay intro & tips
            </button>
          </div>
        </>
      )}
    </>
  );
}
