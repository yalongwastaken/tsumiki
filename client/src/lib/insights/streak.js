// streak.js — two streaks: a DAILY logging streak (the headline — keep showing up,
// any log counts) and a weekly plan-adherence challenge with a rotating objective.

export const DAY = 86400000;
export const WEEK = 7 * DAY;

// local "YYYY-MM-DD" for a date ("" for an unparseable one). Local — not UTC — so a
// day bucket lines up with the user's own calendar across timezones.
export const dayKey = (d) => {
  // a bare YYYY-MM-DD is already a local calendar day — return it as-is so it doesn't
  // shift back a day when parsed as UTC midnight in western timezones (matches monthOf)
  if (typeof d === "string") {
    const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (bare) {
      return d;
    }
  }
  const x = new Date(d);
  if (isNaN(x.getTime())) {
    return "";
  }
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/**
 * Daily logging streak: consecutive days, ending today, with at least one log of
 * ANY type (income, spending, a contribution, or a $0 no-spend day). Today not
 * being logged yet doesn't break it — the count just runs through yesterday until
 * the day is over. `freezes` lets a limited number of missed days be forgiven.
 * @returns {{current:number, longest:number, freezesUsed:number, loggedToday:boolean, cells:Array<{day,met,isNow}>}}
 */
export function computeDailyStreak(transactions = [], freezes = 0, now = Date.now()) {
  const active = new Set();
  for (const t of transactions) {
    const k = dayKey(t.date);
    if (k) {
      active.add(k);
    }
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const loggedToday = active.has(dayKey(today));

  // current run: start at today, or yesterday if today isn't logged yet
  const cursor = new Date(today);
  if (!loggedToday) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let current = 0,
    fz = freezes,
    used = 0;
  while (true) {
    if (active.has(dayKey(cursor))) {
      current++;
      cursor.setDate(cursor.getDate() - 1);
    } else if (fz > 0 && current > 0) {
      fz--;
      used++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  // longest run ever (no freezes): walk calendar days from the first logged day to
  // the later of today / the last logged day. Bounding by the last logged day (not
  // just today) means a stray FUTURE-dated entry can't make this loop run forever.
  let longest = 0;
  if (active.size) {
    const sorted = [...active].sort();
    const d = new Date(`${sorted[0]}T00:00:00`); // local parse
    const lastActive = new Date(`${sorted[sorted.length - 1]}T00:00:00`);
    const end = lastActive > today ? lastActive : today;
    let run = 0;
    while (d <= end) {
      run = active.has(dayKey(d)) ? run + 1 : 0;
      longest = Math.max(longest, run);
      d.setDate(d.getDate() + 1);
    }
  }
  longest = Math.max(longest, current);

  // last 14 days for the grid
  const cells = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    cells.push({ day: k, met: active.has(k), isNow: i === 0 });
  }

  return { current, longest, freezesUsed: used, loggedToday, cells };
}

// Milestone tiers for the daily logging streak — calm progression markers to chase,
// not loss-aversion pressure. Each is a day count plus a short name to celebrate.
export const STREAK_TIERS = [
  { days: 3, label: "Getting started" },
  { days: 7, label: "One week" },
  { days: 14, label: "Two weeks" },
  { days: 30, label: "One month" },
  { days: 60, label: "Two months" },
  { days: 100, label: "100 days" },
  { days: 180, label: "Half a year" },
  { days: 365, label: "One year" },
];

/**
 * Where a current daily streak sits among the milestone tiers — a pure derivation so
 * the UI can show "you're a week in, 6 days to a month" without any extra state.
 * @param {number} current - days in the current streak
 * @returns {{tier:object|null, next:object|null, toNext:number|null, progress:number, level:number}}
 *   tier = highest milestone reached (null before the first), next = the upcoming one
 *   (null once past the last), toNext = days remaining to it, progress = 0..1 from the
 *   last tier toward the next, level = how many tiers reached (drives flame intensity).
 */
export function streakMilestone(current = 0) {
  const n = Math.max(0, Math.floor(current) || 0);
  const reached = STREAK_TIERS.filter((t) => n >= t.days);
  const tier = reached[reached.length - 1] || null;
  const next = STREAK_TIERS[reached.length] || null;
  const from = tier ? tier.days : 0;
  const toNext = next ? next.days - n : null;
  const progress = next ? Math.max(0, Math.min(1, (n - from) / (next.days - from))) : 1;
  return { tier, next, toNext, progress, level: reached.length };
}

/** Timestamp of the Monday that starts the week containing `d`. */
export const weekKey = (d) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // monday-start
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

// each objective is satisfiable by one action that week, evaluated from the
// week's transactions (full history available, unlike past balances)
export const OBJECTIVES = [
  {
    id: "contribute",
    label: "Move money toward your plan",
    test: (tx) => tx.some((t) => t.type === "contribution"),
  },
  {
    id: "log",
    label: "Log your spending this week",
    test: (tx) => tx.some((t) => t.type === "spending"),
  },
  {
    id: "invest",
    label: "Invest in your future",
    test: (tx) =>
      tx.some(
        (t) => t.type === "contribution" && (t.bucket === "invest" || t.bucket === "retirement"),
      ),
  },
  {
    id: "safety",
    label: "Add to your emergency fund",
    test: (tx) => tx.some((t) => t.type === "contribution" && t.bucket === "emergency"),
  },
];

/** Deterministic per-week objective (stable within a given week). */
export const objectiveForWeek = (wk) => OBJECTIVES[Math.floor(wk / WEEK) % OBJECTIVES.length];

/**
 * Compute the current/longest adherence streak (in weeks) plus the 12-week cell
 * grid. `freezes` lets a limited number of missed weeks not break the streak.
 * @returns {{current:number, longest:number, freezesUsed:number, cells:Array, objective:Object, metThisWeek:boolean}}
 */
export function computeAdherence(transactions = [], freezes = 0) {
  const byWeek = {};
  for (const t of transactions) {
    (byWeek[weekKey(t.date)] ??= []).push(t);
  }
  const met = (wk) => objectiveForWeek(wk).test(byWeek[wk] || []);
  // step `n` weeks from a week key via the local calendar (re-normalized to local
  // Monday midnight), so a DST transition doesn't drift the key by an hour and miss
  // the byWeek lookup — a fixed ±WEEK ms step would.
  const shiftWeeks = (wk, n) => {
    const d = new Date(wk);
    d.setDate(d.getDate() + n * 7);
    return weekKey(d);
  };

  const thisWeek = weekKey(Date.now());
  // current streak: this week's objective may not be done yet — don't penalize until it's over
  let cur = thisWeek;
  if (!met(cur)) {
    cur = shiftWeeks(cur, -1);
  }
  let current = 0,
    fz = freezes,
    used = 0;
  while (true) {
    if (met(cur)) {
      current++;
      cur = shiftWeeks(cur, -1);
    } else if (fz > 0 && current > 0) {
      fz--;
      used++;
      cur = shiftWeeks(cur, -1);
    } else {
      break;
    }
  }

  // longest run ever (no freezes), scanning from the earliest logged week
  const allWeeks = Object.keys(byWeek).map(Number);
  let longest = 0;
  if (allWeeks.length) {
    let run = 0;
    for (let wk = Math.min(...allWeeks); wk <= thisWeek; wk = shiftWeeks(wk, 1)) {
      run = met(wk) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  longest = Math.max(longest, current);

  const cells = [];
  for (let i = 11; i >= 0; i--) {
    const wk = shiftWeeks(thisWeek, -i);
    cells.push({ wk, met: met(wk), isNow: wk === thisWeek });
  }

  return {
    current,
    longest,
    freezesUsed: used,
    cells,
    objective: objectiveForWeek(thisWeek),
    metThisWeek: met(thisWeek),
  };
}
