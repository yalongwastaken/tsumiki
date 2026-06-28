// PlanSplitChart.jsx — donut of the paycheck split + alternative strategy bars.
import { fmt } from "./lib/format.js";
import Money from "./Money.jsx";

// deliberately not a sankey — a different shape so the two don't get confused
const GROUPS = [
  { label: "Essentials", color: "#94A3B8", keys: ["essentials"] },
  { label: "Debt", color: "#E05656", keys: ["min_debt", "high_debt"] },
  { label: "Checking", color: "#378ADD", keys: ["floor", "checking_flex"] },
  { label: "Savings", color: "#3FA9C9", keys: ["emergency"] },
  { label: "Retirement", color: "#A78BFA", keys: ["match", "retirement"] },
  { label: "Investment", color: "#1D9E75", keys: ["brokerage"] },
];

// strategy order + labels; the weights come from the plan (plan.strategies) so
// they can't drift from the engine
const STRATS = [
  ["short_term", "Safety"],
  ["balanced", "Balanced"],
  ["long_term", "Growth"],
];
const SPLIT_SEG = [
  ["checking", "#378ADD"],
  ["savings", "#3FA9C9"],
  ["retirement", "#A78BFA"],
  ["invest", "#1D9E75"],
];

/** Donut of where the paycheck splits, plus tap-to-preview alternative strategy bars. */
export default function PlanSplitChart({ plan, strategy, saved, onSetStrategy }) {
  if (!plan?.steps?.length) {
    return null;
  }
  const byKey = {};
  for (const s of plan.steps) {
    byKey[s.key] = (byKey[s.key] || 0) + s.amount;
  }
  const segs = GROUPS.map((g) => ({
    ...g,
    amount: g.keys.reduce((a, k) => a + (byKey[k] || 0), 0),
  })).filter((g) => g.amount > 0);
  const total = segs.reduce((a, s) => a + s.amount, 0) || 1;

  const R = 46,
    SW = 18,
    C = 2 * Math.PI * R,
    cx = 60,
    cy = 60;
  let off = 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Where it splits
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <svg
          width="120"
          height="120"
          viewBox="0 0 120 120"
          className="flex-shrink-0"
          role="img"
          aria-label={`Paycheck split of ${fmt(total)}: ${segs
            .map((s) => `${s.label} ${Math.round((s.amount / total) * 100)}%`)
            .join(", ")}`}
        >
          {segs.map((s, i) => {
            const frac = s.amount / total,
              dash = frac * C,
              el = (
                <circle
                  key={i}
                  r={R}
                  cx={cx}
                  cy={cy}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={SW}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-off}
                  transform={`rotate(-90 ${cx} ${cy})`}
                />
              );
            off += dash;
            return el;
          })}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="12" fill="var(--muted)">
            paycheck
          </text>
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            fontSize="14"
            fontWeight="600"
            fill="var(--text)"
            className="money"
          >
            {fmt(total)}
          </text>
        </svg>
        <div className="flex-1 min-w-[150px] space-y-1.5">
          {segs.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span
                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ background: s.color }}
              />
              <span className="text-slate-600 flex-1">{s.label}</span>
              <span className="font-mono text-slate-500">
                {Math.round((s.amount / total) * 100)}%
              </span>
              <Money n={s.amount} className="font-mono text-slate-700 w-16 text-right" />
            </div>
          ))}
        </div>
      </div>

      {/* alternative strategies — even though one is active, show the others */}
      <div className="mt-4 pt-3 border-t border-slate-50">
        <div className="text-xs text-slate-500 mb-2">
          Surplus split by strategy {onSetStrategy ? "— tap to preview" : ""}
        </div>
        <div className="space-y-1.5">
          {STRATS.map(([key, label]) => {
            const w = (plan.strategies && plan.strategies[key]) || {};
            return (
              <button
                key={key}
                onClick={() => onSetStrategy?.(key)}
                disabled={!onSetStrategy}
                className={`w-full flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors ${strategy === key ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-slate-50"} ${onSetStrategy ? "cursor-pointer" : "cursor-default"}`}
              >
                <span
                  className={`text-xs w-24 text-left flex items-center gap-1 ${strategy === key ? "font-semibold text-brand-700" : "text-slate-500"}`}
                >
                  {label}
                  {saved === key && (
                    <span className="text-[10px] font-normal text-slate-500">· default</span>
                  )}
                </span>
                <span className="flex-1 flex h-3 rounded-full overflow-hidden">
                  {SPLIT_SEG.map(([k, color]) => (
                    <span
                      key={k}
                      style={{ width: `${(w[k] || 0) * 100}%`, background: color }}
                      title={`${k} ${Math.round((w[k] || 0) * 100)}%`}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-slate-500">
          {SPLIT_SEG.map(([k, color]) => (
            <span key={k}>
              <span
                className="inline-block w-2 h-2 rounded-sm mr-1"
                style={{ background: color }}
              />
              {k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
