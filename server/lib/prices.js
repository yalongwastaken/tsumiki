// prices.js — OPT-IN nightly stock-price sync. Off unless TSUMIKI_PRICES is set, so a
// stock install makes zero outbound calls. When on, it fetches daily closes for ONLY
// the tickers you hold (symbols aren't personal), tries each configured provider in
// order until one returns data, caches the result, keeps a short per-symbol history for
// week-over-week moves, and records the outcome of the last sync so the UI can show
// "synced / nothing came back / failed" instead of silently serving stale prices.
//
// Providers, tried in order:
//   1. keyless CSV feed(s) — only if you set TSUMIKI_PRICE_URL ({SYMBOLS} → lowercased
//      ".us" tickers); tried first so a private, keyless feed is preferred when present.
//      There is NO default: the old Stooq default is gone because Stooq now sits behind a
//      JavaScript bot-wall a server can't pass — so with nothing configured, (2) is primary.
//   2. Finnhub JSON quotes — the default/primary feed; on when TSUMIKI_FINNHUB_KEY is set.
//
// Circuit breaker: a symbol the feed can't price (e.g. a mutual fund Finnhub doesn't
// cover) is retried only MANUAL_AFTER times, then marked "manual" — we stop requesting
// it and the UI reminds you to update that holding by hand, instead of erroring forever.
import {
  getState,
  appendPortfolioPoint,
  getPortfolioHistory,
  getSymbolPriceHistory,
  setSymbolPriceHistory,
  getPriceFailures,
  setPriceFailures,
} from "./db.js";
import { fetchTextCapped, isRetryableStatus } from "./http.js";

const TTL = 20 * 60 * 60 * 1000; // refetch at most ~daily
const RETRY_FLOOR = 5 * 60 * 1000; // after a failed sync, wait this long before a lazy retry
const HIST_MAX = 40;
const MANUAL_AFTER = 3; // consecutive misses before a symbol is given up on → "update manually"
const PROBE_EVERY = 7; // re-attempt given-up symbols every Nth refresh so a transient gap can recover

// env read live (not cached at import) so tests can vary it between cases
const enabled = () =>
  ["1", "true", "yes"].includes((process.env.TSUMIKI_PRICES || "").toLowerCase());
