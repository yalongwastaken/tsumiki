# Tsumiki Audit — 2026-07-01

Scope: full sweep (correctness, engine, security, UX, tests, PWA) at v2.4.0.
Baseline: all 94 server tests + 169 client tests pass, lint clean. Findings below were verified against the code (top items re-checked line-by-line); several were reproduced empirically (e.g. `TZ=America/New_York`).

---

## Reconciliation — 2026-07-13

Status of every finding, verified against the code and `docs/CHANGELOG.md` (released as v2.5.0 and v2.6.0):

| Status                       | Findings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Fixed                     | **C1** (`eab766f` — dbpath resolver + relocation; the leftover dual-DB files on disk were reconciled 2026-07-13: live DB now at `server/data/tsumiki.db`, the empty orphan archived to `server/data/backups/`), **H1** (`e898a9d` — premigrate backup + 409 unless `force`), **H2** (`VACUUM INTO` backups), **H3** (`3acf3b3` — calendar-math payday stepping), **H4** (`5caddbb` — local-day edit pre-fill), **M1**/**M2** (`19bc13e`), **M3**/**M4**/**M5** (`42c8c6c`), **M6** (calendar-day forecast stepping), **M7** (`1611ebf`), **L1** (rev required on PUT/PATCH), **L2** (export carries portfolio history), **L3** (migrate inherits current defaults), **L4** (year-keyed contribution caps), **L5** (same-day close kept) |
| ✅ Fixed 2026-07-13          | **H5** (NetWorthCard hidden once accounts exist), **H6** ("Deleted — Undo" toast restores a deleted transaction), **M10** (account deletion: always-on in-app two-tap confirm — remaining editors below), **M11** (SW prunes assets the current index.html doesn't reference), **L6** (app-lock form validates the server's 8-char minimum), **L9** (Plan what-if field follows recomputes only until touched), **L10** (Home plan fetch stale-guard), **L11** (SW only caches a 2xx shell), **L12** (backup import confirms in-app, no window.confirm/alert), **L13** (CSV import commit uses a functional updater), **L14** (profile draft re-syncs after a 409; save rebases on the latest profile)                                  |
| ✅ Fixed 2026-07-13 (v2.6.0) | **M8**/**M9** (offline last-good cache + reconnect push), **M10** remainder (two-tap confirms on bill/income/target deletes too), **L7** (login throttle persisted, survives restarts and resetAll), **L8** (CSV preview warns on European decimals + day-first dates)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ❌ Open                      | — nothing. Every finding from this audit is resolved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Test-coverage gaps: HTTP-level route tests (`test/http.test.js`), TZ cases (`test/engine-tz.test.js`), and garbage-profile engine tests have landed. Closed 2026-07-13: App.jsx persistence machinery extracted to `client/src/lib/core/persist.js` with unit tests; `Fire.yearsToTarget` / `Projection.projectSeries` moved into `lib/finance/` under the lib suite.

Feature opportunities shipped 2026-07-13: #1 undo-delete, #2 backdate in QuickAdd, #3 offline cache + write retry, #4 bill paid/unpaid tracking, #5 month-in-review card, #8 per-paycheck "I moved it", #10 Web Push reminders (plus #9/#11/#12, which landed earlier). **This audit is fully closed as of v2.6.0** — every Critical, High, Medium, and Low finding, every test-coverage gap, and 10 of the 12 feature opportunities have shipped (#6 backup-before-reset and #7 VACUUM INTO backups landed as part of H1/H2).

---

## Critical

### C1. Live database silently moved to `server/lib/data/` — backups and docs point at a dead file

`server/lib/db.js:10` — `DB_PATH = join(__dirname, "data", "tsumiki.db")` is module-relative. The `lib/` refactor (commit `7e99a08`) moved `db.js` into `server/lib/`, silently changing the default DB path from `server/data/tsumiki.db` to `server/lib/data/tsumiki.db`. Both files exist and have diverged: `server/data/tsumiki.db` is an orphan (0 transactions); `server/lib/data/tsumiki.db` is live (has a `-wal`).

Consequences:

