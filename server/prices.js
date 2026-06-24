// prices.js — OPT-IN nightly stock-price sync. Off unless TSUMIKI_PRICES is set, so a
// stock install makes zero outbound calls. When on, it fetches daily closes for ONLY
// the tickers you hold (symbols aren't personal), tries each configured provider in
// order until one returns data, caches the result, keeps a short per-symbol history for
// week-over-week moves, and records the outcome of the last sync so the UI can show
// "synced / nothing came back / failed" instead of silently serving stale prices.
//
// Providers, tried in order:
//   1. keyless CSV feed(s) — TSUMIKI_PRICE_URL (Stooq by default; comma-separate to
//      list fallbacks). {SYMBOLS} is replaced with the lowercased ".us" tickers.
//   2. Finnhub JSON quotes — only when TSUMIKI_FINNHUB_KEY is set (a real fallback for
//      when the keyless feed is blocked/rate-limited).
import {
  getState,
  appendPortfolioPoint,
  getPortfolioHistory,
  getSymbolPriceHistory,
  setSymbolPriceHistory,
} from "./db.js";
import { fetchTextCapped } from "./http.js";

const TTL = 20 * 60 * 60 * 1000; // refetch at most ~daily
const HIST_MAX = 40;
const DEFAULT_STOOQ = "https://stooq.com/q/l/?s={SYMBOLS}&f=sd2ohlcv&h&e=csv";

// env read live (not cached at import) so tests can vary it between cases
const enabled = () =>
  ["1", "true", "yes"].includes((process.env.TSUMIKI_PRICES || "").toLowerCase());
const feedUrls = () =>
  (process.env.TSUMIKI_PRICE_URL || DEFAULT_STOOQ)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const finnhubKey = () => process.env.TSUMIKI_FINNHUB_KEY || "";
const finnhubUrl = () => process.env.TSUMIKI_FINNHUB_URL || "https://finnhub.io/api/v1/quote";

let cache = { prices: {}, fetchedAt: 0 };
// outcome of the most recent refresh attempt (surfaced via getPrices)
let lastSync = { status: "idle", at: 0, source: null, missing: [] };

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

/** Parse a Finnhub /quote JSON for one symbol → a row, or null when there's no price. */
export function parseFinnhubQuote(symbol, json) {
  let j;
  try {
    j = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return null;
  }
  const close = Number(j?.c);
  if (!isFinite(close) || close <= 0) {
    return null;
  }
  const date = j?.t
    ? new Date(j.t * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return { symbol: String(symbol).toUpperCase(), close, date };
}

// ── providers (each returns rows or throws/[]) ──────────────────────────────────
async function fetchStooq(url, symbols) {
  const full = url.replace("{SYMBOLS}", symbols.map((s) => `${s.toLowerCase()}.us`).join(","));
  const text = await fetchTextCapped(full, { maxBytes: 2_000_000 });
  return text == null ? [] : parseStooqCsv(text);
}
async function fetchFinnhub(symbols) {
  const base = finnhubUrl();
  const key = finnhubKey();
  const rows = [];
  for (const s of symbols) {
    try {
      const u = `${base}?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(key)}`;
      const text = await fetchTextCapped(u, { maxBytes: 100_000 });
      const row = text == null ? null : parseFinnhubQuote(s, text);
      if (row) {
        rows.push(row);
      }
    } catch {
      /* skip this symbol; other providers/symbols still count */
    }
  }
  return rows;
}
function providers() {
  const list = feedUrls().map((url, i) => ({
    name: i === 0 ? "feed" : `feed-${i + 1}`,
    fetch: (syms) => fetchStooq(url, syms),
  }));
  if (finnhubKey()) {
    list.push({ name: "finnhub", fetch: fetchFinnhub });
  }
  return list;
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
  if (!enabled()) {
    lastSync = { status: "disabled", at: Date.now(), source: null, missing: [] };
    return cache;
  }
  const symbols = [
    ...new Set((getState().holdings || []).map((h) => String(h.ticker).toUpperCase())),
  ];
  if (!symbols.length) {
    lastSync = { status: "ok", at: Date.now(), source: null, missing: [] };
    return cache;
  }
  // try each provider in order; first one to return any rows wins
  let rows = [];
  let source = null;
  let anyError = false;
  for (const p of providers()) {
    try {
      const got = await p.fetch(symbols);
      if (got && got.length) {
        rows = got;
        source = p.name;
        break;
      }
    } catch {
      anyError = true;
    }
  }

  if (rows.length) {
    const prices = { ...cache.prices };
    const history = getSymbolPriceHistory(); // persisted → week-over-week survives restarts
    for (const r of rows) {
      const changePct = recordHistory(history, r.symbol, r.date, r.close);
      prices[r.symbol] = { price: r.close, date: r.date, changePct };
    }
    setSymbolPriceHistory(history);
    cache = { prices, fetchedAt: Date.now() };
    // record today's total portfolio value so the client can chart it over time
    const value = (getState().holdings || []).reduce((sum, h) => {
      const p = prices[String(h.ticker).toUpperCase()]?.price;
      return sum + (p ? p * (h.shares || 0) : 0);
    }, 0);
    if (value > 0) {
      appendPortfolioPoint(value);
    }
    const have = new Set(rows.map((r) => r.symbol));
    const missing = symbols.filter((s) => !have.has(s));
    lastSync = { status: missing.length ? "partial" : "ok", at: Date.now(), source, missing };
  } else {
    // nothing came back: distinguish "providers errored/unreachable" from "returned empty"
    lastSync = {
      status: anyError ? "error" : "empty",
      at: Date.now(),
      source: null,
      missing: symbols,
    };
  }
  return cache;
}

/** Cached prices, refreshing lazily when stale. */
export async function getPrices() {
  if (enabled() && Date.now() - cache.fetchedAt > TTL) {
    await refreshPrices();
  }
  return {
    enabled: enabled(),
    prices: cache.prices,
    fetchedAt: cache.fetchedAt || null,
    history: getPortfolioHistory(),
    lastSync,
  };
}

/** Kick off a refresh now + nightly (no-op when disabled). */
export function schedulePrices() {
  if (!enabled()) {
    return null;
  }
  refreshPrices();
  return setInterval(refreshPrices, 24 * 60 * 60 * 1000);
}
