# Changelog

All notable changes to Tsumiki are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Destructive routes are guarded.** `POST /api/migrate` now snapshots the current data
  to a local backup file first and returns **409** if transactions already exist (pass
  `force: true` to overwrite deliberately) — previously a stray empty POST could silently
  replace the whole dataset. `POST /api/reset` also writes a `prereset` snapshot before
  wiping.
- **Full and partial state writes require a `rev`.** `PUT /api/state` and
  `PATCH /api/state` without a numeric `rev` now return 409 with the fresh state instead
  of clobbering unconditionally — a stale tab or script can no longer bypass optimistic
  concurrency. (The app has always sent `rev`, so nothing changes for normal use.)
- **Login lockouts back off exponentially.** Repeated lockouts double the wait (1m → 2m
  → 4m …, capped at one hour) instead of a fixed one-minute window; a correct login or
  password change resets the escalation.

### Fixed

- **Database path restored to the documented `server/data/tsumiki.db`.** The v2.4.0
  `lib/` refactor silently moved the default DB to `server/lib/data/` (the path was
  module-relative), so `make backup` and the docs pointed at a dead file. On startup the
  server now relocates a database stranded at the old `lib/data/` path (including its
  `-wal`/`-shm` journal files) back to the documented location; if files exist at **both**
  paths it refuses to guess, keeps the live one, and logs a loud warning — nothing is ever
  discarded silently.
- **`make backup` / `make backup-enc` are now WAL-safe.** They snapshot via SQLite's
  `VACUUM INTO` (dependency-free, through `node:sqlite`) instead of `cp`, so recent writes
  still in the `-wal` journal can no longer be missing or torn in a backup taken while the
  server runs. Restore instructions now cover stale `-wal`/`-shm` files.

### Added

- Boot log of the resolved DB path, state rev, and transaction/account counts — a wrong
  or empty database path is now obvious on the first startup line.

## [2.4.0] — 2026-06-29

### Added

- **Charge a + entry to an account.** Quick Add now has an optional account picker:
  charge a spend to a credit card or pay it from checking, or deposit income into an
  account — and it **moves that account's balance** (so net worth updates as you log).
  Defaults to your primary cash account; pick "— none —" to just log without moving a
  balance (quick logs and no-spend days stay one-tap). Investment accounts aren't
  chargeable (they auto-value from holdings).
- **Transfers now move money.** A Quick Add transfer adjusts both account balances —
  including paying down a credit card by transferring into it (checking → card).

## [2.3.0] — 2026-06-29

### Added

- **Per-holding manual price.** Each holding can be set to a manual price/share with a
  "set price manually (don't sync)" toggle — for things the feed can't value, like mutual
  funds. A manual holding is **never requested from the price API** (so it can't trip the
  sync circuit breaker), and you maintain its price yourself; it still counts toward its
  account's value and net worth. Any holding can also take a manual price as a stopgap
  before its first sync — for an auto-sync holding, the next sync simply overrides it.
- Holdings now always show **price/share** alongside the value when priced (synced or
  manual), with a small "manual" tag when the price was entered by hand.

## [2.2.1] — 2026-06-29

### Fixed

- **Smoother privacy-blur toggle.** The blur transition was declared only on the blurred
  state, so toggling the eye (near the net-worth readout) animated _into_ blur but snapped
  back out. Moved the transition to the base `.money` so it eases both ways.

## [2.2.0] — 2026-06-29

Price-sync reliability + holdings editing, after Stooq put its keyless feed behind a
bot-wall. Backward-compatible.

### Added

- **Edit a holding in place.** Each holding in Accounts has a pencil to change its
  ticker, shares, and cost basis without removing and re-adding it.
- **Price-sync circuit breaker.** A symbol the feed can't price (e.g. a mutual fund
  Finnhub doesn't cover) is retried only a few times, then marked "manual": the app stops
  hammering the API for it and the Portfolio card reminds you to update that holding by
  hand, instead of flagging it as a sync error forever.

