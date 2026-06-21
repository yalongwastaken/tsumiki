// Single source of truth for allocation-bucket labels/colors and spending-
// category colors, so they can't drift across Sankey / Plan / Ledger / etc.
export const BUCKETS = [
  { key: "debt", label: "Debt paydown", short: "Debt", color: "#E05656" },
  { key: "emergency", label: "Emergency fund", short: "Emergency", color: "#378ADD" },
  { key: "retirement", label: "Retirement", short: "Retirement", color: "#A78BFA" },
  { key: "invest", label: "Invest", short: "Invest", color: "#1D9E75" },
];

const BY_KEY = Object.fromEntries(BUCKETS.map((b) => [b.key, b]));

export const bucketLabel = (key) => (BY_KEY[key]?.short || "Invest");
export const bucketColor = (key) => (BY_KEY[key]?.color || "#1D9E75");
// a logged contribution's bucket (legacy goalId folds into invest)
export const bucketOf = (t) => (BY_KEY[t.bucket] ? t.bucket : "invest");

// spending-category ribbon colors (amber family)
export const CAT_COLORS = ["#FB923C", "#F97316", "#FDBA74", "#FCD34D"];
