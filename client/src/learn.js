// learn.js — a small, curated library of personal-finance concepts plus
// deterministic rules that surface the ones relevant to your situation. No
// network and nothing personal leaves the device: it's static educational
// content + rule-based recommendations over your own plan state.

/**
 * Each lesson is a general money concept (`blurb`) paired with a concrete
 * recommendation (`action`) and a `relevant(ctx)` rule deciding when it applies.
 * Order = priority; the last one is evergreen so the feed is never empty.
 */
export const LESSONS = [
  {
    id: "match",
    topic: "Employer retirement match",
    blurb:
      "Many employers match part of what you put into a 401(k) — it's the closest thing to free money there is.",
    action: "Add your employer match in Settings so the plan grabs it before anything else.",
    tab: "settings",
    relevant: (c) => !c.hasMatch,
  },
  {
    id: "hysa",
    topic: "High-yield savings",
    blurb:
      "Cash sitting in checking earns almost nothing while inflation chips at it; a high-yield savings account earns far more and stays just as accessible.",
    action: "Keep your emergency fund and buffer in a high-yield savings account, not checking.",
    tab: "accounts",
    relevant: (c) => c.idleCash,
  },
  {
    id: "taxadv",
    topic: "Tax-advantaged order",
    blurb:
      "The tax-efficient order is usually: capture the 401(k) match, then fill an IRA/401(k), then invest in a taxable brokerage.",
    action: "Make sure you're using tax-advantaged space before taxable investing.",
    tab: "plan",
    relevant: (c) => c.investedTotal > 0 && !c.hasRetirement,
  },
  {
    id: "windfall",
    topic: "Making a windfall count",
    blurb:
      "Bonuses, refunds, and extra paychecks are the easiest money to save because you never budgeted around them.",
    action: "When extra income lands, send it to debt or investing before it quietly disappears.",
    tab: "plan",
    relevant: (c) => c.windfall,
  },
  {
    id: "creep",
    topic: "Lifestyle creep",
    blurb:
      "Spending tends to drift up with income, quietly eating your raises. Catching a rising category early keeps the gains you earn.",
    action: "Check 'Spending vs your average' and trim what crept up.",
    tab: "activity",
    relevant: (c) => c.spendingUp,
  },
  {
    id: "dca",
    topic: "Dollar-cost averaging",
    blurb:
      "Investing the same amount every payday smooths out the market's ups and downs — no need to guess the timing.",
    action: "Automate your recurring transfers so investing happens on autopilot.",
    tab: "plan",
    relevant: (c) => c.hasPaydays,
  },
  {
    id: "fire",
    topic: "The 4% rule",
    blurb:
      "A common benchmark: you're roughly financially independent once your investments reach about 25× your annual spending.",
    action: "See your FIRE number and timeline on the Grow tab.",
    tab: "grow",
    relevant: (c) => c.investedTotal > 0,
  },
  {
    id: "compound",
    topic: "Compounding",
    blurb:
      "Invested money grows on itself, so dollars invested early can outweigh much larger amounts invested later.",
    action: "Stay consistent — time in the market is the biggest lever you control.",
    tab: "grow",
    relevant: () => true, // evergreen fallback
  },
];

/**
 * The most relevant lessons for the current context, highest priority first.
 * @returns {Array<{id, topic, blurb, action, tab}>}
 */
export function learnFeed(ctx = {}, limit = 2) {
  return LESSONS.filter((l) => l.relevant(ctx))
    .slice(0, limit)
    .map(({ relevant: _relevant, ...rest }) => rest); // drop the predicate from the output
}
