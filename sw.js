// Offline-first service worker: precache the whole app, serve from cache, update atomically.
// Bump VERSION on every deploy (must match APP_VERSION in js/model.js — a test checks this).
const VERSION = '1.11.0';
const CACHE = `workout-tracker-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './data/exercises.json',
  './css/styles.css',
  './js/app.js',
  './js/body.js',
  './js/chart.js',
  './js/consistency.js',
  './js/csv.js',
  './js/dates.js',
  './js/icons.js',
  './js/brand.js',
  './js/profile.js',
  './js/units.js',
  './js/types.js',
  './js/measure.js',
  './js/nutrition.js',
  './js/views/nutrition.js',
  './js/views/onboarding.js',
  './js/views/profile.js',
  './js/library.js',
  './js/muscles.js',
  './js/db.js',
  './js/model.js',
  './js/plan.js',
  './js/progression.js',
  './js/review.js',
  './js/pwa.js',
  './js/stats.js',
  './js/theme.js',
  './js/volume.js',
  './js/timer.js',
  './js/store.js',
  './js/ui.js',
  './js/wakelock.js',
  './js/views/body.js',
  './js/views/bodymap.js',
  './js/views/calendar.js',
  './js/views/consistency.js',
  './js/views/day.js',
  './js/views/picker.js',
  './js/views/planner.js',
  './js/views/progress.js',
  './js/views/settings.js',
  './js/views/timer.js',
  './fonts/plus-jakarta-sans.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the HTTP cache so a new version never precaches stale files.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('workout-tracker-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// The page asks the waiting worker to take over when the user taps "Update".
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // App shell: always the cached index.html (routing happens in the hash).
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match('./index.html')) ?? fetch(req);
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  })());
});
