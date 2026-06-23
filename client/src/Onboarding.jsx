// Onboarding.jsx — first-run guided setup + explainer (replayable from Setup).
import { useState } from "react";
import { useFocusTrap } from "./useFocusTrap.js";
import { uid } from "./lib/uid.js";
import { fmt } from "./lib/format.js";
const STRATEGIES = [
  ["short_term", "Safety first", "Kill debt & build a cash cushion before investing."],
  ["balanced", "Balanced", "Split between debt, safety, and investing."],
  ["long_term", "Growth first", "Push into retirement & investments aggressively."],
];
const field =
  "w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700";

/** First-run guided setup modal: name, strategy, and a first income source. */
export default function Onboarding({ open, initial = {}, onComplete, onSkip }) {
  const panelRef = useFocusTrap(open, onSkip); // Escape skips; trap Tab; restore focus
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial.name || "");
  const [srcName, setSrcName] = useState("");
  const [srcAmount, setSrcAmount] = useState("");
  const [srcBasis, setSrcBasis] = useState("monthly"); // monthly | annual | hourly
  const [srcHours, setSrcHours] = useState("40"); // hours/week, only when hourly
  const [srcTaxable, setSrcTaxable] = useState(true);
  const [srcCadence, setSrcCadence] = useState("biweekly");
  const [srcPayday, setSrcPayday] = useState("");
  const [balChecking, setBalChecking] = useState("");
  const [balSavings, setBalSavings] = useState("");
  const [emergencyTarget, setEmergencyTarget] = useState("");
  const [strategy, setStrategy] = useState(initial.strategy || "balanced");
  if (!open) {
    return null;
  }

  const steps = ["welcome", "income", "accounts", "emergency", "strategy", "how"];
  const last = step === steps.length - 1;
  const next = () => (last ? finish() : setStep(step + 1));
  // Enter advances the step from any single-line text/number input
  const onEnter = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      next();
    }
  };
  function finish() {
    const amt = Math.max(0, Number(srcAmount || 0));
    const hrs = Math.max(0, Number(srcHours || 0));
    // mirror IncomeSection.toMonthly: annual/12, hourly × hrs/wk × 52 / 12, else monthly
    const monthly =
      srcBasis === "annual" ? amt / 12 : srcBasis === "hourly" ? (amt * hrs * 52) / 12 : amt;
    const source = srcName.trim()
      ? {
          id: uid(),
          name: srcName.trim(),
          type: srcBasis === "hourly" ? "hourly" : "salary",
          basis: srcBasis,
          amount: amt,
          ...(srcBasis === "hourly" ? { hours: hrs } : {}),
          taxable: srcTaxable,
          typicalMonthly: Math.max(0, Math.round(monthly)),
          cadence: srcCadence,
          payday: srcPayday || null,
        }
      : null;
    // optional starting balances → accounts + snapshots
    const accounts = [];
    const snapshots = [];
    const now = new Date().toISOString();
    const addAcct = (val, accName, type) => {
      if (val === "" || Number.isNaN(Number(val))) {
        return;
      }
      const id = uid();
      accounts.push({ id, name: accName, type, color: "#94A3B8" });
      snapshots.push({ id: uid(), accountId: id, date: now, balance: Number(val) });
    };
    addAcct(balChecking, "Checking", "checking");
    addAcct(balSavings, "Savings", "savings");
    onComplete({
      name: name.trim(),
      strategy,
      source,
      accounts,
      snapshots,
      emergencyTarget: emergencyTarget === "" ? null : Math.max(0, Number(emergencyTarget) || 0),
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Set up Tsumiki"
    >
      <div className="anim-fade absolute inset-0 bg-slate-900/50" />
      <div
        ref={panelRef}
        className="modal-in relative w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-1">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-brand-600" : "w-1.5 bg-slate-200"}`}
              />
            ))}
          </div>
          <button onClick={onSkip} className="text-xs text-slate-500 hover:text-slate-600">
            Skip
          </button>
        </div>
        <div className="text-xs text-slate-500 mb-3" aria-live="polite">
          Step {step + 1} of {steps.length}
        </div>

        {steps[step] === "welcome" && (
          <div>
            <svg width="40" height="40" viewBox="0 0 64 64" aria-hidden="true" className="mb-2">
              <rect x="6" y="40" width="18" height="18" rx="3" fill="#C9C0FB" />
              <rect x="23" y="26" width="18" height="18" rx="3" fill="#9B8AFA" />
              <rect x="40" y="12" width="18" height="18" rx="3" fill="#7C6FE8" />
            </svg>
            <div className="text-xl font-bold text-slate-900 mb-1">Welcome to Tsumiki</div>
            <div className="text-sm text-slate-500 mb-4">
              Building wealth, one block at a time. Let's set you up — takes a minute.
            </div>
            <div className="text-sm text-slate-600 mb-1">What should we call you?</div>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onEnter}
              placeholder="Your name"
              className={field}
            />
          </div>
        )}

        {steps[step] === "income" && (
          <div>
            <div className="text-lg font-bold text-slate-900 mb-1">What do you earn?</div>
            <div className="text-sm text-slate-500 mb-4">
              Add a main income source. You can add more (and exact amounts) later in Accounts.
            </div>
            <input
              value={srcName}
              onChange={(e) => setSrcName(e.target.value)}
              aria-label="Income source name"
              placeholder="e.g. Day job"
              className={field + " mb-2"}
            />
            <div className="flex gap-2 mb-2">
              <select
                value={srcBasis}
                onChange={(e) => setSrcBasis(e.target.value)}
                className={field + " max-w-[8rem]"}
                aria-label="Income basis"
              >
                <option value="monthly">per month</option>
                <option value="annual">per year</option>
                <option value="hourly">per hour</option>
              </select>
              <div className="relative flex-1">
                <span className="absolute left-3 top-3 text-slate-500 text-sm">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={srcAmount}
                  onChange={(e) => setSrcAmount(e.target.value)}
                  aria-label={
                    srcBasis === "annual"
                      ? "Income per year"
                      : srcBasis === "hourly"
                        ? "Hourly rate"
                        : "Income per month"
                  }
                  placeholder={
                    srcBasis === "annual"
                      ? "salary / year"
                      : srcBasis === "hourly"
                        ? "rate / hour"
                        : "typical / month"
                  }
                  className={field + " pl-7"}
                />
              </div>
            </div>
            {srcBasis === "hourly" && (
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={srcHours}
                  onChange={(e) => setSrcHours(e.target.value)}
                  aria-label="Hours per week"
                  placeholder="hours / week"
                  className={field + " max-w-[8rem]"}
                />
                <span className="text-xs text-slate-500">
                  hrs/week ≈{" "}
                  {fmt(Math.round((Number(srcAmount || 0) * Number(srcHours || 0) * 52) / 12))}
                  /mo
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <select
                value={srcCadence}
                onChange={(e) => setSrcCadence(e.target.value)}
                className={field}
              >
                <option value="weekly">paid weekly</option>
                <option value="biweekly">every 2 weeks</option>
                <option value="semimonthly">twice a month</option>
                <option value="monthly">monthly</option>
              </select>
              <input
                type="date"
                value={srcPayday}
                onChange={(e) => setSrcPayday(e.target.value)}
                title="Next payday"
                aria-label="Next payday"
                className={field}
              />
            </div>
            <div className="text-xs text-slate-500 mt-1">
              A payday date unlocks dated transfer reminders + a cashflow forecast.
            </div>
            <label className="flex items-center gap-2 mt-3 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={!srcTaxable}
                onChange={(e) => setSrcTaxable(!e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              This income is non-taxable (e.g. Roth withdrawal, gift, disability)
            </label>
          </div>
        )}

        {steps[step] === "accounts" && (
          <div>
            <div className="text-lg font-bold text-slate-900 mb-1">Where's your money now?</div>
            <div className="text-sm text-slate-500 mb-4">
              Optional starting balances so I can track net worth and watch your buffer. Add more
              accounts later.
            </div>
            <div className="space-y-2">
              <div className="relative">
                <span className="absolute left-3 top-3 text-slate-500 text-sm">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={balChecking}
                  onChange={(e) => setBalChecking(e.target.value)}
                  aria-label="Checking balance"
                  placeholder="checking balance"
                  className={field + " pl-7"}
                />
              </div>
              <div className="relative">
                <span className="absolute left-3 top-3 text-slate-500 text-sm">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={balSavings}
                  onChange={(e) => setBalSavings(e.target.value)}
                  aria-label="Savings balance"
                  placeholder="savings balance"
                  className={field + " pl-7"}
                />
              </div>
            </div>
          </div>
        )}

        {steps[step] === "emergency" && (
          <div>
            <div className="text-lg font-bold text-slate-900 mb-1">Your safety net</div>
            <div className="text-sm text-slate-500 mb-4">
              How big should your emergency fund be? A common target is 3–6 months of expenses. The
              plan builds toward this first.
            </div>
            <div className="relative">
              <span className="absolute left-3 top-3 text-slate-500 text-sm">$</span>
              <input
                type="number"
                inputMode="decimal"
                value={emergencyTarget}
                onChange={(e) => setEmergencyTarget(e.target.value)}
                onKeyDown={onEnter}
                aria-label="Emergency fund target"
                placeholder="emergency fund target"
                className={field + " pl-7"}
              />
            </div>
          </div>
        )}

        {steps[step] === "strategy" && (
          <div>
            <div className="text-lg font-bold text-slate-900 mb-1">How should I coach you?</div>
            <div className="text-sm text-slate-500 mb-4">
              This shapes where your money goes first. Change it anytime.
            </div>
            <div className="space-y-2">
              {STRATEGIES.map(([v, l, desc]) => (
                <button
                  key={v}
                  onClick={() => setStrategy(v)}
                  aria-pressed={strategy === v}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${strategy === v ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <div className="text-sm font-medium text-slate-800">{l}</div>
                  <div className="text-xs text-slate-500">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {steps[step] === "how" && (
          <div>
            <div className="text-lg font-bold text-slate-900 mb-3">How Tsumiki works</div>
            <div className="space-y-3 text-sm">
              <div>
                <span className="font-semibold text-brand-600">Plan</span> — tells you where each
                dollar should go this month.
              </div>
              <div>
                <span className="font-semibold text-brand-600">Add button</span> — log income &
                spending in seconds, from any screen.
              </div>
              <div>
                <span className="font-semibold text-brand-600">Activity</span> — your month at a
                glance: calendar or list, spending, bills.
              </div>
              <div>
                <span className="font-semibold text-brand-600">Goals</span> — streaks & milestones
                keep you motivated.
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="px-4 py-2.5 text-sm font-semibold text-slate-600 border border-slate-200 rounded-lg"
            >
              Back
            </button>
          )}
          <button
            onClick={next}
            className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg"
          >
            {last ? "Start" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