### Changed

- **Finnhub is now the primary price feed.** The built-in Stooq default was removed —
  Stooq now sits behind a JavaScript bot-wall that a self-hosted server can't pass.
  Set `TSUMIKI_FINNHUB_KEY` (free tier) to sync prices; `TSUMIKI_PRICE_URL` remains an
  optional custom keyless CSV feed, tried first when set. Mutual funds aren't covered by
  Finnhub's free tier — use the circuit-breaker's manual path or an equivalent ETF.

## [2.1.0] — 2026-06-29

Post-2.0 improvements (feature additions plus a deep code-audit + UX/polish pass).
Backward-compatible — no changes to your data or API shape.

### Added

- **Edit a logged transaction.** Each ledger row has a pencil to fix the amount, date, and
  note (and category, for spending) in place, instead of delete-and-re-add. The edited date
  is normalized to local noon so it never drifts a day in other timezones.
- **Streak milestones.** The daily streak now shows the tier you've reached, a progress bar
  toward the next milestone (3 days → 1 year), a flame that warms as you climb, and a
  personal-best marker — gentle encouragement, no loss-aversion pressure.
- **Flexible bill schedules.** Bills can now be due on the last day, the last business day,
  or an Nth/last weekday (e.g. "first Monday", "last Friday") — not just a fixed day of the
  month. Reminders, the cash-flow forecast, and the calendar all resolve these dates, and
  existing fixed-day bills keep working unchanged.
- **Import safety net.** Restoring from a JSON backup now snapshots your current data to a
  timestamped file first (returned as `backedUpTo`), so a bad import is always recoverable.
  An opt-in daily local backup (`TSUMIKI_AUTO_BACKUP=1`) keeps the newest 30 and prunes the
  rest. Backups are local-disk only — nothing leaves the device.
- **Account transfers.** A new "transfer" ledger type to record moving money between your
  own accounts (Quick Add → Transfer, with from→to pickers). Transfers show neutrally in
  the ledger/calendar and are excluded from income/spending/budget/Sankey math, so they
  don't distort your totals.
- **CSV export of the ledger** (Settings → Backup → Export CSV) — a human/spreadsheet-
  friendly export alongside the full JSON backup.
- **Tax-year guard.** The Plan tax card shows the tax year (`TAX_YEAR`) the estimate is
  based on and warns once the calendar year passes it, so figures don't silently go stale.

### Changed

- **Accessibility:** `aria-current` on the active nav tab, labels + `aria-valuetext` on
  the projection sliders, `role="alert"` on the error boundary, a proper `tablist`/`tab`
  for the Activity calendar/list toggle, and the global error banner + save toast are now
  announced (`role="alert"` / `aria-live`).
- **Forms:** the net-worth and goal forms now show inline validation errors (and a
  success note) instead of silently doing nothing.
- **Performance:** memoized the Portfolio holdings derivations and the income-schedule
  detection so they don't re-walk on every render/keystroke; the net-worth history series
  now builds in O(N) via a running total instead of re-summing all accounts per snapshot.

### Fixed

- **No more "$-0".** A displayed amount between −50¢ and $0 (e.g. a tiny loss) rounded to
  `-0` and showed as "$-0"; the currency formatters now normalize it to "$0".
- **Reject non-finite amounts.** Quick Add now rejects an `Infinity` amount (e.g. a
  pasted `1e999`), and the money-flow Sankey coerces any non-finite amount to 0 at the
  boundary, so a stray value can never blank the chart with `NaN` SVG geometry.
- **Resilient price parsing.** `parseFinnhubQuote` no longer throws on a garbage/out-of-
  range quote timestamp — it keeps the valid price and falls back to today's date instead
  of dropping the symbol and reporting a sync error.
