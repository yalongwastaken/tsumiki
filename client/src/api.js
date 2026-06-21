// api.js — the thin client→server layer (SPEC.md §12, M0).
// Replaces the old window.storage. Same origin as the server in prod; proxied in dev.
const BASE = import.meta.env.VITE_API ?? "";

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

export const getState = () => call("GET", "/api/state");
export const getPlan = (income) => call("GET", `/api/plan${income != null ? `?income=${encodeURIComponent(income)}` : ""}`);
export const putState = (state) => call("PUT", "/api/state", state);
export const migrateLegacy = (legacy) => call("POST", "/api/migrate", legacy);
