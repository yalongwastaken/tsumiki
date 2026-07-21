# Testing Tsumiki — release review & manual QA runbook

A per-release summary of what shipped (v1.0.0 → v2.0.0) and how to verify each one by
hand. For the authoritative change list see [`CHANGELOG.md`](./CHANGELOG.md); this file
is the practical "how do I smoke-test it" companion.

---

## 1. Automated tests (run these first, every release)

From the repo root:

```bash
make test          # server + client unit tests + server-rendered component tests
make test-smoke    # headless render walk-through of the whole UI
make lint          # eslint
make format        # prettier --write   (or: npm run format:check)
```

As of v2.0.0 the suite is **80 server + 141 client + 16 component** tests, all green.

Date-sensitive logic (months, streaks, reminders, CSV dates) is meant to hold in any
timezone. To run the client unit tests across the same TZ matrix used during
development:

```bash
for TZ in UTC America/Los_Angeles Asia/Tokyo Pacific/Kiritimati; do
  echo "== $TZ =="; (cd client && TZ=$TZ npm test);
done
```

---

## 2. Running the app for a manual smoke test

```bash
make start         # builds the client, then serves everything at http://localhost:4000
```

Open `http://localhost:4000`. **`localhost` counts as a secure origin**, which matters
for the app-lock tests (§ v1.5.0).

**Start from a clean slate** by pointing at a throwaway database so you never touch real
data — and so first-run onboarding triggers:

```bash
TSUMIKI_DB=/tmp/tsumiki-test.db make start
```

**Load the bundled sample data:** in the app, **Settings → Data → Import** and choose
`samples/sample-portfolio.json` (nine holdings spread across a taxable brokerage, a 401(k), a
traditional IRA, and a Roth — so the stocks Sankey shows all four buckets). To wipe and
start over, use **Settings → danger zone → reset** (note: a reset intentionally leaves
the app lock in place — see v1.5.0).

**Optional feature flags** (all off by default — set them on the `make start` line):

