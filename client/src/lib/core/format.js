// format.js — shared currency formatters.

/** Whole-dollar currency, e.g. "$1,234". Non-finite input → "$0" (never "$NaN").
 * The `|| 0` also normalizes -0 (Math.round(-0.3) === -0) so a tiny loss shows "$0",
 * not "$-0". */
export const fmt = (n) => "$" + (Math.round(Number.isFinite(n) ? n : 0) || 0).toLocaleString();

/** Compact currency for axes/labels, e.g. "$1.2k" / "$12k". */
export const fmtK = (n) => {
  const v = Number.isFinite(n) ? n : 0;
  return v >= 1000
    ? "$" + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k"
    : "$" + (Math.round(v) || 0);
};
