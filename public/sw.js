// VIA service worker. Hand-rolled, no library.
//
// Responsibilities:
//  - Cache the installable shell so the PWA opens in airplane mode without
//    crashing.
//  - Cache /_next/static/* and /icons/* aggressively (immutable hashed assets).
//  - Pass everything dynamic (API, MCP, .well-known, /admin, /seller, /buyer)
//    straight through to the network.
//
// Bump CACHE_VERSION on any change to invalidate stale caches.

const CACHE_VERSION = 'via-v1';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-384.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/maskable-512.png',
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
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
  }
});
