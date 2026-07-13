// validate.js — pure input validation for everything the API accepts.
// Split out of db.js: nothing here touches the database, so it's importable (and
// testable) without opening a SQLite file. db.js re-exports the public pieces, so
// callers keep importing from db.js.

const TX_TYPES = new Set(["income", "spending", "contribution", "transfer"]);

// a transfer must move between two DISTINCT accounts → reject a malformed one (the UI
// already enforces this; this guards a direct POST). Returns an error string or null.
function transferError(t) {
  if (t.type !== "transfer") {
    return null;
  }
  if (!t.fromId || !t.toId) {
    return "transfer needs a from and to account";
  }
  if (t.fromId === t.toId) {
    return "transfer needs two different accounts";
  }
  return null;
}

// True for a date that's unparseable OR a bare YYYY-MM-DD that silently rolls over to
// another month (e.g. 2024-02-30 → Mar 1) — Date.parse accepts the latter, which would
// then skew month/streak/forecast math. Used by all inbound date checks (exported for
// the ?date= query validation on /api/plan).
export function invalidDate(v) {
  if (v == null || Number.isNaN(Date.parse(v))) {
    return true;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (m) {
    const [, y, mo, d] = m.map(Number);
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d;
  }
  return false;
}

// Numeric profile fields the plan engine consumes. A non-finite value (NaN via JSON is
// null, but "abc"/Infinity can arrive from scripts or a corrupt import) would silently
// NaN whole plan steps out of existence — reject it up front with a clear message.
// null/undefined mean "unset" and are always fine.
function profileError(p) {
  const fin = (v) => typeof v === "number" && isFinite(v);
  const bad = (obj, key, label) =>
    obj?.[key] != null && !fin(obj[key]) ? `${label} must be a finite number` : null;
  const notObj = (v, label) =>
    v != null && (typeof v !== "object" || Array.isArray(v)) ? `${label} must be an object` : null;

  const direct =
    bad(p, "checkingFloor", "profile.checkingFloor") ||
    bad(p, "emergencyTarget", "profile.emergencyTarget") ||
    bad(p, "typicalIncome", "profile.typicalIncome") ||
    bad(p, "highApr", "profile.highApr") ||
    bad(p, "iraLimit", "profile.iraLimit") ||
    notObj(p.employerMatch, "profile.employerMatch") ||
    bad(p.employerMatch, "pct", "profile.employerMatch.pct") ||
    notObj(p.retirementLimits, "profile.retirementLimits") ||
    bad(p.retirementLimits, "ira", "profile.retirementLimits.ira") ||
    bad(p.retirementLimits, "k401", "profile.retirementLimits.k401") ||
    notObj(p.split, "profile.split") ||
    bad(p.split, "savings", "profile.split.savings") ||
    bad(p.split, "retirement", "profile.split.retirement") ||
    bad(p.split, "invest", "profile.split.invest") ||
    bad(p.split, "checking", "profile.split.checking");
  if (direct) {
    return direct;
  }
  if (p.bills != null) {
    if (!Array.isArray(p.bills)) {
      return "profile.bills must be an array";
    }
    for (const b of p.bills) {
      const e = bad(b, "amount", "profile.bills[].amount");
      if (e) {
        return e;
      }
    }
  }
  if (p.incomeSources != null) {
    if (!Array.isArray(p.incomeSources)) {
      return "profile.incomeSources must be an array";
    }
    for (const src of p.incomeSources) {
      const e = bad(src, "typicalMonthly", "profile.incomeSources[].typicalMonthly");
      if (e) {
        return e;
      }
    }
  }
  return null;
}

/**
 * Validate a full-state PUT body.
 * @returns {string|null} an error message, or null when valid
 */
export function validateState(s) {
  if (!s || typeof s !== "object") {
    return "body must be an object";
  }
  for (const k of ["accounts", "snapshots", "goals", "debts", "transactions", "holdings"]) {
    if (s[k] != null && !Array.isArray(s[k])) {
      return `${k} must be an array`;
    }
  }
  for (const h of s.holdings || []) {
    if (!h?.id || !h?.ticker) {
      return "holding needs an id and ticker";
    }
    if (typeof h.ticker !== "string") {
      return "holding.ticker must be a string";
    }
    // a ticker is interpolated into the (opt-in) price-feed URL, so keep it to a
    // plain symbol charset — no query-param/URL injection via a crafted ticker
    if (!/^[A-Za-z0-9.\-^]{1,15}$/.test(h.ticker)) {
      return "holding.ticker has invalid characters";
    }
    if (typeof h.shares !== "number" || !isFinite(h.shares)) {
      return "holding.shares must be a finite number";
    }
    // optional link to an account whose balance tracks this holding's value
    if (h.accountId != null && typeof h.accountId !== "string") {
      return "holding.accountId must be a string";
    }
    // optional user-entered price/share for manual (un-synced) holdings, e.g. mutual funds
    if (h.manualPrice != null && (typeof h.manualPrice !== "number" || !isFinite(h.manualPrice))) {
      return "holding.manualPrice must be a finite number";
    }
  }
  for (const a of s.accounts || []) {
    if (!a?.id || !a?.type) {
      return "account needs an id and type";
    }
    if (!a.name || !String(a.name).trim()) {
      return "account needs a name";
    }
    // optional uninvested cash held in an investment account
    if (a.cash != null && (typeof a.cash !== "number" || !isFinite(a.cash))) {
      return "account.cash must be a finite number";
    }
  }
  for (const t of s.transactions || []) {
    if (!t?.id) {
      return "transaction needs an id";
    }
    if (!TX_TYPES.has(t?.type)) {
      return `bad transaction type: ${t?.type}`;
    }
    if (typeof t.amount !== "number" || !isFinite(t.amount)) {
      return "transaction.amount must be a finite number";
    }
    if (!t.date) {
      return "transaction needs a date";
    }
    if (invalidDate(t.date)) {
      return "transaction.date is not a valid date";
    }
    const te = transferError(t);
    if (te) {
      return te;
    }
  }
  for (const sn of s.snapshots || []) {
    if (!sn?.id) {
      return "snapshot needs an id"; // PRIMARY KEY — a null id collides with other id-less rows
    }
    if (!sn?.accountId) {
      return "snapshot needs an accountId";
    }
    if (typeof sn.balance !== "number" || !isFinite(sn.balance)) {
      return "snapshot.balance must be a finite number";
    }
    if (invalidDate(sn.date)) {
      return "snapshot.date is not a valid date";
    }
  }
  for (const d of s.debts || []) {
    if (!d?.id || !d?.name) {
      return "debt needs an id and name";
    }
    // balance/apr/minPayment hit NOT NULL REAL columns — reject non-numbers up front
    // so a bad PUT fails cleanly instead of throwing a raw SQLite constraint error
    if (typeof d.balance !== "number" || !isFinite(d.balance)) {
      return "debt.balance must be a finite number";
    }
    if (d.apr != null && (typeof d.apr !== "number" || !isFinite(d.apr))) {
      return "debt.apr must be a finite number";
    }
    if (d.minPayment != null && (typeof d.minPayment !== "number" || !isFinite(d.minPayment))) {
      return "debt.minPayment must be a finite number";
    }
  }
  for (const g of s.goals || []) {
    if (!g?.id || !g?.name) {
      return "goal needs an id and name";
    }
    if (typeof g.target !== "number" || !isFinite(g.target)) {
      return "goal.target must be a finite number";
    }
  }
  if (s.profile != null) {
    if (typeof s.profile !== "object" || Array.isArray(s.profile)) {
      return "profile must be an object";
    }
    const pe = profileError(s.profile);
    if (pe) {
      return pe;
    }
  }
  // optional history blobs (present in exports/backups so a restore keeps the charts)
  if (s.portfolioHistory != null) {
    if (!Array.isArray(s.portfolioHistory)) {
      return "portfolioHistory must be an array";
    }
    for (const p of s.portfolioHistory) {
      if (!p?.date || typeof p.value !== "number" || !isFinite(p.value)) {
        return "portfolioHistory entries need a date and a finite value";
      }
    }
  }
  if (
    s.symbolPriceHistory != null &&
    (typeof s.symbolPriceHistory !== "object" || Array.isArray(s.symbolPriceHistory))
  ) {
    return "symbolPriceHistory must be an object";
  }
  return null; // ok
}

/**
 * Validate a single appended transaction.
 * @returns {string|null} an error message, or null when valid
 */
export function validateTransaction(t) {
  if (!t || typeof t !== "object") {
    return "transaction must be an object";
  }
  if (!t.id) {
    return "transaction needs an id";
  }
  if (!TX_TYPES.has(t.type)) {
    return `bad transaction type: ${t.type}`;
  }
  if (typeof t.amount !== "number" || !isFinite(t.amount)) {
    return "transaction.amount must be a finite number";
  }
  if (!t.date) {
    return "transaction needs a date";
  }
  // a garbage or roll-over date would persist and silently skew month/streak/forecast math
  if (invalidDate(t.date)) {
    return "transaction.date is not a valid date";
  }
  return transferError(t);
}

/**
 * Validate a meta-only patch body ({profile?, settings?, holdings?}).
 * @returns {string|null} an error message, or null when valid
 */
export function validateMeta(p) {
  if (!p || typeof p !== "object") {
    return "body must be an object";
  }
  if (p.profile !== undefined) {
    if (typeof p.profile !== "object" || p.profile == null || Array.isArray(p.profile)) {
      return "profile must be an object";
    }
    const pe = profileError(p.profile); // numeric fields the engine consumes
    if (pe) {
      return pe;
    }
  }
  if (p.settings !== undefined && (typeof p.settings !== "object" || p.settings == null)) {
    return "settings must be an object";
  }
  if (p.holdings !== undefined) {
    if (!Array.isArray(p.holdings)) {
      return "holdings must be an array";
    }
    const err = validateState({ holdings: p.holdings }); // reuse the holding/ticker checks
    if (err) {
      return err;
    }
  }
  return null;
}
