// VIA service worker. Hand-rolled, no library. One SW at scope '/', shared by
// the app-wide "VIA" install and the "The Back Room" install.
//
// Responsibilities:
//  - Cache the installable shell so the PWA opens in airplane mode without
//    crashing.
//  - Cache /_next/static/* and /icons/* aggressively (immutable hashed assets).
//  - Pass everything dynamic (API, MCP, per-room MCP, .well-known, /admin,
//    /seller, /buyer) straight through to the network.
//  - Receive Back Room web push and route notification clicks into the room.
//
// Bump CACHE_VERSION on any change to invalidate stale caches.

const CACHE_VERSION = 'via-v2';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  '/manifest.webmanifest',
  '/backroom.webmanifest',
  '/backroom-offline.html',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-384.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/maskable-512.png',
  '/icons/backroom/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function shouldBypass(url) {
  if (url.origin !== self.location.origin) return true;
  const p = url.pathname;
  if (p.startsWith('/api/'))         return true;
  if (p.startsWith('/mcp'))          return true;
  if (p.startsWith('/rooms/'))       return true; // per-room MCP
  if (p.startsWith('/sellers/'))     return true; // per-seller MCP + public card
  if (p.startsWith('/buyers/'))      return true; // per-buyer MCP (Stage 2)
  if (p.startsWith('/admin'))        return true;
  if (p.startsWith('/seller/'))      return true;
  if (p.startsWith('/buyer/'))       return true;
  if (p.startsWith('/onboard'))      return true;
  if (p.startsWith('/.well-known/')) return true;
  return false;
}

function isImmutableAsset(url) {
  const p = url.pathname;
  return p.startsWith('/_next/static/') || p.startsWith('/icons/');
}

// A Back Room navigation falls back to the paper offline card (not '/') so the
// installed Back Room app degrades in its own skin.
function isBackroomNav(url) {
  const p = url.pathname;
  return p === '/backroom' || p.startsWith('/backroom/') || p.startsWith('/room/') || p === '/you' || p === '/door';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (shouldBypass(url)) return;

  // Cache-first for immutable hashed assets.
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // Network-first with cache fallback for navigation / HTML.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    const offline = isBackroomNav(url) ? '/backroom-offline.html' : '/';
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(offline)))
    );
  }
});

// ── Web push (Back Room) ───────────────────────────────────────────────
// Payload shape from lib/app/backroom/push.ts: { title, body, url, tag }.
// tag is the room id so multiple messages in one room coalesce into one
// notification rather than stacking.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || 'The Back Room';
  const url = data.url || '/backroom';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/backroom/icon-192.png',
      badge: '/icons/backroom/icon-192.png',
      tag: data.tag || url,
      renotify: true,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/backroom';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
