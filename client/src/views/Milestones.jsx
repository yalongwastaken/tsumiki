// Milestones.jsx — achievements panel (earned badges + next to chase).
import { useState } from "react";
import Money, { BlurAmounts } from "../components/Money.jsx";
import { nextMilestone } from "../lib/insights/milestones.js";
import MilestoneIcon from "../components/MilestoneIcon.jsx";

const COLLAPSED_COUNT = 10; // cap earned chips so a long-term user isn't buried

/** Achievements panel: earned badges + the next one to chase. */
export default function Milestones({ list }) {
  const [showAll, setShowAll] = useState(false);
  const achieved = list.filter((m) => m.achieved);
  const next = nextMilestone(list);
  if (achieved.length === 0 && !next) {
    return null;
  }
  const shown = showAll ? achieved : achieved.slice(0, COLLAPSED_COUNT);
  const hidden = achieved.length - shown.length;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Milestones {achieved.length > 0 && `(${achieved.length} earned)`}
      </div>

      {achieved.length > 0 ? (
        <div className="flex flex-wrap gap-2 mb-3" role="list">
          {shown.map((m) => (
            <span
              key={m.id}
              role="listitem"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-amber-50 border border-amber-200 text-amber-700"
            >
              <MilestoneIcon name={m.icon} size={13} />
              <BlurAmounts text={m.label} />
            </span>
          ))}
          {(hidden > 0 || showAll) && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="inline-flex items-center px-2.5 py-1 text-xs rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              {showAll ? "Show less" : `+${hidden} more`}
            </button>
          )}
        </div>
      ) : (
        <div className="text-sm text-slate-500 mb-3">
          No milestones yet — your first contribution starts it.
        </div>
      )}

      {next && (
        <div>
          <div className="flex items-baseline justify-between text-xs text-slate-500 mb-1">
            <span className="inline-flex items-center gap-1.5">
              Next: <MilestoneIcon name={next.icon} size={13} /> <BlurAmounts text={next.label} />
            </span>
            <span className="font-mono">
              <Money n={next.cur} /> / <Money n={next.target} />
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (next.cur / next.target) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