// optional custom keyless CSV feed(s); empty by default (no Stooq fallback anymore)
const feedUrls = () =>
  (process.env.TSUMIKI_PRICE_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const finnhubKey = () => process.env.TSUMIKI_FINNHUB_KEY || "";
const finnhubUrl = () => process.env.TSUMIKI_FINNHUB_URL || "https://finnhub.io/api/v1/quote";

let cache = { prices: {}, fetchedAt: 0 };
// outcome of the most recent refresh attempt (surfaced via getPrices). `manual` lists
// symbols given up on (price them by hand); `missing` is symbols still being retried.
let lastSync = { status: "idle", at: 0, source: null, missing: [], manual: [] };

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

// ── providers (each returns {rows, errored}) ────────────────────────────────────
// `errored` means a REAL failure happened (network error, 429 rate limit, 5xx) — as
// opposed to "the feed answered fine but had no data for these symbols". The refresh
// loop maps errored → anyError, which both reports status:"error" and stops the
// circuit breaker from punishing symbols that were never actually answered (three
// rate-limited syncs used to flip perfectly good holdings to "manual").
const INTER_REQUEST_DELAY_MS = 250; // polite gap between serial per-symbol requests
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchStooq(url, symbols) {
  const full = url.replace("{SYMBOLS}", symbols.map((s) => `${s.toLowerCase()}.us`).join(","));
  const res = await fetchTextCapped(full, { maxBytes: 2_000_000 });
  if (res.text == null) {
    // rate-limited / server error → a provider failure, not "no data"
    return { rows: [], errored: isRetryableStatus(res.status) };
  }
  return { rows: parseStooqCsv(res.text), errored: false };
}
async function fetchFinnhub(symbols) {
  const base = finnhubUrl();
  const key = finnhubKey();
  const rows = [];
  let errors = 0;
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    // small delay between serial quote calls — the free tier is 60 req/min, and a
    // burst of holdings shouldn't trip the limiter on our own sync
    if (i > 0) {
      await sleep(INTER_REQUEST_DELAY_MS);
    }
    try {
      const u = `${base}?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(key)}`;
      const res = await fetchTextCapped(u, { maxBytes: 100_000 });
      if (res.text == null) {
        if (isRetryableStatus(res.status)) {
          errors++; // 429/5xx: a real failure — and if rate-limited, stop hammering
          if (res.status === 429) {
            break;
          }
        }
        continue; // other non-OK (e.g. 404 unknown symbol) → a plain per-symbol miss
      }
      const row = parseFinnhubQuote(s, res.text);
      if (row) {
        rows.push(row);
      }
    } catch {
      errors++; // network error/timeout: skip this symbol, remember it failed
    }
  }
  return { rows, errored: errors > 0 };
}
function providers() {
  // a custom keyless CSV feed (if configured) is tried first; Finnhub is the fallback —
  // and, since there's no default feed, the primary when no TSUMIKI_PRICE_URL is set
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
  if (h.length && h[h.length - 1].date === date) {
    h[h.length - 1].price = price; // same session, newer close → replace, don't drop
  } else {
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
let refreshCount = 0; // drives the periodic re-probe of given-up symbols (resets on restart)

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
    lastSync = { status: "disabled", at: Date.now(), source: null, missing: [], manual: [] };
    return cache;
  }
  // only fetch tickers that have at least one AUTO-sync holding; a ticker held only as a
  // user-marked "manual" holding (e.g. a mutual fund you price by hand) is never requested
  const held = [
    ...new Set(
      (getState().holdings || [])
        .filter((h) => !h.manual)
        .map((h) => String(h.ticker).toUpperCase()),
    ),
  ];

  // no price source configured at all (no TSUMIKI_PRICE_URL, no Finnhub key): report a
  // plain "empty" without penalizing any symbol — a missing config isn't a per-symbol
  // failure, so don't let the breaker mark holdings "manual" because of it.
  if (!providers().length) {
    lastSync = { status: "empty", at: Date.now(), source: null, missing: held, manual: [] };
    return cache;
  }

  // circuit breaker: keep per-symbol failure counts, drop entries for symbols no longer
  // held, and treat any at/over the threshold as "manual" — we don't request those every
  // time, but every PROBE_EVERY-th refresh we re-attempt them so a transient feed gap can
  // recover (a successful price resets the symbol below the threshold).
  const failures = getPriceFailures();
  for (const s of Object.keys(failures)) {
    if (!held.includes(s)) {
      delete failures[s];
    }
  }
  const isManual = (s) => (failures[s] || 0) >= MANUAL_AFTER;
  const probe = refreshCount++ % PROBE_EVERY === 0; // re-attempt given-up symbols this round
  const toFetch = held.filter((s) => !isManual(s) || probe);

  if (!toFetch.length) {
    // nothing to fetch (no holdings, or every held symbol has been given up on)
    setPriceFailures(failures);
    lastSync = {
      status: "ok",
      at: Date.now(),
      source: null,
      missing: [],
      manual: held.filter(isManual),
    };
    return cache;
  }

  // try providers in order, each asked only for the symbols still missing, merging
  // their results. This way a provider that prices *some* symbols doesn't mask a
  // later provider that could fill the rest; we stop as soon as everything is covered.
  const collected = {}; // SYMBOL → {symbol, close, date}
  const sources = [];
  let anyError = false;
  for (const p of providers()) {
    const need = toFetch.filter((s) => !(s in collected));
    if (!need.length) {
      break;
    }
    try {
      const { rows: got = [], errored = false } = (await p.fetch(need)) || {};
      if (errored) {
        anyError = true; // 429/5xx/network — a provider failure, not "no data"
      }
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

  // update the breaker: reset a symbol that priced; increment one that missed (capped at
  // the threshold so re-probing a permanently-unpriceable symbol can't grow it unbounded).
  // When ANY provider errored (rate limit, outage), don't penalize the un-priced symbols
  // at all — they were never genuinely answered, and a few rate-limited syncs in a row
  // must not flip real holdings to "manual".
  for (const s of toFetch) {
    if (s in collected) {
      failures[s] = 0;
    } else if (!anyError) {
      failures[s] = Math.min((failures[s] || 0) + 1, MANUAL_AFTER);
    }
  }
  setPriceFailures(failures);

  if (rows.length) {
    const prices = { ...cache.prices };
    const history = getSymbolPriceHistory(); // persisted → week-over-week survives restarts
    for (const r of rows) {
      const changePct = recordHistory(history, r.symbol, r.date, r.close);
      prices[r.symbol] = { price: r.close, date: r.date, changePct };
    }
    setSymbolPriceHistory(history);
    cache = { prices, fetchedAt: Date.now() };
    // record today's total portfolio value so the client can chart it over time.
    // Manual holdings count at their user-set price (they're real money — excluding
    // them made server history permanently disagree with the client's net worth), and
    // an auto-sync holding falls back to its stopgap manualPrice until first priced.
    // If any holding still has NO price at all, skip the point: a partial sync would
    // chart a dip that never happened.
    let value = 0;
    let complete = true;
    for (const h of getState().holdings || []) {
      const shares = Number(h.shares) || 0;
      const manual = Number(h.manualPrice);
      const synced = h.manual ? null : prices[String(h.ticker).toUpperCase()]?.price;
      const price = synced ?? (Number.isFinite(manual) && manual > 0 ? manual : null);
      if (price == null) {
        complete = false;
        break;
      }
      value += price * shares;
    }
    if (complete && value > 0) {
      appendPortfolioPoint(value);
    }
  }

  // classify the outcome. manual = held symbols now past the give-up threshold; missing =
  // symbols we tried but didn't get and haven't given up on yet (still being retried).
  const manual = held.filter(isManual);
  const have = new Set(rows.map((r) => r.symbol));
  const missing = toFetch.filter((s) => !have.has(s) && !isManual(s));
  const status = rows.length
    ? missing.length
      ? "partial"
      : "ok"
    : missing.length
      ? anyError
        ? "error"
        : "empty"
      : "ok"; // nothing priced but nothing left to retry (all manual) → calm, not an error
  lastSync = { status, at: Date.now(), source, missing, manual };
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
