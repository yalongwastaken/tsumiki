// selectors.js — shared pure derivations over the ledger + account snapshots.

/** Month key like "2026-06" for a date. */
export const monthKey = (date) => new Date(date).toISOString().slice(0, 7);

/** Current month key. */
export const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Most recent snapshot per account.
 * @returns {Object} map of accountId → snapshot
 */
export function latestSnapshots(snapshots = []) {
  const latest = {};
  for (const s of snapshots) {
    // keep the newest snapshot we've seen for this account
    if (!latest[s.accountId] || new Date(s.date) > new Date(latest[s.accountId].date)) {
      latest[s.accountId] = s;
    }
  }
  return latest;
}

/**
 * Net worth = sum of every account's most recent snapshot balance.
 * @returns {number}
 */
export function netWorthFromSnapshots(snapshots = []) {
  return Object.values(latestSnapshots(snapshots)).reduce((a, s) => a + s.balance, 0);
}

/**
 * Sum of latest balances for accounts whose type is in `types`.
 * @returns {number}
 */
export function sumLatestByType(accounts = [], snapshots = [], types = []) {
  const latest = latestSnapshots(snapshots);
  const set = new Set(types);
  return accounts
    .filter((a) => set.has(a.type))
    .reduce((sum, a) => sum + (latest[a.id]?.balance || 0), 0);
}

/**
 * Sum a month's transactions by type. Shared so Plan/Home don't each re-derive it.
 * @returns {{income, spending, contribution}}
 */
export function monthTotals(transactions = [], ym = thisMonth()) {
  let income = 0;
  let spending = 0;
  let contribution = 0;
  for (const t of transactions) {
    if (monthKey(t.date) !== ym) {
      continue;
    }
    if (t.type === "income") {
      income += t.amount;
    } else if (t.type === "spending") {
      spending += t.amount;
    } else if (t.type === "contribution") {
      contribution += t.amount;
    }
  }
  return { income, spending, contribution };
}

/**
 * Average monthly contributions across months that have any — your recent saving
 * pace, used to judge whether a dated goal is on track.
 * @returns {number} 0 when nothing has been contributed
 */
export function avgMonthlyContribution(transactions = []) {
  const byMonth = {};
  for (const t of transactions) {
    if (t.type === "contribution" && t.amount > 0) {
      const m = monthKey(t.date);
      byMonth[m] = (byMonth[m] || 0) + t.amount;
    }
  }
  const vals = Object.values(byMonth);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

/**
 * Average monthly spending, annualized (×12).
 * @returns {number} 0 when no spending has been logged
 */
export function annualSpend(transactions = []) {
  const spending = transactions.filter((tx) => tx.type === "spending" && tx.amount > 0);
  if (spending.length === 0) {
    return 0;
  }

  const months = new Set(spending.map((tx) => monthKey(tx.date)));
  const total = spending.reduce((sum, tx) => sum + tx.amount, 0);
  return (total / Math.max(1, months.size)) * 12;
}
