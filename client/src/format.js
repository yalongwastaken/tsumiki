// shared currency formatters
export const fmt = (n) => "$" + Math.round(n).toLocaleString();
export const fmtK = (n) =>
  n >= 1000 ? "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : "$" + Math.round(n);
