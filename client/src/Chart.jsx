// Chart.jsx — tiny dependency-free area chart (replaces recharts, ~374kB).
// Hand-drawn SVG: filled area + line, min/max y-labels, first/last x-labels.
import { useId } from "react";
import { fmtK } from "./format.js";

/**
 * A single-series area chart.
 * @param {{data:Array, xKey:string, yKey:string, color?:string, xFormat?:Function}} props
 */
export default function AreaChart({
  data = [],
  xKey,
  yKey,
  color = "#6366F1",
  xFormat = (x) => x,
  label = "Trend over time",
}) {
  // unique per instance so two charts on one page can't share a gradient id
  // (sanitized — useId() contains colons that break url(#…) references)
  const gid = `area${useId().replace(/:/g, "")}`;
  if (!Array.isArray(data) || data.length < 2) {
    return null;
  }
  const W = 360,
    H = 120,
    padL = 40,
    padR = 6,
    padT = 8,
    padB = 16;
  const ys = data.map((d) => Number(d[yKey]) || 0);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const range = maxY - minY || 1;
  const n = data.length;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;
  const x = (i) => padL + (i / (n - 1)) * plotW;
  const y = (v) => padT + (1 - (v - minY) / range) * plotH;

  const line = data
    .map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(ys[i]).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ display: "block" }}
      role="img"
      aria-label={`${label}: from ${fmtK(data[0][yKey])} to ${fmtK(data[n - 1][yKey])}, low ${fmtK(minY)}, high ${fmtK(maxY)}`}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" />
      {/* y-axis: max (top) + min (bottom) */}
      <text x={padL - 4} y={padT + 3} textAnchor="end" fontSize="9" fill="var(--muted)">
        {fmtK(maxY)}
      </text>
      <text x={padL - 4} y={baseY} textAnchor="end" fontSize="9" fill="var(--muted)">
        {fmtK(minY)}
      </text>
      {/* x-axis: first + last */}
      <text x={padL} y={H - 4} textAnchor="start" fontSize="9" fill="var(--muted)">
        {xFormat(data[0][xKey])}
      </text>
      <text x={W - padR} y={H - 4} textAnchor="end" fontSize="9" fill="var(--muted)">
        {xFormat(data[n - 1][xKey])}
      </text>
    </svg>
  );
}
