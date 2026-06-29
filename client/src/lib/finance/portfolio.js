// portfolio.js — pure derivations over manually-entered holdings + synced prices.
// prices is a map: { TICKER: { price, date, changePct } }. All explainable, tested.
import { uid } from "../core/uid.js";
import { dayKey } from "../core/selectors.js";

/**
 * The price per share to value a holding with. A holding flagged `manual` (its price
 * isn't synced — e.g. a mutual fund) always uses its user-entered `manualPrice`; an
 * auto holding uses the synced price, falling back to `manualPrice` until a sync lands.
 * @returns {{price:number|null, manual:boolean}} effective price + whether it's manual
 */
export function effectivePrice(h = {}, prices = {}) {
  const synced = prices[String(h.ticker || "").toUpperCase()];
  const syncedPrice = synced && typeof synced.price === "number" ? synced.price : null;
  const manualPrice =
    typeof h.manualPrice === "number" && Number.isFinite(h.manualPrice) && h.manualPrice >= 0
      ? h.manualPrice
      : null;
  if (h.manual) {
    return { price: manualPrice, manual: true };
  }
  // auto: prefer the synced price; before the first sync, fall back to any manual price
  return { price: syncedPrice ?? manualPrice, manual: syncedPrice == null && manualPrice != null };
}

/** Per-holding rows enriched with price, market value, and gain vs cost basis. */
export function portfolioRows(holdings = [], prices = {}) {
  return holdings.map((h) => {
    const ticker = String(h.ticker || "").toUpperCase();
    const q = prices[ticker] || {};
    const { price, manual } = effectivePrice(h, prices);
    // guard against a non-finite shares count poisoning value (and thus totals) with NaN
    const value = price != null && Number.isFinite(price * h.shares) ? price * h.shares : null;
    const perShareCost = typeof h.costBasis === "number" ? h.costBasis : null;
    const cost =
      perShareCost != null && Number.isFinite(perShareCost * h.shares)
        ? perShareCost * h.shares
        : null;
    const gain = value != null && cost != null ? value - cost : null;
    const gainPct = gain != null && cost > 0 ? gain / cost : null;
    return {
      id: h.id,
      ticker,
      shares: h.shares,
      account: h.account || "taxable", // taxable | 401k | ira | roth
      price,
      value,
      cost,
      gain,
      gainPct,
      manual, // price came from a manual entry (sync off, or not yet synced), not the feed
      changePct: typeof q.changePct === "number" ? q.changePct : null,
      date: q.date || null,
    };
  });
}

/**
 * Total market value of holdings grouped by their linked account id. Only holdings
 * with an `accountId` and a known price contribute. Used to keep a linked account's
 * balance in sync with the securities held in it after a price sync.
 * @returns {Object} map of accountId → market value
 */
export function holdingsValueByAccount(holdings = [], prices = {}) {
  const out = {};
  for (const h of holdings) {
    if (!h.accountId) {
      continue;
    }
    // use the effective price (manual entry or synced) so a manually-priced holding
    // still contributes to its account's value
    const { price } = effectivePrice(h, prices);
    const value = price != null ? price * h.shares : null;
    if (value == null || !Number.isFinite(value)) {
      continue;
    }
    out[h.accountId] = (out[h.accountId] || 0) + value;
  }
  return out;
}

/** Account types that hold securities (their balance is derived from holdings + cash). */
export const INVESTMENT_TYPES = new Set(["brokerage", "ira", "roth", "401k"]);

/** Holding tax tag implied by the account type it lives in. */
export const TAX_TAG_FOR_TYPE = { brokerage: "taxable", ira: "ira", roth: "roth", "401k": "401k" };

/** Account types that are tax-advantaged (retirement) vs a taxable brokerage. */
export const RETIREMENT_ACCOUNTS = new Set(["401k", "ira", "roth"]);

/** Sum of priced value held in retirement (tax-advantaged) accounts. */
export function retirementValue(rows = []) {
  return rows
    .filter((r) => RETIREMENT_ACCOUNTS.has(r.account) && r.value != null)
    .reduce((s, r) => s + r.value, 0);
}

/**
 * Portfolio totals. `value` sums every priced row; `gain`/`gainPct` only count
 * rows where both price and cost basis are known (so a missing basis won't skew it).
 * @returns {{value:number, gain:number|null, gainPct:number|null, priced:boolean}}
 */
export function portfolioTotals(rows = []) {
  const value = rows.reduce((s, r) => s + (r.value || 0), 0);
  const withBoth = rows.filter((r) => r.value != null && r.cost != null);
  const cb = withBoth.reduce((s, r) => s + r.cost, 0);
  const mv = withBoth.reduce((s, r) => s + r.value, 0);
  const gain = withBoth.length ? mv - cb : null;
  return {
    value,
    gain,
    gainPct: gain != null && cb > 0 ? gain / cb : null,
    priced: rows.some((r) => r.value != null),
  };
}

/**
 * Deterministic, explainable portfolio-health recommendations — never buy/sell
 * picks. Concentration risk, big recent moves, and a single-stock-risk nudge.
 * @returns {Array<{id, text, tone}>}
 */
