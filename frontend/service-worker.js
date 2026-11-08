/**
 * GOLDEN GRAINS - Service Worker
 * - Pages (HTML): network-first, so a new version is always what you see.
 * - Scripts / styles: shown instantly from the saved copy and refreshed quietly
 *   in the background (fast loading). When the app version changes, ui.js clears
 *   this cache and reloads automatically - nobody has to clear browsing data.
 * - Images: instant from cache, refreshed in the background.
 * - Backend (API) calls and version.json are never cached.
 */
const CACHE_NAME = 'golden-grains-v5';
const SHELL_FILES = [
  './index.html',
  './login.html',
  './forgot-password.html',
  './dashboard.html',
  './products.html',
  './debts.html',
  './purchases.html',
  './sales.html',
  './cash-audit.html',
  './expenses.html',
  './damages.html',
  './store.html',
  './reports.html',
  './users.html',
  './profile.html',
  './css/style.css',
  './css/cash-audit.css',
  './css/premium.css',
  './css/dashboard-premium.css',
  './css/theme.css',
  './js/api.js',
  './js/manifest-init.js',
  './js/ui.js',
  './js/guard.js',
  './js/dashboard.js',
  './js/premium.js',
  './js/theme.js',
  './js/products.js',
  './js/debts.js',
  './js/purchases.js',
  './js/sales.js',
  './js/cash-audit.js',
  './js/expenses.js',
  './js/damages.js',
  './js/store.js',
  './css/store.css',
  './js/reports.js',
  './js/users.js',
  './js/profile.js',
  './assets/logo1.png',
  './assets/hero-logo.png',
  './assets/icon-192.png',
  './assets/icons.svg',
  './customers.html',
  './audit-log.html',
  './receipt.html',
  './css/purchase-order.css',
  './css/auth-animated.css',
  './css/landing-animated.css',
  './js/customers.js',
  './js/audit-log.js',
  './js/receipt.js',
  './js/landing-animated.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(SHELL_FILES.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})))).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Serve the saved copy at once, and refresh it from the server in the background.
function staleWhileRevalidate(event) {
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request, { ignoreSearch: true }).then((hit) => {
        const net = fetch(event.request, { cache: 'no-cache' })
          .then((response) => {
            if (response && response.status === 200) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => hit);
        if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
        return net;
      })
    )
  );
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;               // CDN files: browser handles them
  if (url.pathname.includes('/backend/')) return;                // live data: never cached
  if (/\/version\.json$/.test(url.pathname)) return;             // the update check must always be live

  // Images and icons
  if (/\.(png|jpg|jpeg|webp|ico|svg)$/.test(url.pathname)) {
    staleWhileRevalidate(event);
    return;
  }

  // Scripts and styles: instant from cache, refreshed in the background
  if (/\.(js|css)$/.test(url.pathname) && !/service-worker\.js$/.test(url.pathname)) {
    staleWhileRevalidate(event);
    return;
  }

  // Pages: always the newest from the server; saved copy only if offline / very slow
  event.respondWith(
    new Promise((resolve) => {
      let settled = false;
      const fallback = () => caches.match(event.request, { ignoreSearch: true });
      const timer = setTimeout(() => {
        fallback().then((hit) => { if (hit && !settled) { settled = true; resolve(hit); } });
      }, 4000);
      fetch(event.request, { cache: 'no-cache' })
        .then((response) => {
          clearTimeout(timer);
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          if (!settled) { settled = true; resolve(response); }
        })
        .catch(() => {
          clearTimeout(timer);
          fallback().then((hit) => { if (!settled) { settled = true; resolve(hit || Response.error()); } });
        });
    })
  );
});
