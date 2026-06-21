import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { fmt, fmtK } from "./format.js";

// M6 — net worth over time from snapshot history. Lazy-loaded; shares the
// recharts chunk with Projection. `data` is precomputed in App (pure).
export default function NetWorthHistory({ data }) {
  if (!data || data.length < 2) return null;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Net worth over time</div>
      <div style={{ width: "100%", height: 160 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366F1" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#6366F1" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={44} />
            <Tooltip formatter={(v) => fmt(v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
            <Area type="monotone" dataKey="value" stroke="#6366F1" strokeWidth={2} fill="url(#nw)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