| Flag                                     | Turns on                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `TSUMIKI_PRICES=0`                       | turns OFF stock-price sync (it's ON by default; needs `make prices-setup` to fetch)      |
| `TSUMIKI_PYTHON=…`                       | Python interpreter for price sync — point at the uv venv, e.g. `./.venv/bin/python`     |
| `TSUMIKI_NEWS_FEED='https://…/feed.xml'` | money-headlines card                                                                    |
| `TSUMIKI_TRUST_PROXY=1`                  | trust `x-forwarded-proto` behind a TLS proxy                                            |

---

## 3. Per-release review & smoke tests

### v1.0.0 — first stable release (the core coach)

**What shipped:** the deterministic allocation engine (waterfall across essentials, debt,
checking buffer, savings, retirement, investing, with cadence-aware per-paycheck
transfers), the ledger (search/filter, CSV import with column mapping, envelope budgets,
recurring auto-log), manual stock holdings with a 2026 income-tax estimate, the Home /
Sankey / net-worth-FIRE / calendar views, the PWA shell, onboarding, and full
export/import. Plus the privacy/LAN hardening (same-origin guard, body-size cap,
validation, atomic writes).

**Test it:**

1. Start clean (`TSUMIKI_DB=/tmp/t.db make start`) → the **onboarding wizard** should
   appear. Enter income + a couple of accounts; finish.
2. **Plan tab:** confirm you get an allocation breakdown, per-paycheck transfer amounts,
   the strategy preview, and a tax estimate card.
3. **Ledger:** add a few transactions; try search and a category filter; import a small
   CSV (map the columns); set a category budget and watch "days left / vs last month".
4. **Export → Import round-trip:** export the JSON, reset, re-import → data returns intact.

### v1.1.0 — daily streak, achievements, non-taxable income

**What shipped:** the streak became **daily** (any log keeps it alive — income, spending,
a contribution, or a $0 no-spend day), a 14-day grid + longest-run; many more
achievements; income (and the onboarding income step) can be flagged **non-taxable**;
hardened CSV/RSS parsing and local-time month bucketing.

**Test it:**

1. Log anything today → the streak panel shows "logged today", days-in-a-row, and the
   14-day grid fills a cell.
2. Check the **achievements** list grows (first entry, entry-count tiers).
3. In Settings, mark an income source **non-taxable** → the Plan **tax card** notes how
   much was excluded from the taxable base.

### v1.2.0 — hourly income onboarding + investment accounts hold their shares

**What shipped:** the onboarding income step gained **per-hour** (with hours/week and a
live monthly estimate); brokerage / IRA / Roth / 401(k) accounts now **hold their stock
holdings inline** plus optional cash, and their balance **auto-values from synced prices
plus cash** as a tagged daily snapshot that flows into net worth. The old separate "Stock
holdings" section is gone; unattached holdings get an "assign to account" prompt.

**Test it** (best done with prices on — see v2.0.0 for a local feed):

1. Re-run onboarding; on income choose **per-hour** → the monthly estimate updates live.
2. In **Accounts**, add e.g. a Roth account, add a couple of holdings inline + some cash.
3. Enable prices and **Sync now** → the account balance auto-values (prices × shares +
   cash) and **net worth** reflects it. Confirm a manually-set balance the same day is
   not overwritten.

### v1.3.0 — in-app reminders

**What shipped:** a Home **Reminders card** surfacing an upcoming payday, a bill due soon,
checking dropping below your buffer, a self-employed quarterly estimated-tax deadline,
and a streak about to lapse — each severity-toned and dismissable. A Settings card
toggles each kind. (In-app only; no OS push by design.)

**Test it:**

1. Set a pay cadence with a payday in the next few days, and add a bill with a
   day-of-month near today → both appear on the Reminders card.
2. Drop your checking below the configured buffer → a buffer reminder appears.
3. In Settings, toggle a reminder kind **off** → it disappears from the card.

### v1.4.0 — deeper budgets & goals

**What shipped:** per-category **budget rollover** (unused carries forward, overspend
carries back, as a net envelope over trailing months; Home shows "· rollover +$80");
**annual budgets** (a category cap tracked against the whole calendar year, for lumpy
categories like travel/gifts); and **goal earmarking** (tag a contribution "toward a
goal" in + Add; a goal can use the "Earmarked savings" metric so two goals grow
independently).

**Test it** (rollover needs spend across more than one month — easiest with imported
multi-month CSV data):

1. Set a category to **rollover**; with at least one prior complete month of data, under-
   or over-spend it → Home shows the carried amount on that category.
2. Set a category's period to **annual** → it tracks against the year, not the month.
3. Create two goals; in **+ Add**, earmark a contribution to one; switch that goal's
   metric to **Earmarked savings** → only its balance moves.

### v1.5.0 — app lock (optional password)

**What shipped:** an optional single-password **app lock**, off by default. Set it in
**Settings → App lock**; once on, opening Tsumiki requires the password and a device
stays trusted for **7 days**. scrypt-hashed password, HMAC-signed HttpOnly cookie. The
password can only be set or entered over a **secure origin** (HTTPS / Tailscale /
`localhost`). The secret rotates on every change; a data reset leaves the lock intact.

**Test it (use `localhost`, which is treated as secure):**

1. **Settings → App lock → set a password.** Reload the page → the **Login** screen
   appears; enter the password → you're in, and the device is trusted for 7 days.
2. **Change** the password, then reload on another browser/incognito → old session is
   invalidated (secret rotated), new password required.
3. **Remove** the password → it asks you to confirm first.
4. **Insecure-origin check:** open the app via the machine's plain LAN IP over `http://`
   (not localhost) → App lock shows an "open over HTTPS" message and won't let you
   set/enter a password. Recovery path: open from the box itself at
   `http://localhost:4000`.
5. **Reset leaves the lock on:** with a lock set, do Settings → reset → you should still
   be prompted to unlock.

### v2.0.0 — reliable, honest price sync

**What shipped:** the opt-in price sync no longer fails silently. A **provider fallback
chain** (`TSUMIKI_PRICE_URL` accepts a comma-separated list, tried in order and **merged**
per missing symbol), an optional **Finnhub** key provider tried last (only your tickers +
your key leave the device), and a recorded **last-sync outcome** —
`ok / partial / empty / error / idle / disabled` — surfaced on `/api/prices` and shown in
the Portfolio card (it names un-priced tickers and says the numbers are from the last good
sync). Also: honest error-vs-empty, a ≥5-calendar-day week-over-week baseline, and a
5-minute retry backoff after a failure. The Portfolio card also gained a **stocks Sankey**
("Where your stocks sit") that separates the total into account-type buckets (Taxable /
401(k) / IRA / Roth) and then into individual tickers.

**Test it** (prices now come from a single source: the yfinance sidecar at
`server/scripts/prices.py` — automated coverage drives it through
`server/test/fixtures/fake_prices.py`, so `make test` exercises every outcome without
touching the network):

```bash
make prices-setup             # one-time: uv venv + yfinance (sync is on by default)
TSUMIKI_PYTHON="$(pwd)/.venv/bin/python" make start
```

Import `samples/sample-portfolio.json`, open the **Portfolio** card, and:

1. **OK path:** hit **Sync now** → all holdings priced — including mutual funds — the
   total + allocation donut show, the **"Where your stocks sit" Sankey** appears
   (Portfolio → Taxable / 401(k) / IRA / Roth → tickers), and the footer reads "Prices
   synced just now."
2. **Missing dependency (error):** run with `TSUMIKI_PYTHON=/nonexistent` (or without
   `make prices-setup`), **Sync now** → the sync note says exactly what to install
   (`make prices-setup`); prior prices keep showing.
3. **Offline (error):** disconnect the network, **Sync now** → "showing the last saved
   prices," and the footer stops claiming a fresh sync.
4. **Unpriceable symbol:** add a holding with a junk ticker (e.g. `ZZZZZZ`) → after a
   few syncs it's flagged "update manually" instead of erroring forever.

**Blur money (privacy mode).** Click the **eye icon in the header** (top-right, next to net
worth) — every dollar amount blurs: balances, the plan, ledger, budgets, charts, and both
Sankeys. Non-money text (categories, tickers, dates, percentages) stays sharp. Hover any
blurred amount to peek; click the eye again (or toggle Settings → Privacy) to unblur. It
persists across tabs and is off by default. Note it's visual-only (a screen reader still
reads the amounts).

---

## 4. Tips

- **Throwaway DB per scenario:** `TSUMIKI_DB=/tmp/whatever.db make start` keeps tests
  isolated and lets you re-trigger onboarding.
- **Everything is one file:** the SQLite database is a single file, so a copy is a full
  backup (`make backup`).
- **The only outbound call in a default run is price sync** (on by default) — and only
  if you hold tickers; it sends just those symbols, via yfinance. Set `TSUMIKI_PRICES=0`
  for a fully offline run. The money-news card stays off until you configure a feed.
