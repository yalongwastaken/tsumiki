// CsvImport.jsx — paste or upload a bank CSV, map the columns, preview, and import
// as transactions. Uses the pure parser in csv.js; nothing leaves the device.
import { useState, useMemo } from "react";
import Money from "./Money.jsx";
import { parseCsv, guessMapping, rowsToTransactions, dedupeAgainst } from "../lib/csv.js";
import { uid } from "../lib/uid.js";

const field =
  "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700";

/** A column-picker dropdown (module-scope so it doesn't remount on every keystroke). */
function ColSelect({ value, onChange, label, cols }) {
  return (
    <label className="flex-1 min-w-[90px]">
      <span className="text-xs text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={field}>
        <option value={-1}>—</option>
        {cols.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
}

/** CSV → transactions importer. `onImport(transactions)` appends to the ledger. */
export default function CsvImport({ onImport, existing = [] }) {
  const [text, setText] = useState("");
  const [invert, setInvert] = useState(false);
  const [done, setDone] = useState(0);
  const [skipped, setSkipped] = useState(0);

  const parsed = useMemo(() => (text.trim() ? parseCsv(text) : null), [text]);
  const [map, setMap] = useState(null);
  // use the manual mapping when set, else re-guess from the parsed headers
  const mapping = useMemo(() => map ?? guessMapping(parsed?.headers || []), [map, parsed]);

  const txs = useMemo(
    () => (parsed ? rowsToTransactions(parsed.rows, mapping, { invert }) : []),
    [parsed, mapping, invert],
  );

  function readFile(e) {
    const f = e.target.files?.[0];
    if (!f) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result || ""));
      setMap(null); // re-guess for the new file
      setDone(0);
    };
    reader.readAsText(f);
  }

  function doImport() {
    if (!txs.length) {
      return;
    }
    // skip rows that duplicate transactions already in the ledger (or each other)
    const { kept, skipped: dropped } = dedupeAgainst(txs, existing);
    onImport(kept.map((t) => ({ id: uid(), ...t })));
    setDone(kept.length);
    setSkipped(dropped);
    setText("");
    setMap(null);
  }

  const cols = parsed?.headers || [];

  return (
    <div className="space-y-3">
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={readFile}
        className="block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        aria-label="Upload CSV file"
      />
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setMap(null);
          setDone(0);
        }}
        placeholder="…or paste CSV here (first row = column headers)"
        rows={3}
        className={field + " font-mono text-xs"}
      />

      {parsed && cols.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <ColSelect
              label="Date column"
              cols={cols}
              value={mapping.date}
              onChange={(v) => setMap({ ...mapping, date: v })}
            />
            <ColSelect
              label="Amount column"
              cols={cols}
              value={mapping.amount}
              onChange={(v) => setMap({ ...mapping, amount: v })}
            />
            <ColSelect
              label="Description"
              cols={cols}
              value={mapping.description}
              onChange={(v) => setMap({ ...mapping, description: v })}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
            My bank lists expenses as positive numbers (flip the sign)
          </label>

          {txs.length > 0 ? (
            <>
              <div className="rounded-lg border border-slate-100 divide-y divide-slate-50">
                {txs.slice(0, 4).map((t, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span className="text-slate-500 flex-shrink-0">
                      {new Date(t.date).toLocaleDateString()}
                    </span>
                    <span className="text-slate-600 flex-1 min-w-0 truncate">{t.note || "—"}</span>
                    {t.cat && (
                      <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {t.cat}
                      </span>
                    )}
                    <span
                      className={`font-mono flex-shrink-0 ${t.type === "spending" ? "text-rose-500" : "text-emerald-600"}`}
                    >
                      {t.type === "spending" ? "−" : "+"}
                      <Money n={t.amount} />
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={doImport}
                className="w-full py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg"
              >
                Import {txs.length} transaction{txs.length === 1 ? "" : "s"}
              </button>
            </>
          ) : (
            <div className="text-xs text-amber-700">
              No rows parsed yet — check the column mapping above.
            </div>
          )}
        </>
      )}
      {done > 0 && (
        <div className="text-xs text-emerald-600">
          Imported {done} transactions.{skipped > 0 ? ` Skipped ${skipped} duplicate(s).` : ""} ✓
        </div>
      )}
      {done === 0 && skipped > 0 && (
        <div className="text-xs text-amber-700">
          Nothing imported — all {skipped} row(s) already exist (duplicates skipped).
        </div>
      )}
      <div className="text-xs text-slate-500">
        Stays on your device. Expenses import as spending, deposits as income — tweak categories in
        Activity.
      </div>
    </div>
  );
}
