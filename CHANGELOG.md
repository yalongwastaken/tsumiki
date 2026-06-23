# Changelog

All notable changes to Tsumiki are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.0]: https://github.com/yalongwastaken/tsumiki/releases/tag/v1.1.0
[1.0.0]: https://github.com/yalongwastaken/tsumiki/releases/tag/v1.0.0
