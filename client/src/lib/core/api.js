// api.js — the thin client→server fetch layer.

// same origin as the server in prod; proxied to :4000 in dev
const BASE = import.meta.env.VITE_API ?? "";

// app-lock hook: when the server returns 401 ("locked"), notify the app so it can
// show the login screen instead of surfacing a generic error.
let onLocked = null;
export const setOnLocked = (fn) => {
  onLocked = fn;
};

/**
 * Make a JSON request and parse the response.
 * @throws {Error} with a `.status` field on non-2xx responses
 */
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin", // send the session cookie
  });
  if (!res.ok) {
    const text = await res.text();
    // a locked app rejects everything but /api/auth/* with 401 — surface it to the UI
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      onLocked?.();
    }
    const err = new Error(`${method} ${path} → ${res.status}: ${text}`);
    err.status = res.status;
    // expose the server's `{error}` message so callers can show a clean sentence
    try {
      err.error = JSON.parse(text)?.error;
    } catch {
      /* non-JSON body */
    }
    throw err;
  }
  return res.json();
}

export const getState = () => call("GET", "/api/state");
export const getPlan = (income, strategy, { windfall } = {}) => {
  const q = new URLSearchParams();
  if (income != null) {
    q.set("income", income);
  }
  if (strategy) {
    q.set("strategy", strategy);
  }
  if (windfall) {
    q.set("windfall", "1");
  }
  const s = q.toString();
  return call("GET", `/api/plan${s ? `?${s}` : ""}`);
};
export const getNews = () => call("GET", "/api/news");
export const getPrices = () => call("GET", "/api/prices");
export const refreshPrices = () => call("POST", "/api/prices/refresh");
export const addTransaction = (tx) => call("POST", "/api/transactions", tx);
export const putState = (state) => call("PUT", "/api/state", state);
export const migrateLegacy = (legacy) => call("POST", "/api/migrate", legacy);
export const resetAll = () => call("POST", "/api/reset");
export const importData = (state) => call("POST", "/api/import", state);
export const exportUrl = () => (BASE || "") + "/api/export";

// ── app lock (auth) ─────────────────────────────────────────────────────────────
export const authStatus = () => call("GET", "/api/auth/status");
export const authLogin = (password) => call("POST", "/api/auth/login", { password });
export const authLogout = () => call("POST", "/api/auth/logout");
export const authSetPassword = (body) => call("POST", "/api/auth/set", body);
