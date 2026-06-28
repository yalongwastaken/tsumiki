// ProfileSection.jsx — the profile/strategy/tax form. Self-contained: holds a local
// draft committed with a Save button, with emergency/floor suggestions from spending.
import { useState, useMemo } from "react";
import Cash from "../Money.jsx";
import { annualSpend } from "../lib/selectors.js";
import { FILING_STATUSES } from "../lib/tax.js";
import { card, label, field, Money } from "./ui.jsx";

const STRATEGIES = [
  ["short_term", "Safety first", "Kill debt + build a cash buffer before investing."],
  ["balanced", "Balanced", "Split between debt, safety, and investing."],
  ["long_term", "Growth first", "Push into retirement + investments aggressively."],
  ["custom", "Custom", "Define your own priorities later."],
];

/** The "Your profile" settings card (name, strategy, tax, thresholds). */
export default function ProfileSection({ data, onSave }) {
  const profile = data.profile || {};

  // suggested floor / emergency target from logged spending
  const avgMonthlySpend = useMemo(
    () => annualSpend(data.transactions || []) / 12,
    [data.transactions],
  );
  const suggestEmergency = Math.round(avgMonthlySpend * 3);
  const suggestFloor = Math.round(avgMonthlySpend);

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
    spouseBirthYear: profile.spouseBirthYear ?? "",
  });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v) => (v === "" || v == null ? null : Number(v));

  function saveProfile() {
    onSave({
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
        spouseBirthYear: form.filingStatus === "married" ? num(form.spouseBirthYear) : null,
      },
    });
  }

  return (
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
              Birth year <span className="text-slate-500">(opt)</span>
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
            State tax rate <span className="text-slate-500">(opt — overrides the estimate)</span>
          </div>
          <input
            type="number"
            value={form.stateTaxRate}
            onChange={(e) => set("stateTaxRate")(e.target.value)}
            placeholder="e.g. 5 (%)"
            className={field}
          />
        </div>
        {form.filingStatus === "married" && (
          <div>
            <div className="text-sm text-slate-600 mb-1">
              Spouse birth year <span className="text-slate-500">(opt)</span>
            </div>
            <input
              type="number"
              value={form.spouseBirthYear}
              onChange={(e) => set("spouseBirthYear")(e.target.value)}
              placeholder="for the 65+ deduction"
              className={field}
            />
          </div>
        )}
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
            Use suggested from your spending (<Cash n={suggestFloor} /> /{" "}
            <Cash n={suggestEmergency} />)
          </button>
        )}
        <div>
          <div className="text-sm text-slate-600 mb-1">
            Employer 401k match % <span className="text-slate-500">(optional)</span>
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
              High-interest APR <span className="text-slate-500">(opt)</span>
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
              IRA annual limit <span className="text-slate-500">(opt)</span>
            </div>
            <input
              type="number"
              value={form.iraLimit}
              onChange={(e) => set("iraLimit")(e.target.value)}
              placeholder="7500"
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
  );
}
