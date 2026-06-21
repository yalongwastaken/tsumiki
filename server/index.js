// index.js — the mini-PC brain. Express API + serves the built client.
// Bind to 0.0.0.0 so it's reachable over the LAN / Tailscale (never public — see SPEC.md §12).
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { getState, putState, validateState, ConflictError } from "./db.js";
import { migrateLegacy } from "./migrate.js";
import { buildPlan } from "./engine.js";

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
  if (bad) return res.status(400).json({ error: bad });
  try {
    res.json(putState(body, body.rev));
  } catch (e) {
    if (e instanceof ConflictError) return res.status(409).json({ error: e.message, state: getState() });
    res.status(400).json({ error: String(e.message || e) });
  }
});

// the allocation engine — "where should this money go?" (SPEC §1.5)
app.get("/api/plan", (req, res) => {
  const state = getState();
  const sources = state.profile.incomeSources || [];
  const typical = sources.length
    ? sources.reduce((s, x) => s + (x.typicalMonthly || 0), 0)
    : (state.profile.typicalIncome ?? 0);
  const income = req.query.income != null ? Number(req.query.income) : typical;
  res.json(buildPlan(state, income));
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
