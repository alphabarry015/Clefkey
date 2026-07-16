const CACHE_VERSION = 'v94';
const CACHE_STATIC = `gardefort-static-${CACHE_VERSION}`;

// Assets légers uniquement — pas les listes /data/ (trop volumineuses).
const PRECACHE = [
  '/',
  '/favicon.ico',
  '/css/style.css',
  '/js/app.js',
  '/js/api.js',
  '/js/crypto.js',
  '/js/argon2-worker.js',
  '/js/compat.js',
  '/js/session.js',
  '/js/dev.js',
  '/js/favicon.js',
  '/js/icons.js',
  '/js/pwa.js',
  '/js/common-passwords.js',
  '/js/master-password.js',
  '/js/auth-secrets.js',
  '/js/recovery-export.js',
  '/js/recovery-input.js',
  '/js/auth-screens.js',
  '/vendor/hash-wasm.esm.min.js',
  '/vendor/noble-ed25519.bundle.js',
  '/vendor/lucide.bundle.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-mark.svg',
  '/icons/logo-chevalier.png',
  '/icons/icon-192.png',
  '/icons/favicon.ico',
];

const API_PREFIXES = ['/auth/', '/vault/', '/health/'];

function isApiRequest(pathname) {
  return API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Ne pas mettre en cache les listes de mots de passe (Go de données). */
function isHeavyDataRequest(pathname) {
  return pathname.startsWith('/data/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(async (cache) => {
        // addAll échoue entièrement si une URL manque — on tolère les 404.
        await Promise.all(
          PRECACHE.map((url) => cache.add(url).catch(() => undefined)),
        );
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => (
            key.startsWith('gardefort-')
            || key.startsWith('binalph93-')
            || key.startsWith('binalph-')
            || key.startsWith('coffre-fort-')
          ) && key !== CACHE_STATIC)
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

  // Listes SecLists : toujours réseau (évite de saturer le Cache API).
  if (isHeavyDataRequest(url.pathname)) {
    event.respondWith(fetch(request));
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
      if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') || url.pathname.startsWith('/vendor/')) {
        return networkFetch.catch(() => cached);
      }
      if (cached) return cached;
      return networkFetch;
    }),
  );
});
