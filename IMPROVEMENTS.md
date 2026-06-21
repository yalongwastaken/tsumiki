# Improvement Pass — Working Doc

> Roadmap (M0–M6) is shipped. This is the "make it great" pass. Living doc; we use it to decide direction before building.

## The thesis (to validate)

The app is currently two halves that don't talk:
- a forward **calculator** (Plan tab — type an amount, get advice), and
- a backward **ledger** (logging, Sankey, net worth).

**North star for this pass:** turn the plan from a one-shot calculator into a **living monthly plan** — the app stands up a plan for the period, then tracks real money against it. This single shift delivers most of what was picked:

- **Smarter engine** → the engine produces a standing plan (targets per bucket for the period), not a throwaway calc.
- **Plan vs actual** → falls out for free: compare logged actuals to the plan's targets.
- **UX** → collapse the 3 logging surfaces (Quick-add, Log tab, dashboard QuickLog) into one flow that feeds the plan; the Plan tab becomes the home screen showing "here's the plan, here's where you are, here's what's left to allocate."
- **Adherence (M5 streak)** → becomes "did your actuals track the plan this period?" instead of "did you log anything."

**Robustness** rides alongside as an orthogonal baseline (error boundary, repo smoke test, validation, save model).

---

## Big forks (need Anthony's input)

### Fork 1 — Is the thesis right?
Is "living monthly plan you track against" the emphasis you want? Or is the value more in the *one-shot* "I just got money, where does it go?" calculator, kept sharp? (Could also be: both, with one primary.)

### Fork 1 — ✅ DECIDED: living monthly plan is the direction.

### Fork 2 — Period → ✅ DECIDED: event-driven (per paycheck) + multiple income sources
Log income whenever it lands. **New requirement:** model **multiple named income sources** (salary, freelance, passive…) instead of one catch-all `income`. See "Multiple income sources" below.

