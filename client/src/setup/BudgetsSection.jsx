// BudgetsSection.jsx — envelope category budgets editor. Self-contained: owns its
// form state, commits caps to profile.budgets and per-category options (rollover /
// annual period) to profile.budgetOpts via onSave, and can seed caps from spending.
import { useState } from "react";
import Cash from "../components/Money.jsx";
import { X } from "lucide-react";
import { allCategories } from "../lib/categories.js";
import { categoryAverages } from "../lib/budgets.js";
import { card, label, field, Money } from "./ui.jsx";

/** Category budgets card (lives in the Settings section). */
export default function BudgetsSection({ data, onSave }) {
  const profile = data.profile || {};
  const transactions = data.transactions || [];
  const budgets = profile.budgets || {};
  const budgetOpts = profile.budgetOpts || {};
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
    const nextBudgets = { ...budgets };
    delete nextBudgets[cat];
    const nextOpts = { ...budgetOpts };
    delete nextOpts[cat];
    onSave({ ...data, profile: { ...profile, budgets: nextBudgets, budgetOpts: nextOpts } });
  }
  // merge per-category options, pruning defaults so the stored blob stays tidy
  function setOpt(cat, patch) {
    const opt = { ...(budgetOpts[cat] || {}), ...patch };
    if (opt.period === "monthly") {
      delete opt.period;
    }
    if (!opt.rollover) {
      delete opt.rollover;
    }
    const next = { ...budgetOpts };
    if (Object.keys(opt).length) {
      next[cat] = opt;
    } else {
      delete next[cat];
    }
    onSave({ ...data, profile: { ...profile, budgetOpts: next } });
  }
  // fill budgets from each category's recent average (keeps any you've already set)
  const budgetSuggestions = categoryAverages(transactions, 3);
  function suggestBudgets() {
    const merged = { ...budgets };
    for (const [cat, avg] of Object.entries(budgetSuggestions)) {
      if (!(merged[cat] > 0) && avg > 0) {
        merged[cat] = avg;
      }
    }
    onSave({ ...data, profile: { ...profile, budgets: merged } });
  }

  return (
    <div className={card}>
      <div className={label + " mb-1"}>Category budgets</div>
      <div className="text-xs text-slate-500 mb-3">
        Set a cap per spending category — the coach warns you as you approach it. Optionally let a
        category roll unused budget forward, or track it as a yearly cap.
      </div>
      {Object.keys(budgets).length > 0 && (
        <div className="divide-y divide-slate-100 mb-3">
          {Object.entries(budgets).map(([cat, amount]) => {
            const opt = budgetOpts[cat] || {};
            const annual = opt.period === "annual";
            return (
              <div key={cat} className="py-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-700">{cat}</div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-500">
                      <Cash n={amount} />/{annual ? "yr" : "mo"}
                    </span>
                    <button
                      onClick={() => removeBudget(cat)}
                      aria-label={`Remove ${cat} budget`}
                      className="-m-1.5 flex h-11 w-11 items-center justify-center text-slate-400 hover:text-rose-500"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
                  <label className="flex items-center gap-1.5">
                    <span className="text-slate-500">Period</span>
                    <select
                      value={annual ? "annual" : "monthly"}
                      onChange={(e) => setOpt(cat, { period: e.target.value })}
                      aria-label={`${cat} budget period`}
                      className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1"
                    >
                      <option value="monthly">monthly</option>
                      <option value="annual">annual</option>
                    </select>
                  </label>
                  {!annual && (
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={!!opt.rollover}
                        onChange={(e) => setOpt(cat, { rollover: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      />
                      Roll unused budget forward
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={budgetForm.cat}
          onChange={(e) => setBudgetForm({ ...budgetForm, cat: e.target.value })}
          placeholder="Category (e.g. Dining Out)"
          aria-label="Budget category"
          list="tsumiki-cats"
          className={field + " flex-1"}
        />
        <datalist id="tsumiki-cats">
          {allCategories(transactions).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="relative" style={{ width: 110 }}>
          <Money
            value={budgetForm.amount}
            onChange={(v) => setBudgetForm({ ...budgetForm, amount: v })}
            placeholder="/mo cap"
            ariaLabel="Monthly budget cap"
          />
        </div>
        <button
          onClick={addBudget}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
        >
          Add
        </button>
      </div>
      {Object.keys(budgetSuggestions).length > 0 && (
        <button
          onClick={suggestBudgets}
          className="press mt-2 w-full rounded-lg bg-brand-50 py-2 text-xs font-medium text-brand-800 hover:bg-brand-100"
        >
          Suggest from my spending (3-month average)
        </button>
      )}
    </div>
  );
}
