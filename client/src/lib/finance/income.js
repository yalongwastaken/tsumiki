// income.js — client-facing wrapper around the shared income core (finance.js).
// Kept so existing callers can pass (profile, transactions) positionally.
import { typicalIncome as core } from "./finance.js";

/**
 * Best estimate of typical monthly income. Thin adapter over finance.typicalIncome.
 * @returns {number}
 */
export function typicalIncome(profile, transactions = []) {
  return core({ profile, transactions });
}
