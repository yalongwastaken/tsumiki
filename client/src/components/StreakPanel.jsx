// StreakPanel.jsx — daily logging streak (headline) + weekly rotating challenge.
import { Snowflake, Flame, Check, Trophy } from "lucide-react";
import { computeAdherence, streakMilestone } from "../lib/insights/streak.js";

// flame warms up as you climb the milestone tiers (level 0..8): ember → blue-hot
const FLAME = [
  "text-slate-400",
  "text-orange-400",
  "text-orange-500",
  "text-orange-600",
  "text-amber-500",
  "text-rose-500",
  "text-rose-600",
  "text-violet-500",
  "text-sky-500",
];

export default function StreakPanel({ streak, transactions, freezes = 2 }) {
  const { current, longest, freezesUsed, loggedToday, cells } = streak;
  // secondary: this week's rotating plan-adherence challenge (a bonus to chase)
  const { objective, metThisWeek } = computeAdherence(transactions, freezes);
  const freezesLeft = Math.max(0, freezes - freezesUsed);
  const daysLogged = cells.filter((c) => c.met).length;
  const { tier, next, toNext, progress, level } = streakMilestone(current);
  const flame = FLAME[Math.min(level, FLAME.length - 1)];
  // a personal best feels earned once you're a few days in (and not on day one)
  const personalBest = current > 2 && current === longest;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Daily streak
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <span
            className="inline-flex items-center gap-0.5"
            aria-label={`${freezesLeft} streak freezes left`}
          >
            {Array.from({ length: freezesLeft }).map((_, i) => (
              <Snowflake key={i} size={12} className="text-blue-400" aria-hidden="true" />
            ))}
          </span>
          <span>
            longest {longest} {longest === 1 ? "day" : "days"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-3">
        <Flame
          size={34}
          className={`${flame} transition-colors`}
          style={{ filter: level >= 5 ? "drop-shadow(0 0 6px currentColor)" : "none" }}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-3xl font-mono font-bold text-slate-900">{current}</span>
            {tier && (
              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700">
                {tier.label}
              </span>
            )}
            {personalBest && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"
                aria-label="Personal best"
              >
                <Trophy size={11} aria-hidden="true" /> best
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500">{current === 1 ? "day" : "days"} in a row</div>
        </div>
      </div>

      {/* progress toward the next milestone — a calm goal to chase, not a threat */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>
            {next
              ? `${toNext} ${toNext === 1 ? "day" : "days"} to ${next.label}`
              : "Top tier reached"}
          </span>
          {next && <span className="text-slate-400">{next.days} days</span>}
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={next ? `Progress to ${next.label}` : "Top milestone reached"}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>
      <div
        role="status"
        className={`rounded-lg px-3 py-2 mb-3 text-sm flex items-center gap-1.5 ${loggedToday ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
      >
        {loggedToday ? (
          <>
            <Check size={14} /> <span className="font-semibold">Logged today</span> — streak safe.
          </>
        ) : (
          <>
            <span className="font-semibold">Nothing logged today.</span> Any entry (even a no-spend
            day) keeps it going.
          </>
        )}
      </div>
      <span className="sr-only">{daysLogged} of the last 14 days logged.</span>
      <div className="flex gap-1.5" aria-hidden="true">
        {cells.map((c, i) => (
          <div
            key={i}
            title={c.day ? new Date(`${c.day}T00:00:00`).toLocaleDateString() : ""}
            className={`flex-1 rounded transition-colors ${c.met ? "bg-orange-400" : "bg-slate-100"} ${c.isNow ? "ring-2 ring-orange-300" : ""}`}
            style={{ height: 28 }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1.5 mb-3 text-xs text-slate-400">
        <span>14 days ago</span>
        <span>today</span>
      </div>
      <div
        className={`rounded-lg px-3 py-2 text-xs flex items-center gap-1.5 ${metThisWeek ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-500"}`}
      >
        <span className="font-semibold">Weekly bonus:</span> {objective.label}{" "}
        {metThisWeek && <Check size={13} />}
      </div>
    </div>
  );
}