### Fork 3 — Committed vs live → ✅ DECIDED: live, with derived monthly targets
- Pure-committed budgets don't fit variable/multi-source income (you can't honestly lock amounts before the money lands).
- **Live**: each paycheck → engine allocates *that* inflow against current balances/debts. Always honest, handles irregular income.
- For adherence/plan-vs-actual we keep **derived** monthly targets (from sources' typical amounts), not hand-committed ones. Streak = "did you allocate each paycheck as advised?"

---

## Multiple income sources (new)
**Data model**
```js
profile.incomeSources: [
  { id, name, type, typicalMonthly }
  // type: "salary" | "hourly" | "self_employed" | "passive" | "other"
]
// income transactions gain: sourceId
// profile.incomeType (single) is REPLACED by per-source types
// profile.typicalIncome becomes DERIVED = sum of sources' typicalMonthly
```
**Surfaces**
- Setup: manage sources (name + type + typical monthly), like accounts/debts.
- Quick-add (income): pick the source.
- Insight: income-by-source breakdown; projection baseline uses summed typicals.

**Resolved**
- Source fields: **name + type + typicalMonthly** (typical is optional, feeds projection/target baselines). ✅
- Engine treats **all inflows the same** regardless of type. ✅
- **Income pools**: log each event tagged to a source, but all income in the period **adds together** into one total; the live plan allocates the pool. Sources are for tracking/breakdown, not separate plans. ✅
- Cadence: later.

---

## Improvement roadmap (proposed)

**I1 — Robustness baseline** *(do first; unblocks safe iteration)*
Error boundary (friendly fallback, no blank screen) · headless render smoke test committed to repo · API input validation · keep full-state PUT + add a basic concurrency guard.

**I2 — Multiple income sources**
Data model (`profile.incomeSources`, `sourceId` on income txns; derive `typicalIncome`) · Setup management UI · source picker in quick-add · migration of the single income field.

**I3 — Live monthly plan + plan-vs-actual** *(the centerpiece)*
Plan tab becomes home: this period's pooled income → live allocation → **actual vs target** per bucket with progress · derived monthly targets · "what's left to allocate."

### I3 design crux — ✅ RESOLVED: structured buckets only; checking = flexible money
Anthony's pivot: **drop "custom goals" from the plan.** The engine buckets are the *only* vocabulary. Whatever the waterfall doesn't claim **stays in checking as flexible/discretionary money** (spend or self-direct, no app structure). A **minimum watch** on checking is the only guard rail.

**Simplified waterfall**
1. min debt payments
2. checking → minimum floor (the watched minimum)
3. employer match (retirement)
4. high-interest debt
5. emergency → target
6. retirement → limit
7. invest (brokerage)
8. *leftover stays in checking = flexible money*

**Implications**
- "Custom goals" (e.g. Japan) are no longer first-class plan items — that's flexible-checking money the user self-directs. The Goals concept collapses toward the structured targets (emergency/retirement/invest) + debts.
- Plan-vs-actual is per structured bucket; checking is *flexible*, tracked only against its minimum.

**✅ Goals reframed — the "game layer" (goals = milestones = streak)**
Goals are no longer hand-funded budget buckets. They're **money-oriented, automatic, gamified targets** ("save $5,000", "reach $10k net worth", "fund emergency") tracked automatically from real balances/contributions, and merged with M5 milestones + streak into ONE progress surface.
- Goals leave the allocation waterfall (plan = structured buckets + flexible checking only).
- Goals/milestones/streak unify into a single **Progress** screen → also folds the dashboard's streak+milestones in (answers part of I4 nav).
- Auto-tracked: the app credits progress from balances; no manual "contribute to goal."
- Open: can the user *define* their own money targets, or only the app's preset tiers? (lean: both — preset tiers + a few user-defined "$X" targets.)

**✅ Minimum watch — forward-looking.** Warn when checking < floor AND project "at this spend rate you'll dip below in ~N days."

**I4 — UX consolidation** *(nav/tab rename deferred to a dedicated UX pass; this pass does content + consolidation only)*

Proposed concrete plan (run by Anthony before building):

1. **One logging path.** Remove the dashboard QuickLog and the Log-tab expense form. The **+ button is the only way to log.** (Fixes the 3-surface redundancy.)
2. **Log tab → clean read-only ledger.** Newest-first history with a type filter (all / income / spending / contribution); each row labeled by source (income), bucket (contribution), or category (spending); delete only.
3. **Goals tab → the "Game".** Fixes the I3 staleness (goal cards no longer fund). Move **streak + milestones** here; Dashboard keeps the money picture (reality check + Sankey). Goals tab = streak + milestone badges + next-up.
4. *(proactive)* **User-defined money targets.** In the Game view, add your own "$X" targets (e.g. "Save $5,000") auto-tracked against a chosen metric (net worth / total contributed / emergency), earning a badge + celebration on completion — the "money-oriented, automatic, gamified goals" you described.
5. *(proactive)* **Empty states + polish.** Friendly first-run prompts per tab; consistent card styling.

Open for Anthony: which proactive bits (4, 5) to include now; whether moving streak/milestones off the Dashboard is OK pre-nav-pass.

*(Deferred to dedicated UX pass: tab renames/reordering, the 5-tab IA, overall interaction model.)*

**I5 — Smarter engine**
Avalanche debt ordering (highest APR first) · YTD-aware retirement (toward annual limit) · configurable high-interest threshold · tighter match modeling · feed derived targets to I3.

*Sequencing rationale: I1 makes iteration safe; I2 is a data-model change everything else builds on; I3 is the payoff; I4 polishes the surface; I5 deepens the brain.*

---

## Robustness baseline (mostly just do it; one decision)
- Error boundary → friendly fallback instead of blank screen.
- Headless render smoke test committed to the repo (catches the `debts`-class bug).
- Input validation on the API (reject malformed PUTs).
- **Decision:** keep the full-state PUT (simple, single-user) or move to granular endpoints (accounts/txns/etc.)? Leaning: keep PUT, add validation + optimistic-concurrency guard.

---

## Decisions log
- Nav/tabs: **keep current tabs for now**; a dedicated UX pass will redesign navigation + interaction (the 5-tab IA is the working target, not built yet).
- Build order confirmed: **I1 first** (robustness), then I2 → I3 → I4 → I5.
