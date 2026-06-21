// buckets.js — single source of truth for allocation-bucket labels/colors
// (and spending-category colors), so they can't drift across Sankey / Plan / Ledger.

export const BUCKETS = [
  { key: "debt", label: "Debt paydown", short: "Debt", color: "#E05656" },
  { key: "emergency", label: "Emergency fund", short: "Savings", color: "#3FA9C9" },
  { key: "retirement", label: "Retirement", short: "Retirement", color: "#A78BFA" },
  { key: "invest", label: "Invest", short: "Invest", color: "#1D9E75" },
];

const BY_KEY = Object.fromEntries(BUCKETS.map((b) => [b.key, b]));

/** Short display label for a bucket key. */
export const bucketLabel = (key) => BY_KEY[key]?.short || "Invest";

/** Brand color for a bucket key. */
export const bucketColor = (key) => BY_KEY[key]?.color || "#1D9E75";

/** A logged contribution's bucket key (legacy goalId folds into invest). */
export const bucketOf = (t) => (BY_KEY[t.bucket] ? t.bucket : "invest");

// spending-category ribbon colors (amber family)
export const CAT_COLORS = ["#FB923C", "#F97316", "#FDBA74", "#FCD34D"];
