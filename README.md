# Tsumiki — personal money coach

A self-hosted money **coach**, not just a tracker. Given the money you have, it tells
you where it should go — essentials, debt, a checking buffer, savings, retirement, and
investing — then tracks your real spending and contributions against that plan.

It's a single-user app designed to run on a mini PC at home and be reached privately
from your phone or laptop over [Tailscale](https://tailscale.com) — no public ports,
no cloud, your financial data never leaves your own devices.

See [`docs/SPEC.md`](./docs/SPEC.md) for the full vision and data model, and
[`IMPROVEMENTS.md`](./IMPROVEMENTS.md) for the design notes behind the current build.

## Architecture

The **mini PC is the brain**: it runs the server, holds the SQLite database, and runs
the allocation engine. Phones and laptops are thin web clients that talk to it over the
API.

```
server/   Express + node:sqlite API + allocation engine. No native deps.
client/   Vite + React single-page app (thin client).
docs/     SPEC.md — the working spec.
```

The engine takes your income, accounts, debts, and strategy and returns a plan: how to
split each paycheck across savings, retirement, investing, and checking (cadence-aware,
so it can show per-paycheck recurring transfers). The client renders the plan, a money
flow (Sankey), net-worth/FIRE projections, a calendar, and a light streak/milestone
game layer.

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

| Variable            | Default                  | Purpose                                          |
| ------------------- | ------------------------ | ------------------------------------------------ |
| `PORT`              | `4000`                   | port to listen on                                |
| `HOST`              | `0.0.0.0`                | bind address (LAN / Tailscale)                   |
| `TSUMIKI_DB`        | `server/data/tsumiki.db` | SQLite database file path                        |
| `TSUMIKI_NEWS_FEED` | _(unset → off)_          | optional public RSS/Atom URL for money headlines |

The money-news card is **off by default** — the server makes no outbound calls
unless you set `TSUMIKI_NEWS_FEED` to a public feed. When set, it fetches the feed
nightly, caches it in memory, and serves headlines only (general info, never
personalized, nothing about you leaves the device).

## Reach it from your phone, securely (Tailscale)

1. Install Tailscale on the mini PC and your phone; sign into the same tailnet.
2. On the phone, open `http://<mini-pc-tailscale-ip>:4000`.

No port-forwarding and no public URL — the server is only reachable by your own devices
on the encrypted tailnet.

## Back up your data

The whole database is one file, so a copy is a full backup:

```bash
make backup       # → backups/tsumiki-YYYY-MM-DD.db
```

Automate it nightly with cron on the mini PC:

```cron
0 2 * * *  cd ~/tsumiki && make backup
```

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
| GET    | `/api/export`       | download the full model as JSON                          |
| POST   | `/api/import`       | replace the model from an exported JSON                  |
| POST   | `/api/migrate`      | import old `window.storage` JSON → unified model         |

## Make targets

Run `make help` for the full list: `install`, `dev`, `server`, `client`, `build`,
`start`, `test`, `test-smoke`, `backup`, `clean`, `distclean`.
