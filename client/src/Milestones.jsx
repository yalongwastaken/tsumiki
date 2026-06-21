// Milestones.jsx — achievements panel (earned badges + next to chase).
import { nextMilestone } from "./milestones.js";
import { fmt } from "./format.js";
import MilestoneIcon from "./MilestoneIcon.jsx";

/** Achievements panel: earned badges + the next one to chase. */
export default function Milestones({ list }) {
  const achieved = list.filter((m) => m.achieved);
  const next = nextMilestone(list);
  if (achieved.length === 0 && !next) {
    return null;
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Milestones
      </div>

      {achieved.length > 0 ? (
        <div className="flex flex-wrap gap-2 mb-3">
          {achieved.map((m) => (
            <span
              key={m.id}
              title={m.label}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-amber-50 border border-amber-200 text-amber-700"
            >
              <MilestoneIcon name={m.icon} size={13} />
              {m.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-400 mb-3">
          No milestones yet — your first contribution starts it.
        </div>
      )}

      {next && (
        <div>
          <div className="flex items-baseline justify-between text-xs text-slate-500 mb-1">
            <span className="inline-flex items-center gap-1.5">
              Next: <MilestoneIcon name={next.icon} size={13} /> {next.label}
            </span>
            <span className="font-mono">
              {fmt(next.cur)} / {fmt(next.target)}
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
