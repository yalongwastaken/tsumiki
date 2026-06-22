// portfolio.js — pure derivations over manually-entered holdings + synced prices.
// prices is a map: { TICKER: { price, date, changePct } }. All explainable, tested.

/** Per-holding rows enriched with price, market value, and gain vs cost basis. */
export function portfolioRows(holdings = [], prices = {}) {
  return holdings.map((h) => {
    const ticker = String(h.ticker || "").toUpperCase();
    const q = prices[ticker] || {};
    const price = typeof q.price === "number" ? q.price : null;
    const value = price != null ? price * h.shares : null;
    const perShareCost = typeof h.costBasis === "number" ? h.costBasis : null;
    const cost = perShareCost != null ? perShareCost * h.shares : null;
    const gain = value != null && cost != null ? value - cost : null;
    const gainPct = gain != null && cost > 0 ? gain / cost : null;
    return {
      id: h.id,
      ticker,
      shares: h.shares,
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
