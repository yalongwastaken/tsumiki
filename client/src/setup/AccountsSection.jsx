// AccountsSection.jsx — bank + investment accounts. Cash accounts (checking/savings/
// other) keep a manually-entered balance; investment accounts (brokerage/IRA/Roth/401k)
// hold their shares inline and auto-value from synced prices + optional uninvested cash.
import { useState, useMemo } from "react";
import Cash from "../Money.jsx";
import { X, Pencil, ChevronDown } from "lucide-react";
import { INVESTMENT_TYPES, TAX_TAG_FOR_TYPE, holdingsValueByAccount } from "../lib/portfolio.js";
import { uid, field, Money } from "./ui.jsx";

const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "credit",
  "brokerage",
  "ira",
  "roth",
  "401k",
  "other",
];
const TYPE_LABEL = { "401k": "401(k)", ira: "IRA", roth: "Roth IRA", credit: "Credit card" };
const typeLabel = (t) => TYPE_LABEL[t] || t;
const isInvestment = (t) => INVESTMENT_TYPES.has(t);
// a credit card is a liability: its balance is stored negative (amount owed), so it
// subtracts from net worth like any other negative snapshot.
const isCredit = (t) => t === "credit";
const iconBtn = "-m-1.5 flex h-11 w-11 items-center justify-center"; // 44px tap target (WCAG 2.5.5)

