// tax.js — a transparent income-tax estimate (federal brackets + FICA + a state
// approximation), driven by salary, filing status, age, and state. Deterministic
// and testable — it's an estimate to show take-home, not tax advice or a filing.
// Figures are 2025 (IRS). State is a rough flat approximation unless you override it.

const BRACKETS = {
  single: [
    [11925, 0.1],
    [48475, 0.12],
    [103350, 0.22],
    [197300, 0.24],
    [250525, 0.32],
    [626350, 0.35],
    [Infinity, 0.37],
  ],
  married: [
    [23850, 0.1],
    [96950, 0.12],
    [206700, 0.22],
    [394600, 0.24],
    [501050, 0.32],
    [751600, 0.35],
    [Infinity, 0.37],
  ],
  head: [
    [17000, 0.1],
    [64850, 0.12],
    [103350, 0.22],
    [197300, 0.24],
    [250500, 0.32],
    [626350, 0.35],
    [Infinity, 0.37],
  ],
};
const STD = { single: 15000, married: 30000, head: 22500 };
const STD_65 = { single: 2000, married: 1600, head: 2000 }; // additional standard deduction at 65+
const SS_BASE = 176100; // Social Security wage base (2025)
const SS_RATE = 0.062;
const MEDICARE = 0.0145;
const ADDL_MEDICARE = 0.009;
const ADDL_MED_THRESHOLD = { single: 200000, married: 250000, head: 200000 };

/** States with no broad income tax → state estimate is 0. */
export const NO_INCOME_TAX_STATES = new Set(["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]);
const DEFAULT_STATE_RATE = 0.05; // rough flat stand-in when a state taxes income

export const FILING_STATUSES = [
  ["single", "Single"],
  ["married", "Married filing jointly"],
  ["head", "Head of household"],
];

/**
 * Estimate annual taxes and take-home pay.
 * @param {{income?:number, filingStatus?:string, state?:string, age?:number|null, stateRate?:number|null}} opts
 * @returns {{gross, taxable, federal, fica, state, total, effectiveRate, marginalRate, takeHome, takeHomeMonthly, stateNoTax, stateRate}}
 */
export function estimateTax({
  income = 0,
  filingStatus = "single",
  state = "",
  age = null,
  stateRate = null,
} = {}) {
  const fs = BRACKETS[filingStatus] ? filingStatus : "single";
  const gross = Math.max(0, income);

  let std = STD[fs];
  if (age && age >= 65) {
    std += STD_65[fs];
  }
  const taxable = Math.max(0, gross - std);

  // progressive federal income tax + the marginal bracket reached
  let federal = 0;
  let marginalRate = 0;
  let prev = 0;
  for (const [upper, rate] of BRACKETS[fs]) {
    const slice = Math.min(taxable, upper) - prev;
    if (slice > 0) {
      federal += slice * rate;
      marginalRate = rate;
    }
    prev = upper;
    if (taxable <= upper) {
      break;
    }
  }

  // payroll taxes (Social Security capped at the wage base, Medicare + surtax)
  const fica =
    Math.min(gross, SS_BASE) * SS_RATE +
    gross * MEDICARE +
    Math.max(0, gross - ADDL_MED_THRESHOLD[fs]) * ADDL_MEDICARE;

  const stateNoTax = NO_INCOME_TAX_STATES.has((state || "").toUpperCase());
  const sRate = stateNoTax ? 0 : stateRate != null ? stateRate : DEFAULT_STATE_RATE;
  const stateTax = taxable * sRate;

  const total = federal + fica + stateTax;
  return {
    gross,
    taxable,
    federal: Math.round(federal),
    fica: Math.round(fica),
    state: Math.round(stateTax),
    total: Math.round(total),
    effectiveRate: gross > 0 ? total / gross : 0,
    marginalRate,
    takeHome: gross - total,
    takeHomeMonthly: (gross - total) / 12,
    stateNoTax,
    stateRate: sRate,
  };
}
