// Calendar.jsx — one-month grid: heatmap, activity dots, bills, weekly adherence.
import { useState, useMemo } from "react";
import Money from "./Money.jsx";
import { Flame, ChevronLeft, ChevronRight } from "lucide-react";
import { fmt } from "../lib/core/format.js";
import { weekKey, objectiveForWeek } from "../lib/insights/streak.js";
import { paydaysInMonth } from "../lib/plan/paydays.js";
import { billDueDay } from "../lib/plan/billdates.js";

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * One-month grid combining four views: spending heatmap (cell tint), activity
 * dots (income/contribution), bill due-dates, and the per-week adherence marker.
 * Tap a day to see what happened.
 */
export default function Calendar({ transactions = [], profile = {} }) {
  const [offset, setOffset] = useState(0); // months from current
  const [sel, setSel] = useState(null);

  const base = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return d;
  }, [offset]);
  const year = base.getFullYear(),
    month = base.getMonth();
  const monthLabel = base.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = Monday
  const todayKey = new Date().toDateString();

  // aggregate this month's transactions by day
  const byDay = useMemo(() => {
    const m = {};
    for (const t of transactions) {
      const x = new Date(t.date);
      if (x.getFullYear() !== year || x.getMonth() !== month) {
        continue;
      }
      const d = x.getDate();
      m[d] ??= { spend: 0, income: 0, contrib: 0, items: [] };
      if (t.type === "spending") {
        m[d].spend += t.amount;
      } else if (t.type === "income") {
        m[d].income += t.amount;
      } else if (t.type === "contribution") {
        m[d].contrib += t.amount;
      }
      m[d].items.push(t);
    }
    return m;
  }, [transactions, year, month]);
  const maxSpend = Math.max(1, ...Object.values(byDay).map((d) => d.spend));

  const billsByDay = useMemo(() => {
    const m = {};
    for (const b of profile.bills || []) {
      const day = billDueDay(b, year, month); // resolves day/last-day/Nth-weekday this month
      if (day) {
        (m[day] ??= []).push(b);
      }
    }
    return m;
  }, [profile.bills, year, month]);

  // forecast paydays this month, per income source (day-of-month → source names)
  const paydaysByDay = useMemo(() => {
    const m = {};
    for (const s of profile.incomeSources || []) {
      for (const d of paydaysInMonth(s.payday, s.cadence, year, month)) {
        (m[d] ??= []).push(s.name || "Income");
      }
    }
    return m;
  }, [profile.incomeSources, year, month]);

  // adherence by week (uses all transactions, since a week can span months)
  const weekTx = useMemo(() => {
    const m = {};
    for (const t of transactions) {
      (m[weekKey(t.date)] ??= []).push(t);
    }
    return m;
  }, [transactions]);
  const weekMet = (wk) => objectiveForWeek(wk).test(weekTx[wk] || []);

  // build rows (each row = one Monday-start week)
  const totalCells = firstDow + daysInMonth;
  const rowCount = Math.ceil(totalCells / 7);
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const monday = new Date(year, month, 1 + r * 7 - firstDow);
    const days = [];
    for (let c = 0; c < 7; c++) {
      const dayNum = r * 7 + c - firstDow + 1;
      days.push(dayNum >= 1 && dayNum <= daysInMonth ? dayNum : null);
    }
    rows.push({ wk: weekKey(monday), days });
  }

  const tint = (spend) =>
    spend > 0 ? { background: `rgba(244,63,94,${0.08 + 0.5 * (spend / maxSpend)})` } : undefined;
  const selData = sel != null ? byDay[sel] : null;
  const selBills = sel != null ? billsByDay[sel] || [] : [];
  const selPaydays = sel != null ? paydaysByDay[sel] || [] : [];

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => {
              setOffset(offset - 1);
              setSel(null);
            }}
            aria-label="Previous month"
            className="px-2 py-1 text-slate-500 hover:text-slate-700"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="text-sm font-semibold text-slate-700">{monthLabel}</div>
          <button
            onClick={() => {
              setOffset(offset + 1);
              setSel(null);
            }}
            aria-label="Next month"
            className="px-2 py-1 text-slate-500 hover:text-slate-700"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="grid mb-1" style={{ gridTemplateColumns: "1.2rem repeat(7, 1fr)", gap: 2 }}>
          <div />
          {DOW.map((d, i) => (
            <div key={i} className="text-center text-xs text-slate-400">
              {d}
            </div>
          ))}
        </div>

        {rows.map((row, r) => (
          <div
            key={r}
            className="grid items-stretch"
            style={{ gridTemplateColumns: "1.2rem repeat(7, 1fr)", gap: 2, marginBottom: 2 }}
          >
            <div className="flex items-center justify-center" title="this week's objective">
              {weekMet(row.wk) ? (
                <Flame size={13} className="text-orange-500" />
              ) : (
                <span className="text-slate-200">·</span>
              )}
            </div>
            {row.days.map((d, c) => {
              if (d == null) {
                return <div key={c} />;
              }
              const info = byDay[d];
              const isToday = new Date(year, month, d).toDateString() === todayKey;
              // screen-reader summary of the day's activity
              const parts = [];
              if (info?.spend > 0) {
                parts.push(`${fmt(info.spend)} spent`);
              }
              if (info?.income > 0) {
                parts.push("income");
              }
              if (info?.contrib > 0) {
                parts.push("saved");
              }
              if (billsByDay[d]) {
                parts.push("bill due");
              }
              if (paydaysByDay[d]) {
                parts.push("payday");
              }
              const dayLabel = `${monthLabel.split(" ")[0]} ${d}${parts.length ? `: ${parts.join(", ")}` : ""}`;
              return (
                <button
                  key={c}
                  onClick={() => setSel(sel === d ? null : d)}
                  style={tint(info?.spend || 0)}
                  aria-label={dayLabel}
                  className={`aspect-square rounded-md text-xs flex flex-col items-center justify-center relative ${sel === d ? "ring-2 ring-brand-400" : isToday ? "ring-1 ring-slate-300" : ""}`}
                >
                  <span className={isToday ? "font-bold text-slate-900" : "text-slate-600"}>
                    {d}
                  </span>
                  <span className="flex gap-0.5 mt-0.5 h-1.5">
                    {info?.income > 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    )}
                    {info?.contrib > 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                    )}
                    {billsByDay[d] && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                    {paydaysByDay[d] && (
                      <span className="w-1.5 h-1.5 rounded-full border border-emerald-500" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}

        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-xs text-slate-500">
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />
            income
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-brand-500 mr-1" />
            saved
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />
            bill due
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full border border-emerald-500 mr-1" />
            payday
          </span>
          <span>
            <span
              className="inline-block w-2 h-2 rounded-sm mr-1"
              style={{ background: "rgba(244,63,94,0.4)" }}
            />
            spending
          </span>
          <span className="inline-flex items-center gap-1">
            <Flame size={12} className="text-orange-500" /> week objective met
          </span>
        </div>
      </div>

      {sel != null && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            {base.toLocaleDateString(undefined, { month: "long" })} {sel}
          </div>
          {selPaydays.map((name, i) => (
            <div key={`pay-${i}`} className="flex justify-between py-1.5 text-sm">
              <span className="text-emerald-600">Payday · {name}</span>
              <span className="text-xs text-slate-500">expected</span>
            </div>
          ))}
          {selBills.length > 0 &&
            selBills.map((b) => (
              <div key={b.id} className="flex justify-between py-1.5 text-sm">
                <span className="text-amber-600">Bill due · {b.name}</span>
                <span className="font-mono text-slate-500">
                  <Money n={b.amount} />
                </span>
              </div>
            ))}
          {selData?.items.length
            ? selData.items
                .slice()
                .reverse()
                .map((t) => (
                  <div
                    key={t.id}
                    className="flex justify-between py-1.5 text-sm border-t border-slate-50"
                  >
                    <span className="text-slate-700">
                      {t.type === "spending"
                        ? t.cat || "Spending"
                        : t.type === "income"
                          ? "Income"
                          : t.type === "transfer"
                            ? "Transfer"
                            : "Saved"}
                      {t.note ? ` · ${t.note}` : ""}
                    </span>
                    <span
                      className={`font-mono ${t.type === "spending" ? "text-slate-700" : t.type === "income" ? "text-emerald-600" : t.type === "transfer" ? "text-slate-500" : "text-brand-600"}`}
                    >
                      {t.type === "spending" ? "−" : t.type === "transfer" ? "" : "+"}
                      <Money n={t.amount} />
                    </span>
                  </div>
                ))
            : selBills.length === 0 &&
              selPaydays.length === 0 && (
                <div className="text-sm text-slate-500">Nothing logged this day.</div>
              )}
        </div>
      )}
    </>
  );
}
