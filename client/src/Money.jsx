// Money.jsx — render a currency amount that can be blurred in "privacy mode".
// Always emits a <span class="money">; the actual blur is applied by CSS only when an
// ancestor carries .blur-money (see index.css + the header eye toggle in App.jsx), so
// this component stays stateless and the toggle is a single class flip at the root.
import { fmt, fmtK } from "./lib/format.js";

/**
 * @param {number} n amount in dollars
 * @param {boolean} [k] use the compact "$1.2k" form (for axes / tight labels)
 * @param {string} [className] extra classes to merge onto the span
 */
export default function Money({ n, k = false, className = "" }) {
  return <span className={className ? `money ${className}` : "money"}>{k ? fmtK(n) : fmt(n)}</span>;
}
