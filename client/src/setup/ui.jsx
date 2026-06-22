// ui.jsx — shared primitives for the Setup section components (form field styles,
// a money input, and a uid helper) so each extracted section stays self-contained.
export { uid } from "../lib/uid.js";

export const card = "bg-white rounded-xl border border-slate-200 p-4";
export const label = "text-xs font-semibold text-slate-400 uppercase tracking-wider";
export const field =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700";

/** A "$"-prefixed number input used across the Setup forms. */
export function Money({ value, onChange, placeholder }) {
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