- **Save-flow data-loss race.** All client writes now rebase onto a synchronous
  latest-state mirror instead of the render closure, so a full-state save fired from the
  auto price-sync (whose effect deliberately ignores `transactions`) can no longer clobber
  a just-logged transaction or a concurrent edit. `save`/`saveMeta` take functional
  updaters; the per-blob PATCH path is unchanged.
- **Corrupt-data resilience.** A damaged `meta` JSON blob (disk corruption / an external
  edit) now falls back to its default instead of throwing — one bad byte can no longer
  brick `GET /api/state` or block a reset/recovery.
- **Negative state-tax rate.** A bad/negative state tax rate is clamped to 0, so the
  estimate can never show a negative tax or total; the settings input now also enforces a
  floor. (`goalProgress` likewise guards a non-finite metric value.)
- **Streak longest run** no longer counts a future-dated entry — a streak can't run into
  the future.
- **Timezone-consistent day bucketing.** Portfolio auto-valuation, CSV-import dedup,
  income-schedule detection, and the server's portfolio-history points now all bucket the
  day on the local calendar (matching the streak/insights/forecast logic), so a day flips
  at your midnight rather than UTC's. (Corrected a stale "UTC slice" comment too.)
- **Stricter date validation.** The server now rejects roll-over-invalid calendar dates
  (e.g. `2024-02-30`) instead of letting them silently shift to the next month.

### Security

- **Optional Host allowlist** (`TSUMIKI_ALLOWED_HOSTS`) for mutating requests — closes the
  DNS-rebinding edge where an attacker controls both Origin and Host. Off by default for
  plain LAN/Tailscale; reads are never affected.
- **Hardened deployment docs.** `docs/INSTRUCTIONS.md` now defaults to `HOST=127.0.0.1`
  fronted by `tailscale serve` (HTTPS, tailnet-only) so the port isn't exposed on the LAN
  at all, with explicit guidance for the "someone got onto my wifi" threat.

### Docs

- Moved `CHANGELOG.md` into `docs/` alongside the other docs; `README.md` is the only
  top-level Markdown file. Fixed the doc cross-links (several pointed at the wrong path).

### Internal

- **Versioned schema migrations** (`PRAGMA user_version` + an ordered, idempotent
  migration list) replacing the ad-hoc column-check ALTER block — a safe foundation for
  future schema changes.
- **Granular meta writes**: `PATCH /api/state` + `putMeta`/`saveMeta` update only the
  profile/settings/holdings blobs, so the frequent toggles (theme, blur, goals) no longer
  DELETE+INSERT-rewrite the whole ledger.
- Extracted the investment auto-valuation into a pure, tested `reconcileInvestmentSnapshots`
  helper (slims `App.jsx`, makes the snapshot logic unit-testable).
- Sample fixtures moved to `samples/` (git-ignored); the stray tracked `sample-data.json`
  is untracked.

## [2.0.0] — 2026-06-23

This release makes the opt-in price sync **reliable and honest**: it no longer fails
silently. There are no breaking changes to your data or API; the major bump marks the
milestone of price sync being production-trustworthy (and follows a full end-to-end
smoke test).

### Added

- **Provider fallback chain.** `TSUMIKI_PRICE_URL` now accepts a comma-separated list of
  feed URLs, tried in order. Each provider is asked only for the symbols still missing
  and results are **merged**, so a feed that prices only some of your holdings is
  completed by the next one instead of masking it.
- **Optional Finnhub fallback.** Set `TSUMIKI_FINNHUB_KEY` (and optionally
  `TSUMIKI_FINNHUB_URL`) to add a keyed JSON quote provider, tried after the keyless
  feed(s). Only your ticker symbols and your own key are sent to Finnhub — no holdings,
  share counts, or other data ever leave the device. Still fully off by default.
- **Last-sync outcome.** Every refresh records its result — `ok`, `partial` (with the
  list of tickers that had no data), `empty` (feed reached but returned nothing),
  `error` (feed unreachable), `idle`, or `disabled` — surfaced on `/api/prices`.
