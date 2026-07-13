# Tsumiki Audit — 2026-07-13

Scope: full line-by-line review of everything shipped since v2.4.0 — the persistence
store, per-entity endpoint adoption, offline resilience, bill tracking, "I moved it",
Web Push reminders, the yfinance price sidecar, the auth-throttle persistence, and the
schema/validate split. Two independent review passes (server, client), each verifying
comments against actual behavior. Baseline at audit time: 131 server + 213 client +
28 component tests, smoke test, lint, and prettier all green.

The previous audit (2026-07-01, archived at
[`docs/AUDIT-2026-07-01.md`](./docs/AUDIT-2026-07-01.md)) is **fully closed** — every
finding, every test gap, and 12 of its 12 feature opportunities shipped by v2.6.0.

---

## Findings — all High/Medium items FIXED in this pass

### High (3 found, 3 fixed)

- **SH1 — `/api/auth/set` was an unthrottled password oracle.** ✅ Fixed. It verified
  `current` with no lockout check and no failure recording — an attacker could
  brute-force at full speed (and over plain http, and with free scrypt CPU burn),
  making the persisted login throttle moot. Now: secure-origin check first, the shared
  lockout applies, and a wrong `current` records a failed attempt (`auth.js`, tested).
  _Consequence: a locked-out user must wait out the lockout to change the password —
  that's the point of a lockout._
- **CH1 — a failed account DELETE could still strip that account's holdings.** ✅
  Fixed. The follow-up holdings meta-patch was queued unconditionally with a payload
  captured at optimistic time; if the DELETE 409'd, the resync restored the account
  but the patch then erased its holdings server-side. The patch now runs in the same
  chain step, only after the delete persists, with a live-mirror payload
  (`persist.js`, regression-tested).
- **CH2 — an offline boot latched the plaintext cache ON for the whole session.** ✅
  Fixed. The `authStatus` failure path set cache-allowed permanently, so a
  lock-enabled device booting while the server was briefly unreachable would cache
  full financial state to localStorage all session. Now: a failed check never grants
  permission (reads stay safe by construction — a cache only exists if written while
  the lock was confirmed off), permission is re-confirmed on every successful load,
  and enabling the lock clears the cache immediately (new `lib/core/lastgood.js`
  invariant, wired into AppLock).

### Medium (9 found, 9 fixed)

- **CM1 — queued writes didn't re-rebase after a mid-chain 409**, resurrecting
  conflicted data and silently diverging UI from server. ✅ Fixed: `save`/`saveEntity`/
  `deleteEntity`/`appendTx` now build payloads from the live mirror at execution time
  and VOID themselves when a conflict resync made them moot (tested).
- **CM2 — undo-after-409 could duplicate a transaction** (same id twice). ✅ Fixed:
  undo is a no-op when the tx is already back.
- **CM3 — a rejected-but-online lean append showed a false "Offline" banner.** ✅
  Fixed: `appendTx` reports via `onResync` when the server answered; `onError` (and
  the offline banner) is reserved for a truly unreachable server (tested).
- **CM4 — Notifications "enable" hung forever with no service worker** (dev mode /
  failed registration) — `.ready` never resolves. ✅ Fixed: `getRegistration()` + a
  clear error.
- **CM5 — six AccountsSection saves used render-closure constants**, clobber-prone
  against concurrent optimistic writes. ✅ Fixed: all converted to functional updaters.
- **CM6 — bill matching false positives**: weak reverse-name evidence (a short note
  inside a bill's name) could mark an unpaid bill "paid", suppressing the overdue
  alert. ✅ Fixed: reverse evidence now only counts alongside an amount match (tested).
- **SM1 — push subscribe was a stored-SSRF surface**: any URL was accepted as an
  endpoint the server would POST to daily (including its own localhost API). ✅ Fixed:
  HTTPS-only, length-capped fields, string-typed keys, max 20 subscriptions (tested).
- **SM2 — a systemic push failure burned the whole day's digest** (day marked sent
  before sending). ✅ Fixed: send first, mark after (idempotent per-device sends).
