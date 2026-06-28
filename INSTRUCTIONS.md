# Tsumiki — running it & installing on your phone

A plain-English guide to: running the app on your mini PC, installing it on your
iPhone, keeping it running, and updating it later. (For the architecture/feature
overview, see [`README.md`](./README.md).)

> **The model in one line:** the mini PC runs everything and holds your data; your
> phone is just a thin client that reaches it privately over Tailscale.

---

## 1. One-time setup (on the mini PC)

**Prerequisites:** [Node.js](https://nodejs.org) **22.12 or newer** and npm. Check with:

```bash
node --version    # should print v22.12.x or higher
```

**Get the code onto the mini PC** (clone your repo, or copy the `tsumiki/` folder), then:

```bash
cd tsumiki
make install      # installs dependencies for the root tooling, client, and server
```

That's it for setup. Nothing to compile, no database to configure — the database is
a single SQLite file created automatically on first run.

---

## 2. Run it

### The simple way (build once, then serve everything)

```bash
make start
```

This builds the web app and starts the server on **port 4000**, serving both the API
and the app. Open `http://localhost:4000` on the mini PC to confirm it works.

Leave that terminal running and it stays up. To stop it, press `Ctrl-C`.

### Keep it running 24/7 (recommended)

So it survives reboots and you don't need a terminal open, run it as a background
service. On a Linux mini PC with systemd, create `/etc/systemd/system/tsumiki.service`:

```ini
[Unit]
Description=Tsumiki money coach
After=network.target

[Service]
Type=simple
# adjust the path + user to wherever you put the repo
WorkingDirectory=/home/youruser/tsumiki/server
ExecStart=/usr/bin/node --experimental-sqlite index.js
Restart=on-failure
Environment=PORT=4000
Environment=HOST=0.0.0.0

[Install]
WantedBy=multi-user.target
```

Then build the app once and enable the service:

```bash
make build                          # produces client/dist that the server serves
sudo systemctl enable --now tsumiki
sudo systemctl status tsumiki       # check it's running
```

> Note: the server only serves the web app if `client/dist` exists, so always run
> `make build` before (re)starting the service.

### Configuration (optional environment variables)

| Variable            | Default                  | What it does                                         |
| ------------------- | ------------------------ | ---------------------------------------------------- |
| `PORT`              | `4000`                   | port the server listens on                           |
| `HOST`              | `0.0.0.0`                | bind address (`0.0.0.0` = reachable over Tailscale)  |
| `TSUMIKI_DB`        | `server/data/tsumiki.db` | where the SQLite database lives                      |
| `TSUMIKI_NEWS_FEED` | _(unset → off)_          | optional public RSS/Atom URL for the money-news card |

Set them in the systemd file (`Environment=...`) or before `make start`
(`PORT=8080 make start`).

---

## 3. Reach it privately with Tailscale

The server has **no public ports** — the only way in is your own private tailnet.

1. Install **Tailscale** on the mini PC and sign in: `tailscale up`.
2. Install the **Tailscale app** on your iPhone and sign into the **same account**.
3. (Recommended) turn on **MagicDNS** in the Tailscale admin console. Now the mini PC
   has a friendly name, so instead of an IP you can use something like
   `http://minipc:4000`.

Find the mini PC's Tailscale address any time with `tailscale ip -4` (or use its
MagicDNS name).

---

## 4. Install it on your iPhone (as an app)

Tsumiki is an installable web app (PWA), so it gets a home-screen icon and opens
fullscreen — no App Store, no download.

1. Make sure **Tailscale is connected** on the phone (toggle it on).
2. Open **Safari** and go to `http://minipc:4000` (or `http://<tailscale-ip>:4000`).
3. Tap the **Share** button (the square with an up-arrow).
4. Scroll down and tap **Add to Home Screen**, then **Add**.

You'll get a **Tsumiki** icon on your home screen. Tapping it launches the app
fullscreen, with the status bar tinted to match light/dark mode. It looks and feels
like a native app.

