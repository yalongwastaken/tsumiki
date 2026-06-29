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
const RETRY_FLOOR = 5 * 60 * 1000; // after a failed sync, wait this long before a lazy retry
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
  // guard the timestamp: a garbage/out-of-range `t` (e.g. 9e15 or Infinity) makes
  // new Date(...).toISOString() throw, which would discard an otherwise-valid close.
  // Fall back to today's date instead of dropping the price.
  const stamped = j?.t ? new Date(j.t * 1000) : null;
  const date = (stamped && !isNaN(stamped.getTime()) ? stamped : new Date())
    .toISOString()
    .slice(0, 10);
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
  let errors = 0;
  for (const s of symbols) {
    try {
      const u = `${base}?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(key)}`;
      const text = await fetchTextCapped(u, { maxBytes: 100_000 });
      const row = text == null ? null : parseFinnhubQuote(s, text);
      if (row) {
        rows.push(row);
      }
    } catch {
      errors++; // skip this symbol, but remember a real failure occurred
    }
  }
  // if every request errored and nothing came back, surface it so the loop records
  // status:"error" (unreachable) rather than "empty" (reached, no data).
  if (!rows.length && errors) {
    throw new Error("finnhub: all requests failed");
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
  // week-over-week change: find the latest entry at least ~5 calendar days before this
  // one (robust to sparse/partial history, unlike a fixed "6 entries back" index). The
  // fixed-offset fallback only helps a feed whose dates are distinct but unparseable; a
  // truly date-less feed (empty dates) can't distinguish days, so change stays null.
  const cur = Date.parse(date);
  let prior = null;
  if (Number.isFinite(cur)) {
    for (let i = h.length - 2; i >= 0; i--) {
      const t = Date.parse(h[i].date);
      if (Number.isFinite(t) && cur - t >= 5 * 864e5) {
        prior = h[i].price;
        break;
      }
    }
  } else if (h.length > 5) {
    prior = h[h.length - 6].price;
  }
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
  // try providers in order, each asked only for the symbols still missing, merging
  // their results. This way a provider that prices *some* symbols doesn't mask a
  // later provider that could fill the rest; we stop as soon as everything is covered.
  const collected = {}; // SYMBOL → {symbol, close, date}
  const sources = [];
  let anyError = false;
  for (const p of providers()) {
    const need = symbols.filter((s) => !(s in collected));
    if (!need.length) {
      break;
    }
    try {
      const got = (await p.fetch(need)) || [];
      const fresh = got.filter((r) => need.includes(r.symbol) && !(r.symbol in collected));
      if (fresh.length) {
        for (const r of fresh) {
          collected[r.symbol] = r;
        }
        sources.push(p.name);
      }
    } catch {
      anyError = true;
    }
  }
  const rows = Object.values(collected);
  const source = sources.length ? sources.join(",") : null;

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

/** Cached prices, refreshing lazily when stale (but not on every read during an outage). */
export async function getPrices() {
  const fresh = cache.fetchedAt && Date.now() - cache.fetchedAt <= TTL;
  // when the last attempt failed, back off so a down feed doesn't make every read slow;
  // a manual "Sync now" (refreshPrices) bypasses this floor.
  const recentlyTried = lastSync.at && Date.now() - lastSync.at < RETRY_FLOOR;
  if (enabled() && !fresh && !recentlyTried) {
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
