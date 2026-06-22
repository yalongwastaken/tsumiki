// categories.js — the canonical spending-category list, shared so budgets, the
// quick-add chips, the ledger, and CSV import all speak the same vocabulary (no
// more "Dining" budget vs "Dining Out" transactions reading $0 forever).

/** Default spending categories offered across the app. */
export const CATEGORIES = [
  "Housing",
  "Groceries",
  "Dining Out",
  "Transport",
  "Utilities",
  "Subscriptions",
  "Entertainment",
  "Shopping",
  "Health",
  "Education",
  "Travel",
  "Tech / Gear",
  "Clothing",
  "Other",
];

// merchant keyword → canonical category, checked in order. Lowercased substring
// match against a transaction note; used to auto-categorize CSV imports.
const RULES = [
  [/netflix|spotify|hulu|disney\+|hbo|patreon|youtube prem|icloud|prime video/, "Subscriptions"],
  [
    // "uber" but not "uber eats" (that's a food order → Dining, matched below)
    /uber(?! eats)|lyft|shell|chevron|exxon|bp |parking|transit|metro|caltrain|toll|gas station/,
    "Transport",
  ],
  [
    /whole foods|trader joe|safeway|kroger|aldi|costco|walmart|grocery|supermarket|wegmans|publix/,
    "Groceries",
  ],
  [
    /starbucks|mcdonald|chipotle|restaurant|coffee|cafe|doordash|grubhub|uber eats|taco|pizza|dunkin/,
    "Dining Out",
  ],
  [/amazon|target|best buy|etsy|ebay|ikea/, "Shopping"],
  [/rent|mortgage|landlord|hoa|leasing/, "Housing"],
  [
    /electric|water bill|comcast|xfinity|verizon|at&t|t-mobile|internet|utility|pg&e|con ed/,
    "Utilities",
  ],
  [/pharmacy|cvs|walgreens|doctor|dental|clinic|gym|fitness|hospital|copay/, "Health"],
  [/airline|hotel|airbnb|delta|united air|expedia|marriott|hilton|booking\.com/, "Travel"],
  [/apple\.com|microsoft|adobe|github|google \*|steam/, "Tech / Gear"],
];

/**
 * Best-guess category for a transaction note via merchant keyword rules.
 * @returns {string|null} a canonical category, or null when nothing matches
 */
export function categorize(note = "") {
  const s = String(note).toLowerCase();
  for (const [re, cat] of RULES) {
    if (re.test(s)) {
      return cat;
    }
  }
  return null;
}

/**
 * The canonical list merged with any categories already used in the ledger, so a
 * user's own free-text categories still appear in pickers. Most-used first, then
 * the remaining defaults.
 * @returns {string[]}
 */
export function allCategories(transactions = []) {
  const used = {};
  for (const t of transactions) {
    if (t.type === "spending" && t.cat && t.amount > 0) {
      used[t.cat] = (used[t.cat] || 0) + 1;
    }
  }
  const ranked = Object.keys(used).sort((a, b) => used[b] - used[a]);
  const seen = new Set(ranked);
  return [...ranked, ...CATEGORIES.filter((c) => !seen.has(c))];
}
