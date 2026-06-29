// Login.jsx — full-screen app-lock prompt shown when the server reports the app is
// locked and this device has no valid session. Over an insecure origin (plain-LAN
// http) sign-in is refused server-side, so we explain that instead of a password box.
import { useState, useRef, useEffect } from "react";
import { Lock } from "lucide-react";
import { authLogin } from "../lib/core/api.js";

/** @param {{secure:boolean, onSuccess:()=>void}} props */
export default function Login({ secure = true, onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e) {
    e?.preventDefault();
    if (busy || !password) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await authLogin(password);
      onSuccess?.();
    } catch (err) {
      setError(err.status === 401 ? "Wrong password." : "Couldn't sign in — try again.");
      setPassword("");
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <Lock size={18} />
        </div>
        <h1 className="text-lg font-bold text-slate-900">Tsumiki is locked</h1>
        {secure ? (
          <>
            <p className="mt-1 mb-4 text-sm text-slate-500">
              Enter your password to unlock. This device stays trusted for 7 days.
            </p>
            <form onSubmit={submit}>
              <input
                ref={inputRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                aria-label="Password"
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700"
              />
              {error && (
                <div role="alert" className="mt-2 text-xs text-rose-600">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={busy || !password}
                className="press mt-3 w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
              >
                {busy ? "Unlocking…" : "Unlock"}
              </button>
            </form>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-600">
            For your security, sign-in is only allowed over a private connection. Open Tsumiki over
            HTTPS or your Tailscale address to unlock it.
          </p>
        )}
      </div>
    </div>
  );
}
