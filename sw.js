/* sw.js — Sovereign (GitHub Pages friendly)
   Goal: app loads + refreshes in airplane mode (offline-first shell),
   while still allowing online fetch when available.

   ✅ What this does:
   - Caches the "app shell" (./ and ./index.html) on install
   - On refresh/navigation, serves cached index.html when offline
   - For same-origin files (css/js/images), uses cache-first then updates cache
   - Keeps caches tidy on activate

   IMPORTANT:
   - Keep register call in index.html as: navigator.serviceWorker.register("./sw.js")
   - If you make big changes, bump VERSION below to force a clean update.
*/

const VERSION = "v87-shell-1";          // <-- bump this when you want to force-update
const CACHE_SHELL = `sovereign-shell-${VERSION}`;
const CACHE_RUNTIME = `sovereign-runtime-${VERSION}`;

// Minimal shell required for offline boot (airplane mode refresh)
const SHELL_ASSETS = [
  "./",
  "./index.html",
];

// ---- Install: cache shell ----
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
});

// ---- Activate: clean old caches ----
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => {
          if (k.startsWith("sovereign-shell-") && k !== CACHE_SHELL) return caches.delete(k);
          if (k.startsWith("sovereign-runtime-") && k !== CACHE_RUNTIME) return caches.delete(k);
          return Promise.resolve();
        })
      );
    } catch {}
    await self.clients.claim();
  })());
});

// ---- Fetch strategy ----
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) Navigation requests (page refresh / direct load)
  // Offline: return cached index.html so your app boots.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      // Try network first (fresh updates when online), fallback to cached index.html
      try {
        const net = await fetch(req);
        // Update shell cache with latest index.html (best-effort)
        try {
          const cache = await caches.open(CACHE_SHELL);
          cache.put("./index.html", net.clone());
        } catch {}
        return net;
      } catch {
        const cached = await caches.match("./index.html");
        if (cached) return cached;
        // last resort: try root
        return caches.match("./") || cached;
      }
    })());
    return;
  }

  // 2) Same-origin assets: cache-first, then refresh cache in background
  if (sameOrigin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) {
        // Background refresh (stale-while-revalidate)
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(req);
            if (fresh && fresh.ok) {
              const cache = await caches.open(CACHE_RUNTIME);
              await cache.put(req, fresh.clone());
            }
          } catch {}
        })());
        return cached;
      }

      // Not cached: try network, then store
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_RUNTIME);
          await cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        // If offline and not cached, just fail gracefully
        return new Response("", { status: 504, statusText: "Offline" });
      }
    })());
    return;
  }

  // 3) Cross-origin (e.g., icons8): don't cache; just try network
  // (Cross-origin assets often cause weird offline hangs if you try to cache them.)
  event.respondWith(
    fetch(req).catch(() => new Response("", { status: 504, statusText: "Offline" }))
  );
});
