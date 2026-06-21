// A4 — plan-adherence streak with a ROTATING weekly objective, so the challenge
// changes week to week instead of being the same goal forever. Pure + testable.
export const WEEK = 7 * 86400000;
export const weekKey = (d) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday-start
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

// Each objective is satisfiable by one action that week, evaluated from the
// week's transactions (full history available, unlike past balances).
export const OBJECTIVES = [
  { id: "contribute", label: "Move money toward your plan", test: (tx) => tx.some((t) => t.type === "contribution") },
  { id: "log", label: "Log your spending this week", test: (tx) => tx.some((t) => t.type === "spending") },
  { id: "invest", label: "Invest in your future", test: (tx) => tx.some((t) => t.type === "contribution" && (t.bucket === "invest" || t.bucket === "retirement")) },
  { id: "safety", label: "Add to your emergency fund", test: (tx) => tx.some((t) => t.type === "contribution" && t.bucket === "emergency") },
];

// deterministic per-week rotation (stable within a given week)
export const objectiveForWeek = (wk) => OBJECTIVES[Math.floor(wk / WEEK) % OBJECTIVES.length];

export function computeAdherence(transactions = [], freezes = 0) {
  const byWeek = {};
  for (const t of transactions) (byWeek[weekKey(t.date)] ??= []).push(t);
  const met = (wk) => objectiveForWeek(wk).test(byWeek[wk] || []);

  const thisWeek = weekKey(Date.now());
  // current streak: this week's objective may not be done yet — don't penalize until it's over
  let cur = thisWeek;
  if (!met(cur)) cur -= WEEK;
  let current = 0, fz = freezes, used = 0;
  while (true) {
    if (met(cur)) { current++; cur -= WEEK; }
    else if (fz > 0 && current > 0) { fz--; used++; cur -= WEEK; }
    else break;
  }

  // longest run ever (no freezes), scanning from the earliest logged week
  const allWeeks = Object.keys(byWeek).map(Number);
  let longest = 0;
  if (allWeeks.length) {
    let run = 0;
    for (let wk = Math.min(...allWeeks); wk <= thisWeek; wk += WEEK) {
      run = met(wk) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  longest = Math.max(longest, current);

  const cells = [];
  for (let i = 11; i >= 0; i--) {
    const wk = thisWeek - i * WEEK;
    cells.push({ wk, met: met(wk), isNow: wk === thisWeek });
  }

  return {
    current, longest, freezesUsed: used, cells,
    objective: objectiveForWeek(thisWeek),
    metThisWeek: met(thisWeek),
  };
}
