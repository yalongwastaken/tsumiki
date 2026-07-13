// AccountsSection.jsx — bank + investment accounts. Cash accounts (checking/savings/
// other) keep a manually-entered balance; investment accounts (brokerage/IRA/Roth/401k)
// hold their shares inline and auto-value from synced prices + optional uninvested cash.
import { useState, useMemo } from "react";
import Money from "../components/Money.jsx";
import { X, Pencil, ChevronDown } from "lucide-react";
import {
  INVESTMENT_TYPES,
  TAX_TAG_FOR_TYPE,
  holdingsValueByAccount,
  effectivePrice,
} from "../lib/finance/portfolio.js";
import { uid, field, AmountInput } from "./ui.jsx";

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
export default function AccountsSection({
  data,
  onSave,
  onSaveEntity,
  onDeleteEntity,
  prices = null,
}) {
  const accounts = data.accounts || [];
  const holdings = useMemo(() => data.holdings || [], [data.holdings]);
  const snapshots = useMemo(() => data.snapshots || [], [data.snapshots]);
  const priceMap = useMemo(() => prices?.prices || {}, [prices]);
  const [acct, setAcct] = useState({ name: "", type: "checking", balance: "" });
  const [balEdit, setBalEdit] = useState({ id: null, value: "" });
  const [openId, setOpenId] = useState(null); // which investment account is expanded
  const [hold, setHold] = useState({ ticker: "", shares: "", costBasis: "" });
  const [editHold, setEditHold] = useState({
    id: null,
    ticker: "",
    shares: "",
    costBasis: "",
    manual: false,
    manualPrice: "",
  });

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
    if (!inv && acct.balance !== "") {
      const entered = Number(acct.balance) || 0;
      // a credit card's entered figure is what you OWE → store it negative (a liability)
      const balance = isCredit(acct.type) ? -Math.abs(entered) : entered;
      // account + its opening snapshot must land together → full-state save
      onSave((d) => ({
        ...d,
        accounts: [...(d.accounts || []), account],
        snapshots: [
          ...(d.snapshots || []),
          { id: uid(), accountId: id, date: new Date().toISOString(), balance },
        ],
      }));
    } else if (onSaveEntity) {
      // no snapshot to write → one-row upsert via PATCH /api/accounts/:id
      onSaveEntity("accounts", account);
    } else {
      onSave((d) => ({ ...d, accounts: [...(d.accounts || []), account] }));
    }
    setAcct({ name: "", type: "checking", balance: "" });
    if (inv) {
      toggleOpen(id); // jump straight into adding shares
    }
  }
  // deleting an account erases its whole balance history (and retroactively changes
  // net-worth history), so ALWAYS confirm — in-app two-tap, not window.confirm, which
  // renders poorly in an iOS standalone PWA (AUDIT M10/L12)
  const [confirmRemove, setConfirmRemove] = useState(null);
  function removeAccount(id) {
    if (confirmRemove !== id) {
      setConfirmRemove(id);
      setTimeout(() => setConfirmRemove((c) => (c === id ? null : c)), 4000); // disarm
      return;
    }
    setConfirmRemove(null);
    if (onDeleteEntity) {
      // granular DELETE /api/accounts/:id — the server FK-cascades the snapshots and
      // the store drops attached holdings (meta) in a follow-up patch
      onDeleteEntity("accounts", id);
      return;
    }
    // fallback: functional full-state save rebased on the latest state
    onSave((d) => ({
      ...d,
      accounts: d.accounts.filter((a) => a.id !== id),
      snapshots: d.snapshots.filter((s) => s.accountId !== id),
      holdings: (d.holdings || []).filter((h) => h.accountId !== id), // drop its shares too
    }));
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
  function startEditHold(h) {
    setEditHold({
      id: h.id,
      ticker: h.ticker || "",
      shares: String(h.shares ?? ""),
      costBasis: h.costBasis == null ? "" : String(h.costBasis),
      manual: !!h.manual, // price entered by hand, not synced
      manualPrice: h.manualPrice == null ? "" : String(h.manualPrice),
    });
  }
  function saveEditHold() {
    const ticker = editHold.ticker.trim().toUpperCase();
    const shares = Number(editHold.shares);
    if (!ticker || !Number.isFinite(shares) || shares <= 0) {
      return; // need a ticker and a positive share count
    }
    const mp = editHold.manualPrice === "" ? null : Math.max(0, Number(editHold.manualPrice));
    onSave({
      ...data,
      holdings: holdings.map((h) =>
        h.id === editHold.id
          ? {
              ...h,
              ticker,
              shares,
              costBasis: editHold.costBasis === "" ? null : Number(editHold.costBasis),
              manual: !!editHold.manual,
              manualPrice: Number.isFinite(mp) ? mp : null,
            }
          : h,
      ),
    });
    setEditHold({
      id: null,
      ticker: "",
      shares: "",
      costBasis: "",
      manual: false,
      manualPrice: "",
    });
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
                        <Money n={-(val || 0)} /> owed
                      </div>
                    ) : val != null ? (
                      <div className="text-xs text-slate-500">
                        <Money n={val} />
                        {inv && (
                          <span>
                            {" "}
                            · {accHoldings.length}{" "}
                            {accHoldings.length === 1 ? "holding" : "holdings"}
                            {Number(a.cash) ? (
                              <>
                                {" + "}
                                <Money n={a.cash} /> cash
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
                      className={
                        confirmRemove === a.id
                          ? "-m-1.5 flex h-11 items-center px-2 text-xs font-semibold text-rose-600"
                          : `${iconBtn} text-slate-400 hover:text-rose-500`
                      }
                      aria-label={
                        confirmRemove === a.id
                          ? `Confirm: remove ${a.name} and its balance history`
                          : `Remove ${a.name}${accHoldings.length ? " and its holdings" : ""}`
                      }
                    >
                      {confirmRemove === a.id ? "Remove?" : <X size={15} />}
                    </button>
                  </div>
                </div>

                {/* credit card: charge it up or pay it down (logs a new owed balance) */}
                {isCredit(a.type) && balEdit.id === a.id && (
                  <div className="mt-2 flex gap-2">
                    <div className="flex-1">
                      <AmountInput
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
                      <AmountInput
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
                          const { price: effPrice, manual: effManual } = effectivePrice(
                            h,
                            priceMap,
                          );
                          const mv = effPrice != null ? effPrice * h.shares : null;
                          if (editHold.id === h.id) {
                            return (
                              <div key={h.id} className="py-1.5">
                                <div className="grid grid-cols-3 gap-2">
                                  <input
                                    value={editHold.ticker}
                                    onChange={(e) =>
                                      setEditHold({ ...editHold, ticker: e.target.value })
                                    }
                                    aria-label={`Edit ticker for ${h.ticker}`}
                                    autoCapitalize="characters"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    className={field + " uppercase"}
                                  />
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    value={editHold.shares}
                                    onChange={(e) =>
                                      setEditHold({ ...editHold, shares: e.target.value })
                                    }
                                    aria-label={`Edit shares for ${h.ticker}`}
                                    className={field}
                                  />
                                  <AmountInput
                                    value={editHold.costBasis}
                                    onChange={(v) => setEditHold({ ...editHold, costBasis: v })}
                                    placeholder="cost/sh"
                                    ariaLabel={`Edit cost per share for ${h.ticker}`}
                                  />
                                </div>
                                {/* manual price: for holdings the feed can't sync (e.g. mutual
                                    funds) — turn off auto-sync and set the price/share yourself */}
                                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                                  <input
                                    type="checkbox"
                                    checked={editHold.manual}
                                    onChange={(e) =>
                                      setEditHold({ ...editHold, manual: e.target.checked })
                                    }
                                    aria-label={`Set price manually for ${h.ticker} (don't sync)`}
                                    className="accent-brand-600"
                                  />
                                  Set price manually (don’t sync — e.g. a mutual fund)
                                </label>
                                <div className="mt-2 flex items-center gap-2">
                                  <span className="text-xs text-slate-500 whitespace-nowrap">
                                    {editHold.manual
                                      ? "Price / share"
                                      : "Price / share (until synced)"}
                                  </span>
                                  <div className="flex-1">
                                    <AmountInput
                                      value={editHold.manualPrice}
                                      onChange={(v) => setEditHold({ ...editHold, manualPrice: v })}
                                      placeholder="0.00"
                                      ariaLabel={`Manual price per share for ${h.ticker}`}
                                    />
                                  </div>
                                </div>
                                <div className="mt-2 flex gap-2">
                                  <button
                                    onClick={saveEditHold}
                                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() =>
                                      setEditHold({
                                        id: null,
                                        ticker: "",
                                        shares: "",
                                        costBasis: "",
                                        manual: false,
                                        manualPrice: "",
                                      })
                                    }
                                    className="px-2 py-1.5 text-sm text-slate-500"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div
                              key={h.id}
                              className="flex items-center justify-between py-1.5 text-sm"
                            >
                              <span className="text-slate-700">
                                {h.ticker}{" "}
                                <span className="text-xs text-slate-500">
                                  · <span className="money">{h.shares}</span> sh
                                  {effPrice != null && (
                                    <>
                                      {" @ "}
                                      <Money n={effPrice} />
                                      {" · "}
                                      <Money n={mv} />
                                    </>
                                  )}
                                  {effManual && <span className="text-slate-400"> · manual</span>}
                                </span>
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => startEditHold(h)}
                                  aria-label={`Edit ${h.ticker}`}
                                  className={`${iconBtn} text-slate-400 hover:text-brand-600`}
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={() => removeHolding(h.id)}
                                  aria-label={`Remove ${h.ticker}`}
                                  className={`${iconBtn} text-slate-400 hover:text-rose-500`}
                                >
                                  <X size={14} />
                                </button>
                              </div>
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
                      <AmountInput
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
                        <AmountInput
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
                    {h.ticker}{" "}
                    <span className="text-xs text-slate-500">
                      · <span className="money">{h.shares}</span> sh
                    </span>
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
          <AmountInput
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
