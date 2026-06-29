// StocksSankey.jsx — a 3-column Sankey of the portfolio: total → account-type bucket
// (Taxable / 401(k) / IRA / Roth) → individual tickers. It separates the total so you
// can see where your stocks actually sit. Pure render over portfolioFlow(); no network.
import { fmt } from "../lib/core/format.js";
import { portfolioFlow } from "../lib/finance/portfolio.js";

const clip = (s) => (s.length > 14 ? s.slice(0, 13) + "…" : s);

// a cubic-bezier ribbon from a left edge (x1, ly..ly+lh) to a right edge (x2, ry..ry+rh)
function ribbon(x1, x2, ly, lh, ry, rh) {
  const cx = (x2 - x1) * 0.45;
  return `M${x1},${ly} C${x1 + cx},${ly} ${x2 - cx},${ry} ${x2},${ry} L${x2},${ry + rh} C${x2 - cx},${ry + rh} ${x1 + cx},${ly + lh} ${x1},${ly + lh} Z`;
}

/**
 * @param {Array} rows portfolioRows(holdings, prices) output
 * Renders null when there's nothing worth separating (fewer than 2 priced holdings).
 */
export default function StocksSankey({ rows = [] }) {
  const { total, buckets } = portfolioFlow(rows);
  const tickerCount = buckets.reduce((s, b) => s + b.holdings.length, 0);
  if (!total || total <= 0 || tickerCount < 2) {
    return null;
  }

  // geometry
  const W = 600,
    TX = 96, // total bar x
    BX = 250, // bucket bar x
    KX = 410, // ticker bar x
    BAR = 14,
    PAD = 10,
    H_UNIT = 300, // px representing 100% of the total
    MIN_H = 16,
    GAP = 6,
    GROUP_GAP = 14;
  const h = (v) => Math.max(MIN_H, (v / total) * H_UNIT);

  // bucket column stack height
  const bucketStackH = buckets.reduce((s, b) => s + h(b.value), 0) + GAP * (buckets.length - 1);
  // ticker column stack height (inner GAPs within a bucket + GROUP_GAPs between buckets)
  const innerGaps = tickerCount - buckets.length;
  const tickerStackH =
    buckets.reduce((s, b) => s + b.holdings.reduce((ss, hd) => ss + h(hd.value), 0), 0) +
    GAP * innerGaps +
    GROUP_GAP * (buckets.length - 1);

  const contentH = Math.max(H_UNIT, bucketStackH, tickerStackH);
  const SVG_H = contentH + PAD * 2;

  // total node (single block, centered)
  const totalNode = { y: PAD + (contentH - H_UNIT) / 2, hh: H_UNIT };

  // bucket nodes (proportional, stacked, centered)
  let by = PAD + (contentH - bucketStackH) / 2;
  const bucketNodes = buckets.map((b) => {
    const node = { ...b, y: by, hh: h(b.value) };
    by += node.hh + GAP;
    return node;
  });

  // ticker nodes (proportional, grouped by bucket, centered)
  let ty = PAD + (contentH - tickerStackH) / 2;
  const tickerNodes = [];
  buckets.forEach((b, bi) => {
    if (bi > 0) {
      ty += GROUP_GAP;
    }
    b.holdings.forEach((hd, hi) => {
      const hh = h(hd.value);
      tickerNodes.push({ ...hd, color: b.color, bucket: b.key, y: ty, hh });
      ty += hh + (hi < b.holdings.length - 1 ? GAP : 0);
    });
  });

  // ribbons total → bucket: partition the total block by bucket value (no gaps on source)
  const r1 = [];
  let s1 = totalNode.y;
  bucketNodes.forEach((bn) => {
    const segH = (bn.value / total) * totalNode.hh;
    r1.push({ d: ribbon(TX + BAR, BX, s1, segH, bn.y, bn.hh), color: bn.color, key: bn.key });
    s1 += segH;
  });
  // ribbons bucket → ticker: partition each bucket block by ticker value
  const r2 = [];
  bucketNodes.forEach((bn) => {
    let s2 = bn.y;
    tickerNodes
      .filter((t) => t.bucket === bn.key)
      .forEach((t) => {
        const segH = (t.value / bn.value) * bn.hh;
        r2.push({
          d: ribbon(BX + BAR, KX, s2, segH, t.y, t.hh),
          color: t.color,
          key: `${bn.key}-${t.ticker}`,
        });
        s2 += segH;
      });
  });

  const cY = totalNode.y + totalNode.hh / 2;
  const aria = `Portfolio of ${fmt(total)} separated into ${buckets
    .map(
      (b) =>
        `${b.label} ${fmt(b.value)} (${b.holdings.map((x) => `${x.ticker} ${fmt(x.value)}`).join(", ")})`,
    )
    .join("; ")}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${SVG_H}`}
      width="100%"
      style={{ display: "block", overflow: "visible" }}
      role="img"
      aria-label={aria}
    >
      {/* ribbons (under the node bars) */}
      {r1.map((r) => (
        <path key={r.key} d={r.d} fill={r.color} fillOpacity={0.22} />
      ))}
      {r2.map((r) => (
        <path key={r.key} d={r.d} fill={r.color} fillOpacity={0.22} />
      ))}

      {/* total node */}
      <rect x={TX} y={totalNode.y} width={BAR} height={totalNode.hh} fill="#475569" rx={2} />
      <text
        x={TX - 10}
        y={cY - 9}
        textAnchor="end"
        dominantBaseline="central"
        fontSize="13"
        fill="var(--muted)"
      >
        Portfolio
      </text>
      <text
        x={TX - 10}
        y={cY + 9}
        textAnchor="end"
        dominantBaseline="central"
        fontSize="15"
        fill="var(--text)"
        fontWeight="bold"
        className="money"
      >
        {fmt(total)}
      </text>

      {/* bucket nodes + labels (label sits to the left, over the light ribbon) */}
      {bucketNodes.map((b) => (
        <rect key={b.key} x={BX} y={b.y} width={BAR} height={b.hh} fill={b.color} rx={2} />
      ))}
      {bucketNodes.map((b) => (
        <text
          key={`bl-${b.key}`}
          x={BX - 8}
          y={b.y + b.hh / 2}
          textAnchor="end"
          dominantBaseline="central"
          fontSize="12"
          fontWeight="600"
          fill={b.color}
        >
          {b.label}
        </text>
      ))}

      {/* ticker nodes + labels (to the right) */}
      {tickerNodes.map((t) => (
        <rect
          key={`tr-${t.bucket}-${t.ticker}`}
          x={KX}
          y={t.y}
          width={BAR}
          height={t.hh}
          fill={t.color}
          rx={2}
        />
      ))}
      {tickerNodes.map((t) => {
        const m = t.y + t.hh / 2;
        return (
          <g key={`tl-${t.bucket}-${t.ticker}`}>
            <text
              x={KX + BAR + 8}
              y={m - 7}
              dominantBaseline="central"
              fontSize="12.5"
              fontWeight="600"
              fill={t.color}
            >
              {clip(t.ticker)}
            </text>
            <text
              x={KX + BAR + 8}
              y={m + 8}
              dominantBaseline="central"
              fontSize="12"
              fill="var(--muted)"
              className="money"
            >
              {fmt(t.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
