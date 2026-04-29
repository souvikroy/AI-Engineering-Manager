// Dev-only self-unregistering service worker. Replaces any stale SW from an old build
// that had a previous API URL precached. In production, `vite-plugin-pwa` generates
// the real sw.js into dist/ and overrides this file.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", async (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    const clients = await self.clients.matchAll({ type: "window" });
    await self.registration.unregister();
    clients.forEach((c) => c.navigate(c.url));
  })());
});
