// fire.js — pure FIRE / projection math, extracted from the Fire and Projection
// views so it's covered by the lib test suite (AUDIT test-gap item) instead of
// living invisibly inside JSX files.

/**
 * Years for `start` to reach `target` at `monthly` contributions compounding at
 * annual `rate` (monthly compounding). Returns 0 when already there and Infinity
 * when it would take more than 100 years (i.e. effectively never at this pace).
 */
export function yearsToTarget(start, monthly, rate, target) {
  if (start >= target) {
    return 0;
  }
  const mr = rate / 12;
  let bal = start,
    m = 0;
  while (bal < target && m < 1200) {
    bal = bal * (1 + mr) + monthly;
    m++;
  }
  return m >= 1200 ? Infinity : m / 12;
}

/**
 * Yearly {year, value, contributed} series from compounding `monthly` at annual
 * `rate` for `years` years, starting from `start`. `startYear` defaults to the
 * current year (injectable so tests are deterministic).
 */
export function projectSeries(start, monthly, rate, years, startYear = new Date().getFullYear()) {
  const data = [],
    mRate = rate / 12;
  let bal = start,
    contributed = start;
  for (let m = 0; m <= years * 12; m++) {
    if (m % 12 === 0) {
      data.push({
        year: startYear + m / 12,
        value: Math.round(bal),
        contributed: Math.round(contributed),
      });
    }
    bal = bal * (1 + mRate) + monthly;
    contributed += monthly;
  }
  return data;
}
