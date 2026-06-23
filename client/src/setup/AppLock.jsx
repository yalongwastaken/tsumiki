// AppLock.jsx — Settings card to enable / change / remove the app-lock password.
// Self-contained: reads /api/auth/status, and (per the threat model) only lets you set
// a password over a secure origin — over plain-LAN http it explains why it's disabled.
import { useState, useEffect, useCallback } from "react";
import { authStatus, authSetPassword, authLogout } from "../lib/api.js";
import { card, label, field } from "./ui.jsx";

export default function AppLock() {
  const [status, setStatus] = useState(null); // { enabled, authed, secure }
  const [form, setForm] = useState({ current: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const refresh = useCallback(() => {
    authStatus()
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, authed: true, secure: false }));
  }, []);
  useEffect(refresh, [refresh]);

  const reset = () => setForm({ current: "", password: "", confirm: "" });
  async function save(clearing) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      if (!clearing) {
        if (form.password.length < 6) {
          throw new Error("Password must be at least 6 characters.");
        }
        if (form.password !== form.confirm) {
          throw new Error("Passwords don't match.");
        }
      }
      await authSetPassword({
        current: status?.enabled ? form.current : undefined,
        password: clearing ? "" : form.password,
      });
      reset();
      setMsg(clearing ? "App lock removed." : "Password saved — this device is trusted.");
      refresh();
    } catch (e) {
      setErr(
        e.status === 401
          ? "Wrong current password."
          : e.message?.replace(/^.*→ \d+: /, "") || "Couldn't save.",
      );
    }
    setBusy(false);
  }
  async function logout() {
    await authLogout().catch(() => {});
    location.reload();
  }

  if (!status) {
    return null;
  }
  const locked = status.enabled;
  // can't enable a brand-new lock over an insecure origin
  const canEnable = status.secure || locked;

  return (
    <div className={card}>
      <div className={label + " mb-1"}>App lock</div>
      <div className="mb-3 text-xs text-slate-500">
        {locked
          ? "A password is required to open Tsumiki. Trusted devices stay signed in for 7 days."
          : "Set a password so only you can open Tsumiki on your network."}
      </div>

      {!canEnable ? (
        <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          Open Tsumiki over HTTPS or your Tailscale address to enable a password — over a plain LAN
          connection it could be read by others on the network.
        </div>
      ) : (
        <div className="space-y-2">
          {locked && (
            <input
              type="password"
              value={form.current}
              onChange={(e) => setForm({ ...form, current: e.target.value })}
              placeholder="Current password"
              aria-label="Current password"
              autoComplete="current-password"
              className={field}
            />
          )}
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={locked ? "New password" : "Password"}
            aria-label={locked ? "New password" : "Password"}
            autoComplete="new-password"
            className={field}
          />
          <input
            type="password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            placeholder="Confirm password"
            aria-label="Confirm password"
            autoComplete="new-password"
            className={field}
          />
          <div className="flex gap-2">
            <button
              onClick={() => save(false)}
              disabled={busy || !form.password}
              className="press flex-1 rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {locked ? "Change password" : "Enable lock"}
            </button>
            {locked && (
              <button
                onClick={() => save(true)}
                disabled={busy || !form.current}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      {(msg || err) && (
        <div className={`mt-2 text-xs ${err ? "text-rose-600" : "text-emerald-600"}`}>
          {err || msg}
        </div>
      )}
      {locked && (
        <button
          onClick={logout}
          className="mt-3 text-xs font-medium text-slate-500 hover:text-brand-600"
        >
          Log out this device
        </button>
      )}
    </div>
  );
}
