// Notifications.jsx — opt-in daily reminder push, per device. The server sends one
// generic morning digest (counts only — no names or amounts ever leave the device;
// see server/lib/push.js) when bills are due or a payday lands. Requires a secure
// origin (HTTPS / tailscale serve / localhost) and the installed service worker.
import { useState, useEffect } from "react";
import { card, label } from "./ui.jsx";
import { getPushKey, pushSubscribe, pushUnsubscribe } from "../lib/core/api.js";

const supported = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

// base64url VAPID key → the Uint8Array applicationServerKey the browser wants
function b64ToU8(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Settings card: enable/disable the daily reminder push for THIS device. */
export default function Notifications() {
  const [status, setStatus] = useState("loading"); // loading|unsupported|off|on|busy
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      if (!supported()) {
        setStatus("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        setStatus(sub ? "on" : "off");
      } catch {
        setStatus("off");
      }
    })();
  }, []);

  async function enable() {
    setStatus("busy");
    setErr("");
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        throw new Error("Notifications were blocked — allow them in your browser settings.");
      }
      // getRegistration (not .ready): .ready never resolves when no SW is registered
      // (dev mode, or a failed registration) and would hang this button on "…" forever
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        throw new Error(
          "No service worker here — use the installed app (production build) to enable this.",
        );
      }
      const { key } = await getPushKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToU8(key),
      });
      await pushSubscribe(sub.toJSON());
      setStatus("on");
    } catch (e) {
      setErr(String(e.message || e));
      setStatus("off");
    }
  }

  async function disable() {
    setStatus("busy");
    setErr("");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        await pushUnsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (e) {
      setErr(String(e.message || e));
      setStatus("on");
    }
  }

  return (
    <div className={card}>
      <div className={label + " mb-1"}>Notifications</div>
      <div className="text-xs text-slate-500 mb-3">
        A single morning push on days a bill is due or a payday lands — counts only, never names or
        amounts (details stay in the app). Per device; uses the reminder toggles above.
      </div>
      {status === "unsupported" ? (
        <div className="text-xs text-slate-500">
          Not available here — notifications need a secure address (your Tailscale HTTPS name or{" "}
          <span className="font-mono">localhost</span>) and the installed app (PWA).
        </div>
      ) : (
        <button
          onClick={status === "on" ? disable : enable}
          disabled={status === "loading" || status === "busy"}
          className={`w-full py-2 text-sm font-semibold rounded-lg transition-colors ${
            status === "on"
              ? "border border-slate-300 text-slate-700 hover:border-slate-400"
              : "bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40"
          }`}
        >
          {status === "busy" || status === "loading"
            ? "…"
            : status === "on"
              ? "Turn off on this device"
              : "Enable daily reminders on this device"}
        </button>
      )}
      {status === "on" && <div className="mt-2 text-xs text-emerald-600">On for this device.</div>}
      {err && (
        <div role="alert" className="mt-2 text-xs text-rose-600">
          {err}
        </div>
      )}
    </div>
  );
}