> First launch needs Tailscale connected (that's how it reaches your mini PC). The
> app shell is cached after the first visit, so it opens instantly afterward, but it
> still needs the connection to load your live data.

_(Android is the same idea: open in Chrome → ⋮ menu → **Install app**.)_

---

## 5. Day-to-day use

- Tap the **+** button (bottom-right) from any screen to log spending, income, or a
  contribution in a few taps. No spending today? Use **"Log a no-spend day."**
- **Home** is your dashboard; **Plan** tells you where each dollar should go; **Activity**
  is your history; **Grow** has projections; **Goals** has streaks & milestones;
  **Accounts** / **Settings** hold your setup.
- Your data lives only on the mini PC. As long as Tailscale is on, every device sees
  the same up-to-date numbers.

---

## 6. Updating Tsumiki later

When you change the code (or pull a new version), here's the full update flow.

### On the mini PC

```bash
cd tsumiki
git pull                 # if you track it in git (skip if you edit in place)
make install             # only needed if dependencies changed
make build               # rebuild the web app (new client/dist)
sudo systemctl restart tsumiki     # restart the server to pick it up
#   …or, if you run it manually: Ctrl-C, then `make start` again
```

Before shipping a change it's worth a quick check:

```bash
make test         # all unit tests (engine, insights, paydays, db, …)
make test-smoke   # renders the whole UI headlessly to catch blank-screen bugs
make lint         # ESLint
make format       # Prettier (auto-formats)
```

### On your phone (picking up the update)

The app checks for the freshest page every time you open it online, so updates
usually appear on the next launch. If you still see an old version:

- Pull-to-refresh, or fully close and reopen the app, **or**
- In Safari, do a hard refresh, **or**
- Remove the home-screen icon and re-add it (Section 4).

You **do not** need to reinstall for normal updates — only if you want a clean reset.

> Why this works: the app always fetches fresh HTML when online (so it never gets
> stuck on an old version), and only the unchanged pieces are served from cache.

### A common gotcha

If a tab (especially **Grow**) ever errors with _"error loading dynamically imported
module,"_ it means the server is serving a stale build. Fix: re-run `make build` and
restart the server, then hard-refresh the phone. (Don't run `make clean` while the
server is live — it deletes the built app.)

---

## 7. Back up your data

The whole database is one file, so a copy is a complete backup:

```bash
make backup       # writes backups/tsumiki-YYYY-MM-DD.db  (PLAINTEXT)
```

That copy is **unencrypted** — fine on an encrypted disk, but if a backup ever leaves
the machine, make an encrypted one instead (AES-256, needs `gpg`):

```bash
TSUMIKI_BACKUP_PASSPHRASE='a-strong-passphrase' make backup-enc
# → backups/tsumiki-YYYY-MM-DD.db.gpg
```

Automate it nightly with cron on the mini PC (`crontab -e`):

```cron
0 2 * * *  cd /home/youruser/tsumiki && make backup
```

To restore: stop the server, then copy a backup over `server/data/tsumiki.db` (for an
encrypted one, `gpg -d -o server/data/tsumiki.db backups/tsumiki-YYYY-MM-DD.db.gpg`).

**Starting over:** to wipe everything and reset to a clean slate, go to
**Settings → Danger zone → Delete all my data** (export first if you might want it
back). This clears all accounts, transactions, and your profile, and reopens the
setup wizard.

---

## 8. Keep it secure

Your finances live in one file on your mini PC. Tsumiki is privacy-respecting by design
— no telemetry, and the news/price features are off unless you turn them on — but a few
operational choices are what actually keep your data safe. In order of importance:

1. **Turn on the app lock.** In **Settings → App lock**, set a strong password (do it
   over `http://localhost:4000` on the mini PC itself, or over your Tailscale address —
   it won't let you set one over a plain `http://<lan-ip>` connection). **It's off by
   default, which means an unlocked instance has no password at all** — anyone who can
   reach the server can see everything.
2. **Only reach it over Tailscale** (Section 3), never a plain `http://<lan-ip>:4000`
   address. Tailscale encrypts the connection; plain LAN http does not. Behind a TLS
   reverse proxy instead? Set `TSUMIKI_TRUST_PROXY=1`.
3. **Encrypt your backups** with `make backup-enc` (Section 7) before any of them leave
   the machine, and keep `server/data/` on an encrypted disk — the database file itself
   is not encrypted.
4. **Limit who can reach it** with a Tailscale ACL (or host firewall) so only your own
   devices can hit the port.

Two things to know: **"Blur money"** (the eye icon) only hides amounts on screen — it's
for shoulder-surfing, not access control. And the app does **no encryption itself** — it
relies on Tailscale/your disk for that.

For the full threat model and the reasoning behind all of this, see
[`SECURITY.md`](./SECURITY.md).

---

## 9. Quick reference

| I want to…               | Command                                        |
| ------------------------ | ---------------------------------------------- |
| Install dependencies     | `make install`                                 |
| Develop with hot-reload  | `make dev` (backend :4000 + frontend :5173)    |
| Build + run for real     | `make start`                                   |
| Just rebuild the web app | `make build`                                   |
| Run the tests            | `make test` / `make test-smoke`                |
| Back up the database     | `make backup`                                  |
| Encrypted backup         | `TSUMIKI_BACKUP_PASSPHRASE=… make backup-enc`  |
| Lock the app / privacy   | Settings → App lock · eye icon to blur amounts |
| See all commands         | `make help`                                    |
