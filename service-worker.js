const CACHE_NAME = "online-siparis-shell-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./admin.html",
  "./manifest.json",
  "./supabase-config.js",
  "./platform-config.js",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./durumcu/manifest.json",
  "./durumcu/icon-192.png",
  "./durumcu/icon-512.png",
  "./durumcu/icon-512-maskable.png",
  "./cakmak-tatlici/manifest.json",
  "./cakmak-tatlici/icon-192.png",
  "./cakmak-tatlici/icon-512.png",
  "./cakmak-tatlici/icon-512-maskable.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("online-siparis-shell-") && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          return (await caches.match(request))
            || (await caches.match("./index.html"))
            || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);

      return cached || network;
    })
  );
});