- **Sync state in the Portfolio card.** Instead of silently showing stale values, the
  card now shows when the last sync couldn't reach the feed, returned nothing, or only
  priced some holdings (naming the missing tickers), and clarifies that the displayed
  numbers are from the last good sync.
- **Stocks Sankey ("Where your stocks sit").** A new diagram in the Portfolio card
  separates the portfolio total into account-type buckets (Taxable / 401(k) / IRA / Roth)
  and then into individual tickers, with value-weighted ribbons colored by bucket — so you
  can see at a glance where your stocks are held. Driven by a pure, tested `portfolioFlow`
  helper; it appears once you have at least two priced holdings.
- **Credit card accounts.** A new "Credit card" account type, modeled as a liability
  (its balance is what you owe and subtracts from net worth). Charge it up or pay it
  down right from the account row — each writes a balance snapshot — so you can track a
  card alongside your cash and investment accounts. (For paying a card down with interest
  over time, Debts still has the APR-aware payoff plan.)
- **Blur money (privacy mode).** An optional toggle that blurs every dollar amount on
  screen so balances aren't exposed on a glanced-at screen — flip it with the eye icon in
  the header (persists across tabs) or in Settings → Privacy. Hover an amount to peek; the
  rest stays readable (categories, tickers, dates, percentages) so the app is still usable
  in public. It's visual-only and off by default. Covers everything: balances, plan and
  ledger figures, budgets, the charts and both Sankeys, and amounts embedded in milestone
  labels and coaching text.

### Fixed

- A total Finnhub failure is now reported as `error` (unreachable), not `empty`.
- Week-over-week change picks the latest history point at least ~5 calendar days back
  rather than a fixed "6 entries ago" index, so sparse or partial history no longer
  skews the percentage.
- After a failed sync, lazy reads back off for 5 minutes (a manual "Sync now" still
  forces an attempt) so a down feed doesn't make every page load slow.
- The outbound size cap's no-stream fallback measures real UTF-8 bytes.
- `categoryAverages`, `avgDailySpend`, and the milestones "months tracked" count now
  bucket bare dates by the local calendar (matching `monthOf`), so a transaction on a
  month/window boundary no longer counts differently across timezones.
- Hardening from a code audit: the retirement-contribution sum guards a missing amount
  (`|| 0`) so it can't `NaN` the contribution-room calc, and `dayKey` short-circuits a
  bare `YYYY-MM-DD` like `monthOf` (no off-by-one for a future date picker).

### Security

- App-lock logins are now throttled (lockout after repeated wrong passwords, cleared on
  a correct login or a password change) and the password minimum is 8 characters.
- Added `make backup-enc` (AES-256 via gpg) for encrypted backups, and a `SECURITY.md`
  documenting the threat model, protections, residual risks (no at-rest encryption by
  default; app lock off by default; no built-in TLS), and hardening steps.

### Internal

- `parseFinnhubQuote` is pure and unit-tested; real localhost-socket integration tests
  (`sync.test.js`) cover ok / partial / empty / unreachable / multi-URL fallback /
  keyed fallback / merge-completes-partial. `syncProblem` and `portfolioFlow` are exported
  and tested. Suite: 80 server and 141 client tests (across UTC, US/Pacific, Tokyo,
  UTC+14) plus 18 component tests. The blur-money mode is a stateless `<Money>` /
  `BlurAmounts` layer toggled by a single root `.blur-money` class. Credit cards reuse
  the snapshot model with a negative balance, so net worth needs no special-casing.
- Project layout: `client/src` is grouped into `views/`, `charts/`, and `components/`
  (with `StreakPanel`/`NavRail` extracted from `App.jsx`); `lib/` into
  `core/finance/plan/insights/`; the server into `server/lib/` + `server/test/`; and
  client tests into `test/lib/`. The run/QA guides moved to `docs/`. No behavior change.

## [1.5.0] — 2026-06-23

### Added

