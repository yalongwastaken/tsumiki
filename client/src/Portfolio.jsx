// Portfolio.jsx — manually-entered stock holdings + opt-in synced prices, with
// deterministic portfolio-health recommendations (never buy/sell picks).
import { fmt } from "./format.js";
import { portfolioRows, portfolioTotals, portfolioInsights, retirementValue } from "./portfolio.js";

const ACCT_LABEL = { taxable: "Taxable", "401k": "401(k)", ira: "IRA", roth: "Roth IRA" };

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

/** Holdings table + total + gain + recommendations. `news` is the optional price feed payload. */
export default function Portfolio({ holdings = [], prices = null, onGoSetup }) {
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

      <div className="text-xs text-slate-400 mt-3">
        {synced ? `Prices synced ${synced}.` : "Manual holdings."} Health notes are general info,
        not advice.
      </div>
    </div>
  );
}
