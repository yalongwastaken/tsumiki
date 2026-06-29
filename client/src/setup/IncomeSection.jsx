// IncomeSection.jsx — income sources with pay cadence + payday. Self-contained:
// owns its add/edit form state, commits via onSave (keeping profile.typicalIncome
// as the derived monthly sum), and can fill cadence/payday from logged history.
import { useState } from "react";
import Money from "../components/Money.jsx";
import { X, Pencil } from "lucide-react";
import { detectIncomeSchedule } from "../lib/insights.js";
import { CADENCE_LABEL } from "../lib/cadence.js";
import { nextPaydays } from "../lib/paydays.js";
import { uid, field, AmountInput } from "./ui.jsx";

const SOURCE_TYPES = ["salary", "hourly", "self_employed", "passive", "other"];
const BLANK = {
  name: "",
  type: "salary",
  basis: "annual",
  amount: "",
  hours: "40",
  cadence: "biweekly",
  payday: "",
  taxable: true,
};
const toDateInput = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const basisForType = (type) =>
  type === "hourly" ? "hourly" : type === "salary" ? "annual" : "monthly";

/** Income-sources editor body (rendered inside the accordion Section). */
export default function IncomeSection({ data, onSave }) {
  const profile = data.profile || {};
  const transactions = data.transactions || [];
  const incomeSources = profile.incomeSources || [];
  const [src, setSrc] = useState(BLANK);
  const [editingSrc, setEditingSrc] = useState(null);
  const incomeSchedule = detectIncomeSchedule(transactions);

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
      taxable: src.taxable !== false,
      typicalMonthly: toMonthly(src),
    };
    commitSources(
      editingSrc
        ? incomeSources.map((s) => (s.id === editingSrc ? { ...s, ...fields } : s))
        : [...incomeSources, { id: uid(), ...fields }],
    );
    setSrc(BLANK);
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
      taxable: s.taxable !== false,
    });
    setEditingSrc(s.id);
  }
  function removeSource(id) {
    commitSources(incomeSources.filter((s) => s.id !== id));
    if (editingSrc === id) {
      setEditingSrc(null);
      setSrc(BLANK);
    }
  }
  const srcDetail = (s) =>
    s.basis === "hourly" ? (
      <>
        <Money n={Number(s.amount) || 0} />
        /hr · {s.hours}h/wk
      </>
    ) : s.basis === "annual" ? (
      <>
        <Money n={s.amount} />
        /yr
      </>
    ) : (
      <>
        <Money n={s.amount} />
        /mo
      </>
    );

  return (
    <>
      {incomeSources.length > 0 && (
        <div className="divide-y divide-slate-50 mb-3">
          {incomeSources.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2.5">
              <div>
                <div className="text-sm text-slate-700">
                  {s.name}{" "}
                  <span className="text-xs text-slate-500">· {s.type.replace("_", " ")}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {s.basis ? <>{srcDetail(s)} → </> : ""}
                  ~<Money n={s.typicalMonthly || 0} />
                  /mo
                  {s.taxable === false && <span className="text-emerald-600"> · non-taxable</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => editSource(s)}
                  className="text-slate-400 hover:text-brand-600"
                  aria-label="Edit"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => removeSource(s.id)}
                  className="text-slate-400 hover:text-rose-400"
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
        <AmountInput
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
          <div className="flex items-center text-xs text-slate-500">
            ≈ <Money n={toMonthly(src)} />
            /mo
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
        <span className="text-xs text-slate-500">— sets per-paycheck amounts on your plan</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-slate-500">Next payday</span>
        <input
          type="date"
          value={src.payday || ""}
          onChange={(e) => setSrc({ ...src, payday: e.target.value })}
          className={field}
        />
        <span className="text-xs text-slate-500">— optional, shows dated reminders</span>
      </div>
      <label className="flex items-center gap-2 mb-3 text-xs text-slate-600 cursor-pointer">
        <input
          type="checkbox"
          checked={src.taxable === false}
          onChange={(e) => setSrc({ ...src, taxable: !e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-brand-600"
        />
        Non-taxable income (e.g. Roth withdrawal, gift, disability) — excluded from the tax estimate
      </label>
      <div className="flex items-center justify-between gap-2">
        {src.basis === "hourly" && (
          <span className="text-xs text-slate-500">
            ≈ <Money n={toMonthly(src)} />
            /mo
          </span>
        )}
        <button
          onClick={addSource}
          className="ml-auto px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
        >
          {editingSrc ? "Save" : "Add"}
        </button>
      </div>
    </>
  );
}
