// cadence.js — pay-frequency constants shared across the client paycheck features.

/** Paychecks per month for each cadence (mirrors server engine.js CADENCE). */
export const CADENCE = { weekly: 4.345, biweekly: 2.1725, semimonthly: 2, monthly: 1 };

/** Human label for each cadence. */
export const CADENCE_LABEL = {
  weekly: "weekly",
  biweekly: "every 2 weeks",
  semimonthly: "twice a month",
  monthly: "monthly",
};

/** Whether a string is a known cadence. */
export const isCadence = (c) => Object.prototype.hasOwnProperty.call(CADENCE, c);
