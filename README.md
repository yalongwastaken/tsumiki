# Tsumiki — personal money coach

A self-hosted money coach (not just a tracker): given the money you have, it works
toward telling you where it should go — debt, buffer, savings, investing, retirement.
See [`SPEC.md`](./SPEC.md) for the full vision, data model, and roadmap.

**Architecture** (SPEC.md §12): the **mini PC is the brain** — it runs the server,
holds the SQLite database, and (soon) runs the allocation engine. Phone and desktop
are thin web clients. Reach it from anywhere over **Tailscale** — no public ports.

This repo currently implements **M0**: the backend, unified data model, and the
client wired to the API (replacing the old browser `window.storage`).

```
server/   Express + node:sqlite API (the brain). No native deps.
client/   Vite + React app (thin client).
```

## Run it locally (dev)

Two terminals:

```bash
# 1) backend  → http://localhost:4000
cd server && npm install && npm start

# 2) frontend → http://localhost:5173 (proxies /api to :4000)
cd client && npm install && npm run dev
```

Requires **Node ≥ 22.5** (for the built-in `node:sqlite`).

## Run it as one server (prod / on the mini PC)

Build the client once; the server then serves it at `/`:

```bash
cd client && npm install && npm run build
cd ../server && npm install && npm start      # http://0.0.0.0:4000
```

Open `http://<mini-pc-ip>:4000`. The DB lives at `server/data/tsumiki.db`
(override with `TSUMIKI_DB`). Port via `PORT`, bind host via `HOST`.

## Reach it from your phone, securely (Tailscale)

1. Install Tailscale on the mini PC and your phone; sign into the same tailnet.
2. On the phone, open `http://<mini-pc-tailscale-ip>:4000`.

No port-forwarding, no public URL — the server is only reachable by your own
devices on the encrypted tailnet.

## Back up your data

The whole database is one file. A nightly copy is plenty:

```bash
# crontab -e  (on the mini PC)
0 2 * * *  cp ~/tsumiki/server/data/tsumiki.db ~/tsumiki/backups/tsumiki-$(date +\%F).db
```

## API (M0)

| Method | Path           | Purpose                                            |
|--------|----------------|----------------------------------------------------|
| GET    | `/api/health`  | liveness check                                     |
| GET    | `/api/state`   | full unified model                                 |
| PUT    | `/api/state`   | replace full model (the client's "save")           |
| POST   | `/api/migrate` | import old `window.storage` JSON → unified model   |

## Roadmap

M0 (done) → M1 profile/setup → **M2 allocation engine + "Your Plan"** (MVP) →
M3 fast logging → M4 tracking → M5 motivation → M6 insight. Details in `SPEC.md` §3.
