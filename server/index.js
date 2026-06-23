// index.js — the mini-PC brain. Express API + serves the built client.
// Bind to 0.0.0.0 so it's reachable over the LAN / Tailscale (never exposed publicly).
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import {
  getState,
  putState,
  validateState,
  validateTransaction,
  addTransaction,
  resetAll,
  ConflictError,
} from "./db.js";
import { migrateLegacy } from "./migrate.js";
import { buildPlan, typicalIncome } from "./engine.js";
import { getNews, scheduleNews } from "./news.js";
import { getPrices, refreshPrices, schedulePrices } from "./prices.js";
import { authGate, authStatus, authLogin, authLogout, authSet } from "./auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by"); // don't advertise the framework
app.use(express.json({ limit: "5mb" }));

// CSRF / DNS-rebinding guard: a browser sends Origin on cross-site writes. If a
// mutating request carries an Origin whose host isn't ours, reject it — this stops
// a malicious page on the tailnet from POSTing /api/reset etc. Same-origin app
// fetches (Origin === Host) and non-browser tools (no Origin) pass through.
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  const origin = req.get("origin");
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return res.status(403).json({ error: "bad origin" });
    }
    if (host !== req.get("host")) {
      return res.status(403).json({ error: "cross-origin request blocked" });
    }
  }
  next();
});

// wrap an async route so a rejected promise becomes a clean 500, not a hang
const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// optional app lock: when a password is set, gate /api/* (except auth + health) on a
// valid 7-day session. No-op until the user enables it. See auth.js.
app.use(authGate);

// ── auth (always reachable so the login screen works while locked) ──────────────
app.get("/api/auth/status", authStatus);
app.post("/api/auth/login", authLogin);
app.post("/api/auth/logout", authLogout);
app.post("/api/auth/set", authSet);

// ── API ───────────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// full model (client loads this once on boot)
app.get("/api/state", (_req, res) => res.json(getState()));

// pragmatic full-state replace (client's "save" — see db.js)
app.put("/api/state", (req, res) => {
  const body = req.body || {};
  const bad = validateState(body);
  if (bad) {
    return res.status(400).json({ error: bad });
  }
  try {
    res.json(putState(body, body.rev));
  } catch (e) {
    if (e instanceof ConflictError) {
      return res.status(409).json({ error: e.message, state: getState() });
    }
    console.warn("PUT /api/state failed:", e.message);
    res.status(400).json({ error: "could not save — check your data" });
  }
});

// append a single transaction (the common case — no full-state PUT, no rev clash)
app.post("/api/transactions", (req, res) => {
  const t = req.body || {};
  const bad = validateTransaction(t);
  if (bad) {
    return res.status(400).json({ error: bad });
  }
  try {
    res.json(addTransaction(t));
  } catch (e) {
    console.warn("POST /api/transactions failed:", e.message);
    res.status(400).json({ error: "could not log that transaction" });
  }
});

// the allocation engine — "where should this money go?"
app.get("/api/plan", (req, res) => {
  const state = getState();
  // coerce ?income, falling back to typical when it's missing or not a finite number
  const q = Number(req.query.income);
  const income = req.query.income != null && Number.isFinite(q) ? q : typicalIncome(state);
  const windfall = req.query.windfall === "1" || req.query.windfall === "true";
  res.json(buildPlan(state, income, { strategy: req.query.strategy, windfall }));
});

// opt-in money-news headlines (off unless TSUMIKI_NEWS_FEED is set)
app.get(
  "/api/news",
  asyncH(async (_req, res) => res.json(await getNews())),
);

// opt-in stock prices for held tickers (off unless TSUMIKI_PRICES is set)
app.get(
  "/api/prices",
  asyncH(async (_req, res) => res.json(await getPrices())),
);

// force a price refresh now (the "sync now" button); no-op shape when disabled
app.post(
  "/api/prices/refresh",
  asyncH(async (_req, res) => {
    await refreshPrices();
    res.json(await getPrices());
  }),
);

// wipe everything and start fresh (the Settings "danger zone")
app.post("/api/reset", (_req, res) => res.json(resetAll()));

// data export (download the whole dataset) + import (validated full replace)
app.get("/api/export", (_req, res) => {
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="tsumiki-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  res.json(getState());
});
app.post("/api/import", (req, res) => {
  const body = req.body || {};
  const bad = validateState(body);
  if (bad) {
    return res.status(400).json({ error: bad });
  }
  try {
    res.json(putState(body)); // no rev check — deliberate replace
  } catch (e) {
    console.warn("POST /api/import failed:", e.message);
    res.status(400).json({ error: "import failed — file may be malformed" });
  }
});

// one-time import of old window.storage JSON → unified model
app.post("/api/migrate", (req, res) => {
  try {
    const migrated = migrateLegacy(req.body || {});
    // validate the migrated shape before it hits the NOT NULL columns
    const bad = validateState(migrated);
    if (bad) {
      return res.status(400).json({ error: bad });
    }
    res.json(putState(migrated));
  } catch (e) {
    console.warn("POST /api/migrate failed:", e.message);
    res.status(400).json({ error: "migration failed — data may be malformed" });
  }
});

// unknown API paths get a clean 404 (not the SPA shell)
app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

// ── serve the built client (client/dist) if present ────────────────────────────
const dist = join(__dirname, "..", "client", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(join(dist, "index.html")));
}

// terminal error handler — turns thrown/rejected route errors into a clean 500
// instead of an unhandled rejection (which would hang the request)
app.use((err, _req, res, _next) => {
  console.warn("unhandled route error:", err?.message || err);
  if (!res.headersSent) {
    // honor a client-error status (e.g. 413 oversized body, 400 malformed JSON)
    // instead of flattening every body-parser error to a 500
    const status = err?.status || err?.statusCode || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: status >= 400 && status < 500 ? "bad request" : "server error",
    });
  }
});

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => console.log(`tsumiki server on http://${HOST}:${PORT}`));

scheduleNews(); // no-op unless TSUMIKI_NEWS_FEED is configured
schedulePrices(); // no-op unless TSUMIKI_PRICES is enabled
