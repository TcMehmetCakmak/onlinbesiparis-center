const CACHE_NAME = "online-siparis-pwa-v14";
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
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname.toLowerCase();
  if (path.endsWith("/admin-manifest.json")) {
    const t = url.searchParams.get("tenant") || "demo";
    const name = t.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const manifest = {
      name: name + " Yönetim",
      short_name: name,
      start_url: "/admin.html?tenant=" + encodeURIComponent(t),
      display: "standalone",
      background_color: "#f4f5f7",
      theme_color: "#222222",
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
      ]
    };
    event.respondWith(
      new Response(JSON.stringify(manifest), {
        headers: { "Content-Type": "application/manifest+json; charset=utf-8" }
      })
    );
    return;
  }

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
      fetch(event.request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      })
    )
  );
});
