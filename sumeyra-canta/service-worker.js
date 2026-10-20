const CACHE_NAME = "sumeyra-canta-pwa-v2";
const CACHE_PREFIX = "sumeyra-canta-pwa-v";
const STATIC_ASSETS = [
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(STATIC_ASSETS.map(url => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname.toLowerCase();
  const dynamic =
    event.request.mode === "navigate" ||
    path.endsWith("/index.html") ||
    path.endsWith("/admin.html") ||
    path.endsWith("/supabase-config.js") ||
    path.endsWith("/platform-config.js");

  if (dynamic) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then(response => response)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached =>
      cached ||
      fetch(event.request).then(async response => {
        if (response.ok) {
          // Clone before returning the response to the browser.
          const cacheResponse = response.clone();
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(event.request, cacheResponse);
          } catch (error) {
            console.warn("Önbelleğe yazılamadı; ağ yanıtı kullanılacak:", error);
          }
        }
        return response;
      })
    )
  );
});