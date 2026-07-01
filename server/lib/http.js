// http.js — outbound fetch with a timeout AND a response-size cap. The price/news
// feed URLs are operator-configured, but a buggy or hostile feed returning a
// multi-GB body shouldn't be able to OOM the mini-PC.
//
// Returns { status, ok, text }: `text` is the body on success, or null when the
// response was non-OK or over the size cap. Surfacing the status (instead of a bare
// null) lets callers tell "rate-limited / server error" (retry later, don't punish
// the symbol) apart from "answered fine but had no data". Network errors/timeouts
// still throw (fetch semantics).
export async function fetchTextCapped(url, { timeoutMs = 8000, maxBytes = 5_000_000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const meta = { status: res.status, ok: res.ok };
  if (!res.ok) {
    return { ...meta, text: null };
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ...meta, text: null }; // server told us it's too big — don't even read it
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    // no stream API (e.g. a test stub) — the body is already buffered, so this caps only
    // what we *return*, not memory. Measure real UTF-8 bytes, not UTF-16 code units.
    const t = await res.text();
    return { ...meta, text: Buffer.byteLength(t, "utf8") > maxBytes ? null : t };
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      return { ...meta, text: null }; // missing/lying content-length — bail over the cap
    }
    chunks.push(value);
  }
  return { ...meta, text: Buffer.concat(chunks).toString("utf8") };
}

/** True for a response worth retrying later: rate-limited or a server-side failure. */
export const isRetryableStatus = (status) => status === 429 || (status >= 500 && status < 600);
