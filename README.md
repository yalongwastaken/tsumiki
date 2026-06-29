# Tsumiki — personal money coach

**v2.1.0** · self-hosted · single-user · no cloud, no AI in the product

A self-hosted money **coach**, not just a tracker. Given the money you have, it tells
you where it should go — essentials, debt, a checking buffer, savings, retirement, and
investing — then tracks your real spending and contributions against that plan.

It's a single-user app designed to run on a mini PC at home and be reached privately
from your phone or laptop over [Tailscale](https://tailscale.com) — no public ports,
no cloud, your financial data never leaves your own devices.

## Architecture

The **mini PC is the brain**: it runs the server, holds the SQLite database, and runs
the allocation engine. Phones and laptops are thin web clients that talk to it over the
API.

```
server/   Express + node:sqlite API + allocation engine (no native deps)
  lib/       db, auth, engine, prices, news, http, migrate
  test/      server unit tests
client/   Vite + React single-page app (thin client)
  src/views/        tab screens (Home, Plan, Activity, Portfolio, …)
  src/charts/       dependency-free SVG charts + Sankeys
  src/components/   shared widgets (Money, QuickAdd, NavRail, …)
  src/lib/          pure logic: core/ finance/ plan/ insights/
  src/setup/        account/income/bill/budget editors
  test/             client tests: lib/ + component/ + smoke
docs/     INSTRUCTIONS.md (run + install) · TESTING.md (QA runbook)
```

The engine takes your income, accounts, debts, and strategy and returns a plan: how to
split each paycheck across savings, retirement, investing, and checking (cadence-aware,
so it can show per-paycheck recurring transfers). The client renders the plan, a money
flow (Sankey), net-worth/FIRE projections, a calendar, and a light streak/milestone
game layer.

## Documentation

- [`docs/INSTRUCTIONS.md`](./docs/INSTRUCTIONS.md) — run it on a mini PC, install it on
  your phone, keep it updated, and keep it secure.
- [`docs/TESTING.md`](./docs/TESTING.md) — per-release review + manual QA runbook.
- [`SECURITY.md`](./SECURITY.md) — threat model, protections, and hardening steps.
- [`CHANGELOG.md`](./CHANGELOG.md) — release history.

## Requirements

- **Node ≥ 22.12** and npm. The server uses the built-in `node:sqlite`
  (run with `--experimental-sqlite`); the client uses Vite 8. No database server or
  native build step required.

All dependencies are declared in `client/package.json` and `server/package.json`.

## Quick start

With [`make`](./Makefile):

```bash
make install   # install client + server dependencies
make dev       # run backend (:4000) and frontend (:5173) together
```

Then open http://localhost:5173 (the dev frontend proxies `/api` to the backend).

<details>
<summary>Without make (two terminals)</summary>

```bash
# terminal 1 — backend → http://localhost:4000
cd server && npm install && npm run dev

# terminal 2 — frontend → http://localhost:5173
cd client && npm install && npm run dev
```

</details>

## Production (on the mini PC)

Build the client once; the server then serves it from `/`:

```bash
make start        # builds the client, then serves everything from :4000
```

Open `http://<mini-pc-ip>:4000`. Configuration via environment variables:

| Variable              | Default                  | Purpose                                                                                                                          |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                | `4000`                   | port to listen on                                                                                                                |
| `HOST`                | `0.0.0.0`                | bind address; set to `127.0.0.1` to expose only locally and front with a TLS reverse proxy                                       |
| `TSUMIKI_DB`          | `server/data/tsumiki.db` | SQLite database file path                                                                                                        |
| `TSUMIKI_NEWS_FEED`   | _(unset → off)_          | optional public RSS/Atom URL for money headlines                                                                                 |
| `TSUMIKI_PRICES`      | _(unset → off)_          | set to `1` to sync prices for your stock holdings                                                                                |
| `TSUMIKI_PRICE_URL`   | _(Stooq CSV)_            | price feed URL(s) (`{SYMBOLS}` placeholder); comma-separate to list fallback feeds tried in order                                |
| `TSUMIKI_FINNHUB_KEY` | _(unset → off)_          | optional Finnhub API key; when set, Finnhub is tried as a fallback for any symbols the keyless feed(s) couldn't price            |
| `TSUMIKI_FINNHUB_URL` | _(Finnhub quote API)_    | override the Finnhub quote endpoint (only sends a ticker + your key)                                                             |
| `TSUMIKI_TRUST_PROXY` | _(unset → off)_          | set to `1` only when behind a TLS-terminating proxy (Tailscale serve / nginx) so `x-forwarded-proto` is trusted for the app lock |
| `TSUMIKI_AUTO_BACKUP` | _(unset → off)_          | set to `1` for a daily local JSON backup (keeps the newest 30); off by default, never leaves the device                          |
| `TSUMIKI_BACKUP_DIR`  | _(`backups/` by the DB)_ | where pre-import snapshots and auto-backups are written                                                                          |

The money-news card and price sync are both **off by default** — the server makes
no outbound calls unless you opt in. With `TSUMIKI_NEWS_FEED` set it fetches that
feed nightly and serves headlines only. With `TSUMIKI_PRICES=1` it fetches daily
closing prices **for only the tickers you hold** (symbols aren't personal) from a
keyless public source, caches them, and falls back to the last good prices when
offline. You can list several feeds in `TSUMIKI_PRICE_URL` (comma-separated) and
they're tried in order; if you also set `TSUMIKI_FINNHUB_KEY`, Finnhub is tried as a
last fallback (only your ticker symbols and your own key are sent to it). The
Portfolio card shows the outcome of the last sync — synced, partial (which tickers
had no data), nothing returned, or unreachable — so a stale feed is never silently
passed off as fresh. Everything stays general info, never personalized, and nothing
about you leaves the device.

## App lock (optional password)

Off by default — the app is open on your trusted LAN/tailnet. In **Settings → App lock**
you can set a password; once set, opening Tsumiki requires it, and a device stays
trusted for 7 days. For security the password can only be set or entered over a private
connection (HTTPS, your Tailscale address, or `localhost`) — never plain-LAN `http`,
where it could be sniffed. Behind a TLS-terminating proxy (e.g. `tailscale serve`), set
`TSUMIKI_TRUST_PROXY=1` so the proxy's `https` is recognized. Locked out (e.g. a cert
broke)? Open the app from the mini-PC itself at `http://localhost:4000` to sign in and
change or remove the password.

## Reach it from your phone, securely (Tailscale)

1. Install Tailscale on the mini PC and your phone; sign into the same tailnet.
2. On the phone, open `http://<mini-pc-tailscale-ip>:4000`.

No port-forwarding and no public URL — the server is only reachable by your own devices
on the encrypted tailnet.

### Install it as an app (iPhone / Android)

Tsumiki is an installable PWA, so it runs like a native app — no App Store needed:

1. (Optional) enable **MagicDNS** in Tailscale so the address is a name like
   `http://minipc:4000` instead of a raw IP.
2. Open that URL in **Safari** (iOS) or **Chrome** (Android).
3. **Share → Add to Home Screen** (iOS) / **⋮ → Install app** (Android).

It installs with the Tsumiki icon and launches fullscreen (no browser chrome),
with a theme color that follows light/dark mode.

## Back up your data

The whole database is one file, so a copy is a full backup:

```bash
make backup       # → backups/tsumiki-YYYY-MM-DD.db   (PLAINTEXT)
```

The plain copy is unencrypted — fine on an encrypted disk, risky if it leaves the box.
For an encrypted backup (recommended before syncing anywhere off the machine):

```bash
TSUMIKI_BACKUP_PASSPHRASE='your-strong-passphrase' make backup-enc
# → backups/tsumiki-YYYY-MM-DD.db.gpg   (AES-256, via gpg)
# restore: gpg -d -o restored.db backups/tsumiki-YYYY-MM-DD.db.gpg
```

Automate it nightly with cron on the mini PC (set the passphrase in the cron env):

```cron
0 2 * * *  cd ~/tsumiki && TSUMIKI_BACKUP_PASSPHRASE='…' make backup-enc
```

## Security

Tsumiki is built for a single user on a private network and is deliberately
privacy-respecting: **no telemetry, no analytics, no third-party calls**, and the
outbound news/price features are off by default (when on, only ticker symbols / the
feed URL / your own API key ever leave). See [`SECURITY.md`](./SECURITY.md) for the
full threat model, what protects your data, the residual risks (no at-rest encryption
by default; the app lock is off by default; the server does no TLS itself), and the
recommended hardening steps.

## Testing

```bash
make test         # all unit tests (engine, db, migrate, selectors, streak, milestones)
make test-smoke   # headless render walk-through of the whole UI
```

## API

| Method | Path                | Purpose                                                  |
| ------ | ------------------- | -------------------------------------------------------- |
| GET    | `/api/health`       | liveness check                                           |
| GET    | `/api/state`        | full unified model                                       |
| PUT    | `/api/state`        | replace the full model (the client's "save")             |
| POST   | `/api/transactions` | append a single transaction (lean write)                 |
| GET    | `/api/plan`         | allocation plan (`?income=`, `?strategy=`, `?windfall=`) |
| GET    | `/api/news`         | cached money headlines (empty unless a feed is set)      |
| GET    | `/api/prices`       | cached prices for held tickers (empty unless enabled)    |
| GET    | `/api/export`       | download the full model as JSON                          |
| POST   | `/api/import`       | replace the model from an exported JSON                  |
| POST   | `/api/migrate`      | import old `window.storage` JSON → unified model         |

## Make targets

Run `make help` for the full list: `install`, `dev`, `server`, `client`, `build`,
`start`, `test`, `test-smoke`, `backup`, `clean`, `distclean`.

## Releases

See [`CHANGELOG.md`](./CHANGELOG.md). Releases follow [SemVer](https://semver.org);
the current release is **v2.1.0**.

## License

All rights reserved. © 2026 Anthony. This is a personal project published for
reference; no license to use, copy, modify, or distribute is granted.
