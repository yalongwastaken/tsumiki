// Setup.jsx — profile + accounts/debts the engine runs on (accounts vs settings section).
import { useState, useMemo, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { importData, exportUrl } from "../lib/core/api.js";
import { transactionsToCsv } from "../lib/core/csv.js";
import Money from "../components/Money.jsx";
import { card, label } from "../setup/ui.jsx";
import { INVESTMENT_TYPES, holdingsValueByAccount } from "../lib/finance/portfolio.js";
import IncomeSection from "../setup/IncomeSection.jsx";
import AccountsSection from "../setup/AccountsSection.jsx";
import BillsSection from "../setup/BillsSection.jsx";
import DebtsSection from "../setup/DebtsSection.jsx";
import BudgetsSection from "../setup/BudgetsSection.jsx";
import ProfileSection from "../setup/ProfileSection.jsx";
import AppLock from "../setup/AppLock.jsx";
import CsvImport from "../components/CsvImport.jsx";

/** Collapsible card: title + one-line summary collapsed, full form when open. */
function Section({ title, summary, open, onToggle, children }) {
  return (
    <div className={card}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="press flex w-full items-center justify-between text-left"
      >
        <span className={label}>{title}</span>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {summary}
          <ChevronDown
            size={15}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && <div className="anim-fade mt-3">{children}</div>}
    </div>
  );
}