- **SM3 — chatty python stdout failed every price sync as "unreadable".** ✅ Fixed:
  the JSON contract is parsed from the last non-empty stdout line; and a spawn error
  with parseable output now still counts as a provider error so the circuit breaker
  never punishes symbols (SL1).

### Low — fixed

- **SL2** subscription 403s (e.g. after a VAPID regeneration) now prune the dead
  subscription instead of warn-logging daily forever.
- **SL3** the `fast_info` price fallback stamps today's date, so per-symbol history
  grows and week-over-week change doesn't stay null forever.
- **SL4** stale "ticker is interpolated into the URL" comment updated (it's argv to
  `execFile`).
- **CL1** typed future backdates are rejected at submit, not just constrained by the
  picker UI.
- **CL2** "I moved it" hides while previewing an unsaved strategy (it logged against
  targets the real plan never asked for).
- **CL3** Home's bill statuses re-key on the calendar day, so an app left open
  overnight doesn't show yesterday's due/overdue states.

### Low — accepted / documented (not bugs, known trade-offs)

- **A1** `server/lib/push.js` imports two pure calendar libs from `client/src/lib/plan/`
  — a server-only deployment (repo split) would break at import. Deliberate DRY choice;
  the repo deploys as a whole.
- **A2** Push timing uses the server's local clock (8am gate + "today"). Correct for
  the intended mini-PC-at-home deployment; a UTC-clocked container would send at the
  wrong local hour. Set the container's TZ if that ever applies.
- **A3** A half-corrupt VAPID meta blob regenerates the keypair, orphaning existing
  subscriptions — they now 403 and self-prune (SL2), and devices re-subscribe from
  Settings. Self-healing, if blunt.
- **A4** A schedule-less bill is invisible in "Bills this month" until a spend matches
  it (counted "none"). Consistent-if-imperfect; give bills a due day for full tracking.
- **A5** Reconnect push drops offline edits on a genuine conflict (rev-checked → 409 →
  resync) with only a toast. Conservative and correct — the alternative is a merge UI.
- **A6** sw.js assumes a root deployment (`/assets/`, `/index.html`, `openWindow("/")`).
  True today (Vite `base: "/"`); pruning degrades to a no-op on a subpath, never
  wrongly deletes. Derive from `registration.scope` if a subpath is ever needed.
- **A7** Two-tap confirm timers aren't cleaned up on unmount — harmless in React 18
  (functional no-op setState); a shared hook would be tidier.
- **A8** `saveMeta` partials are captured at call time (not re-derived post-conflict) —
  meta blobs are user-intent toggles where re-sending is the desired behavior.
- **A9** Calendar/billpay bucket `new Date(t.date)` directly; all in-app writers emit
  full-ISO or local-noon stamps so this only matters for hand-crafted external data.
- **A10** Server tests spawn `python3` (the fixture needs no yfinance) — present on
  ubuntu CI and the target mini-PC; Windows contributors need a `python3` alias.

---

## Verified sound (spot-checks that passed line-verification)

- **Price sidecar contract**: argv-safe `execFile` (no shell), ticker charset enforced
  on every write path, 90s timeout, 2MB cap, ENOENT → "install python3 + yfinance"
  note surfaced verbatim in the Portfolio card; breaker semantics (errors never
  punish, misses cap at 3, every-7th-refresh probe recovers) covered by real
  spawn-based tests. Manual holdings are never requested (args-file test).
- **Push privacy**: digest payloads are counts only (test asserts no names/amounts);
  routes sit behind the auth gate; VAPID keys + subs survive `resetAll` as intended.
- **Persistence store**: rev read at execution time; 409 vs failure distinguished;
  serialized chain; offline reconnect push is rev-checked (cannot clobber newer
  server state).
- **Offline cache invariant**: only exists while the lock is confirmed off; enabling
  the lock clears it immediately and on every confirmed-lock load.
- **billdates/paydays/apply/fire math**: TZ/DST-safe (local-Date construction, calendar
  stepping, local-noon stamps), covered by the lib suites.
- **CI**: every step reproduced on Linux — green (lockfiles present, `python3`
  available, `--experimental-sqlite` carried via package scripts).

## Post-fix baseline

131 server + 213 client + 28 component tests, smoke test, production build, lint, and
prettier — all green.
