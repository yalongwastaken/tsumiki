// Projection.jsx — compound-growth projection chart (lazy-loaded recharts).
import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { fmt, fmtK } from "./format.js";

// own chunk, lazy-loaded by App so recharts (~400kB) only loads on the Grow tab

/** Yearly balance + contributed series from compounding `monthly` at annual `rate`. */
function projectSeries(start, monthly, rate, years) {
  const data = [],
    mRate = rate / 12,
    now = new Date().getFullYear();
  let bal = start,
    contributed = start;
  for (let m = 0; m <= years * 12; m++) {
    if (m % 12 === 0) {
      data.push({
        year: now + m / 12,
        value: Math.round(bal),
        contributed: Math.round(contributed),
      });
    }
    bal = bal * (1 + mRate) + monthly;
    contributed += monthly;
  }
  return data;
}

function Slider({ label, value, min, max, step, suffix = "", fmt: f, onChange }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-sm text-slate-600">{label}</span>
        <span className="text-sm font-mono font-semibold text-slate-800">
          {f ? f(value) : value + suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-emerald-600"
      />
    </div>
  );
}

/** Interactive net-worth projection: horizon / monthly-invested / return-rate sliders. */
export default function Projection({ start, settings, onChange, derivedInvest }) {
  const [years, setYears] = useState(10);
  // §7: default to what your actual plan invests; the slider is an override.
  const monthly = settings.monthlyInvest ?? (derivedInvest != null ? derivedInvest : 3000);
  const usingDerived = settings.monthlyInvest == null && derivedInvest != null;
  const data = projectSeries(start, monthly, settings.returnRate, years);
  const end = data[data.length - 1];
  const gains = end.value - end.contributed;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Projected net worth
        </div>
        <div className="text-xs text-slate-400">
          in {years} {years === 1 ? "year" : "years"}
        </div>
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <div className="text-3xl font-mono font-bold text-emerald-600">{fmt(end.value)}</div>
        <div className="text-xs text-emerald-500">+{fmt(gains)} growth</div>
      </div>
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#10B981" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="year"
              tick={{ fontSize: 11, fill: "#94A3B8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={fmtK}
              tick={{ fontSize: 11, fill: "#94A3B8" }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip
              formatter={(v) => fmt(v)}
              labelFormatter={(l) => `Year ${l}`}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Area type="monotone" dataKey="value" stroke="#10B981" strokeWidth={2} fill="url(#g)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-4 mt-4">
        <Slider
          label="Time horizon"
          value={years}
          min={1}
          max={30}
          step={1}
          suffix=" yr"
          onChange={setYears}
        />
        <Slider
          label={usingDerived ? "Monthly invested (from your plan)" : "Monthly invested"}
          value={monthly}
          min={0}
          max={6000}
          step={100}
          fmt={fmt}
          onChange={(v) => onChange({ ...settings, monthlyInvest: v })}
        />
        <Slider
          label="Annual return"
          value={settings.returnRate}
          min={0.02}
          max={0.12}
          step={0.005}
          fmt={(v) => (v * 100).toFixed(1) + "%"}
          onChange={(v) => onChange({ ...settings, returnRate: v })}
        />
      </div>
      <div className="flex gap-2 mt-4">
        {[
          ["Conservative", 0.05],
          ["Market avg", 0.07],
          ["Aggressive", 0.1],
        ].map(([l, r]) => (
          <button
            key={l}
            onClick={() => onChange({ ...settings, returnRate: r })}
            className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
              Math.abs(settings.returnRate - r) < 0.001
                ? "border-emerald-500 text-emerald-600 bg-emerald-50"
                : "border-slate-200 text-slate-500 hover:border-slate-300"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
