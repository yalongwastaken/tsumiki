# Finance Tracker — Working Spec

> Living doc. Personal tool (just for Anthony). We use this to flush out vision, features, data model, and refinements before building.

---

## 1. What this app actually is  ⭐ REFRAMED

> Earlier we framed this as a "wealth-building discipline tracker." After the vision pass, that's too narrow. The real ask is **guidance, not just tracking.**

A **personal money coach.** The job: *given the money I have right now, tell me how much should go where* — credit cards, checking buffer, savings, investments, retirement — tailored to me, with short- and long-term strategies, and then show me how I'm doing against that plan.

A tracker answers "where did my money go?" Anthony wants the app to answer **"where should my money go?"** — that's the difference between describing the past and coaching the future.

**One-line vision:** *A money coach that turns each paycheck into a clear, personalized plan — how much to put toward debt, buffer, savings, investing, and retirement — and tracks how I'm actually doing against it.*

### What this means for the pieces we already discussed
- **Logging everything** isn't the point — it's the *fuel*. The coach needs to know real income and spending to give good advice. (Validates the "log it all" decision.)
- **The Sankey** stops being just a record of the past — its best version shows the **recommended flow** (the plan) with actuals tracked against it.
- **Net worth / projection** become the "is the plan working?" feedback, not the headline.
- **Streak/discipline** shifts from "did I contribute?" to **"did I follow my plan this paycheck?"**

### 1.5 The allocation engine (the new heart) 🧠
Input: a paycheck (amount + type — salary, hourly, irregular, or none this period).
Output: a recommended split across buckets, applied as a **priority waterfall** so it works no matter how much came in:

1. **Essentials + minimum debt payments** — non-negotiable.
2. **Checking buffer** — keep a target floor (e.g. ~1 month of expenses).
3. **High-interest debt** (credit cards) — pay down aggressively.
4. **Emergency fund** — fill to target (e.g. 3–6 months).
5. **Retirement** — Roth IRA / 401k (grab any employer match first).
6. **Goals + taxable brokerage** — everything left.

Each bucket has a rule: fixed $, % of paycheck, or "fill to target." **Short-term strategy** (kill debt / build buffer) vs **long-term strategy** (max retirement / invest) = different priority weightings Anthony can switch between. Handling **variable income** is core: a $0 week, an hourly week, and a salary deposit all run through the same waterfall.

*Note: this is rule-based personal-finance guidance (an "order of operations"), tailored to Anthony — not licensed financial advice. Fine for a personal tool; worth a disclaimer if it ever goes wider.*

---

## 2. Open decisions (the big forks)

These shape everything else. Marking my recommendation, but they're yours to call.

### A. Where does the data come from? → ✅ DECIDED: light hybrid, no Plaid
- **Contributions stay manual** — this is the ritual / streak / soul of the app. The friction is the point.
- **Balances are manual snapshots** — you punch in real account balances occasionally (~monthly) so net worth is real, with zero integration to build or trust.
- *Rejected: full account-linking (Plaid) — costs money/mo, privacy surface, heavy maintenance, all to save minutes on a personal tool.*

### B. Is income really a flat $7,000/mo? → ✅ REVISED: log income as transactions
Since Anthony's logging everything, income becomes ledger transactions (type "income") so the Sankey's left side is real, not assumed. Keep a `settings.monthlyIncome` *estimate* only as a fallback for projections before there's enough logged history. Hardcoded `$7k` goes away.

### D. How much does spending matter? → ✅ REVISED: log everything (Anthony's call)
Anthony wants to log *all* purchases, and wants a strong Sankey. So spending is first-class, not "light." Upside: this makes the Sankey **honest** (real income → real spending + real saving) and unifies the data model into one ledger (see §6). **Risk to manage: logging fatigue** — logging every purchase is what kills these apps. Mitigation is non-negotiable: fast entry (defaults, recents, few taps), and CSV import on the LATER list as an escape hatch.

### C. What's the "truth" of net worth? → ✅ DECIDED: real + honest, but not the motivational metric
The fix is to **split two numbers that the app currently conflates**:
- **Net worth** = real balances (your snapshots) + market reality. Honest, *can dip*. The truth number.
- **"Contributed by you"** = cumulative of what you've put in. Only goes up, fully in your control. This is the **motivational spine** — it drives the streak and is the number worth celebrating.
- Rationale: a net worth that only ever goes up stops being trustworthy the first market dip. Keep net worth honest; protect motivation by celebrating the metric you actually control.