- `make backup` / `make backup-enc` (`Makefile:72,82`) copy the **orphaned** file — every backup since the refactor archives dead data.
- `README.md:93`, `docs/SECURITY.md:28`, `docs/INSTRUCTIONS.md:98,240-241` all document the wrong path; the restore instructions would restore over the wrong file.
- Any pre-refactor data would appear as a fresh install after upgrading.

**Fix:** change to `join(__dirname, "..", "data", "tsumiki.db")`; on startup, relocate an existing `server/lib/data/tsumiki.db` (+`-wal`/`-shm`) to the documented path; log the resolved DB path at boot.

---

## High

### H1. `POST /api/migrate` is an unguarded full-state wipe

`server/index.js:205-218`. `migrateLegacy({})` passes `validateState`, so a stray POST with `{}` replaces the entire dataset — no rev check, no pre-backup (unlike `/api/import`, which snapshots first at `index.js:195`) — and seeds a fake $7,000/mo profile.
**Fix:** call `backupStateToFile("premigrate")` before `putState`; refuse migration when transactions already exist unless explicitly forced.

### H2. `make backup` copies a live WAL-mode DB file

`Makefile:72,82` + WAL mode (`db.js:15`). Recent writes can live entirely in the `-wal` until checkpoint; `cp` of only the main file while the server runs yields a stale or torn backup. Compounds C1.
**Fix:** `sqlite3 ... "VACUUM INTO ..."`, or copy `-wal`/`-shm` too, or back up via `GET /api/export`.

### H3. Weekly/biweekly paydays drift one day early after DST fall-back

`client/src/lib/plan/paydays.js:37-46` strides by fixed `7/14 × 86400000` ms from a local-midnight anchor without re-normalizing. Reproduced in `TZ=America/New_York`: biweekly anchor Fri 2026-10-23 → every payday Nov–Mar renders as Thursday. Ripples into calendar payday dots, payday reminders, the Recurring "Upcoming paydays" list, one-tap paycheck logging dates, and cashflow-forecast inflow days.
**Fix:** step with calendar math: `t.setDate(t.getDate() + stride)` (re-anchors to local midnight).

### H4. Editing any transaction can silently shift it to the wrong day

`client/src/components/Ledger.jsx:23` — `String(t.date).slice(0, 10)` slices a full UTC ISO stamp, so west of UTC an evening entry pre-fills tomorrow's date; `saveEdit` then re-stamps it there. Editing just the amount moves the entry to the next local day — shifting calendar cells, month totals, budgets, and the streak grid.
**Fix:** use `dayKey(t.date)` (already exported from `lib/core/selectors.js` and imported by this file).

### H5. "Record your current net worth" corrupts the first real account

`client/src/App.jsx:511-526` + `NetWorthCard` rendered unconditionally (`App.jsx:756`). With accounts present, the entered whole-net-worth figure is appended as a balance snapshot to `accounts[0]` (typically Checking) — checking buffer, cashflow forecast, and net worth (which still adds other accounts) all go wrong.
**Fix:** hide the card once `accounts.length > 0`, or write to a dedicated synthetic account.

### H6. Deleting a transaction is one tap, permanent, no confirm/undo

`Ledger.jsx:215-221` → `App.jsx:390-392`; the X sits beside the edit pencil on mobile.
**Fix:** "Deleted — Undo" toast (toast + functional `save` already exist, so restore is trivial).

---

## Medium

### M1. Engine YTD retirement bucketing is timezone-wrong at year boundary

`server/lib/engine.js:129` — `new Date(t.date).getFullYear()`: a `"2026-01-01"` contribution parses as UTC midnight and lands in 2025 in negative-offset TZs. Reproduced: $7,000 Jan-1 contribution → `ytdRetirement: 0` → the plan can advise contributing past IRA/401k caps.
**Fix:** derive the year via the shared `monthOf()` pattern (`finance.js:12`) used elsewhere for exactly this bug class.

### M2. Unvalidated profile fields feed the engine; NaN silently deletes plan steps

`db.js:575-595` only checks `profile` is an object. Verified: `checkingFloor:"abc"` makes the "Savings account" step vanish and context values serialize as `null`.
**Fix:** validate/coerce numeric fields (`checkingFloor`, `emergencyTarget`, `employerMatch.pct`, `highApr`, `retirementLimits.*`, `split.*`, `bills[].amount`, `incomeSources[].typicalMonthly`) in `validateMeta`.

