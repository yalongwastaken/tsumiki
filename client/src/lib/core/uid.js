// uid.js — single source for client-side row ids. Prefers crypto.randomUUID
// (collision-free) with a timestamp+random fallback for older runtimes.
export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
