const CACHE_VERSION = 'v39';
const CACHE_STATIC = `binalph93-static-${CACHE_VERSION}`;

const PRECACHE = [
  '/',
  '/css/style.css',
  '/js/app.js',
  '/js/api.js',
  '/js/crypto.js',
  '/js/dev.js',
  '/js/favicon.js',
  '/js/icons.js',
  '/js/pwa.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-mark.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
];

const API_PREFIXES = ['/auth/', '/vault/', '/health/'];

function isApiRequest(pathname) {
  return API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => (key.startsWith('binalph93-') || key.startsWith('binalph-') || key.startsWith('coffre-fort-')) && key !== CACHE_STATIC)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/') || caches.match('/index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (!response.ok) return response;
        const clone = response.clone();
        caches.open(CACHE_STATIC).then((cache) => cache.put(request, clone));
        return response;
      });
      if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/')) {
        return networkFetch.catch(() => cached);
      }
      if (cached) return cached;
      return networkFetch;
    }),
  );
});
