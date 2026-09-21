// Milestone 5's service worker (PLAN.md §11 step 5): a minimal, dependency-free
// runtime cache for the app shell (HTML/JS/CSS/tracks), so a repeat visit —
// including with the network gone — can still load the app itself. It does
// NOT cache `/api/*` calls: those are live data and should either succeed
// live or fail loudly, never serve stale narration silently. The actual
// downloaded route-pack *content* (stories, citations, tile list) lives in
// IndexedDB (see `src/offlineStore.ts`), not in this cache — this worker's
// only job is making sure the page itself can still boot offline.

const CACHE_NAME = "hereabouts-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return; // let live API calls hit the network directly, uncached

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
      }
    }),
  );
});
