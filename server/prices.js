// prices.js — OPT-IN nightly stock-price sync. Off unless TSUMIKI_PRICES is set,
// so a stock install makes zero outbound calls. When on, it fetches daily closes
// for ONLY the tickers you hold (symbols aren't personal) from a keyless public
// source (Stooq), caches them, keeps a short history for week-over-week moves, and
// fails gracefully to the last good prices when offline. Nothing about you leaves.
import {
  getState,
  appendPortfolioPoint,
  getPortfolioHistory,
  getSymbolPriceHistory,
  setSymbolPriceHistory,
} from "./db.js";
import { fetchTextCapped } from "./http.js";

const ENABLED = ["1", "true", "yes"].includes((process.env.TSUMIKI_PRICES || "").toLowerCase());
const FEED =
  process.env.TSUMIKI_PRICE_URL || "https://stooq.com/q/l/?s={SYMBOLS}&f=sd2ohlcv&h&e=csv";
const TTL = 20 * 60 * 60 * 1000; // refetch at most ~daily
const HIST_MAX = 40;

let cache = { prices: {}, fetchedAt: 0 };

// split one CSV line, honoring "quoted, fields" and "" escapes. Stooq's own feed is
// plain, but a custom TSUMIKI_PRICE_URL might not be — be tolerant either way.
function splitCsvLine(line) {
  const out = [];
  let cur = "",
    q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          q = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      q = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse a Stooq CSV (header + rows) into latest closes. Pure — no network.
 * Tolerant of a BOM, quoted fields, blank lines, and Stooq's "N/D" no-data marker
 * (which yields NaN and is skipped rather than cached as a price).
 * @returns {Array<{symbol, close, date}>}
 */
export function parseStooqCsv(csv = "") {
  const lines = String(csv)
    .replace(/^\uFEFF/, "") // strip a leading byte-order mark
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) {
    return [];
  }
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const ci = header.indexOf("close");
  const si = header.indexOf("symbol");
  const di = header.indexOf("date");
  // without a symbol+close column there's nothing reliable to read
  if (ci === -1 || si === -1) {
    return [];
  }
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const close = parseFloat(cells[ci]);
    // strip the exchange suffix (.US/.UK/.DE …) but NOT a 1-letter class share (BRK.B)
    const symbol = (cells[si] || "").replace(/\.[A-Z]{2,}$/i, "").toUpperCase();
    if (!symbol || !isFinite(close) || close <= 0) {
      continue;
    }
    out.push({ symbol, close, date: di === -1 ? "" : cells[di] || "" });
  }
  return out;
}

// append a close to a symbol's persisted history and return its week-over-week change
function recordHistory(history, symbol, date, price) {
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

let inFlight = null; // single-flight guard: scheduler + lazy + manual refresh share one fetch

/** Fetch + cache closes for held tickers; concurrent calls share one in-flight fetch. */
export function refreshPrices() {
  if (inFlight) {
    return inFlight;
  }
  inFlight = doRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh() {
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
    const text = await fetchTextCapped(url, { maxBytes: 2_000_000 });
    if (text == null) {
      return cache;
    }
    const rows = parseStooqCsv(text);
    if (rows.length) {
      const prices = { ...cache.prices };
      // load persisted per-symbol history so week-over-week change survives restarts
      const history = getSymbolPriceHistory();
      for (const r of rows) {
        const changePct = recordHistory(history, r.symbol, r.date, r.close);
        prices[r.symbol] = { price: r.close, date: r.date, changePct };
      }
      setSymbolPriceHistory(history);
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
