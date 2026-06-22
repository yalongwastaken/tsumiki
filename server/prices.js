// prices.js — OPT-IN nightly stock-price sync. Off unless TSUMIKI_PRICES is set,
// so a stock install makes zero outbound calls. When on, it fetches daily closes
// for ONLY the tickers you hold (symbols aren't personal) from a keyless public
// source (Stooq), caches them, keeps a short history for week-over-week moves, and
// fails gracefully to the last good prices when offline. Nothing about you leaves.
import { getState, appendPortfolioPoint, getPortfolioHistory } from "./db.js";

const ENABLED = ["1", "true", "yes"].includes((process.env.TSUMIKI_PRICES || "").toLowerCase());
const FEED =
  process.env.TSUMIKI_PRICE_URL || "https://stooq.com/q/l/?s={SYMBOLS}&f=sd2ohlcv&h&e=csv";
const TTL = 20 * 60 * 60 * 1000; // refetch at most ~daily
const HIST_MAX = 40;

let cache = { prices: {}, fetchedAt: 0 };
const history = {}; // SYMBOL → [{ date, price }]

/**
 * Parse a Stooq CSV (header + rows) into latest closes. Pure — no network.
 * @returns {Array<{symbol, close, date}>}
 */
export function parseStooqCsv(csv = "") {
  const lines = String(csv).trim().split(/\r?\n/);
  if (lines.length < 2) {
    return [];
  }
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const ci = header.indexOf("close");
  const si = header.indexOf("symbol");
  const di = header.indexOf("date");
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const close = parseFloat(cells[ci]);
    const symbol = (cells[si] || "").replace(/\.[A-Z]+$/i, "").toUpperCase();
    if (!symbol || !isFinite(close) || close <= 0) {
      continue;
    }
    out.push({ symbol, close, date: (cells[di] || "").trim() });
  }
  return out;
}

function recordHistory(symbol, date, price) {
  const h = (history[symbol] = history[symbol] || []);
  if (!h.length || h[h.length - 1].date !== date) {
    h.push({ date, price });
    if (h.length > HIST_MAX) {
      h.shift();
    }
  }
  // week-over-week change: compare to ~5 trading days ago when we have it
  const prior = h.length > 5 ? h[h.length - 6].price : null;
  return prior && prior > 0 ? (price - prior) / prior : null;
}

/** Fetch + cache closes for the tickers currently held; keep last cache on failure. */
export async function refreshPrices() {
  if (!ENABLED) {
    return cache;
  }
  const symbols = [
    ...new Set((getState().holdings || []).map((h) => String(h.ticker).toUpperCase())),
  ];
  if (!symbols.length) {
    return cache;
  }
  try {
    const url = FEED.replace("{SYMBOLS}", symbols.map((s) => `${s.toLowerCase()}.us`).join(","));
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return cache;
    }
    const rows = parseStooqCsv(await res.text());
    if (rows.length) {
      const prices = { ...cache.prices };
      for (const r of rows) {
        const changePct = recordHistory(r.symbol, r.date, r.close);
        prices[r.symbol] = { price: r.close, date: r.date, changePct };
      }
      cache = { prices, fetchedAt: Date.now() };
      // record today's total portfolio value so the client can chart it over time
      const holdings = getState().holdings || [];
      const value = holdings.reduce((sum, h) => {
        const p = prices[String(h.ticker).toUpperCase()]?.price;
        return sum + (p ? p * (h.shares || 0) : 0);
      }, 0);
      if (value > 0) {
        appendPortfolioPoint(value);
      }
    }
  } catch {
    // offline / timeout / bad feed — serve whatever we had
  }
  return cache;
}

/** Cached prices, refreshing lazily when stale. */
export async function getPrices() {
  if (ENABLED && Date.now() - cache.fetchedAt > TTL) {
    await refreshPrices();
  }
  return {
    enabled: ENABLED,
    prices: cache.prices,
    fetchedAt: cache.fetchedAt || null,
    history: getPortfolioHistory(),
  };
}

/** Kick off a refresh now + nightly (no-op when disabled). */
export function schedulePrices() {
  if (!ENABLED) {
    return null;
  }
  refreshPrices();
  return setInterval(refreshPrices, 24 * 60 * 60 * 1000);
}
