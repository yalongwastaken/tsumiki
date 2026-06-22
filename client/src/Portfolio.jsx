// Portfolio.jsx — manually-entered stock holdings + opt-in synced prices, with
// deterministic portfolio-health recommendations (never buy/sell picks).
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { fmt } from "./format.js";
import AreaChart from "./Chart.jsx";
import { portfolioRows, portfolioTotals, portfolioInsights, retirementValue } from "./portfolio.js";

const ACCT_LABEL = { taxable: "Taxable", "401k": "401(k)", ira: "IRA", roth: "Roth IRA" };
// stable-ish palette for the allocation donut (cycled by holding rank)
const PALETTE = ["#A78BFA", "#3FA9C9", "#378ADD", "#1D9E75", "#E0A356", "#E05656", "#64748B"];

/** Donut of portfolio value by holding, with a percent/value legend. */
function AllocationDonut({ segs, total }) {
  const R = 46,
    SW = 18,
    C = 2 * Math.PI * R,
    cx = 60,
    cy = 60;
  let off = 0;
  return (
    <div className="flex items-center gap-4 flex-wrap mb-3">
      <svg
        width="120"
        height="120"
        viewBox="0 0 120 120"
        className="flex-shrink-0"
        role="img"
        aria-label={`Allocation by holding, total ${fmt(total)}: ${segs
          .map((s) => `${s.label} ${Math.round((s.amount / total) * 100)}%`)
          .join(", ")}`}
      >
        {segs.map((s, i) => {
          const dash = (s.amount / total) * C;
          const el = (
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
          holdings
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize="14"
          fontWeight="600"
          fill="var(--text)"
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
            <span className="text-slate-600 flex-1 truncate">{s.label}</span>
            <span className="font-mono text-slate-500">
              {Math.round((s.amount / total) * 100)}%
            </span>
            <span className="font-mono text-slate-700 w-16 text-right">{fmt(s.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const REC_TONE = {
  warn: "bg-amber-50 text-amber-800",
  good: "bg-emerald-50 text-emerald-700",
  info: "bg-brand-50 text-brand-700",
};
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const ago = (ts) => {
  if (!ts) {
    return null;
  }
  const h = Math.round((Date.now() - ts) / 3.6e6);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

/** Holdings table + allocation donut + total/gain + recommendations. `prices` is the
 * optional synced-price payload ({enabled, prices, fetchedAt}); `onSync` forces a refresh. */
export default function Portfolio({ holdings = [], prices = null, onGoSetup, onSync }) {
  const [syncing, setSyncing] = useState(false);
  // run a manual price sync; ignore double-taps while one is in flight
  async function sync() {
    if (syncing || !onSync) {
      return;
    }
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
    }
  }

  if (!holdings.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Portfolio
        </div>
        <div className="text-sm text-slate-500">
          Track individual stocks you own.{" "}
          <button onClick={onGoSetup} className="text-brand-600 hover:text-brand-700">
            Add holdings in Accounts ›
          </button>
        </div>
      </div>
    );
  }

  const priceMap = prices?.prices || {};
  const rows = portfolioRows(holdings, priceMap);
  const totals = portfolioTotals(rows);
  const recs = portfolioInsights(rows, totals);
  const synced = ago(prices?.fetchedAt);
  const retire = retirementValue(rows);
  const taxable = totals.value - retire;
  // allocation donut: one slice per priced holding, biggest first (≥2 to be useful)
  const allocSegs = rows
    .filter((r) => r.value != null && r.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((r, i) => ({ label: r.ticker, amount: r.value, color: PALETTE[i % PALETTE.length] }));

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Portfolio
        </div>
        <button onClick={onGoSetup} className="text-xs text-slate-400 hover:text-brand-600">
          edit ›
        </button>
      </div>

      {totals.priced ? (
        <div className="flex items-baseline gap-2 mb-3">
          <div className="text-3xl font-mono font-bold text-slate-900">{fmt(totals.value)}</div>
          {totals.gain != null && (
            <div className={`text-xs ${totals.gain >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
              {totals.gain >= 0 ? "+" : ""}
              {fmt(totals.gain)} {totals.gainPct != null ? `(${pct(totals.gainPct)})` : ""}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-slate-500 mb-1">
          Prices sync nightly when enabled on the server (off by default).
        </div>
      )}
      {totals.priced && retire > 0 && (
        <div className="text-xs text-slate-400 mb-3">
          {fmt(retire)} in retirement (401k/IRA) · {fmt(taxable)} taxable
        </div>
      )}

      {allocSegs.length >= 2 && <AllocationDonut segs={allocSegs} total={totals.value} />}

      {prices?.history?.length >= 2 && (
        <div className="mb-3">
          <div className="text-xs text-slate-400 mb-1">Value over time</div>
          <AreaChart
            data={prices.history}
            xKey="date"
            yKey="value"
            label="Portfolio value"
            xFormat={(d) =>
              new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            }
          />
        </div>
      )}

      <div className="divide-y divide-slate-50">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-700">
                {r.ticker}
                {r.account !== "taxable" && (
                  <span className="ml-1.5 text-[10px] font-semibold text-brand-700 bg-brand-50 rounded px-1 py-0.5 align-middle">
                    {ACCT_LABEL[r.account] || r.account}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400">
                {r.shares} sh{r.price != null ? ` · ${fmt(r.price)}` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-mono text-slate-800">
                {r.value != null ? fmt(r.value) : "—"}
              </div>
              {r.gainPct != null && (
                <div className={`text-xs ${r.gain >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                  {pct(r.gainPct)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {recs.length > 0 && (
        <div className="mt-3 space-y-2">
          {recs.map((r) => (
            <div
              key={r.id}
              className={`rounded-lg p-2.5 text-sm ${REC_TONE[r.tone] || REC_TONE.info}`}
            >
              {r.text}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-3">
        <div className="text-xs text-slate-400">
          {synced ? `Prices synced ${synced}.` : "Manual holdings."} Health notes are general info,
          not advice.
        </div>
        {prices?.enabled && onSync && (
          <button
            onClick={sync}
            disabled={syncing}
            className="press flex flex-shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
          >
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        )}
      </div>
    </div>
  );
}
