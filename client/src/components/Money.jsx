// Money.jsx — render a currency amount that can be blurred in "privacy mode".
// Always emits a <span class="money">; the actual blur is applied by CSS only when an
// ancestor carries .blur-money (see index.css + the header eye toggle in App.jsx), so
// this component stays stateless and the toggle is a single class flip at the root.
import { fmt, fmtK } from "../lib/core/format.js";

/**
 * @param {number} n amount in dollars
 * @param {boolean} [k] use the compact "$1.2k" form (for axes / tight labels)
 * @param {string} [className] extra classes to merge onto the span
 */
export default function Money({ n, k = false, className = "" }) {
  return <span className={className ? `money ${className}` : "money"}>{k ? fmtK(n) : fmt(n)}</span>;
}

// split on / test for a rendered currency token like $1,234 / $1,234.56 / $-80 / $1.2k
const AMOUNT_SPLIT = /(\$-?[\d,]+(?:\.\d+)?k?)/g;
const IS_AMOUNT = /^\$-?[\d,]+(?:\.\d+)?k?$/;

/**
 * Render a plain string while blurring any embedded currency amount in privacy mode.
 * Used for amounts baked into label/advisory strings (milestones, goals, coaching
 * nudges, reminders) that can't be wrapped at the source. No amount → returns the text.
 */
export function BlurAmounts({ text }) {
  const s = String(text ?? "");
  return s.split(AMOUNT_SPLIT).map((part, i) =>
    IS_AMOUNT.test(part) ? (
      <span key={i} className="money">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
