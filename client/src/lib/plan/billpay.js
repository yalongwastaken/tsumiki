// billpay.js — match logged spending against recurring bills, so the app can say
// "paid / due / overdue" instead of just "due on the 15th". Pure + explainable:
// a bill is "paid" this month when a spend matches by name (bill name appears in
// the transaction's category or note, or vice versa) or by amount near the due
// date; each transaction can pay at most one bill.
import { billDueDay } from "./billdates.js";

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// name evidence, two strengths: `forward` (the bill's name appears in the tx's
// cat/note — strong) and `reverse` (the tx text appears inside the bill name —
// weak: any short generic note could hit, so it only ever counts WITH an amount
// match; see the scoring below)
function nameEvidence(bill, t) {
  const bn = norm(bill.name);
  const hay = norm(`${t.cat || ""} ${t.note || ""}`);
  if (!bn || !hay) {
    return { forward: false, reverse: false };
  }
  return { forward: hay.includes(bn), reverse: hay.length >= 4 && bn.includes(hay) };
}

// amount within 2% (or $1) of the bill amount — utilities wobble a little
function amountMatches(bill, t) {
  const a = Number(bill.amount) || 0;
  return a > 0 && Math.abs(t.amount - a) <= Math.max(1, a * 0.02);
}

/**
 * Payment status of every bill for one calendar month.
 * @param {Array} bills - profile.bills
 * @param {Array} transactions - the full ledger (filtered internally)
 * @param {number} year
 * @param {number} month - 0-based
 * @param {Date} [today]
 * @returns {Array<{bill, dueDay, status, paidBy, paidOn}>} status is one of
 *   "paid" | "due" (not due yet this month) | "overdue" (due day passed, unpaid) |
 *   "upcoming" (a future month) | "none" (no schedule and nothing matched)
 */
export function billPayments(bills = [], transactions = [], year, month, today = new Date()) {
  const inMonth = transactions.filter((t) => {
    if (t.type !== "spending" || !(t.amount > 0)) {
      return false;
    }
    const d = new Date(t.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const used = new Set();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const isFutureMonth =
    year > today.getFullYear() || (year === today.getFullYear() && month > today.getMonth());

  return bills.map((bill) => {
    const dueDay = billDueDay(bill, year, month);
    // best unused match: name+amount beats forward-name beats amount-near-the-due-date.
    // Weak (reverse) name evidence never matches alone — a false "paid" suppresses the
    // overdue alert, which is the failure mode that actually costs money.
    let match = null;
    let best = 0;
    for (const t of inMonth) {
      if (used.has(t.id)) {
        continue;
      }
      const { forward, reverse } = nameEvidence(bill, t);
      const am = amountMatches(bill, t);
      let score = 0;
      if (am && (forward || reverse)) {
        score = 3;
      } else if (forward) {
        score = 2;
      } else if (am && dueDay != null && Math.abs(new Date(t.date).getDate() - dueDay) <= 7) {
        score = 1; // amount alone only counts within a week of the due date
      }
      if (score > best) {
        best = score;
        match = t;
      }
    }
    if (match) {
      used.add(match.id);
    }
    let status;
    if (match) {
      status = "paid";
    } else if (dueDay == null) {
      status = "none";
    } else if (isFutureMonth) {
      status = "upcoming";
    } else if (isCurrentMonth && today.getDate() <= dueDay) {
      status = "due";
    } else {
      status = "overdue"; // past the due day (or a past month) with no matching spend
    }
    return {
      bill,
      dueDay,
      status,
      paidBy: match?.id ?? null,
      paidOn: match ? new Date(match.date).getDate() : null,
    };
  });
}

/** Roll a month's statuses up for the Home card: paid X of N, $ left, overdue list. */
export function billsSummary(statuses = []) {
  const relevant = statuses.filter((s) => s.status !== "none" && s.status !== "upcoming");
  const unpaid = relevant.filter((s) => s.status === "due" || s.status === "overdue");
  return {
    total: relevant.length,
    paidCount: relevant.filter((s) => s.status === "paid").length,
    leftCount: unpaid.length,
    leftTotal: unpaid.reduce((sum, s) => sum + (Number(s.bill.amount) || 0), 0),
    overdue: relevant.filter((s) => s.status === "overdue"),
  };
}