---

## 3. Roadmap (build order)  ⭐ REWRITTEN for the money-coach vision

Sequenced to reach the **core promise — "the app tells me where my money should go" — as fast as possible**, then layer tracking, motivation, and insight on top. Each milestone is independently usable. Architecture is server-centric (mini PC = brain; see §12).

### M0 — Backend, data model & migration *(foundation, no new features)*
Stand up the **mini-PC server**: small backend (Node/Python) + SQLite, served on the LAN, reachable via **Tailscale**. Define the unified model in §6 server-side: `accounts`, `snapshots`, `transactions` (ledger), `debts`, `goals`, `profile`. Replace the React app's `window.storage` calls with a thin **client→server API layer** (so all later features are written against the API, not browser storage). Migrate existing data (old contributions/expenses → transactions; `startNetWorth` → first snapshot). Set up a cron'd SQLite backup. De-risks everything downstream.

### M1 — Profile & setup
Progressive onboarding (§11): income type, accounts, debts, strategy, with smart defaults. Output: a complete `profile` the engine can run on. Editable in Settings.

### M2 — Allocation engine + "Your Plan" view  🎯 **MVP / core promise delivered**
The waterfall (§1.5). Given balances, debts, and profile, take an income amount and output the recommended split (debt / buffer / emergency / retirement / brokerage). The "Your Plan" screen is the headline. *After this, the app actually coaches — this is the first genuinely useful version.*

### M3 — Fast logging
The <15s quick-add (§9): amount-first, type toggle (income / spending / contribution), frequency-sorted categories, recents. The daily faucet that feeds real data back into the engine and tracking.

### M4 — Tracking: honest Sankey, net worth, projection
Sankey shows **plan vs. actual** money flow. Two-number net worth (real vs. contributed, §7) from snapshots. Fix projection to **derive** monthly invest from the actual plan (§7), not a disconnected slider.

### M5 — Motivation
Streak reframed to **"did I follow my plan this paycheck?"** + freezes/grace. Milestones & celebration (emergency fund full, debt cleared, net-worth thresholds).

### M6 — Insight payoff
FIRE / Coast-FI number + date. Net-worth-over-time chart (free from snapshot history). Goal target dates + required-pace status.

### Later / optional
CSV/bank import (bulk logging escape hatch). Account-linked goals. Multiple projection scenarios. Data export/backup.

---

## 4. Refinements to what's already built

- Streak only counts *any* contribution that week — should it require hitting a target?
- Projection assumes a flat monthly invest separate from the goal pledges — these two mental models (pledges vs. `monthlyInvest`) aren't reconciled.
- Net worth ignores expenses entirely.
- `window.storage` only — no export/backup, data lives in one place.
- Mobile-first layout (max-w-lg) — is desktop a thing you care about?

---

## 6. Data model (NOW phase)

### Today's shape
```js
{
  goals:         [{ id, name, target, pledge, color }],
  expenses:      [{ id, cat, amount, note, date }],
  contributions: [{ id, goalId, amount, date }],
  settings:      { startNetWorth, monthlyInvest, returnRate }
}
```

### Proposed shape — one unified ledger
```js
{
  accounts: [
    { id, name, type, color }
    // type: "checking" | "savings" | "brokerage" | "ira" | "other"
  ],

  // one row each time you punch in a balance for an account.
  // real net worth = sum of the LATEST snapshot per account.
  snapshots: [
    { id, accountId, date, balance }
  ],

  goals: [
    { id, name, target, pledge, color,
      targetDate? }  // optional — enables required-pace math (NEXT phase)
      // (abstract — NOT tied to an account, per decision)
  ],

  // ONE ledger replaces the old separate contributions + expenses lists.
  transactions: [
    { id, type, amount, date, note,
      cat?,      // for type "spending": Dining, Tech, etc.
      goalId? }  // for type "contribution": which goal/bucket
    // type: "income" | "spending" | "contribution"
    //   income       → money in        (net worth ↑)
    //   spending     → money out        (net worth ↓)
    //   contribution → moved to a goal  (net worth neutral; drives streak)
  ],

  // debts the engine pays down (credit cards etc.)
  debts: [
    { id, name, balance, apr, minPayment }
  ],

  // the personalization PROFILE the engine runs on — collected via setup (§11)
  profile: {
    incomeType,            // "salary" | "hourly" | "irregular" | "none"
    typicalIncome?,        // estimate for projections before history exists
    checkingFloor,         // keep at least this in checking
    emergencyTarget,       // 3–6 months of expenses, in $
    employerMatch?,        // { pct, limit } — capture first if present
    retirementLimits?,     // e.g. Roth IRA annual cap
    strategy,              // "short_term" | "long_term" | "balanced" | "custom"
    customRules?           // ordered bucket rules when strategy = custom
  },

  settings: {
    returnRate,
    monthlyInvest?,  // OPTIONAL override; default = derived (see §7)
    streakFreezes?   // NEXT phase
  }
}
```