- **App lock (optional password).** Off by default. In Settings → App lock you can set
  a password; once set, opening Tsumiki requires it and a device stays trusted for 7
  days. Passwords are scrypt-hashed; the session is an HMAC-signed, HttpOnly,
  SameSite=Strict cookie. Setting or entering the password is only allowed over a
  private connection (HTTPS / Tailscale / `localhost`) so a credential is never sent
  over sniffable plain-LAN http. Behind a TLS-terminating proxy, set
  `TSUMIKI_TRUST_PROXY=1`. Recovery: sign in from the box's own `localhost`.

### Security

- The auth gate matches API paths case-insensitively (Express routes are
  case-insensitive, so a case-sensitive gate would have let `/API/state` bypass the
  lock); case-sensitive routing is also enabled as defense-in-depth.
- `x-forwarded-proto` is trusted only when `TSUMIKI_TRUST_PROXY` is set, so a plain-LAN
  client can't spoof `https` to set or use a password. The session secret rotates on
  every password change (invalidating other devices), and a data reset leaves the lock
  intact.

## [1.4.0] — 2026-06-23

### Added

- **Budget rollover (per category).** Any category budget can opt into rollover:
  unused budget carries forward and overspend carries back, as a net "envelope"
  balance accumulated over the trailing complete months (capped at 12). Home shows
  the carried amount ("· rollover +$80").
- **Annual budgets.** A category's cap can be monthly (default) or annual — an annual
  cap is tracked against the whole calendar year's spend, for lumpy categories like
  travel or gifts. Toggle period per category in Settings.
- **Goal earmarking.** Contributions can be tagged "toward a goal" in the + Add sheet,
  and a goal can use the new **Earmarked savings** metric to track its own balance =
  the sum earmarked to it. Two goals now grow independently instead of all reading one
  global number.

### Fixed

- `thisMonth()` is now local (matching `monthOf`), so the current month/year isn't
  briefly mis-detected around the UTC/local boundary (which blanked an annual budget's
  days-left and per-day pace); the allocation engine derives its month the same way, so
  a "this month" strategy override isn't dropped at the boundary.
- The weekly adherence streak steps by the local calendar, fixing a DST drift that reset
  the run twice a year; out-of-range goal target dates are rejected instead of rolled over.
- Accessibility: 44px tap targets on the goal/reminder remove buttons, and the selected
  income/spending type labels darkened to clear WCAG AA contrast.

### Performance

- Memoized the category-list and monthly-pace derivations that previously re-walked the
  full ledger on every render via the always-mounted Quick-Add.

### Internal

- `budgetStatus` takes a per-category options map and returns `{cap, budget(effective),
period, rollover, carry}`; `rolloverBalance()` + `earmarkedByGoal()` are pure and
  tested. Suite: 57 server + 138 client tests across UTC, US/Pacific, Tokyo, UTC+14.

## [1.3.0] — 2026-06-23

### Added

- **Reminders (in-app).** A new Reminders card on Home surfaces time-based alerts: an
  upcoming payday, a bill due soon (bills with a day-of-month), checking dropping below
  your buffer, a self-employed quarterly estimated-tax deadline, and a daily streak
  about to lapse. Each is severity-toned (urgent / warn / info), dismissable for the
  session, and the card hides when there's nothing to show.
- **Reminder preferences.** A Settings card toggles each reminder kind on or off
  (paydays / bills / buffer / taxes / streak); the engine honors it.

### Notes

- Reminders are **in-app only** — shown when you open Tsumiki. OS push notifications
  were intentionally deferred: Web Push needs HTTPS and routes through a third-party
  push service, which is at odds with the "nothing leaves the device" default. It may
  return as its own release once TLS is set up.

### Internal

- Pure `reminders.js` engine (`computeReminders(state, today)`), timezone-correct
  (local date keys, DST-safe day math), with stable unique ids. +10 tests across UTC,
  US/Pacific, Tokyo, and UTC+14.

## [1.2.0] — 2026-06-23

### Added

