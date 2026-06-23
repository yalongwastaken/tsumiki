// BudgetsSection.jsx — envelope monthly category budgets editor. Self-contained:
// owns its form state, commits to profile.budgets via onSave, and can seed caps
// from recent spending averages.
import { useState } from "react";
import { X } from "lucide-react";
import { fmt } from "../lib/format.js";
import { allCategories } from "../lib/categories.js";
import { categoryAverages } from "../lib/budgets.js";
import { card, label, field, Money } from "./ui.jsx";

/** Monthly budgets card (lives in the Settings section). */
export default function BudgetsSection({ data, onSave }) {
  const profile = data.profile || {};
  const transactions = data.transactions || [];
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
      <div className={label + " mb-1"}>Monthly budgets</div>
      <div className="text-xs text-slate-500 mb-3">
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
                  className="-m-1 flex h-9 w-9 items-center justify-center text-slate-400 hover:text-rose-400"
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
          placeholder="Category (e.g. Dining Out)"
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
      {Object.keys(budgetSuggestions).length > 0 && (
        <button
          onClick={suggestBudgets}
          className="press mt-2 w-full rounded-lg bg-brand-50 py-2 text-xs font-medium text-brand-700 hover:bg-brand-100"
        >
          Suggest from my spending (3-month average)
        </button>
      )}
    </div>
  );
}
