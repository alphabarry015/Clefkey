const CACHE_VERSION = 'v268';
const CACHE_STATIC = `clefkey-static-${CACHE_VERSION}`;

// Assets légers uniquement — pas les listes /data/ (trop volumineuses).
const PRECACHE = [
  '/',
  '/docs/',
  '/favicon.ico',
  '/css/theme.css',
  '/css/base-p1.css',
  '/css/base-p2.css',
  '/css/vault-layout-a-p1.css',
  '/css/vault-layout-a-p2.css',
  '/css/vault-layout-b-p1.css',
  '/css/vault-layout-b-p2.css',
  '/css/vault-nav-p1.css',
  '/css/vault-nav-p2.css',
  '/css/vault-profile-a.css',
  '/css/vault-profile-b.css',
  '/css/vault-content-a.css',
  '/css/vault-content-b.css',
  '/css/overlays-a.css',
  '/css/overlays-b.css',
  '/css/landing-a.css',
  '/css/landing-b.css',
  '/css/breach-switch.css',
  '/css/responsive-a.css',
  '/css/responsive-b.css',
  '/css/vault-ds.css',
  '/css/docs.css',
  '/css/privacy.css',
  '/js/app.js',
  '/js/app-compose.js',
  '/js/app-nav.js',
  '/js/api.js',
  '/js/crypto.js',
  '/js/crypto-ssh.js',
  '/js/argon2-worker.js',
  '/js/compat.js',
  '/js/session.js',
  '/js/dev.js',
  '/js/favicon.js',
  '/js/detail-secret.js',
  '/js/folders.js',
  '/js/icons.js',
  '/js/pwa.js',
  '/js/theme.js',
  '/js/common-passwords.js',
  '/js/master-password.js',
  '/js/auth-secrets.js',
  '/js/recovery-export.js',
  '/js/recovery-input.js',
  '/js/auth-screens.js',
  '/js/ui.js',
  '/js/entry-ui.js',
  '/js/entry-markup.js',
  '/js/projects-ui.js',
  '/js/transfer-ui.js',
  '/js/shares-ui.js',
  '/js/vault-views.js',
  '/js/profile-ui.js',
  '/js/audit.js',
  '/js/breach-check.js',
  '/js/auth-session.js',
  '/js/bind-auth.js',
  '/js/bind-vault.js',
  '/js/bind-projects.js',
  '/js/bind-shares.js',
  '/js/docs-app.js',
  '/js/markdown.js',
  '/vendor/hash-wasm.esm.min.js',
  '/vendor/noble-ed25519.bundle.js',
  '/vendor/lucide.bundle.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
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
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => (
            key.startsWith('clefkey-')
            || key.startsWith('gardefort-')
            || key.startsWith('binalph93-')
            || key.startsWith('binalph-')
            || key.startsWith('coffre-fort-')
          ) && key !== CACHE_STATIC)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim())
      .catch(() => undefined),
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
      fetch(request).catch(async () => {
        if (url.pathname.startsWith('/docs')) {
          return (await caches.match('/docs/')) || caches.match('/');
        }
        return caches.match('/') || caches.match('/index.html');
      }),
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
        caches.open(CACHE_STATIC)
          .then((cache) => cache.put(request, clone))
          .catch(() => undefined);
        return response;
      }).catch(() => cached);
      if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') || url.pathname.startsWith('/vendor/')) {
        return networkFetch.catch(() => cached);
      }
      if (cached) return cached;
      return networkFetch;
    }).catch(() => fetch(request)),
  );
});
