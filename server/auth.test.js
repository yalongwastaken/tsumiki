// auth.test.js — app-lock: hashing, signed sessions, secure-origin gating, the gate
// middleware, and set/login/logout handlers. Runs against a temp DB (set before import).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TSUMIKI_DB = `/tmp/tsumiki-auth-${process.pid}-${Date.now()}.db`;
process.env.TSUMIKI_TRUST_PROXY = "1"; // trust x-forwarded-proto (simulates Tailscale serve)

const auth = await import("./auth.js");
const { _internals: I } = auth;

const SECURE = { "x-forwarded-proto": "https", host: "box.tailnet.ts.net" };
function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(o) {
      this.body = o;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
}
const req = ({ headers = {}, body = {}, path = "/api/state", secure = false } = {}) => ({
  headers,
  body,
  path,
  secure,
});
const cookieFrom = (res) => (res.headers["Set-Cookie"] || "").split(";")[0]; // "name=token"
const next = () => {
  next.called = true;
};

test("hashPassword/verifyPassword: salted, correct, reject wrong + non-string", () => {
  const rec = I.hashPassword("hunter2");
  assert.ok(rec.salt && rec.hash && rec.hash !== "hunter2");
  assert.equal(I.verifyPassword("hunter2", rec), true);
  assert.equal(I.verifyPassword("Hunter2", rec), false);
  assert.equal(I.verifyPassword(12345, rec), false);
  assert.notEqual(I.hashPassword("x").salt, I.hashPassword("x").salt); // random salt
});

test("session token: verifies, rejects tamper + expiry", () => {
  const s = "secret-abc";
  const tok = I.sign({ exp: Date.now() + 10000 }, s);
  assert.ok(I.verifyToken(tok, s));
  assert.equal(I.verifyToken(tok, "other-secret"), null); // wrong secret
  assert.equal(I.verifyToken(tok + "x", s), null); // tampered mac
  assert.equal(I.verifyToken(I.sign({ exp: Date.now() - 1 }, s), s), null); // expired
  assert.equal(I.verifyToken("garbage", s), null);
});

test("isSecureReq: https / localhost yes, plain LAN no", () => {
  assert.equal(
    auth.isSecureReq(req({ headers: { "x-forwarded-proto": "https", host: "x" } })),
    true,
  );
  assert.equal(auth.isSecureReq(req({ headers: { host: "localhost:4000" } })), true);
  assert.equal(auth.isSecureReq(req({ headers: { host: "127.0.0.1:4000" } })), true);
  assert.equal(auth.isSecureReq(req({ headers: { host: "192.168.1.5:4000" } })), false);
});

test("x-forwarded-proto is NOT trusted unless TSUMIKI_TRUST_PROXY is set", () => {
  delete process.env.TSUMIKI_TRUST_PROXY;
  try {
    // a plain-LAN client can't spoof the header to look secure
    assert.equal(
      auth.isSecureReq(req({ headers: { "x-forwarded-proto": "https", host: "192.168.1.5" } })),
      false,
    );
    // localhost is still secure regardless of the flag
    assert.equal(auth.isSecureReq(req({ headers: { host: "localhost" } })), true);
  } finally {
    process.env.TSUMIKI_TRUST_PROXY = "1";
  }
});

test("gate matches case-insensitively (no /API/state bypass)", () => {
  // enable a lock, then hit an upper-cased API path with no cookie → must still 401
  const set = mockRes();
  auth.authSet(req({ headers: SECURE, body: { password: "gate-case-test" } }), set);
  assert.equal(auth.authEnabled(), true);
  for (const p of ["/API/state", "/Api/export", "/api/STATE", "/aPi/reset"]) {
    next.called = false;
    const res = mockRes();
    auth.authGate(req({ path: p }), res, next);
    assert.equal(res.statusCode, 401, `${p} should be gated`);
    assert.equal(next.called, false, `${p} should not pass through`);
  }
  // clean up so later tests start unlocked
  const clr = mockRes();
  auth.authSet(req({ headers: SECURE, body: { current: "gate-case-test", password: "" } }), clr);
  assert.equal(auth.authEnabled(), false);
});