/** Accounts editor body (rendered inside the accordion Section). */
export default function AccountsSection({ data, onSave, prices = null }) {
  const accounts = data.accounts || [];
  const holdings = useMemo(() => data.holdings || [], [data.holdings]);
  const snapshots = useMemo(() => data.snapshots || [], [data.snapshots]);
  const priceMap = useMemo(() => prices?.prices || {}, [prices]);
  const [acct, setAcct] = useState({ name: "", type: "checking", balance: "" });
  const [balEdit, setBalEdit] = useState({ id: null, value: "" });
  const [openId, setOpenId] = useState(null); // which investment account is expanded
  const [hold, setHold] = useState({ ticker: "", shares: "", costBasis: "" });

  // latest manual balance per account (for cash accounts + as the "last synced" fallback)
  const latestBalances = useMemo(() => {
    const m = new Map();
    for (const s of snapshots) {
      const cur = m.get(s.accountId);
      if (!cur || new Date(s.date) > new Date(cur.date)) {
        m.set(s.accountId, s);
      }
    }
    return m;
  }, [snapshots]);
  const latestBalance = (id) => (latestBalances.has(id) ? latestBalances.get(id).balance : null);
  const marketByAcct = useMemo(
    () => holdingsValueByAccount(holdings, priceMap),
    [holdings, priceMap],
  );
  const holdingsFor = (id) => holdings.filter((h) => h.accountId === id);
  const investmentAccounts = accounts.filter((a) => isInvestment(a.type));
  // legacy/loose holdings not attached to any current account (so they're not stranded)
  const orphans = holdings.filter(
    (h) => !h.accountId || !accounts.some((a) => a.id === h.accountId),
  );

  // what to show as an account's value: cash accounts use their latest balance;
  // investment accounts use live market value + cash, falling back to the last synced
  // snapshot when prices aren't available yet.
  function displayValue(a) {
    if (!isInvestment(a.type)) {
      return latestBalance(a.id);
    }
    // net worth is snapshot-based and the reconcile keeps this account's snapshot at
    // market+cash, so prefer the snapshot to stay consistent with Home/net worth
    // (and to respect a manual same-day override the reconcile won't clobber).
    const snap = latestBalance(a.id);
    if (snap != null) {
      return snap;
    }
    const market = marketByAcct[a.id] || 0;
    const cash = Number(a.cash) || 0;
    if (market > 0) {
      return market + cash; // priced but not yet written to a snapshot
    }
    return cash > 0 ? cash : null; // nothing to value yet → empty state
  }

  function toggleOpen(id) {
    setHold({ ticker: "", shares: "", costBasis: "" }); // don't carry a half-typed row across accounts
    setOpenId((cur) => (cur === id ? null : id));
  }
  function addAccount() {
    if (!acct.name.trim()) {
      return;
    }
    const id = uid();
    const inv = isInvestment(acct.type);
    const account = { id, name: acct.name.trim(), type: acct.type, color: "#94A3B8" };
    if (inv && acct.balance !== "") {
      account.cash = Math.max(0, Number(acct.balance) || 0); // for investment accounts the field is "cash"
    }
    const next = { ...data, accounts: [...accounts, account] };
    if (!inv && acct.balance !== "") {
      const entered = Number(acct.balance) || 0;
      // a credit card's entered figure is what you OWE → store it negative (a liability)
      const balance = isCredit(acct.type) ? -Math.abs(entered) : entered;
      next.snapshots = [
        ...snapshots,
        { id: uid(), accountId: id, date: new Date().toISOString(), balance },
      ];
    }
    onSave(next);
    setAcct({ name: "", type: "checking", balance: "" });
    if (inv) {
      toggleOpen(id); // jump straight into adding shares
    }
  }
  function removeAccount(id) {
    const n = holdingsFor(id).length;
    const name = accounts.find((a) => a.id === id)?.name || "this account";
    if (
      n > 0 &&
      !window.confirm(`Remove ${name} and its ${n} ${n === 1 ? "holding" : "holdings"}?`)
    ) {
      return;
    }
    onSave({
      ...data,
      accounts: accounts.filter((a) => a.id !== id),
      snapshots: snapshots.filter((s) => s.accountId !== id),
      holdings: holdings.filter((h) => h.accountId !== id), // drop the account's shares too
    });
  }
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
  // log money against a credit card: delta>0 charges it (owe more), delta<0 pays it down
  // (owe less, never below 0). Each writes a snapshot of the new owed amount (negative).
  function adjustCard(id, delta) {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    const owed = -(latestBalance(id) || 0);
    const newOwed = Math.max(0, owed + delta);
    onSave({
      ...data,
      snapshots: [
        ...snapshots,
        { id: uid(), accountId: id, date: new Date().toISOString(), balance: -newOwed },
      ],
    });
    setBalEdit({ id: null, value: "" });
  }
  function setCash(a, value) {
    const cash = value === "" ? 0 : Math.max(0, Number(value));
    if (Number.isNaN(cash)) {
      return;
    }
    onSave({ ...data, accounts: accounts.map((x) => (x.id === a.id ? { ...x, cash } : x)) });
  }
  function addHolding(a) {
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
          accountId: a.id,
          account: TAX_TAG_FOR_TYPE[a.type] || "taxable", // tax treatment from the account
        },
      ],
    });
    setHold({ ticker: "", shares: "", costBasis: "" });
  }
  function removeHolding(id) {
    onSave({ ...data, holdings: holdings.filter((h) => h.id !== id) });
  }
  function assignHolding(hid, accId) {
    if (!accId) {
      return;
    }
    const acc = accounts.find((a) => a.id === accId);
    onSave({
      ...data,
      holdings: holdings.map((h) =>
        h.id === hid
          ? {
              ...h,
              accountId: accId,
              account: TAX_TAG_FOR_TYPE[acc?.type] || h.account || "taxable",
            }
          : h,
      ),
    });
  }

  return (
    <>
      {accounts.length > 0 && (
        <div className="divide-y divide-slate-50 mb-3">
          {accounts.map((a) => {
            const inv = isInvestment(a.type);
            const val = displayValue(a);
            const expanded = openId === a.id;
            const accHoldings = holdingsFor(a.id);
            return (
              <div key={a.id} className="py-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-slate-700">
                      {a.name} <span className="text-xs text-slate-500">· {typeLabel(a.type)}</span>
                    </div>
                    {isCredit(a.type) ? (
                      <div className="text-xs text-rose-600">
                        <Cash n={-(val || 0)} /> owed
                      </div>
                    ) : val != null ? (
                      <div className="text-xs text-slate-500">
                        <Cash n={val} />
                        {inv && (
                          <span>
                            {" "}
                            · {accHoldings.length}{" "}
                            {accHoldings.length === 1 ? "holding" : "holdings"}
                            {Number(a.cash) ? (
                              <>
                                {" + "}
                                <Cash n={a.cash} /> cash
                              </>
                            ) : (
                              ""
                            )}
                          </span>
                        )}
                      </div>
                    ) : (
                      inv && (
                        <div className="text-xs text-slate-500">
                          add shares{prices?.enabled ? "" : " · enable price sync to value them"}
                        </div>
                      )
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {inv ? (
                      <button
                        onClick={() => toggleOpen(a.id)}
                        className={`${iconBtn} text-slate-400 hover:text-brand-600`}
                        aria-label={expanded ? "Close holdings" : "Manage holdings"}
                        aria-expanded={expanded}
                      >
                        <ChevronDown
                          size={16}
                          className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                        />
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          setBalEdit(
                            balEdit.id === a.id ? { id: null, value: "" } : { id: a.id, value: "" },
                          )
                        }
                        className={`${iconBtn} text-slate-400 hover:text-brand-600`}
                        aria-label={isCredit(a.type) ? "Charge or pay card" : "Update balance"}
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => removeAccount(a.id)}
                      className={`${iconBtn} text-slate-400 hover:text-rose-500`}
                      aria-label={`Remove ${a.name}${accHoldings.length ? " and its holdings" : ""}`}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {/* credit card: charge it up or pay it down (logs a new owed balance) */}
                {isCredit(a.type) && balEdit.id === a.id && (
                  <div className="mt-2 flex gap-2">
                    <div className="flex-1">
                      <Money
                        value={balEdit.value}
                        onChange={(v) => setBalEdit({ id: a.id, value: v })}
                        placeholder="Amount"
                        ariaLabel="Amount to charge or pay"
                      />
                    </div>
                    <button
                      onClick={() => adjustCard(a.id, Math.abs(Number(balEdit.value) || 0))}
                      className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700"
                    >
                      Charge
                    </button>
                    <button
                      onClick={() => adjustCard(a.id, -Math.abs(Number(balEdit.value) || 0))}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      Pay
                    </button>
                  </div>
                )}

                {/* cash-account manual balance editor */}
                {!inv && !isCredit(a.type) && balEdit.id === a.id && (
                  <div className="flex gap-2 mt-2">
                    <div className="flex-1">
                      <Money
                        value={balEdit.value}
                        onChange={(v) => setBalEdit({ id: a.id, value: v })}
                        placeholder="New balance"
                        ariaLabel="New balance"
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

                {/* investment-account holdings + cash editor */}
                {inv && expanded && (
                  <div className="mt-2 rounded-lg bg-slate-50 p-3">
                    {accHoldings.length > 0 && (
                      <div className="divide-y divide-slate-100 mb-2">
                        {accHoldings.map((h) => {
                          const q = priceMap[h.ticker];
                          const mv = q?.price != null ? q.price * h.shares : null;
                          return (
                            <div
                              key={h.id}
                              className="flex items-center justify-between py-1.5 text-sm"
                            >
                              <span className="text-slate-700">
                                {h.ticker}{" "}
                                <span className="text-xs text-slate-500">
                                  · {h.shares} sh
                                  {mv != null && (
                                    <>
                                      {" · "}
                                      <Cash n={mv} />
                                    </>
                                  )}
                                </span>
                              </span>
                              <button
                                onClick={() => removeHolding(h.id)}
                                aria-label={`Remove ${h.ticker}`}
                                className={`${iconBtn} text-slate-400 hover:text-rose-500`}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        value={hold.ticker}
                        onChange={(e) => setHold({ ...hold, ticker: e.target.value })}
                        placeholder="Ticker"
                        aria-label="Ticker"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        className={field + " uppercase"}
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
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
                        ariaLabel="Cost per share"
                      />
                    </div>
                    <button
                      onClick={() => addHolding(a)}
                      className="w-full mt-2 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
                    >
                      Add shares
                    </button>
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        Uninvested cash
                      </span>
                      <div className="flex-1">
                        <Money
                          value={a.cash ?? ""}
                          onChange={(v) => setCash(a, v)}
                          placeholder="0"
                          ariaLabel="Uninvested cash"
                        />
                      </div>
                    </div>
                    {!prices?.enabled && (
                      <div className="mt-2 text-xs text-slate-500">
                        Turn on price sync (TSUMIKI_PRICES) so share values update automatically.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* loose holdings from before they lived in accounts — let the user attach them */}
      {orphans.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-semibold text-amber-800 mb-2">
            {orphans.length} {orphans.length === 1 ? "holding isn’t" : "holdings aren’t"} in an
            account
          </div>
          {investmentAccounts.length === 0 ? (
            <div className="text-xs text-amber-800">
              Add a brokerage/IRA account above, then assign these to it.
            </div>
          ) : (
            <div className="divide-y divide-amber-100">
              {orphans.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-sm text-slate-700">
                    {h.ticker} <span className="text-xs text-slate-500">· {h.shares} sh</span>
                  </span>
                  <select
                    defaultValue=""
                    onChange={(e) => assignHolding(h.id, e.target.value)}
                    aria-label={`Assign ${h.ticker} to an account`}
                    className={field + " max-w-[10rem]"}
                  >
                    <option value="" disabled>
                      Assign to…
                    </option>
                    {investmentAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-2">
        <input
          value={acct.name}
          onChange={(e) => setAcct({ ...acct, name: e.target.value })}
          placeholder="Account name"
          aria-label="Account name"
          className={field}
        />
        <select
          value={acct.type}
          onChange={(e) => setAcct({ ...acct, type: e.target.value })}
          aria-label="Account type"
          className={field}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <Money
            value={acct.balance}
            onChange={(v) => setAcct({ ...acct, balance: v })}
            placeholder={
              isInvestment(acct.type)
                ? "Cash (optional)"
                : isCredit(acct.type)
                  ? "Amount owed (optional)"
                  : "Current balance (optional)"
            }
            ariaLabel={
              isInvestment(acct.type)
                ? "Cash (optional)"
                : isCredit(acct.type)
                  ? "Amount owed (optional)"
                  : "Current balance (optional)"
            }
          />
        </div>
        <button
          onClick={addAccount}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
        >
          Add
        </button>
      </div>
      {isInvestment(acct.type) && (
        <div className="mt-1 text-xs text-slate-500">
          Add the account, then enter its shares — the balance values them automatically.
        </div>
      )}
    </>
  );
}