export function portfolioInsights(rows = [], totals = {}) {
  const out = [];
  const value = totals.value || 0;

  // concentration risk: one position dominates the portfolio
  if (value > 0) {
    const top = rows.filter((r) => r.value != null).sort((a, b) => b.value - a.value)[0];
    if (top && top.value / value >= 0.4) {
      out.push({
        id: "concentration",
        tone: "warn",
        text: `${top.ticker} is ${Math.round((top.value / value) * 100)}% of your portfolio — a lot riding on one company. A low-cost index fund spreads that risk.`,
      });
    }
  }

  // notable recent moves (from the synced price history)
  for (const r of rows) {
    if (r.changePct != null && Math.abs(r.changePct) >= 0.08) {
      const dir = r.changePct < 0 ? "down" : "up";
      out.push({
        id: `move-${r.ticker}`,
        tone: r.changePct < 0 ? "warn" : "good",
        text: `${r.ticker} is ${dir} ${Math.abs(Math.round(r.changePct * 100))}% recently.`,
      });
    }
  }

  // tax-advantaged nudge: holding only in taxable accounts
  if (value > 0 && retirementValue(rows) === 0) {
    out.push({
      id: "tax-advantaged",
      tone: "info",
      text: "None of your tracked holdings are in a 401(k)/IRA. Tax-advantaged accounts let the same investments grow without yearly taxes.",
    });
  }

  // general single-stock-risk education (skip if concentration already covers it)
  if (rows.length > 0 && !out.some((o) => o.id === "concentration")) {
    out.push({
      id: "single-stock",
      tone: "info",
      text: "You hold individual stocks. Keeping the core of your investing in a low-cost index fund reduces single-company risk.",
    });
  }

  return out.slice(0, 3);
}

/**
 * Auto-value investment accounts: for each brokerage/IRA/Roth/401k account, ensure
 * today's snapshot equals its holdings' market value + uninvested cash. Pure + idempotent:
 * - never writes a spurious $0 (skips accounts with nothing to value yet),
 * - when shares can't be priced right now, keeps the last synced "holdings" snapshot,
 * - never clobbers a MANUAL same-day edit (only touches its own source:"holdings" snapshot).
 * @returns {{snapshots: Array, changed: boolean}} the (possibly new) snapshots + whether it changed
 */
export function reconcileInvestmentSnapshots(
  { accounts = [], holdings = [], snapshots = [] },
  priceMap = {},
  now = new Date(),
) {
  const byAcct = holdingsValueByAccount(holdings, priceMap);
  // bucket "today" on the LOCAL calendar so the auto-valuation day flips at the user's
  // midnight, not UTC's (matches streak/insights/forecast day bucketing)
  const todayKey = dayKey(now);
  const isToday = (s, accId) => s.accountId === accId && dayKey(s.date) === todayKey;
  let snaps = snapshots;
  let changed = false;
  for (const a of accounts) {
    if (!INVESTMENT_TYPES.has(a.type)) {
      continue;
    }
    const hasHoldings = holdings.some((h) => h.accountId === a.id);
    const market = byAcct[a.id] || 0;
    const cash = Number(a.cash) || 0;
    if (!hasHoldings && cash <= 0) {
      continue; // nothing to value yet — don't write a spurious $0 snapshot
    }
    if (hasHoldings && market <= 0) {
      // can't price the shares right now: keep the last synced "holdings" snapshot if we
      // have one; only when there's none do we still record the cash floor.
      const hasPrior = snaps.some((s) => s.accountId === a.id && s.source === "holdings");
      if (hasPrior || cash <= 0) {
        continue;
      }
    }
    const val = Math.round(market + cash);
    const ours = snaps.find((s) => isToday(s, a.id) && s.source === "holdings");
    if (ours) {
      if (Math.round(ours.balance) !== val) {
        snaps = snaps.map((s) => (s === ours ? { ...s, balance: val } : s));
        changed = true;
      }
    } else if (snaps.some((s) => isToday(s, a.id))) {
      continue; // a manual snapshot already exists for today — respect it
    } else {
      snaps = [
        ...snaps,
        { id: uid(), accountId: a.id, date: now.toISOString(), balance: val, source: "holdings" },
      ];
      changed = true;
    }
  }
  return { snapshots: snaps, changed };
}

/** Display order + colors for the account-type (tax) buckets in the stocks flow. */
export const ACCOUNT_META = [
  { key: "taxable", label: "Taxable", color: "#378ADD" },
  { key: "401k", label: "401(k)", color: "#1D9E75" },
  { key: "ira", label: "IRA", color: "#E0A356" },
  { key: "roth", label: "Roth", color: "#A78BFA" },
];

/**
 * Build the stocks-flow structure for a Sankey: the portfolio total separated into
 * account-type buckets, each split into its individual tickers. Only priced holdings
 * (value > 0) contribute; duplicate tickers within a bucket are merged; buckets and
 * their holdings are ordered by value, descending. Pure.
 * @returns {{total:number, buckets:Array<{key,label,color,value,holdings:Array<{ticker,value}>}>}}
 */
export function portfolioFlow(rows = []) {
  const priced = rows.filter((r) => r.value != null && r.value > 0);
  const total = priced.reduce((s, r) => s + r.value, 0);
  // bucket key → { ticker → summed value } (merges multiple lots of the same ticker)
  const byKey = {};
  for (const r of priced) {
    const key = r.account || "taxable";
    const b = (byKey[key] = byKey[key] || {});
    b[r.ticker] = (b[r.ticker] || 0) + r.value;
  }
  // keep the known buckets in display order, then any unexpected keys after
  const order = [...ACCOUNT_META.map((m) => m.key), ...Object.keys(byKey)];
  const seen = new Set();
  const buckets = [];
  for (const key of order) {
    if (seen.has(key) || !byKey[key]) {
      continue;
    }
    seen.add(key);
    const meta = ACCOUNT_META.find((m) => m.key === key);
    const holdings = Object.entries(byKey[key])
      .map(([ticker, value]) => ({ ticker, value }))
      .sort((a, b) => b.value - a.value);
    buckets.push({
      key,
      label: meta ? meta.label : key,
      color: meta ? meta.color : "#64748B",
      value: holdings.reduce((s, h) => s + h.value, 0),
      holdings,
    });
  }
  buckets.sort((a, b) => b.value - a.value);
  return { total, buckets };
}
