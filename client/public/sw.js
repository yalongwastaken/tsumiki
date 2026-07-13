// sw.js — app-shell cache for the installed PWA. Makes Tsumiki open instantly and
// survive a flaky connection, WITHOUT ever caching /api (financial data must stay
// fresh and private). Bump CACHE to invalidate old shells on the next visit.
const CACHE = "tsumiki-shell-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// drop cached /assets/ entries the current index.html doesn't reference — hashed
// bundles are immutable, so anything unreferenced belongs to an old deploy
async function pruneStaleAssets(res) {
  try {
    const html = await res.text();
    const referenced = new Set(Array.from(html.matchAll(/\/assets\/[^"')\s]+/g), (m) => m[0]));
    const c = await caches.open(CACHE);
    for (const key of await c.keys()) {
      const path = new URL(key.url).pathname;
      if (path.startsWith("/assets/") && !referenced.has(path)) {
        await c.delete(key);
      }
    }
  } catch {
    // best-effort housekeeping — never let it break a navigation
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") {
    return;
  }
  const url = new URL(req.url);
  // only handle our own origin; never touch the API (no stale/secret data cached)
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  // navigations: network-first (always get the freshest HTML when online), fall
  // back to the cached shell when offline. Only cache a 2xx shell — a transient
  // 502 must not become the permanent offline fallback (AUDIT L11) — and prune
  // hashed assets the fresh HTML no longer references, so old deploys' bundles
  // don't accumulate in the cache forever (AUDIT M11).
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const c = await caches.open(CACHE);
            await c.put("/index.html", res.clone());
            pruneStaleAssets(res.clone()); // fire-and-forget
          }
          return res;
        } catch {
          const c = await caches.open(CACHE);
          return (await c.match("/index.html")) || Response.error();
        }
      })(),
    );
    return;
  }

  // static assets (content-hashed → immutable): cache-first, then network + store.
  e.respondWith(
    (async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(req);
      if (hit) {
        return hit;
      }
      try {
        const res = await fetch(req);
        if (res.ok) {
          c.put(req, res.clone());
        }
        return res;
      } catch {
        return Response.error();
      }
    })(),
  );
});
