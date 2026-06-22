// HoldingsSection.jsx — manually-entered stock holdings (ticker + shares + optional
// cost basis + account type). Self-contained: owns its form state, commits via onSave.
import { useState } from "react";
import { X } from "lucide-react";
import { fmt } from "../lib/format.js";
import { uid, field, Money } from "./ui.jsx";

const HOLDING_ACCOUNTS = [
  ["taxable", "Taxable"],
  ["401k", "401(k)"],
  ["ira", "IRA"],
  ["roth", "Roth IRA"],
];
const ACCT_LABEL = Object.fromEntries(HOLDING_ACCOUNTS);

/** The Stock-holdings editor body (rendered inside the accordion Section). */
export default function HoldingsSection({ data, onSave }) {
  const holdings = data.holdings || [];
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

  return (
    <>
      <div className="text-xs text-slate-400 mb-3">
        Track individual stocks by ticker + shares. Cost basis (avg price/share) is optional — it
        powers gain/loss.
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
                className="-m-1 flex h-9 w-9 items-center justify-center text-slate-300 hover:text-rose-400"
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
    </>
  );
}
