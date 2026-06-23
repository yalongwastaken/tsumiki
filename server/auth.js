// auth.js — optional single-password "app lock" with 7-day trusted-device sessions.
// OFF until a password is set (the app stays open by default). Passwords are
// scrypt-hashed; a session is an HMAC-signed token in an HttpOnly cookie. Setting a
// password AND logging in both require a secure origin (HTTPS / Tailscale-serve /
// localhost) so a credential is never sent over sniffable plain-LAN http — which is
// the exact threat (someone on your wifi). Dependency-free: cookies parsed by hand.
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { getAuth, setAuth } from "./db.js";

const COOKIE = "tsumiki_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // trusted-device window
const KEYLEN = 32;
const MIN_LEN = 6;

/** Whether a password is currently set. */
export const authEnabled = () => !!getAuth();

// ── password hashing (scrypt; its cost also rate-limits guessing) ───────────────
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, KEYLEN).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, rec) {
  if (!rec || typeof password !== "string") {
    return false;
  }
  const got = scryptSync(password, rec.salt, KEYLEN);
  const want = Buffer.from(rec.hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

// ── session tokens (HMAC-signed; secret persisted with the auth record) ─────────
function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verifyToken(token, secret) {
  if (!token || !secret) {
    return null;
  }
  const dot = token.lastIndexOf(".");
  if (dot < 0) {
    return null;
  }
  const body = token.slice(0, dot);
  const mac = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(createHmac("sha256", secret).update(body).digest("base64url"));
  if (mac.length !== want.length || !timingSafeEqual(mac, want)) {
    return null;
  }
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p && p.exp && Date.now() <= p.exp ? p : null;
  } catch {
    return null;
  }
}

// ── cookies + secure-origin detection ───────────────────────────────────────────
function readCookie(req, name) {
  const raw = req.headers?.cookie;
  if (!raw) {
    return null;
  }
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}
const hostname = (req) => (req.headers?.host || "").split(":")[0];
const isLocalhost = (req) => ["localhost", "127.0.0.1", "::1"].includes(hostname(req));
/** Served over a connection we trust to be private: direct TLS (`req.secure`),
 * localhost (the box itself / dev), or — only when TSUMIKI_TRUST_PROXY is set — an
 * `x-forwarded-proto: https` from a TLS-terminating proxy like `tailscale serve`.
 * The header is NOT trusted by default, so a plain-LAN client can't spoof it to set
 * or use a password over sniffable http. */
export function isSecureReq(req) {
  if (req.secure || isLocalhost(req)) {
    return true;
  }
  if (process.env.TSUMIKI_TRUST_PROXY) {
    const proto = String(req.headers?.["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim();
    return proto === "https";
  }
  return false;
}
function setSessionCookie(req, res, token) {
  const attrs = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ];
  // Secure over real https; omit on localhost-http so dev/login on the box still works
  if (isSecureReq(req) && !isLocalhost(req)) {
    attrs.push("Secure");
  }
  res.setHeader("Set-Cookie", attrs.join("; "));
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

/** True when the request carries a valid session (or no password is set at all). */
export function isAuthed(req) {
  const auth = getAuth();
  if (!auth) {
    return true;
  }
  return !!verifyToken(readCookie(req, COOKIE), auth.secret);
}

// ── gate middleware: when locked, require a session for /api/* (except auth+health);
// static assets / the SPA shell always load so the login screen can render. ─────────
export function authGate(req, res, next) {
  if (!getAuth()) {
    return next();
  }
  // match case-INsensitively: Express routes are case-insensitive by default, so a
  // case-sensitive gate compare (e.g. /API/state) would slip past while still hitting
  // the lowercase route handler — a full bypass. Normalize before matching.
  const path = req.path.toLowerCase();
  if (path === "/api/health" || path.startsWith("/api/auth/")) {
    return next();
  }
  if (!path.startsWith("/api/")) {
    return next();
  }
  if (isAuthed(req)) {
    return next();
  }
  return res.status(401).json({ error: "locked" });
}

// ── route handlers ──────────────────────────────────────────────────────────────
export function authStatus(req, res) {
  res.json({ enabled: authEnabled(), authed: isAuthed(req), secure: isSecureReq(req) });
}
export function authLogin(req, res) {
  const auth = getAuth();
  if (!auth) {
    return res.json({ ok: true, enabled: false });
  }
  if (!isSecureReq(req)) {
    return res.status(400).json({ error: "open over HTTPS or Tailscale to sign in" });
  }
  if (!verifyPassword(req.body?.password, auth)) {
    return res.status(401).json({ error: "wrong password" });
  }
  setSessionCookie(req, res, sign({ exp: Date.now() + SESSION_MS }, auth.secret));
  res.json({ ok: true });
}
export function authLogout(_req, res) {
  clearSessionCookie(res);
  res.json({ ok: true });
}
/** Set / change / clear the password. Changing or clearing needs the current
 * password; enabling needs a secure origin. Rotates the session secret on every
 * change so other devices' sessions are invalidated. */
export function authSet(req, res) {
  const { password, current } = req.body || {};
  const existing = getAuth();
  if (existing && !verifyPassword(current, existing)) {
    return res.status(401).json({ error: "wrong current password" });
  }
  if (password == null || password === "") {
    setAuth(null); // disable the lock
    clearSessionCookie(res);
    return res.json({ ok: true, enabled: false });
  }
  if (!isSecureReq(req)) {
    return res
      .status(400)
      .json({ error: "open over HTTPS or Tailscale before setting a password" });
  }
  if (String(password).length < MIN_LEN) {
    return res.status(400).json({ error: `password must be at least ${MIN_LEN} characters` });
  }
  const { salt, hash } = hashPassword(password);
  const secret = randomBytes(32).toString("hex"); // rotate → old sessions die
  setAuth({ salt, hash, secret });
  setSessionCookie(req, res, sign({ exp: Date.now() + SESSION_MS }, secret)); // log in this device
  res.json({ ok: true, enabled: true });
}

// test-only seam: re-export the internals worth unit-testing without a live server
export const _internals = { hashPassword, verifyPassword, sign, verifyToken, readCookie };
