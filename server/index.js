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

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "5mb" }));

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
    res.status(400).json({ error: String(e.message || e) });
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
    res.status(400).json({ error: String(e.message || e) });
  }
});

// the allocation engine — "where should this money go?"
app.get("/api/plan", (req, res) => {
  const state = getState();
  const income = req.query.income != null ? Number(req.query.income) : typicalIncome(state);
  const windfall = req.query.windfall === "1" || req.query.windfall === "true";
  res.json(buildPlan(state, income, { strategy: req.query.strategy, windfall }));
});

// opt-in money-news headlines (off unless TSUMIKI_NEWS_FEED is set)
app.get("/api/news", async (_req, res) => res.json(await getNews()));

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
    res.json(putState(body));
  } catch (e) {
    // no rev check — deliberate replace
    res.status(400).json({ error: String(e.message || e) });
  }
});

// one-time import of old window.storage JSON → unified model
app.post("/api/migrate", (req, res) => {
  try {
    res.json(putState(migrateLegacy(req.body || {})));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// ── serve the built client (client/dist) if present ────────────────────────────
const dist = join(__dirname, "..", "client", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(join(dist, "index.html")));
}

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => console.log(`tsumiki server on http://${HOST}:${PORT}`));

scheduleNews(); // no-op unless TSUMIKI_NEWS_FEED is configured
