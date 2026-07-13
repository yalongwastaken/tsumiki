// push.js — opt-in Web Push reminders ("the coach taps you on the shoulder").
// A device subscribes from Settings → Notifications; each morning the server checks
// whether anything needs attention TODAY (bills due, paydays) and sends one push.
//
// Privacy: the payload is deliberately GENERIC — counts only, no names, no amounts —
// because push payloads transit the browser vendor's push service (FCM/Mozilla/APNs).
// Details stay on your device: tapping the notification opens the app, which shows
// the real reminders. No subscriptions → no outbound calls at all (opt-in stays true).
//
// VAPID keys are generated once and persisted; subscriptions live in the meta table
// and survive resetAll (they're device registrations, not financial data). A push
// that returns 404/410 means the browser revoked the subscription — it's pruned.
import webpush from "web-push";
import {
  getState,
  getVapid,
  setVapid,
  getPushSubs,
  setPushSubs,
  getPushState,
  setPushState,
} from "./db.js";
// pure calendar logic shared with the client (no browser APIs — safe to import)
import { billDueDay } from "../../client/src/lib/plan/billdates.js";
import { paydaysInMonth } from "../../client/src/lib/plan/paydays.js";

const CHECK_EVERY_MS = 15 * 60 * 1000; // scheduler granularity
const SEND_AT_HOUR = 8; // local morning digest

/** Lazily create + persist the VAPID keypair (first subscribe generates it). */
export function vapidKeys() {
  let keys = getVapid();
  if (!keys?.publicKey || !keys?.privateKey) {
    keys = webpush.generateVAPIDKeys();
    setVapid(keys);
  }
  return keys;
}

/** Register a device subscription (idempotent by endpoint). */
export function addSubscription(sub) {
  if (!sub?.endpoint || typeof sub.endpoint !== "string" || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { error: "subscription needs an endpoint and keys" };
  }
  const subs = getPushSubs().filter((s) => s.endpoint !== sub.endpoint);
  subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  setPushSubs(subs);
  return { ok: true, count: subs.length };
}

/** Remove a device subscription by endpoint. */
export function removeSubscription(endpoint) {
  const subs = getPushSubs();
  const kept = subs.filter((s) => s.endpoint !== endpoint);
  setPushSubs(kept);
  return { ok: true, removed: subs.length - kept.length };
}

export const subscriptionCount = () => getPushSubs().length;

/**
 * What needs attention today — counts only (see privacy note above). Pure given
 * (state, date). Respects the same Settings → Reminders toggles the Home card uses.
 * @returns {{bills:number, paydays:number, title:string, body:string}|null}
 */
export function todayDigest(state, today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const day = today.getDate();
  const prefs = state.settings?.reminders || {};
  let bills = 0;
  if (prefs.bill !== false) {
    for (const b of state.profile?.bills || []) {
      if (billDueDay(b, y, m) === day) {
        bills++;
      }
    }
  }
  let paydays = 0;
  if (prefs.payday !== false) {
    for (const s of state.profile?.incomeSources || []) {
      if (s.payday && paydaysInMonth(s.payday, s.cadence, y, m).includes(day)) {
        paydays++;
      }
    }
  }
  if (!bills && !paydays) {
    return null;
  }
  const parts = [];
  if (paydays) {
    parts.push(paydays === 1 ? "payday today" : `${paydays} paydays today`);
  }
  if (bills) {
    parts.push(bills === 1 ? "1 bill due today" : `${bills} bills due today`);
  }
  return {
    bills,
    paydays,
    title: "Tsumiki",
    body: `${parts.join(" · ")} — open the app for details.`,
  };
}

/** Send `payload` to every subscription, pruning ones the browser revoked. */
export async function sendToAll(payload) {
  const subs = getPushSubs();
  if (!subs.length) {
    return { sent: 0, pruned: 0 };
  }
  const keys = vapidKeys();
  webpush.setVapidDetails("mailto:tsumiki@localhost", keys.publicKey, keys.privateKey);
  const body = JSON.stringify(payload);
  let sent = 0;
  const dead = new Set();
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, body, { TTL: 12 * 60 * 60 });
      sent++;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        dead.add(sub.endpoint); // expired/revoked — clean it up
      } else {
        console.warn("push: send failed:", e?.statusCode || e?.message || e);
      }
    }
  }
  if (dead.size) {
    setPushSubs(subs.filter((s) => !dead.has(s.endpoint)));
  }
  return { sent, pruned: dead.size };
}

/** One scheduler tick: after SEND_AT_HOUR local, send at most one digest per day. */
export async function pushTick(now = new Date()) {
  if (!getPushSubs().length || now.getHours() < SEND_AT_HOUR) {
    return null;
  }
  const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (getPushState().lastSentDay === dayKey) {
    return null;
  }
  const digest = todayDigest(getState(), now);
  setPushState({ lastSentDay: dayKey }); // checked today — quiet days send nothing
  if (!digest) {
    return null;
  }
  const out = await sendToAll(digest);
  console.log(`push: sent morning digest to ${out.sent} device(s)`);
  return out;
}

/** Start the daily reminder push loop (no-op work when nothing is subscribed). */
export function schedulePush() {
  pushTick().catch(() => {});
  return setInterval(() => pushTick().catch(() => {}), CHECK_EVERY_MS);
}
