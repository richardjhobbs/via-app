// RRG service worker — KILL SWITCH.
//
// The previous version's caching/intercept logic was implicated in a mobile
// image regression. This version installs, then immediately unregisters
// itself and wipes any caches it (or its predecessor) created. After every
// existing client has fetched this file once, the worker is gone.
//
// Once the image regression is diagnosed and a clean SW is ready, replace
// this file. Bumping CACHE_VERSION is enough — browsers always re-fetch
// /sw.js, so the unregister code below runs on every device that ever
// installed the previous SW.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) {}
    try {
      await self.registration.unregister();
    } catch (_) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url);
      }
    } catch (_) {}
  })());
});

// No fetch handler — every request hits the network directly.
