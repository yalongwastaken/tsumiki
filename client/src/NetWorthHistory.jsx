// NetWorthHistory.jsx — net-worth-over-time area chart from snapshot history.
import AreaChart from "./Chart.jsx";

/** Net worth over time from snapshot history (needs ≥2 snapshots). */
export default function NetWorthHistory({ data }) {
  if (!data || data.length < 2) {
    return null;
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        Net worth over time
      </div>
      <AreaChart data={data} xKey="label" yKey="value" color="#6366F1" />
    </div>
  );
}
