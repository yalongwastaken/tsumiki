# Changelog

All notable changes to Tsumiki are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  client tests into `test/lib/`. No behavior change.

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
