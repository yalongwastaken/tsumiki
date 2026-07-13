// prices.js — OPT-IN nightly stock-price sync. Off unless TSUMIKI_PRICES is set, so a
// stock install makes zero outbound calls. When on, it fetches daily closes for ONLY
// the tickers you hold (symbols aren't personal) via ONE source: a small Python
// sidecar (scripts/prices.py) built on yfinance — the community-maintained library
// that tracks Yahoo's endpoints, covering stocks, ETFs, and mutual funds with zero
// keys and zero config. Requires python3 + `pip install yfinance` on the machine;
// the sync status says so plainly when either is missing.
//
// Results are cached, a short per-symbol history drives week-over-week moves, and the
// outcome of the last sync is recorded so the UI shows "synced / nothing came back /
// failed" instead of silently serving stale prices.
//
// Circuit breaker: a symbol the feed can't price (e.g. a delisted ticker) is retried
// only MANUAL_AFTER times, then marked "manual" — we stop requesting it and the UI
// reminds you to update that holding by hand, instead of erroring forever. A script
// ERROR (network down, rate limit, yfinance missing) never punishes symbols: they
// were not genuinely answered.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  getState,
  appendPortfolioPoint,
  getPortfolioHistory,
  getSymbolPriceHistory,
  setSymbolPriceHistory,
  getPriceFailures,
  setPriceFailures,
} from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TTL = 20 * 60 * 60 * 1000; // refetch at most ~daily
const RETRY_FLOOR = 5 * 60 * 1000; // after a failed sync, wait this long before a lazy retry
const HIST_MAX = 40;
const MANUAL_AFTER = 3; // consecutive misses before a symbol is given up on → "update manually"
const PROBE_EVERY = 7; // re-attempt given-up symbols every Nth refresh so a transient gap can recover
const SCRIPT_TIMEOUT_MS = 90_000; // yfinance fetches serially; give a big portfolio room

// env read live (not cached at import) so tests can vary it between cases
const enabled = () =>
  ["1", "true", "yes"].includes((process.env.TSUMIKI_PRICES || "").toLowerCase());
const pythonBin = () => process.env.TSUMIKI_PYTHON || "python3";
const priceScript = () =>
  process.env.TSUMIKI_PRICES_SCRIPT || join(__dirname, "..", "scripts", "prices.py");

let cache = { prices: {}, fetchedAt: 0 };
// outcome of the most recent refresh attempt (surfaced via getPrices). `manual` lists
// symbols given up on (price them by hand); `missing` is symbols still being retried;
// `note` is the human-readable problem when something real failed.
let lastSync = { status: "idle", at: 0, source: null, missing: [], manual: [], note: null };

/**
 * Run the yfinance sidecar for `symbols` → {rows, errored, note}.
 * `errored` means a REAL failure (network, rate limit, python/yfinance missing) —
 * as opposed to "answered fine but had no data for these symbols". Never throws.
 * @returns {Promise<{rows: Array<{symbol, close, date}>, errored: boolean, note: string|null}>}
 */
export function runPriceScript(symbols) {
  return new Promise((resolve) => {
    execFile(
      pythonBin(),
      [priceScript(), ...symbols],
      { timeout: SCRIPT_TIMEOUT_MS, maxBuffer: 2_000_000 },
      (err, stdout) => {
        if (err && !String(stdout || "").trim()) {
          // spawn-level failure: python missing, script missing, timeout, crash
          const note =
            err.code === "ENOENT"
              ? `price sync needs Python — "${pythonBin()}" was not found (install python3 + pip install yfinance)`
              : err.killed
                ? "price script timed out"
                : `price script failed: ${err.message || err.code}`;
          return resolve({ rows: [], errored: true, note });
        }
        try {
          // the contract is ONE line of JSON, but be tolerant of stray stdout above it
          // (a chatty yfinance/pandas warning must not fail every sync as "unreadable"):
          // parse the LAST non-empty line
          const lines = String(stdout)
            .split(/\r?\n/)
            .filter((l) => l.trim());
          const parsed = JSON.parse(lines[lines.length - 1] || "");
          const rows = (Array.isArray(parsed.rows) ? parsed.rows : []).filter(
            (r) =>
              r &&
              typeof r.symbol === "string" &&
              r.symbol &&
              typeof r.close === "number" &&
              isFinite(r.close) &&
              r.close > 0,
          );
          const note = parsed.error ? String(parsed.error) : null;
          resolve({
            rows: rows.map((r) => ({
              symbol: r.symbol.toUpperCase(),
              close: r.close,
              date: typeof r.date === "string" ? r.date : "",
            })),
            // a spawn-level error WITH parseable stdout (killed after printing, stderr
            // overflow) is still a real failure — the breaker must not punish symbols
            errored: !!note || !!err,
            note,
          });
        } catch {
          resolve({ rows: [], errored: true, note: "price script returned unreadable output" });
        }
      },
    );
  });
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
    lastSync = {
      status: "disabled",
      at: Date.now(),
      source: null,
      missing: [],
      manual: [],
      note: null,
    };
    return cache;
  }
  // only fetch tickers that have at least one AUTO-sync holding; a ticker held only as a
  // user-marked "manual" holding (e.g. one you price by hand) is never requested
  const held = [
    ...new Set(
      (getState().holdings || [])
        .filter((h) => !h.manual)
        .map((h) => String(h.ticker).toUpperCase()),
    ),
  ];

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
      note: null,
    };
    return cache;
  }

  const { rows, errored, note } = await runPriceScript(toFetch);
  if (note) {
    console.warn("prices:", note);
  }

  // update the breaker: reset a symbol that priced; increment one that missed (capped at
  // the threshold so re-probing a permanently-unpriceable symbol can't grow it unbounded).
  // When the script ERRORED (outage, rate limit, missing yfinance), don't penalize the
  // un-priced symbols at all — they were never genuinely answered, and a few failed
  // syncs in a row must not flip real holdings to "manual".
  const collected = new Set(rows.map((r) => r.symbol));
  for (const s of toFetch) {
    if (collected.has(s)) {
      failures[s] = 0;
    } else if (!errored) {
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
  const missing = toFetch.filter((s) => !collected.has(s) && !isManual(s));
  const status = rows.length
    ? missing.length
      ? "partial"
      : "ok"
    : missing.length
      ? errored
        ? "error"
        : "empty"
      : "ok"; // nothing priced but nothing left to retry (all manual) → calm, not an error
  lastSync = {
    status,
    at: Date.now(),
    source: rows.length ? "yfinance" : null,
    missing,
    manual,
    note,
  };
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
