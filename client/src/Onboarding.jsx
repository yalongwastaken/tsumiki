import { useState } from "react";

// First-run guided setup + explainer (replayable from Setup).
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const STRATEGIES = [
  ["short_term", "Safety first", "Kill debt & build a cash cushion before investing."],
  ["balanced", "Balanced", "Split between debt, safety, and investing."],
  ["long_term", "Growth first", "Push into retirement & investments aggressively."],
];
const field = "w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700";

export default function Onboarding({ open, initial = {}, onComplete, onSkip }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial.name || "");
  const [srcName, setSrcName] = useState("");
  const [srcAmount, setSrcAmount] = useState("");
  const [strategy, setStrategy] = useState(initial.strategy || "balanced");
  if (!open) return null;

  const steps = ["welcome", "income", "strategy", "how"];
  const last = step === steps.length - 1;
  function finish() {
    const source = srcName.trim() ? { id: uid(), name: srcName.trim(), type: "salary", typicalMonthly: Number(srcAmount || 0) } : null;
    onComplete({ name: name.trim(), strategy, source });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/50" />
      <div className="relative w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <div className="flex gap-1.5">
            {steps.map((_, i) => <div key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-indigo-600" : "w-1.5 bg-slate-200"}`} />)}
          </div>
          <button onClick={onSkip} className="text-xs text-slate-400 hover:text-slate-600">Skip</button>
        </div>

        {steps[step] === "welcome" && (
          <div>
            <div className="text-3xl mb-2">🧱</div>
            <div className="text-xl font-bold text-slate-900 mb-1">Welcome to Tsumiki</div>
            <div className="text-sm text-slate-500 mb-4">Building wealth, one block at a time. Let's set you up — takes a minute.</div>
            <div className="text-sm text-slate-600 mb-1">What should we call you?</div>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={field} />
          </div>
        )}

        {steps[step] === "income" && (
          <div>
            <div className="text-lg font-bold text-slate-900 mb-1">What do you earn?</div>
            <div className="text-sm text-slate-500 mb-4">Add a main income source. You can add more (and exact amounts) later in Setup.</div>
            <input value={srcName} onChange={(e) => setSrcName(e.target.value)} placeholder="e.g. Day job" className={field + " mb-2"} />
            <div className="relative">
              <span className="absolute left-3 top-3 text-slate-400 text-sm">$</span>
              <input type="number" value={srcAmount} onChange={(e) => setSrcAmount(e.target.value)} placeholder="typical / month" className={field + " pl-7"} />
            </div>
          </div>
        )}

        {steps[step] === "strategy" && (
          <div>
            <div className="text-lg font-bold text-slate-900 mb-1">How should I coach you?</div>
            <div className="text-sm text-slate-500 mb-4">This shapes where your money goes first. Change it anytime.</div>
            <div className="space-y-2">
              {STRATEGIES.map(([v, l, desc]) => (
                <button key={v} onClick={() => setStrategy(v)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${strategy === v ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-slate-300"}`}>
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
              <div><span className="font-semibold text-indigo-600">Plan</span> — tells you where each dollar should go this month.</div>
              <div><span className="font-semibold text-indigo-600">＋ button</span> — log income & spending in seconds, from any screen.</div>
              <div><span className="font-semibold text-indigo-600">Calendar</span> — your month at a glance: spending, activity, bills.</div>
              <div><span className="font-semibold text-indigo-600">Goals</span> — streaks & milestones keep you motivated.</div>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          {step > 0 && <button onClick={() => setStep(step - 1)} className="px-4 py-2.5 text-sm font-semibold text-slate-600 border border-slate-200 rounded-lg">Back</button>}
          <button onClick={() => (last ? finish() : setStep(step + 1))}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg">
            {last ? "Start" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
