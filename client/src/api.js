// api.js — the thin client→server fetch layer.

// same origin as the server in prod; proxied to :4000 in dev
const BASE = import.meta.env.VITE_API ?? "";

/**
 * Make a JSON request and parse the response.
 * @throws {Error} with a `.status` field on non-2xx responses
 */
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
export const addTransaction = (tx) => call("POST", "/api/transactions", tx);
export const putState = (state) => call("PUT", "/api/state", state);
export const migrateLegacy = (legacy) => call("POST", "/api/migrate", legacy);
export const importData = (state) => call("POST", "/api/import", state);
export const exportUrl = () => (BASE || "") + "/api/export";
