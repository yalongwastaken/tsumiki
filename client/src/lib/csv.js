// csv.js — minimal, dependency-free CSV parsing + bank-statement mapping. Pure and
// testable: turns pasted/uploaded CSV text into transactions the ledger understands.

/**
 * Parse CSV text into a header row + data rows. Handles quoted fields, escaped
 * quotes (""), and CRLF/CR line endings.
 * @returns {{headers:string[], rows:string[][]}}
 */
export function parseCsv(text) {
  // strip a leading UTF-8 BOM (common in Excel exports) + normalize line endings
  const s = String(text)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++; // escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // drop rows that are entirely blank
  const clean = rows.filter((r) => r.some((x) => x.trim() !== ""));
  if (!clean.length) {
    return { headers: [], rows: [] };
  }
  return { headers: clean[0].map((h) => h.trim()), rows: clean.slice(1) };
}

/**
 * Best-guess which columns hold the date, amount, and description, by header name.
 * @returns {{date:number, amount:number, description:number}} indices (-1 if unknown)
 */
export function guessMapping(headers = []) {
  const find = (...names) =>
    headers.findIndex((h) => names.some((n) => h.toLowerCase().includes(n)));
  return {
    date: find("date", "posted", "time"),
    amount: find("amount", "debit", "value", "withdraw"),
    description: find("description", "payee", "merchant", "memo", "name", "note"),
  };
}

// parse a money cell to a number; accounting parentheses "(50.00)" mean negative
/**
 * Drop transactions that duplicate an existing one (same day + amount + note + type),
 * and de-dupe within the batch itself, so re-importing overlapping statements is safe.
 * @returns {{kept:Array, skipped:number}}
 */
export function dedupeAgainst(newTxs = [], existing = []) {
  const key = (t) =>
    `${String(t.date).slice(0, 10)}|${Math.round((t.amount || 0) * 100)}|${(t.note || "").trim().toLowerCase()}|${t.type}`;
  const seen = new Set(existing.map(key));
  const kept = [];
  let skipped = 0;
  for (const t of newTxs) {
    const k = key(t);
    if (seen.has(k)) {
      skipped++;
    } else {
      seen.add(k);
      kept.push(t);
    }
  }
  return { kept, skipped };
}

const num = (v) => {
  const s = String(v ?? "").trim();
  const neg = /^\(.*\)$/.test(s); // (50.00) → -50
  const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
  return neg ? -Math.abs(n) : n;
};

/**
 * Convert mapped CSV rows into transactions (without ids — the caller assigns them).
 * Sign convention: negative amount = spending, positive = income. `invert` flips it
 * for banks that list expenses as positive numbers.
 * @returns {Array<{type, amount, date, note, cat}>}
 */
export function rowsToTransactions(rows = [], mapping = {}, { invert = false } = {}) {
  const out = [];
  for (const r of rows) {
    const amt = num(r[mapping.amount]);
    const rawDate = String(r[mapping.date] ?? "").trim();
    if (!isFinite(amt) || amt === 0 || !rawDate) {
      continue;
    }
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) {
      continue;
    }
    const signed = invert ? -amt : amt;
    const type = signed < 0 ? "spending" : "income";
    const note = mapping.description >= 0 ? String(r[mapping.description] ?? "").trim() : "";
    out.push({
      type,
      amount: Math.abs(signed),
      date: d.toISOString(),
      note: note || null,
      cat: type === "spending" ? "Imported" : null,
    });
  }
  return out;
}