### M3. Finnhub 429s look like "no data" and permanently mark holdings "manual"

`prices.js:149-172` fetches serially, no throttle (free tier 60/min); `http.js:7` returns `null` for any non-OK response, so rate-limited symbols count as per-symbol misses (`prices.js:309`) — three rate-limited syncs flip real holdings to "manual".
**Fix:** surface HTTP status from `fetchTextCapped` (429/5xx → `anyError`, not a miss); add a small inter-request delay.

### M4. Portfolio history undercounts partial syncs and always excludes manual holdings

`prices.js:323-329` sums only cache-priced symbols; `manualPrice` holdings (v2.3 feature) contribute 0 forever — server history permanently disagrees with client net worth.
**Fix:** include `manualPrice * shares`; skip `appendPortfolioPoint` when any auto-sync holding is unpriced.

### M5. `/api/news` has no failure backoff and no single-flight guard

`news.js:134-139` — a down feed re-fetches on every request (blocking up to 8s) with concurrent fetches. `prices.js` already solves both (RETRY_FLOOR + `inFlight`).
**Fix:** mirror the prices.js pattern.

### M6. Cashflow forecast double-counts a day across fall DST

`insights.js:95` — `new Date(t0.getTime() + i * DAY)` resolves two iterations to the same local date after fall-back; that day's payday and bills apply twice.
**Fix:** `new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + i)`.

### M7. Average monthly spend counts the current partial month as full

`selectors.js:147-156`, `finance.js:104-111`. On the 3rd, three days of spend divide as a whole month → FIRE number too low (progress overstated), emergency-fund suggestions too low, runway overstated. `typicalIncome` already excludes the current month — apply the same cutoff.

### M8. Offline, the installed PWA shows an error and $0 everywhere

`sw.js` caches shell only; failed `loadData` leaves `EMPTY` state (`App.jsx:132-135`). Routine for a Tailscale-reached home server.
**Fix:** persist last-good state locally, render read-only with an "offline — last synced" banner.

### M9. Writes that fail offline are shown but never persisted

`App.jsx:445-462, 198-212` — on network failure the optimistic entry stays in the UI with only an error banner; close the app and it's gone.
**Fix:** small retry queue, or visibly mark rows "not saved".

### M10. Account deletion silently destroys snapshot history

`AccountsSection.jsx:127-142` — confirm only fires when holdings exist; deleting a cash account erases years of balance history and retroactively changes net-worth history. Debts/bills/income/targets likewise one-tap irreversible.
**Fix:** shared confirm-or-undo across setup editors.

### M11. SW cache never pruned or versioned per deploy

`sw.js:4,49-66` — hashed assets from every deploy accumulate forever under `tsumiki-shell-v1`.
**Fix:** inject build hash into cache name, or prune assets not referenced by current index.html on activate.

---

## Low

- **L1** `index.js:100,119` / `db.js:556` — PUT/PATCH without `rev` bypass optimistic concurrency. Require `rev` on client-facing PUT.
- **L2** `db.js:659-670` — export/backup JSON omits `portfolioHistory`/`symbolPriceHistory`; restore loses the portfolio chart.
- **L3** `migrate.js:53-73` — migrated settings/profile miss newer default fields; spread `DEFAULT_PROFILE` under migrated values.
- **L4** `engine.js:18-19` — 2026 IRA/401k caps hardcoded; year-keyed map + "using YYYY limits" in plan context.
- **L5** `prices.js:189-194` — `recordHistory` drops same-day newer closes; replace same-date entry.
- **L6** `auth.js:13` vs `AppLock.jsx:35` — server requires 8-char password, client validates 6; align client to 8.
- **L7** `auth.js:19-20` — login throttle is a single in-memory global (resets on restart). Acceptable for the threat model; persist + backoff if hardening.
- **L8** `csv.js:134-139,169` — European `1.234,56` and `DD/MM/YYYY` silently misparse; warn on ambiguous formats in import preview.
- **L9** `Plan.jsx:85-88` — what-if amount field is clobbered when `planIncome` recomputes mid-typing.
- **L10** `Home.jsx:101-105` — plan fetch lacks the stale-response guard Plan.jsx has.
- **L11** `sw.js:36-38` — caches index.html without checking `res.ok`; a transient 502 becomes the permanent offline fallback.
- **L12** `Setup.jsx:120,128` — `window.confirm/alert` render poorly in iOS standalone PWA; use the in-app confirm pattern.
- **L13** `Setup.jsx:323` — CsvImport commit uses render-closure `data` instead of a functional updater; racy with a queued save.
- **L14** `ProfileSection.jsx:28-43` — draft initialized once from props can go stale after a 409 reload.

