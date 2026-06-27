// portfolio.js — pure derivations over manually-entered holdings + synced prices.
// prices is a map: { TICKER: { price, date, changePct } }. All explainable, tested.

/** Per-holding rows enriched with price, market value, and gain vs cost basis. */
export function portfolioRows(holdings = [], prices = {}) {
  return holdings.map((h) => {
    const ticker = String(h.ticker || "").toUpperCase();
    const q = prices[ticker] || {};
    const price = typeof q.price === "number" ? q.price : null;
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
    const q = prices[String(h.ticker || "").toUpperCase()];
    const price = q && typeof q.price === "number" ? q.price : null;
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

/**
 * Derived balance of an investment account: market value of its linked holdings
 * (from the latest synced prices) plus any uninvested cash. Returns null for a
 * non-investment account (those keep a manually-entered balance).
 * @returns {number|null}
 */
export function investmentAccountValue(account = {}, holdings = [], prices = {}) {
  if (!INVESTMENT_TYPES.has(account.type)) {
    return null;
  }
  const market = holdingsValueByAccount(holdings, prices)[account.id] || 0;
  return market + (Number(account.cash) || 0);
}

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
