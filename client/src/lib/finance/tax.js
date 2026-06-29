// tax.js — a transparent income-tax estimate (federal brackets + FICA + a state
// approximation), driven by salary, filing status, age, and state. Deterministic
// and testable — it's an estimate to show take-home, not tax advice or a filing.
// Figures are 2026 (IRS Rev. Proc. 2025-32, post-OBBBA). State is a rough flat
// approximation unless you override it.

// The tax year these figures encode. Surfaced in the UI so a stale year is obvious:
// when the calendar year moves past this, the brackets/limits need an update.
export const TAX_YEAR = 2026;

const BRACKETS = {
  single: [
    [12400, 0.1],
    [50400, 0.12],
    [105700, 0.22],
    [201775, 0.24],
    [256225, 0.32],
    [640600, 0.35],
    [Infinity, 0.37],
  ],
  married: [
    [24800, 0.1],
    [100800, 0.12],
    [211400, 0.22],
    [403550, 0.24],
    [512450, 0.32],
    [768700, 0.35],
    [Infinity, 0.37],
  ],
  head: [
    [17700, 0.1],
    [67450, 0.12],
    [105700, 0.22],
    [201775, 0.24],
    [256200, 0.32],
    [640600, 0.35],
    [Infinity, 0.37],
  ],
};
// 2026 standard deduction (IRS Rev. Proc. 2025-32)
const STD = { single: 16100, married: 32200, head: 24150 };
const STD_65 = { single: 2050, married: 1650, head: 2050 }; // additional standard deduction at 65+ (per spouse)
// 2025–2028 bonus deduction for filers 65+, phased out 6% per $1 of MAGI over the
// threshold (so it vanishes by ~$175k single / ~$250k married)
const SENIOR_BONUS = 6000;
const SENIOR_PHASEOUT_START = { single: 75000, married: 150000, head: 75000 };
const SENIOR_PHASEOUT_RATE = 0.06;
const SS_BASE = 184500; // Social Security wage base (2026)
const SS_RATE = 0.062;
const MEDICARE = 0.0145;
const ADDL_MEDICARE = 0.009;
const ADDL_MED_THRESHOLD = { single: 200000, married: 250000, head: 200000 };
// self-employment tax: 92.35% of net is subject; 12.4% SS (capped) + 2.9% Medicare
// + the 0.9% surtax. Half is deductible above the line for income tax.
const SE_FACTOR = 0.9235;
const SS_SE_RATE = 0.124;
const MEDICARE_SE_RATE = 0.029;
function selfEmploymentTax(net, fs) {
  const base = Math.max(0, net) * SE_FACTOR;
  return (
    Math.min(base, SS_BASE) * SS_SE_RATE +
    base * MEDICARE_SE_RATE +
    Math.max(0, base - ADDL_MED_THRESHOLD[fs]) * ADDL_MEDICARE
  );
}

/** States with no broad income tax → state estimate is 0. */
export const NO_INCOME_TAX_STATES = new Set(["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]);
const DEFAULT_STATE_RATE = 0.05; // rough flat stand-in when a state taxes income

export const FILING_STATUSES = [
  ["single", "Single"],
  ["married", "Married filing jointly"],
  ["head", "Head of household"],
];

/**
 * The next IRS estimated-tax due date on/after `today`. Quarterly deadlines are
 * Apr 15, Jun 15, Sep 15, and Jan 15 of the following year.
 * @returns {Date}
 */
export function nextQuarterlyDue(today = new Date()) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const y = t.getFullYear();
  const candidates = [
    new Date(y, 0, 15), // Jan 15 (Q4 of last year)
    new Date(y, 3, 15), // Apr 15
    new Date(y, 5, 15), // Jun 15
    new Date(y, 8, 15), // Sep 15
    new Date(y + 1, 0, 15), // Jan 15 next year
  ];
  return candidates.find((d) => d >= t) || candidates[candidates.length - 1];
}

/**
 * Estimate annual taxes and take-home pay. For self-employed income, payroll tax
 * becomes self-employment tax (≈15.3%) and half of it is deducted before the
 * income-tax brackets, matching how 1040-ES estimated payments are figured.
 * @param {{income?:number, filingStatus?:string, state?:string, age?:number|null, spouseAge?:number|null, stateRate?:number|null, selfEmployed?:boolean}} opts
 * @returns {{gross, taxable, federal, fica, state, total, effectiveRate, marginalRate, takeHome, takeHomeMonthly, stateNoTax, stateRate, selfEmployed}}
 */
export function estimateTax({
  income = 0,
  filingStatus = "single",
  state = "",
  age = null,
  spouseAge = null,
  stateRate = null,
  selfEmployed = false,
} = {}) {
  const fs = BRACKETS[filingStatus] ? filingStatus : "single";
  // clamp a non-finite salary (e.g. a half-typed input field) to 0 so the page
  // shows $0 rather than "$NaN" across every derived figure
  const gross = Math.max(0, Number.isFinite(income) ? income : 0);

  // payroll tax: self-employment tax for SE income, else employee FICA
  const seTax = selfEmployed ? selfEmploymentTax(gross, fs) : 0;
  const fica = selfEmployed
    ? seTax
    : Math.min(gross, SS_BASE) * SS_RATE +
      gross * MEDICARE +
      Math.max(0, gross - ADDL_MED_THRESHOLD[fs]) * ADDL_MEDICARE;
  // SE filers deduct half their SE tax above the line before income tax
  const seDeduction = seTax / 2;

  let std = STD[fs];
  // count qualifying 65+ filers — for married filing jointly, the extra std
  // deduction ($1,650 each) and OBBBA senior bonus ($6,000 each) are PER person
  let seniors = age && age >= 65 ? 1 : 0;
  if (fs === "married" && spouseAge && spouseAge >= 65) {
    seniors += 1;
  }
  if (seniors > 0) {
    std += STD_65[fs] * seniors;
    // OBBBA senior bonus, phased out above the MAGI threshold (gross ~ MAGI here)
    const over = Math.max(0, gross - SENIOR_PHASEOUT_START[fs]);
    std += Math.max(0, SENIOR_BONUS - over * SENIOR_PHASEOUT_RATE) * seniors;
  }
  const taxable = Math.max(0, gross - std - seDeduction);

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
    selfEmployed,
  };
}
