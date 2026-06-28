# Security & your data

Tsumiki is a **single-user, self-hosted** money app. It's designed to run on a machine
you control (e.g. a mini PC) and be reached privately from your own devices over
[Tailscale](https://tailscale.com). This document is an honest account of how your
financial data is protected, what the real residual risks are, and how to harden it.

## The short version

For its intended setup — one user, reached over a private tailnet — it's sensibly built
and notably privacy-respecting. Your real exposure comes down to **operational choices**,
not code flaws:

1. The **app lock is off by default**, and the server listens on all interfaces — so an
   instance with no password set has **no authentication**; anyone who can reach the port
   can read and change everything.
2. **Data is not encrypted at rest** — the database file (and plain backups) are readable
   by anyone who gets the file.
3. The app **does no TLS itself** — encryption in transit relies on Tailscale or a TLS
   reverse proxy. Plain-LAN `http://` is sniffable.

Do these three things and you're in good shape: **set the app lock**, **stay on
Tailscale/TLS**, and **encrypt the DB file and its backups**.

## What protects your data

- **Local-only storage.** Everything lives in one SQLite file on your machine
  (`server/data/tsumiki.db`, override with `TSUMIKI_DB`). No cloud, ever. The file is
  git-ignored so it's never committed.
- **No telemetry / analytics / third-party calls.** The only outbound traffic is the
  opt-in news and price sync. Both are **off by default**; when enabled, only your held
  **ticker symbols**, the operator-configured **feed URL**, and (if you set one) your own
  **Finnhub API key** leave the device — never your balances, transactions, or profile.
  Outbound fetches are time- and size-capped.
- **App lock (optional, but strong when on).** scrypt-hashed password, an HMAC-signed
  session token in an HttpOnly/SameSite=Strict cookie (Secure over HTTPS), a 7-day
  trusted-device window, and a session secret that **rotates on every password change**
  (invalidating other devices). Setting or entering the password is only allowed over a
  **secure origin** (HTTPS / Tailscale / `localhost`), so a credential never crosses
  sniffable plain-LAN http. Login attempts are **throttled** (lockout after repeated
  wrong guesses). The auth gate protects all `/api/*` routes (the password survives a
  data reset).
- **Web hardening.** Same-origin (CSRF / DNS-rebinding) guard on all mutating requests,
  a request body-size cap, full input validation on every write, a ticker-charset guard
  (tickers are interpolated into the price URL), feed links restricted to `http(s)`, the
  `X-Powered-By` header disabled, and generic non-leaking error messages. The service
  worker never caches `/api` responses.

## Residual risks (be aware)

- **No encryption at rest.** The SQLite file is plaintext. Anyone who obtains it — a
  stolen disk, a synced/cloud backup, another user account on the box — reads all your
  finances. `make backup` is a plaintext copy; use `make backup-enc` (below).
- **No built-in TLS.** The server speaks plain HTTP and binds `0.0.0.0:4000` by default.
  Confidentiality in transit depends entirely on Tailscale (WireGuard) or a TLS proxy.
  Opening it over `http://<lan-ip>:4000` exposes all traffic to anyone on that network.
- **App lock off by default = no auth.** Until you set a password, anyone who can reach
  the port has full read/write access. This is a defensible default for a private
  tailnet, but understand it's a true no-auth state.
- **"Blur money" is visual-only.** It hides amounts on screen but the real numbers stay
  in the page — a screen reader, "inspect element", or copy-paste still sees them. It's
  shoulder-surfing protection, not access control.
- **Minor:** the password minimum is modest; there's no remote login without a secure
  origin, and login is throttled, but choose a strong password anyway.

## Recommended hardening (by impact)

1. **Set the app lock** with a strong password (Settings → App lock, over `localhost`
   or HTTPS). Turns the instance from no-auth into authenticated.
2. **Only reach it over Tailscale** (or a TLS reverse proxy with `TSUMIKI_TRUST_PROXY=1`)
   — never plain-LAN http. Optionally bind `HOST=127.0.0.1` and put the proxy in front.
3. **Encrypt data at rest + backups.** Keep `server/data/` on an encrypted volume
   (LUKS / FileVault) and use `make backup-enc` (AES-256 via gpg) for any backup that
   might leave the machine.
4. **Restrict the port** to your own devices with a Tailscale ACL or host firewall.

## Reporting

This is a personal project. If you spot a security issue, open an issue (without
sensitive details) or note it via the app's feedback.
