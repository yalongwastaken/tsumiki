// lastgood.js — the offline read cache (AUDIT M8): the last server-acked state,
// kept in localStorage so an offline boot can render your money instead of an
// error and $0 everywhere.
//
// Security invariant: this plaintext copy may only EXIST while the app lock is
// OFF. Writers must check permission (confirmed lock-off) first; enabling the
// lock clears it immediately (see AppLock.jsx) and again on every confirmed-lock
// load. Reading is always safe — a cache can only have been written while that
// invariant held.
const KEY = "tsumiki-last-good";

export function readLastGood() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeLastGood(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota/private mode — the cache is best-effort */
  }
}

export function clearLastGood() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
