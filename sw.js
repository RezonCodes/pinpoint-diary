// sw.js - service worker: makes the app open and work with no internet.
//
// Strategy:
//  - App files (HTML, CSS, JS, icons, Leaflet): pre-cached on install, served cache-first,
//    and refreshed in the background (stale-while-revalidate).
//  - Map tiles: cache-first, so map areas you've seen before still show offline (max 300 tiles).
//  - Weather / place APIs: always network. The app itself handles being offline.

const VERSION = 'pinpoint-v1.0.0';
const SHELL_CACHE = `${VERSION}-shell`;
const TILE_CACHE = 'pinpoint-tiles';
const MAX_TILES = 300;

const SHELL_FILES = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/api.js',
  './js/auth.js',
  './js/crypto.js',
  './js/db.js',
  './js/device.js',
  './js/utils.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './lib/leaflet/leaflet.js',
  './lib/leaflet/leaflet.css',
  './lib/leaflet/images/marker-icon.png',
  './lib/leaflet/images/marker-icon-2x.png',
  './lib/leaflet/images/marker-shadow.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Delete caches from older versions of the app.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys
        .filter((k) => k.startsWith('pinpoint-v') && !k.startsWith(VERSION))
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok || res.type === 'opaque') {
            cache.put(req, res.clone());
            trimCache(TILE_CACHE, MAX_TILES);
          }
          return res;
        } catch {
          return new Response('', { status: 504, statusText: 'Offline' });
        }
      }),
    );
    return;
  }

  // Only handle our own files below. APIs go straight to the network.
  if (url.origin !== self.location.origin) return;

  // Page navigations: serve the app shell (single-page app).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html', { ignoreSearch: true })),
    );
    return;
  }

  // Static files: cache first, update in the background.
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