*The waterfall in §1.5 is the engine's logic; `profile` above is the data that personalizes it. Same engine, different profile per person.*

### Notes / decisions
- **Goals are abstract** — buckets with a number, not linked to real accounts. ✅
- **Logging is a pure record** — a transaction doesn't auto-move account balances; real net worth updates only on your next snapshot. ✅ (this preserves the honesty gap, §7)
- **Net-worth-over-time chart = LATER** — snapshot history accrues for free regardless. ✅
- **Snapshots are append-only history**, not a single editable balance.
- `startNetWorth` **goes away** — net worth now comes from real snapshots.
- Migration: convert old `contributions` → `transactions` with type "contribution"; old `expenses` → type "spending"; seed a "Brokerage" account and turn old `startNetWorth` into its first snapshot.

### The Sankey, now honest
Old Sankey mixed goal *pledges* (plan) with logged expenses (partial actuals). New Sankey runs on real ledger data for the period: **income (left) → spending categories + contributions to goals + leftover** (right). One true money-flow picture.

## 7. How the numbers reconcile (the important part)

Three numbers, three jobs — and the *gaps between them* are features, not bugs.

| Number | Definition | Behavior | Job |
|---|---|---|---|
| **Real net worth** | sum of latest snapshot per account | honest, can dip | the truth |
| **Contributed by you** | cumulative sum of `contributions` | only goes up | the discipline metric (drives streak, hero celebration) |
| **Allocated / mo** | sum of goal `pledge`s + leftover → brokerage | plan, not actual | the Sankey engine |

**The pledges-vs-`monthlyInvest` tension (a current bug):** today the projection uses a separate `monthlyInvest` slider that has nothing to do with goal pledges. Fix: **derive** the projected monthly invest from the actual plan — `monthlyIncome − expenses − non-investing goals`, or more simply the amount flowing to brokerage + retirement goals. Keep a manual override for "what if" scenarios, but default to the real plan so the projection reflects *your* allocation.

**The most interesting gap:** contributed total vs. real net worth growth. If you've logged $5,000 of contributions but real net worth only rose $4,200, the $800 gap is the market (or unlogged spending) taking a bite. Surfacing that gap = a built-in reality check, and it's the honest counterweight to the always-up motivational number.

**Projection start point** = real net worth (latest snapshots), not a typed-in guess.

## 9. Logging UX — "intuitive" made concrete

Goal: log a purchase in ~3 taps so you actually keep it up. The flow:

1. **One always-visible "+" button.** Tapping it opens a quick-add sheet — no navigating to a tab.
2. **Amount first.** A big number pad is the first thing focused, because the amount is the one field that always changes.
3. **Type defaults to Spending** (the common case), with a small Spending / Income / Contribution toggle up top.
4. **Category as tap-tiles, frequency-sorted.** Your most-used categories float to the top automatically, so the right one is usually one tap. No dropdown digging.
5. **Smart prefill.** Date = today. Last category/merchant remembered. Recent entries one tap to repeat (your $6 coffee, your $16 subscription).
6. **Done.** Open → type amount → tap category → it's logged. Note is optional.

Principle: *the app guesses, you correct.* Defaults and recents do the work; you only touch what's different today. CSV/bank import stays on the LATER list as the bulk escape hatch.

## 12. Interaction, hosting & security

**Driving requirement:** logging happens *as purchases occur during the day* (§ vision) → must work on the **phone, away from home**, fast (<15s), ideally even with no signal. This, not the mini PC, dictates the architecture.

**The security reframe:** a self-hosted server is only a real risk when it's **exposed to the public internet** (port-forwarding / public URL = patching burden, brute-force surface, the thing Anthony is rightly wary of). For a single user, *never expose it.* Two ways to avoid that completely:

