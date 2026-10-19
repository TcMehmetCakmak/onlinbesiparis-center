const CACHE_NAME = "toksoz-gayrimenkul-pwa-v2";
const STATIC_ASSETS = [
  "./manifest.json?v=2",
  "./icon-192.png?v=2",
  "./icon-512.png?v=2"
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
      Promise.all(keys.filter(key => key.startsWith("toksoz-gayrimenkul-pwa-") && key !== CACHE_NAME).map(key => caches.delete(key)))
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
    path.endsWith("/manifest.json") ||
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
      fetch(event.request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      })
    )
  );
});

