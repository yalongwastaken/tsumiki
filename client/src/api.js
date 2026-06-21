// api.js — the thin client→server layer (SPEC.md §12, M0).
// Replaces the old window.storage. Same origin as the server in prod; proxied in dev.
const BASE = import.meta.env.VITE_API ?? "";

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`${method} ${path} → ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const getState = () => call("GET", "/api/state");
export const getPlan = (income) => call("GET", `/api/plan${income != null ? `?income=${encodeURIComponent(income)}` : ""}`);
export const addTransaction = (tx) => call("POST", "/api/transactions", tx);
export const putState = (state) => call("PUT", "/api/state", state);
export const migrateLegacy = (legacy) => call("POST", "/api/migrate", legacy);
export const importData = (state) => call("POST", "/api/import", state);
export const exportUrl = () => (BASE || "") + "/api/export";