test("disabled by default: open, status reports it, gate passes", () => {
  assert.equal(auth.authEnabled(), false);
  const res = mockRes();
  auth.authStatus(req({ headers: SECURE }), res);
  assert.deepEqual({ e: res.body.enabled, a: res.body.authed }, { e: false, a: true });
  next.called = false;
  auth.authGate(req(), mockRes(), next);
  assert.equal(next.called, true); // no password → pass through
});

test("can't enable over insecure origin", () => {
  const res = mockRes();
  auth.authSet(req({ headers: { host: "192.168.1.5" }, body: { password: "longenough" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(auth.authEnabled(), false);
});

test("enabling needs a 6+ char password (secure origin)", () => {
  const res = mockRes();
  auth.authSet(req({ headers: SECURE, body: { password: "short" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(auth.authEnabled(), false);
});

test("end-to-end: set → gate locks → login → gate passes → logout/clear", () => {
  // set a password over a secure origin; it logs in this device + sets a cookie
  let res = mockRes();
  auth.authSet(req({ headers: SECURE, body: { password: "correct horse" } }), res);
  assert.equal(res.body.enabled, true);
  assert.equal(auth.authEnabled(), true);
  const setCookie = res.headers["Set-Cookie"];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/); // non-localhost https → Secure flag
  const cookie = cookieFrom(res);

  // gate: no cookie → 401; valid cookie → pass
  res = mockRes();
  next.called = false;
  auth.authGate(req({ path: "/api/state" }), res, next);
  assert.equal(res.statusCode, 401);
  assert.equal(next.called, false);

  next.called = false;
  auth.authGate(req({ path: "/api/state", headers: { cookie } }), mockRes(), next);
  assert.equal(next.called, true);

  // health + auth endpoints stay reachable while locked
  next.called = false;
  auth.authGate(req({ path: "/api/health" }), mockRes(), next);
  assert.equal(next.called, true);

  // wrong password rejected; correct (secure) issues a fresh cookie
  res = mockRes();
  auth.authLogin(req({ headers: SECURE, body: { password: "nope" } }), res);
  assert.equal(res.statusCode, 401);
  res = mockRes();
  auth.authLogin(req({ headers: SECURE, body: { password: "correct horse" } }), res);
  assert.equal(res.body.ok, true);
  assert.ok(cookieFrom(res));

  // login refused over insecure origin
  res = mockRes();
  auth.authLogin(
    req({ headers: { host: "192.168.1.5" }, body: { password: "correct horse" } }),
    res,
  );
  assert.equal(res.statusCode, 400);
});

test("changing the password rotates the secret (old sessions die)", () => {
  // log in, capture an old cookie
  let res = mockRes();
  auth.authLogin(req({ headers: SECURE, body: { password: "correct horse" } }), res);
  const oldCookie = cookieFrom(res);
  // change password (needs current)
  res = mockRes();
  auth.authSet(
    req({ headers: SECURE, body: { current: "correct horse", password: "brand new pw" } }),
    res,
  );
  assert.equal(res.body.enabled, true);
  // old cookie no longer authenticates
  next.called = false;
  auth.authGate(req({ path: "/api/state", headers: { cookie: oldCookie } }), mockRes(), next);
  assert.equal(next.called, false);
});

test("wrong current password can't change/clear; correct current clears the lock", () => {
  let res = mockRes();
  auth.authSet(req({ headers: SECURE, body: { current: "wrong", password: "" } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(auth.authEnabled(), true);
  res = mockRes();
  auth.authSet(req({ headers: SECURE, body: { current: "brand new pw", password: "" } }), res);
  assert.equal(res.body.enabled, false);
  assert.equal(auth.authEnabled(), false); // lock disabled → app open again
});
