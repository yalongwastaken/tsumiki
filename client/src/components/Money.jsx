// Money.jsx — render a currency amount that can be blurred in "privacy mode".
// Always emits a <span class="money">; the actual blur is applied by CSS only when an
// ancestor carries .blur-money (see index.css + the header eye toggle in App.jsx), so
// this component stays stateless and the toggle is a single class flip at the root.
import { createContext, useContext } from "react";
import { fmt, fmtK } from "../lib/core/format.js";

/**
 * @param {number} n amount in dollars
 * @param {boolean} [k] use the compact "$1.2k" form (for axes / tight labels)
 * @param {string} [className] extra classes to merge onto the span
 */
export default function Money({ n, k = false, className = "" }) {
  return <span className={className ? `money ${className}` : "money"}>{k ? fmtK(n) : fmt(n)}</span>;
}

// ── privacy blur for SVG chart amounts ──────────────────────────────────────
// CSS `filter: blur()` on an HTML span works everywhere, but on an SVG <text> it
// is unreliable in WebKit/Safari — so chart amounts stayed sharp in privacy mode.
// Instead we drive SVG amounts through a real SVG <filter> (core SVG, supported
// everywhere), toggled by this context, and let CSS handle only the HTML spans.
export const BlurContext = createContext(false);
export const useBlur = () => useContext(BlurContext);
export const MONEY_BLUR_FILTER = "tsumiki-blur-money";

/** The <filter> that blurs SVG amounts — rendered once at the app root. */
export function MoneyBlurDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <defs>
        <filter id={MONEY_BLUR_FILTER} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * An SVG <text> for a currency amount that blurs in privacy mode via the SVG
 * <filter> above. Drop-in replacement for a `<text className="money">` in charts —
 * forwards all the usual text props (x, y, fontSize, fill, …).
 */
export function SvgMoney({ className = "", children, ...rest }) {
  const blur = useBlur();
  return (
    <text
      {...rest}
      className={className ? `money ${className}` : "money"}
      filter={blur ? `url(#${MONEY_BLUR_FILTER})` : undefined}
    >
      {children}
    </text>
  );
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