### Option A — Local-first PWA, no server (simplest, most private)
A Progressive Web App installed to the phone home screen; all data in on-device storage (IndexedDB); works fully offline. No server, no network, **zero attack surface.**
- ✅ Dead simple, totally private, instant logging even with no signal.
- ❌ Data lives on one device — no phone↔desktop sync, backups are manual (export file).
- *Best if Anthony mostly uses one device (the phone).*

### Option B — Local-first PWA + self-hosted sync over Tailscale (recommended sweet spot)
Same offline PWA, but it **syncs** to a small service on the mini PC (e.g. CouchDB ↔ PouchDB, which gives robust offline sync for free). Reach the mini PC from anywhere via **Tailscale/WireGuard** — a private encrypted mesh between *your own devices* with **no public ports opened.**
- ✅ Data lives on Anthony's hardware (owns it), phone + desktop stay in sync, automatic central backup, still works offline, and **the security concern is neutralized** — nothing is internet-exposed.
- ❌ A bit of setup (Tailscale on mini PC + phone; run the sync service). Mini PC must be on to sync (but the app still works offline meanwhile).
- *Best if Anthony wants phone + desktop, and real backups. Tailscale is free for personal use.*

### Option C — Publicly hosted (NOT recommended here)
Self-host with a public reverse proxy + auth, or deploy to a cloud host with a managed DB.
- ❌ Public attack surface + patching burden (the worry), or finances living in someone else's cloud (against the privacy lean). Overkill for one user.

### ✅ DECIDED architecture — server-centric (mini PC is the brain)
Anthony's call: he does **not** want the phone doing the computing. So:

- **Mini PC = the server / brain.** Hosts the app backend, runs the **allocation engine** and all computation, and holds the **database** (single source of truth + lives on hardware Anthony owns).
- **Phone & desktop = thin clients.** Just a browser pointing at the server (optionally an installable PWA *shell* for a home-screen icon — but the shell is a window, not the worker).
- **Access from anywhere = Tailscale/WireGuard.** Private encrypted mesh between Anthony's own devices; **no public ports, no public URL** → the security concern is neutralized without giving up remote access.

This is essentially **Option B's hosting, with Option A dropped** — the brain is the mini PC, not the phone.

**Honest tradeoff:** the app now needs the server reachable (Tailscale + a signal) to function — a true dead-zone means no logging in that moment. Acceptable for v1. *Mitigation if it ever annoys: a small client-side offline queue that syncs when back online.* On the parking lot, not in v1.

**Suggested stack (personal-scale, keep it boring):** small backend (Node or Python) + SQLite (one file, trivial to back up) on the mini PC; existing React UI served as the client; Tailscale for remote reach; a cron'd copy of the SQLite file for backups.

*Implication for the build:* the engine and data access move **server-side**; the current `window.storage` (browser) calls get replaced by a thin client→server API layer. Bake this boundary in at **M0** so features are written against an API, not browser storage.

## 11. Setup / onboarding (how the profile gets collected)

The engine needs the profile (§6) before it can advise — but a giant setup form is exactly the bad-UI / friction failure mode Anthony flagged. So:

- **Progressive, not front-loaded.** Ask the few essentials to start (income type, what accounts/debts exist, pick a strategy). Defer the rest (exact targets, match details) until the engine actually needs them, or offer sensible defaults Anthony can tweak later.
- **Smart defaults.** Emergency target defaults to ~3 months of detected expenses; checking floor to ~1 month; strategy to "balanced." The app guesses, Anthony corrects (same principle as logging, §9).
- **Editable any time.** Profile lives in Settings; changing strategy instantly re-runs the waterfall so Anthony can see "what if I went growth-first?"
- **Re-asks on change.** If income type shifts (new job, went hourly), the app can prompt to revisit the plan.

## 10. Parking lot / questions for Anthony

Resolved: abstract goals ✅ · chart later ✅ · pure record ✅ · log all purchases ✅ · log income too ✅ · intuitive quick-add (§9) ✅

Still open:
- Spending categories: keep the current list (Tech, Subscriptions, Dining, Entertainment, Education, Clothing, Other) or rework it?
- Does the 4-tab layout (Dashboard / Grow / Log / Goals) still fit, now that logging is a quick-add button instead of a tab?