- **Hourly income in onboarding.** The first-run income step now offers per-hour
  (alongside per-month and per-year), with an hours/week field and a live monthly
  estimate — matching the full income editor in Settings.
- **Investment accounts hold their shares.** Brokerage / IRA / Roth / 401(k) accounts
  now hold their stock holdings inline (entered right in the account) plus optional
  uninvested cash, and their balance auto-values from synced prices + cash — recorded
  as a tagged daily snapshot so it flows into net worth and history, with the last
  synced value preserved between syncs. The reconciliation is client-owned and
  idempotent and never overwrites a balance you set manually the same day. The separate
  "Stock holdings" setup section is gone; any holdings not yet attached to an account
  surface in Accounts with an "assign to account" prompt (no data loss).

### Changed

- **Accessibility / contrast pass.** Secondary text was bumped one step darker
  (slate-400 → slate-500, slate-300 → slate-400) across the app so muted labels,
  captions, and axis text meet WCAG AA contrast. Onboarding gained an accessible
  dialog name, labeled inputs, and `aria-pressed` on the strategy choices; the
  milestone badge list collapses past ten with a "+N more" toggle.

### Internal

- Snapshots carry an optional `source` tag (`"holdings"` = auto-valued vs. manual),
  with a backward-compatible column migration for existing databases.
- Holdings validate an optional `accountId` (string) server-side.
- Test suite: 56 server + 119 client unit tests (across UTC, US/Pacific, Tokyo) plus
  6 component tests.

## [1.1.0] — 2026-06-22

### Added

- **Daily logging streak.** The streak is now daily and grows from _any_ log of any
  type — income, spending, a contribution, or a $0 no-spend day — so simply showing
  up keeps it alive. The panel shows days-in-a-row, longest run, a 14-day grid, and a
  clear "logged today / log anything to keep it" status. The old rotating weekly
  objective is kept as a "weekly bonus" to chase.
- **More achievements.** First entry, entries-logged tiers (10→1000), day-based streak
  tiers (3→365), no-spend-day counts, months-tracked, and a "first investment" badge,
  alongside the existing net-worth / contribution / emergency / debt milestones. The
  earned-badge list collapses past ten with a "+N more" toggle.
- **Non-taxable income.** Income sources (and the onboarding income step) can be marked
  non-taxable (e.g. Roth withdrawals, gifts, disability). Such income still counts for
  planning but is excluded from the tax estimate's base, with a note on the Plan tax
  card showing how much was excluded.

### Changed

- **Onboarding.** Income step gained a per-month / per-year toggle and the non-taxable
  checkbox; added a "Step X of N" announced counter, Enter-to-advance on single-field
  steps, numeric input hints, input labels, and negative-value clamping.
- **Nightly parsing hardening.** The Stooq price CSV parser strips a BOM, handles
  quoted fields with embedded commas, and bails cleanly if a required column is
  missing. The RSS/Atom news parser decodes entity-encoded links, accepts
  single-quoted hrefs, prefers the Atom `alternate` link, and de-duplicates entries.

### Fixed

- Month bucketing (`monthOf`) is now local-time aware, so a late-evening transaction
  on the last day of a month no longer slips into the next month's totals/budgets in
  western timezones.
- CSV-imported bare dates (`2026-06-21`) keep their calendar day instead of shifting
  one day earlier in western timezones.
- A future-dated transaction could send the streak's longest-run calculation into an
  infinite loop; it's now bounded.
- Server now rejects transactions with unparseable dates, hides the `X-Powered-By`
  header, and returns correct 4xx status codes for oversized/malformed request bodies.

### Internal

- Single memoized daily-streak computation reused across the app; milestone memo
  depends only on the fields it reads.
- Test suite expanded to 55 server + 117 client unit tests (run across UTC, US/Pacific,
  Tokyo, and UTC+14) plus 6 component tests.

## [1.0.0] — 2026-06-22

