import { fmt } from "./format.js";
import { CAT_COLORS, bucketLabel, bucketColor, bucketOf } from "./buckets.js";

// Real money flow for the current month — actual income on the left, actual
// spending + contributions + leftover on the right (SPEC §7). Honest, not planned.

const clip = (s) => (s.length > 16 ? s.slice(0, 15) + "…" : s);
export default function SankeyFlow({ transactions, fallbackIncome }) {
  // left gutter (LX) leaves room for the income label so it isn't clipped
  const W = 720, LX = 110, LW = 16, RX = 400, RW = 16, PTOP = 12, PBOT = 16, GAP = 6, MIN_H = 30, SCALE = 140;
  const ym = new Date().toISOString().slice(0, 7);
  const month = transactions.filter((t) => new Date(t.date).toISOString().slice(0, 7) === ym);
  const incomeActual = month.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const income = incomeActual > 0 ? incomeActual : fallbackIncome;
  const usingFallback = incomeActual <= 0;

  const catMap = {};
  for (const t of month) if (t.type === "spending") catMap[t.cat || "Other"] = (catMap[t.cat || "Other"] || 0) + t.amount;
  const topCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const contribMap = {};
  for (const t of month) if (t.type === "contribution") { const b = bucketOf(t); contribMap[b] = (contribMap[b] || 0) + t.amount; }

  const items = [
    ...Object.entries(contribMap).map(([b, a]) => ({ label: bucketLabel(b), amount: a, color: bucketColor(b) })),
    ...topCats.map(([c, a], i) => ({ label: c, amount: a, color: CAT_COLORS[i % CAT_COLORS.length] })),
  ];
  // nothing real to show yet (no spending/contributions logged this month) →
  // a single full-height "leftover" block is just a gray blob, so prompt instead
  const hasFlow = items.length > 0;
  if (!income || income <= 0 || !hasFlow)
    return <div className="text-center py-8 text-slate-400 text-sm">Log income, spending, or a contribution to see this month's flow.</div>;
  const freeAmt = income - items.reduce((s, x) => s + x.amount, 0);
  if (freeAmt > 0) items.push({ label: "Leftover", amount: freeAmt, color: "#94A3B8" });

  let ry = PTOP;
  const right = items.map((it) => { const h = MIN_H + (it.amount / income) * SCALE; const r = { ...it, y: ry, h }; ry += h + GAP; return r; });
  const SVG_H = ry - GAP + PBOT, leftH = SVG_H - PTOP - PBOT;
  let ly = PTOP;
  const left = items.map((it) => { const h = (it.amount / income) * leftH; const b = { ...it, y: ly, h }; ly += h; return b; });
  const ribbon = (l, r) => { const cx = (RX - LX - LW) * 0.42, x1 = LX + LW, x2 = RX;
    return `M${x1},${l.y} C${x1 + cx},${l.y} ${x2 - cx},${r.y} ${x2},${r.y} L${x2},${r.y + r.h} C${x2 - cx},${r.y + r.h} ${x1 + cx},${l.y + l.h} ${x1},${l.y + l.h} Z`; };
  const cY = PTOP + leftH / 2;
  return (
    <svg viewBox={`0 0 ${W} ${SVG_H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
      {left.map((b, i) => <rect key={i} x={LX} y={b.y} width={LW} height={Math.max(0.5, b.h)} fill={b.color} />)}
      {right.map((r, i) => <path key={i} d={ribbon(left[i], r)} fill={r.color} fillOpacity={0.2} />)}
      {right.map((r, i) => <rect key={i} x={RX} y={r.y} width={RW} height={r.h} fill={r.color} rx={2} />)}
      {right.map((r, i) => { const m = r.y + r.h / 2, lc = r.color === "#94A3B8" ? "var(--muted)" : r.color;
        return (<g key={i}>
          <text x={RX + RW + 10} y={m - 7} dominantBaseline="central" fontSize="11" fill={lc} fontWeight="600">{clip(r.label)}</text>
          <text x={RX + RW + 10} y={m + 7} dominantBaseline="central" fontSize="11" fill="var(--muted)">{fmt(r.amount)}/mo</text>
        </g>); })}
      <text x={LX - 10} y={cY - 8} textAnchor="end" dominantBaseline="central" fontSize="11" fill="var(--muted)">{usingFallback ? "Income (est.)" : "Income"}</text>
      <text x={LX - 10} y={cY + 8} textAnchor="end" dominantBaseline="central" fontSize="13" fill="var(--text)" fontWeight="bold">{fmt(income)}</text>
    </svg>
  );
}
