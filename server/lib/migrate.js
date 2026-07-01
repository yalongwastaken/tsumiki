// migrate.js — convert old window.storage shapes into the unified data model.
// Old "finance-v2" shape:
//   { goals:[{id,name,target,pledge,color}], expenses:[{id,cat,amount,note,date}],
//     contributions:[{id,goalId,amount,date}], settings:{startNetWorth,monthlyInvest,returnRate} }
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from "./defaults.js";

/** Short unique id. */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Normalize a date to ISO (now if missing). */
const iso = (d) => (d ? new Date(d).toISOString() : new Date().toISOString());

/**
 * Convert a legacy "finance-v2" object into the unified model.
 * @returns {Object} unified state (accounts, snapshots, goals, debts, transactions, profile, settings)
 */
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
    start > 0 ? [{ id: uid(), accountId: "brokerage", date: iso(Date.now()), balance: start }] : [];

  // spread the CURRENT defaults underneath so fields added after this migration was
  // written (moneyTargets, bills, theme, onboarded…) exist on a migrated dataset too,
  // instead of being permanently absent until the user happens to edit settings
  const settings = {
    ...DEFAULT_SETTINGS,
    returnRate: old.settings?.returnRate ?? DEFAULT_SETTINGS.returnRate,
    monthlyInvest: old.settings?.monthlyInvest ?? null,
    streakFreezes: 0,
  };

  // profile gets sensible defaults; real values come from setup
  const profile = {
    ...DEFAULT_PROFILE,
    typicalIncome: 7000, // old hardcoded MONTHLY, kept as a fallback
    // seed a single income source from the old single income figure
    incomeSources: [
      { id: "primary", name: "Primary income", type: "salary", typicalMonthly: 7000 },
    ],
  };

  return { accounts, snapshots, goals, debts: [], transactions, profile, settings };
}
