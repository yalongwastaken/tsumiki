// Portfolio.jsx — manually-entered stock holdings + opt-in synced prices, with
// deterministic portfolio-health recommendations (never buy/sell picks).
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { fmt } from "../lib/format.js";
import AreaChart from "../charts/Chart.jsx";
import StocksSankey from "../charts/StocksSankey.jsx";
import Money from "../components/Money.jsx";
import {
  portfolioRows,
  portfolioTotals,
  portfolioInsights,
  retirementValue,
  portfolioFlow,
} from "../lib/portfolio.js";

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
            <span className="text-slate-600 flex-1 truncate">{s.label}</span>
            <span className="font-mono text-slate-500">
              {Math.round((s.amount / total) * 100)}%
            </span>
            <Money n={s.amount} className="font-mono text-slate-700 w-16 text-right" />
          </div>
        ))}
      </div>
    </div>
  );
}

const REC_TONE = {
  warn: "bg-amber-50 text-amber-800",
  good: "bg-emerald-50 text-emerald-700",
  info: "bg-brand-50 text-brand-800",
};
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const ago = (ts) => {
  if (!ts) {
    return null;
  }
  const h = Math.round((Date.now() - ts) / 3.6e6);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

// a human note when the last sync didn't fully succeed (null when it's fine / off).
// Returns {text, tone} so an error can be announced more assertively than a partial.
// Exported for unit testing.
export function syncProblem(ls) {
  if (!ls || ls.status === "ok" || ls.status === "idle" || ls.status === "disabled") {
    return null;
  }
  if (ls.status === "error") {
    return {
      text: "Last price sync couldn't reach the feed — showing the last saved prices.",
      tone: "error",
    };
  }
  if (ls.status === "empty") {
    return {
      text: "Last price sync returned no data — showing the last saved prices.",
      tone: "error",
    };
  }
  if (ls.status === "partial") {
    const m = ls.missing || [];
    // cap the list so a portfolio with many un-priced tickers can't produce a runaway sentence
    const shown = m.slice(0, 4).join(", ");
    const extra = m.length > 4 ? ` +${m.length - 4} more` : "";
    return {
      text: `No fresh price for ${shown}${extra} — showing the last saved value${m.length > 1 ? "s" : ""}.`,
      tone: "warn",
    };
  }
  return null;
}

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
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
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
  const problem = syncProblem(prices?.lastSync);
  // show the stocks Sankey only when there are ≥2 priced holdings to separate
  const flow = portfolioFlow(rows);
  const showSankey = flow.total > 0 && flow.buckets.reduce((s, b) => s + b.holdings.length, 0) >= 2;
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
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Portfolio
        </div>
        <button onClick={onGoSetup} className="text-xs text-slate-500 hover:text-brand-600">
          edit ›
        </button>
      </div>

      {totals.priced ? (
        <div className="flex items-baseline gap-2 mb-3">
          <Money n={totals.value} className="text-3xl font-mono font-bold text-slate-900" />
          {totals.gain != null && (
            <div className={`text-xs ${totals.gain >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
              {totals.gain >= 0 ? "+" : ""}
              <Money n={totals.gain} /> {totals.gainPct != null ? `(${pct(totals.gainPct)})` : ""}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-slate-500 mb-1">
          {prices?.enabled
            ? "Prices are enabled but haven't synced yet — tap Sync now."
            : "Prices sync nightly when enabled on the server (off by default)."}
        </div>
      )}
      {totals.priced && retire > 0 && (
        <div className="text-xs text-slate-500 mb-3">
          <Money n={retire} /> in retirement (401k/IRA) · <Money n={taxable} /> taxable
        </div>
      )}

      {allocSegs.length >= 2 && (
        <AllocationDonut segs={allocSegs} total={allocSegs.reduce((a, s) => a + s.amount, 0)} />
      )}

      {showSankey && (
        <div className="mb-3">
          <div className="text-xs text-slate-500 mb-1">Where your stocks sit</div>
          <StocksSankey rows={rows} />
        </div>
      )}

      {prices?.history?.length >= 2 && (
        <div className="mb-3">
          <div className="text-xs text-slate-500 mb-1">Value over time</div>
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
              <div className="text-xs text-slate-500">
                {r.shares} sh
                {r.price != null && (
                  <>
                    {" · "}
                    <Money n={r.price} />
                  </>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-mono text-slate-800">
                {r.value != null ? <Money n={r.value} /> : "—"}
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

      {problem && (
        <div
          className="mt-3 rounded-lg p-2.5 text-sm bg-amber-50 text-amber-800 break-words"
          role={problem.tone === "error" ? "alert" : "status"}
        >
          {problem.text}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-3">
        <div className="text-xs text-slate-500">
          {/* when the latest sync failed, don't claim a fresh "synced Xh ago"; clarify the
              shown prices are the last good ones */}
          {problem
            ? synced
              ? `Showing prices from last good sync (${synced}).`
              : "Showing manual holdings."
            : synced
              ? `Prices synced ${synced}.`
              : "Manual holdings."}{" "}
          Health notes are general info, not advice.
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