First stable release. Tsumiki is a self-hosted, single-user money **coach**: it
takes the money you have and tells you where it should go, then tracks your real
spending and contributions against that plan. Everything is deterministic and
explainable — no AI/LLM in the product, and your financial data never leaves your
own devices.

### Planning & recommendations

- Deterministic allocation engine: a waterfall across essentials, debt, a checking
  buffer, savings, retirement, and investing, with surplus splitting, windfall
  blending, an emergency-fund taper, and 401(k)/IRA contribution-room awareness.
- Cadence-aware plan: per-paycheck transfer amounts derived from your pay schedule.
- Strategy preview and one-month override without persisting the change.
- Goal pace math: percent complete, required monthly amount (calendar-accurate),
  and on-track vs. behind vs. your actual recent saving rate.
- Debt payoff timeline: months to payoff, payoff date, and total interest.
- Rule-based coaching: cashflow forecast, spending trends, recurring detection,
  months-of-runway, and educational nudges — all transparent, never buy/sell picks.

### Tracking

- Unified ledger with search, filter, and bulk recategorization.
- Canonical spending categories with autocomplete and smart merchant-based
  auto-categorization.
- CSV import with column mapping, sign handling, duplicate detection, and
  auto-categorization.
- Category (envelope) budgets with per-day-left, vs-last-month, and set-to-average.
- One-tap recurring auto-logging.

### Investing & taxes

- Manually-entered stock holdings with taxable vs. 401(k)/IRA/Roth tagging.
- Opt-in daily price sync for held tickers (symbols only) with persisted per-symbol
  history, week-over-week change, and offline fallback to the last good prices.
- Portfolio value-over-time, allocation donut, and concentration/diversification
  insights.
- Transparent 2026 income-tax estimate (federal brackets, FICA/SE tax, senior
  deductions, state approximation) and self-employed quarterly estimated-tax dates.

### Views & app

- Home dashboard, money-flow Sankey, net-worth/FIRE projections, calendar, and a
  light streak/milestone layer.
- Installable PWA (iOS/Android) that launches fullscreen with light/dark theming.
- Onboarding wizard and a getting-started checklist.
- Full data export/import (single-file JSON) and a one-time legacy migration.

### Architecture, privacy & safety

- Mini-PC "brain": Express + built-in `node:sqlite` (no native deps, no DB server),
  serving a Vite + React thin client. Single SQLite file = one-file backup.
- Privacy-first: outbound network features (news, prices) are **off by default**;
  only ticker symbols / public feed URLs ever leave the device.
- Hardening for the LAN/Tailscale, no-auth threat model: same-origin (CSRF /
  DNS-rebinding) guard on mutating routes, body-size cap, capped outbound feed
  reads, ticker-charset and full-state validation before any write, atomic writes
  with optimistic-concurrency conflict detection, and generic (non-leaking) errors.
- Feed links restricted to `http(s)` so a hostile feed can't smuggle a
  `javascript:` link into the app.

### Quality

- Pure, dependency-free logic modules in `client/src/lib/` shared by client and
  server so the two can't drift.
- Test suite: server + client unit tests (run across UTC, US/Pacific, and Asia/Tokyo
  for date-sensitive code) plus server-rendered component tests; Prettier + ESLint
  enforced.

[2.0.0]: https://github.com/yalongwastaken/tsumiki/releases/tag/v2.0.0
[1.5.0]: https://github.com/yalongwastaken/tsumiki/releases/tag/v1.5.0
[1.4.0]: https://github.com/yalongwastaken/tsumiki/releases/tag/v1.4.0
[1.3.0]: https://github.com/yalongwastaken/tsumiki/releases/tag/v1.3.0
[1.2.0]: https://github.com/yalongwastaken/tsumiki/releases/tag/v1.2.0
[1.1.0]: https://github.com/yalongwastaken/tsumiki/releases/tag/v1.1.0
[1.0.0]: https://github.com/yalongwastaken/tsumiki/releases/tag/v1.0.0