/** Profile + accounts/debts editor; renders the "accounts" or "settings" section. */
export default function Setup({
  data,
  onSave,
  onReplayIntro,
  onReset,
  theme = "light",
  onSetTheme,
  section = "settings",
  prices = null,
}) {
  const {
    profile = {},
    accounts = [],
    debts = [],
    transactions = [],
    snapshots = [],
    holdings = [],
    settings = {},
  } = data;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const incomeSources = profile.incomeSources || [];
  const totalTypical = incomeSources.reduce((s, x) => s + (x.typicalMonthly || 0), 0);

  // accordion: each accounts group collapses to a one-line summary; empty groups
  // default open so a fresh setup shows the forms, filled ones start calm/closed.
  const [open, setOpen] = useState({});
  const isOpen = (id, empty) => open[id] ?? empty;
  const toggle = (id, empty) => setOpen((o) => ({ ...o, [id]: !(o[id] ?? empty) }));

  // accordion summaries (the section editors live in setup/*Section.jsx)
  const bills = profile.bills || [];
  const billsTotal = bills.reduce((s, b) => s + (b.amount || 0), 0);
  const debtsTotal = debts.reduce((s, d) => s + (d.balance || 0), 0);
  // known account balances total (null if none snapshotted yet)
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
  // an account's effective value: investment accounts derive from market value + cash
  // (falling back to the last synced snapshot), cash accounts use their latest balance.
  const marketByAcct = useMemo(
    () => holdingsValueByAccount(holdings, prices?.prices || {}),
    [holdings, prices],
  );
  const acctValue = (a) => {
    if (!INVESTMENT_TYPES.has(a.type)) {
      return latestBalances.get(a.id)?.balance ?? null;
    }
    // snapshot-first, matching net worth + AccountsSection (reconcile keeps it current)
    const snap = latestBalances.get(a.id)?.balance;
    if (snap != null) {
      return snap;
    }
    const market = marketByAcct[a.id] || 0;
    const cash = Number(a.cash) || 0;
    if (market > 0) {
      return market + cash;
    }
    return cash > 0 ? cash : null;
  };
  const accountsTotal = accounts.some((a) => acctValue(a) != null)
    ? accounts.reduce((s, a) => s + (acctValue(a) || 0), 0)
    : null;

  // backup: export (download) + import (replace)
  const fileRef = useRef(null);
  async function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    if (!window.confirm("Import will REPLACE all current data. Continue?")) {
      e.target.value = "";
      return;
    }
    try {
      await importData(JSON.parse(await file.text()));
      location.reload();
    } catch (err) {
      window.alert("Import failed: " + (err.message || err));
    }
    e.target.value = "";
  }
  // human/spreadsheet-friendly export of just the ledger (alongside the full JSON backup)
  function exportCsv() {
    const blob = new Blob([transactionsToCsv(transactions)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tsumiki-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {section === "accounts" && (
        <>
          {incomeSources.length === 0 &&
            accounts.length === 0 &&
            debts.length === 0 &&
            bills.length === 0 && (
              <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 text-sm text-brand-700">
                Set up your money here — add your income, bank accounts, recurring bills, and any
                debts. The plan uses these to tell you where each paycheck should go.
              </div>
            )}
          {/* Income sources */}
          <Section
            title="Income sources"
            summary={
              <>
                {incomeSources.length} {incomeSources.length === 1 ? "source" : "sources"} ·{" "}
                <Money n={totalTypical} />
                /mo
              </>
            }
            open={isOpen("income", incomeSources.length === 0)}
            onToggle={() => toggle("income", incomeSources.length === 0)}
          >
            <IncomeSection data={data} onSave={onSave} />
          </Section>

          {/* Accounts */}
          <Section
            title="Accounts"
            summary={
              <>
                {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
                {accountsTotal != null && (
                  <>
                    {" · "}
                    <Money n={accountsTotal} />
                  </>
                )}
              </>
            }
            open={isOpen("accounts", accounts.length === 0)}
            onToggle={() => toggle("accounts", accounts.length === 0)}
          >
            <AccountsSection data={data} onSave={onSave} prices={prices} />
          </Section>

          {/* Recurring bills (essentials) */}
          <Section
            title="Recurring bills"
            summary={
              <>
                {bills.length} {bills.length === 1 ? "bill" : "bills"} · <Money n={billsTotal} />
                /mo
              </>
            }
            open={isOpen("bills", bills.length === 0)}
            onToggle={() => toggle("bills", bills.length === 0)}
          >
            <BillsSection data={data} onSave={onSave} />
          </Section>

          {/* Debts */}
          <Section
            title="Debts"
            summary={
              <>
                {debts.length} {debts.length === 1 ? "debt" : "debts"}
                {debtsTotal > 0 && (
                  <>
                    {" · "}
                    <Money n={debtsTotal} />
                  </>
                )}
              </>
            }
            open={isOpen("debts", debts.length === 0)}
            onToggle={() => toggle("debts", debts.length === 0)}
          >
            <DebtsSection data={data} onSave={onSave} />
          </Section>
        </>
      )}

      {section === "settings" && (
        <>
          {/* Profile */}
          <ProfileSection data={data} onSave={onSave} />

          {/* Appearance */}
          <div className={card}>
            <div className={label + " mb-3"}>Appearance</div>
            <div className="flex gap-1 p-1 bg-slate-50 rounded-xl">
              {[
                ["light", "Light"],
                ["dark", "Dark"],
                ["system", "System"],
              ].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => onSetTheme?.(v)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${theme === v ? "bg-white dark:bg-slate-600 shadow-sm text-brand-700" : "text-slate-500"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* App lock (optional password) */}
          <AppLock />

          {/* Privacy — blur money on screen */}
          <div className={card}>
            <div className={label + " mb-3"}>Privacy</div>
            <label className="flex cursor-pointer items-center justify-between gap-2 text-sm text-slate-700">
              Blur dollar amounts
              <input
                type="checkbox"
                checked={!!settings.blurMoney}
                onChange={(e) =>
                  onSave({ ...data, settings: { ...settings, blurMoney: e.target.checked } })
                }
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
            </label>
            <div className="mt-2 text-xs text-slate-500">
              Hides every amount behind a blur so balances aren't exposed on a glanced-at screen.
              Toggle anytime with the eye icon in the header; hover an amount to peek.
            </div>
          </div>

          {/* Reminders — which time-based alerts show on Home */}
          <div className={card}>
            <div className={label + " mb-3"}>Reminders</div>
            <div className="space-y-2.5">
              {[
                ["payday", "Upcoming paydays"],
                ["bill", "Bills due soon"],
                ["buffer", "Low checking buffer"],
                ["tax", "Estimated-tax deadlines"],
                ["streak", "Streak about to lapse"],
              ].map(([k, l]) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center justify-between gap-2 text-sm text-slate-700"
                >
                  {l}
                  <input
                    type="checkbox"
                    checked={settings.reminders?.[k] ?? true}
                    onChange={(e) =>
                      onSave({
                        ...data,
                        settings: {
                          ...settings,
                          reminders: { ...(settings.reminders || {}), [k]: e.target.checked },
                        },
                      })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                </label>
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Shown on Home; turned-off ones are hidden.
            </div>
          </div>

          {/* Category budgets (envelope caps) */}
          <BudgetsSection data={data} onSave={onSave} />

          {/* Import transactions from a bank CSV */}
          <div className={card}>
            <div className={label + " mb-3"}>Import transactions (CSV)</div>
            <CsvImport
              existing={transactions}
              onImport={(txs) => onSave({ ...data, transactions: [...transactions, ...txs] })}
            />
          </div>

          {/* Backup: export / import */}
          <div className={card}>
            <div className={label + " mb-3"}>Backup</div>
            {(() => {
              const hasData = transactions.length > 0 || accounts.length > 0;
              const days = settings.lastBackup
                ? Math.floor((Date.now() - settings.lastBackup) / 86400000)
                : null;
              const stale = hasData && (days == null || days >= 30);
              return (
                <div
                  className={`mb-3 rounded-lg p-2.5 text-xs ${stale ? "bg-amber-50 text-amber-800" : "text-slate-500"}`}
                >
                  {days == null
                    ? stale
                      ? "You haven't backed up yet — export a copy to be safe."
                      : "No backup yet."
                    : `Last backed up ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}.${stale ? " Worth exporting a fresh copy." : ""}`}
                </div>
              );
            })()}
            <div className="flex gap-2">
              <a
                href={exportUrl()}
                onClick={() =>
                  onSave({ ...data, settings: { ...settings, lastBackup: Date.now() } })
                }
                className="flex-1 text-center py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg"
              >
                Export data
              </a>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 py-2 border border-slate-300 text-slate-700 hover:border-slate-400 text-sm font-semibold rounded-lg"
              >
                Import data
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                onChange={onImportFile}
                className="hidden"
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>Export downloads everything as JSON. Import replaces all current data.</span>
              {transactions.length > 0 && (
                <button
                  onClick={exportCsv}
                  className="flex-shrink-0 font-medium text-brand-600 hover:text-brand-700"
                >
                  Export CSV ›
                </button>
              )}
            </div>
          </div>

          {/* Danger zone: wipe everything and start over */}
          <div className={card + " border-rose-200"}>
            <div className={label + " mb-1"}>Danger zone</div>
            <div className="text-xs text-slate-500 mb-3">
              Permanently erase all your data — accounts, transactions, profile, everything — and
              start fresh. Export first if you might want it back.
            </div>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full py-2 border border-rose-300 text-rose-600 hover:bg-rose-50 text-sm font-semibold rounded-lg"
              >
                Delete all my data
              </button>
            ) : (
              <div className="space-y-2">
                <div className="text-sm text-rose-600 font-medium">
                  This can't be undone. Really delete everything?
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 py-2 border border-slate-300 text-slate-700 hover:border-slate-400 text-sm font-semibold rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setConfirmDelete(false);
                      onReset?.();
                    }}
                    className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-lg"
                  >
                    Yes, delete everything
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Help */}
          <div className={card}>
            <div className={label + " mb-3"}>Help</div>
            <button
              onClick={() => onReplayIntro?.()}
              className="w-full py-2 border border-slate-300 text-slate-700 hover:border-slate-400 text-sm font-semibold rounded-lg"
            >
              Replay intro & tips
            </button>
          </div>
        </>
      )}
    </>
  );
}
