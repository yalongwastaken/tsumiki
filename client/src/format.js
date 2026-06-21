// format.js — shared currency formatters.

/** Whole-dollar currency, e.g. "$1,234". */
export const fmt = (n) => "$" + Math.round(n).toLocaleString();

/** Compact currency for axes/labels, e.g. "$1.2k" / "$12k". */
export const fmtK = (n) =>
  n >= 1000 ? "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : "$" + Math.round(n);
