// push.test.js — web-push reminders: subscription storage, the privacy-preserving
// daily digest, and the once-per-day scheduler tick. The actual network send is
// web-push's job; everything around it is covered here.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TSUMIKI_DB = `/tmp/tsumiki-push-${process.pid}-${Date.now()}.db`;

const db = await import("../lib/db.js");
const push = await import("../lib/push.js");

const SUB = {
  endpoint: "https://push.example/device-1",
  keys: { p256dh: "BPub", auth: "authsecret" },
};

test("vapidKeys generates once and persists", () => {
  const first = push.vapidKeys();
  assert.ok(first.publicKey && first.privateKey);
  assert.deepEqual(push.vapidKeys(), first); // stable across calls
});

test("subscriptions add idempotently by endpoint and remove cleanly", () => {
  assert.equal(push.addSubscription(SUB).count, 1);
  assert.equal(push.addSubscription(SUB).count, 1); // same endpoint → replaced, not duplicated
  assert.equal(push.addSubscription({ ...SUB, endpoint: "https://push.example/2" }).count, 2);
  assert.equal(push.removeSubscription("https://push.example/2").removed, 1);
  assert.equal(push.subscriptionCount(), 1);
  assert.match(push.addSubscription({}).error, /endpoint/); // malformed rejected
});

test("todayDigest counts bills due + paydays today — no names, no amounts", () => {
  const state = {
    profile: {
      bills: [
        { id: "b1", name: "Rent", amount: 1800, dayOfMonth: 15 },
        { id: "b2", name: "Internet", amount: 80, dayOfMonth: 16 },
      ],
      incomeSources: [{ id: "s1", name: "Job", payday: "2026-07-15", cadence: "monthly" }],
    },
    settings: {},
  };
  const d = push.todayDigest(state, new Date(2026, 6, 15)); // July 15
  assert.equal(d.bills, 1);
  assert.equal(d.paydays, 1);
  assert.doesNotMatch(d.body, /Rent|1800|Job/); // privacy: generic counts only
  assert.match(d.body, /payday today/);
  assert.match(d.body, /1 bill due today/);
  // a quiet day → null (no push at all)
  assert.equal(push.todayDigest(state, new Date(2026, 6, 3)), null);
});

test("todayDigest respects the Settings → Reminders toggles", () => {
  const state = {
    profile: { bills: [{ id: "b1", name: "Rent", amount: 1800, dayOfMonth: 15 }] },
    settings: { reminders: { bill: false } },
  };
  assert.equal(push.todayDigest(state, new Date(2026, 6, 15)), null);
});

test("pushTick sends at most once per day, only after the morning hour", async () => {
  let sends = 0;
  const webpush = (await import("web-push")).default;
  const orig = webpush.sendNotification;
  webpush.sendNotification = async () => {
    sends++;
  };
  try {
    db.putState({ profile: { bills: [{ id: "b1", name: "Rent", amount: 1, dayOfMonth: 15 }] } });
    // before 8am → no send
    assert.equal(await push.pushTick(new Date(2026, 6, 15, 6)), null);
    // 9am → sends to the registered device
    const out = await push.pushTick(new Date(2026, 6, 15, 9));
    assert.equal(out.sent, 1);
    assert.equal(sends, 1);
    // later the same day → already sent
    assert.equal(await push.pushTick(new Date(2026, 6, 15, 12)), null);
    assert.equal(sends, 1);
  } finally {
    webpush.sendNotification = orig;
  }
});

test("a 410 from the push service prunes the dead subscription", async () => {
  const webpush = (await import("web-push")).default;
  const orig = webpush.sendNotification;
  webpush.sendNotification = async () => {
    const e = new Error("gone");
    e.statusCode = 410;
    throw e;
  };
  try {
    assert.equal(push.subscriptionCount(), 1);
    const out = await push.sendToAll({ title: "t", body: "b" });
    assert.equal(out.pruned, 1);
    assert.equal(push.subscriptionCount(), 0);
  } finally {
    webpush.sendNotification = orig;
  }
});
