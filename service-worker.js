const LEGACY_CACHE_PREFIX = "online-siparis-shell-";

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith(LEGACY_CACHE_PREFIX))
        .map(key => caches.delete(key))
    );

    await self.registration.unregister();

    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of clients) {
      client.navigate(client.url);
    }
  })());
});
