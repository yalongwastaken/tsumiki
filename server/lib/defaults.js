// defaults.js — the default profile/settings shapes, in their own dependency-free
// module so both db.js (fresh installs, resets) and migrate.js (filling newer fields
// under migrated values) can use them WITHOUT migrate.js pulling in the DB side
// effects of importing db.js. Add new fields here and every path picks them up.
export const DEFAULT_PROFILE = {
  name: "",
  birthYear: null,
  retireAge: 65,
  incomeType: "salary",
  typicalIncome: null,
  checkingFloor: 0,
  emergencyTarget: 0,
  employerMatch: null,
  retirementLimits: null,
  strategy: "balanced",
  customRules: null,
  incomeSources: [], // [{ id, name, type, typicalMonthly }] — replaces single income field
  moneyTargets: [], // [{ id, label, amount, metric }] — user-defined game goals
  bills: [], // [{ id, name, amount }] — recurring essentials (inform-only)
};

export const DEFAULT_SETTINGS = {
  returnRate: 0.07,
  monthlyInvest: null,
  streakFreezes: 2,
  onboarded: false,
  theme: "light",
};
