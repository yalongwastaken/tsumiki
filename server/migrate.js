// migrate.js — convert old window.storage shapes into the unified model (SPEC.md §6).
// Old "finance-v2" shape:
//   { goals:[{id,name,target,pledge,color}], expenses:[{id,cat,amount,note,date}],
//     contributions:[{id,goalId,amount,date}], settings:{startNetWorth,monthlyInvest,returnRate} }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const iso = (d) => (d ? new Date(d).toISOString() : new Date().toISOString());

export function migrateLegacy(old = {}) {
  const goals = (old.goals || []).map((g) => ({
    id: g.id || uid(),
    name: g.name,
    target: g.target ?? 0,
    pledge: g.pledge ?? 0,
    color: g.color || null,
    targetDate: null,
  }));

  // contributions -> transactions(type=contribution); expenses -> transactions(type=spending)
  const transactions = [
    ...(old.contributions || []).map((c) => ({
      id: String(c.id || uid()),
      type: "contribution",
      amount: c.amount,
      date: iso(c.date),
      note: null,
      cat: null,
      goalId: c.goalId ?? null,
    })),
    ...(old.expenses || []).map((e) => ({
      id: String(e.id || uid()),
      type: "spending",
      amount: e.amount,
      date: iso(e.date),
      note: e.note || null,
      cat: e.cat || null,
      goalId: null,
    })),
  ];

  // seed a Brokerage account; turn old startNetWorth into its first snapshot
  const accounts = [{ id: "brokerage", name: "Brokerage", type: "brokerage", color: "#94A3B8" }];
  const start = old.settings?.startNetWorth ?? 0;
  const snapshots =
    start > 0
      ? [{ id: uid(), accountId: "brokerage", date: iso(Date.now()), balance: start }]
      : [];

  const settings = {
    returnRate: old.settings?.returnRate ?? 0.07,
    monthlyInvest: old.settings?.monthlyInvest ?? null,
    streakFreezes: 0,
  };

  // profile gets sensible defaults; real values come from setup (M1)
  const profile = {
    incomeType: "salary",
    typicalIncome: 7000, // old hardcoded MONTHLY, as an estimate
    checkingFloor: 0,
    emergencyTarget: 0,
    employerMatch: null,
    retirementLimits: null,
    strategy: "balanced",
    customRules: null,
  };

  return { accounts, snapshots, goals, debts: [], transactions, profile, settings };
}
