// selectors.js — shared pure derivations over the unified ledger + account
// snapshots. Centralized so the same logic isn't re-implemented (and allowed to
// drift) across App / Plan / Home / Sankey. All pure + memo-friendly.

// "2026-06" style month key for a date
export const monthKey = (date) => new Date(date).toISOString().slice(0, 7);
export const thisMonth = () => new Date().toISOString().slice(0, 7);

// latest snapshot per account, keyed by accountId
export function latestSnapshots(snapshots = []) {
  const latest = {};
  for (const s of snapshots)
    if (!latest[s.accountId] || new Date(s.date) > new Date(latest[s.accountId].date)) latest[s.accountId] = s;
  return latest;
}

// net worth = sum of every account's most recent snapshot balance
export function netWorthFromSnapshots(snapshots = []) {
  return Object.values(latestSnapshots(snapshots)).reduce((a, s) => a + s.balance, 0);
}

// sum of latest balances for accounts whose type is in `types`
export function sumLatestByType(accounts = [], snapshots = [], types = []) {
  const latest = latestSnapshots(snapshots);
  const set = new Set(types);
  return accounts.filter((a) => set.has(a.type)).reduce((sum, a) => sum + (latest[a.id]?.balance || 0), 0);
}

// average monthly spending × 12 (0 when nothing is logged)
export function annualSpend(transactions = []) {
  const sp = transactions.filter((t) => t.type === "spending");
  if (!sp.length) return 0;
  const months = new Set(sp.map((t) => monthKey(t.date)));
  return (sp.reduce((s, t) => s + t.amount, 0) / Math.max(1, months.size)) * 12;
}

// transactions in a given month key (defaults to the current month)
export function inMonth(transactions = [], ym = thisMonth()) {
  return transactions.filter((t) => monthKey(t.date) === ym);
}
