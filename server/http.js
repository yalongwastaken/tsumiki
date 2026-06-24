// http.js — outbound fetch with a timeout AND a response-size cap. The price/news
// feed URLs are operator-configured, but a buggy or hostile feed returning a
// multi-GB body shouldn't be able to OOM the mini-PC. Returns body text, or null
// on failure / non-OK / over-limit.
export async function fetchTextCapped(url, { timeoutMs = 8000, maxBytes = 5_000_000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    return null;
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return null; // server told us it's too big — don't even read it
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    // no stream API (e.g. a test stub) — the body is already buffered, so this caps only
    // what we *return*, not memory. Measure real UTF-8 bytes, not UTF-16 code units.
    const t = await res.text();
    return Buffer.byteLength(t, "utf8") > maxBytes ? null : t;
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
      return null; // missing/lying content-length — bail once we exceed the cap
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