---

## Security posture

No critical or high security flaws. Verified strong: parameterized SQL throughout; scrypt + timing-safe compares; HMAC HttpOnly `SameSite=Strict` cookie (no tokens in localStorage); working Origin-based CSRF/DNS-rebinding guard; no CORS exposure; no XSS sinks (no `innerHTML` anywhere); CSV formula-injection defense on export; capped outbound fetches; SW never caches `/api`; no secrets or DB files in git history. SECURITY.md claims all check out **except** the DB path (C1). Remaining residual risks are documented ones: plaintext `make backup`, no TLS without Tailscale/proxy, unauthenticated reads when app lock is off.

---

## Test coverage gaps

- Zero HTTP-level server tests: routes, origin guard, 409 paths, `/api/import` pre-backup, `/api/migrate` destructiveness (H1), error handlers.
- No engine tests for NaN/garbage profile input (M2) or year-boundary YTD (M1).
- Client date-math tests run in UTC only — add `TZ=America/New_York` cases (would have caught H3, M6).
- App.jsx persistence machinery (saveChain, rebase, 409 re-sync, lean-tx failure) — the riskiest client code — is untested.
- `Fire.yearsToTarget` / `Projection.projectSeries` live inside view files, invisible to the lib suite; move to `lib/finance/` and test.
- `http.js` fetchTextCapped (size cap, lying content-length, timeout) untested.

---

## Feature opportunities (ranked by value ÷ effort)

1. **Undo-delete toast** (H6) — infrastructure already exists.
2. **Backdate in QuickAdd** — a "Yesterday" chip / date field; `localNoonIso` already handles stamping. Phone-first logging essential.
3. **Offline read cache + write retry queue** (M8/M9) — state is one JSON blob; biggest reliability win.
4. **Bill paid/unpaid tracking** — match logged spends against bills; calendar dots become paid/overdue; "bills left this month" total. Pure-lib work.
5. **Month-in-review card** — `monthTotals`, `spendingTrends`, `budgetStatus`, `computeAdherence` are all pure and already imported by Home; a "June report card" is nearly free and very coach-like.
6. **Backup-before-reset** — `/api/reset` is one irreversible click; `backupStateToFile` already exists.
7. **`GET /api/export?format=db`** via `VACUUM INTO` — consistent SQLite-native backup, fixes H2 without shell tooling.
8. **Per-paycheck "I moved it" confirmation** — one tap creates the plan's transfer contributions, closing the plan→action gap.
9. **`/api/plan?date=`** — `buildPlan` is pure; parameterize its two `new Date()` calls to plan future paychecks.
10. **Web Push reminders** — `computeReminders` was explicitly designed for this (`reminders.js:3-4`); completes the phone-first coach loop.
11. **Boot log of resolved DB path + rev + row counts** — would have surfaced C1 immediately.
12. **Per-entity PATCH endpoints** — shrink the full-state-PUT clobber window (pairs with L1; also fixes L-class Projection slider spam, B6).

---

## Suggested fix order

1. **C1 + H2 today** — data-loss class: fix DB path, relocate live DB, fix Makefile backups (VACUUM INTO), correct docs.
2. **H1** — guard `/api/migrate`.
3. **H3–H5, M1** — verified correctness bugs with user-visible wrong numbers/dates.
4. **H6, M10** — destructive-action safety.
5. **M2–M9, M11** then Lows, adding the missing tests (esp. `TZ=` date cases and HTTP-level route tests) as each lands.
