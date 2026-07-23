/* Nexus Card service worker.
 *
 * Scope is deliberately narrow: cache the app shell so a cold launch works
 * offline and a warm launch is instant. Nothing else.
 *
 * What is explicitly NOT cached, and why:
 *  - Every Supabase request. Card data, contacts and reminders are mutable
 *    and shared across devices; serving a stale contact list from cache is
 *    worse than showing a connection error, because the user cannot tell.
 *  - card.html's rendered content. The public card must always reflect what
 *    the owner last saved -- a recipient scanning a QR needs current data,
 *    not whatever was cached the last time this device saw that card.
 *
 * CACHE_VERSION must be bumped on every deploy that changes a shell file.
 * That is the same manual step as the ?v=N query strings in the HTML, and it
 * has already drifted once this session -- both should move to a build-time
 * content hash. Until then: bump this AND the ?v=N together.
 */
const CACHE_VERSION = 'nexus-shell-v10';

const SHELL = [
  'index.html',
  'card.html',
  'landing.html',
  'css/styles.css',
  'css/landing.css',
  'js/qrcode.js?v=10',
  'js/supabase-client.js?v=10',
  'js/store.js?v=10',
  'js/onboarding.js?v=10',
  'js/card.js?v=10',
  'js/contacts.js?v=10',
  'js/pipeline.js?v=10',
  'js/analytics.js?v=10',
  'js/app.js?v=10',
  'js/public-card.js?v=10',
  'favicon.svg',
  'manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // addAll is atomic: one 404 rejects the whole install and the old
      // worker stays active, which is the behaviour we want -- a partially
      // cached shell is worse than no service worker at all.
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[sw] shell precache failed', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Anything not on our own origin (Supabase REST/RPC/auth, the supabase-js
  // CDN bundle, Stripe) goes straight to the network, untouched.
  if (url.origin !== self.location.origin) return;

  /* Network-first for navigations so a deploy is picked up immediately;
     fall back to cache only when the network genuinely fails. Cache-first
     here would strand users on an old build until the cache expired. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
    );
    return;
  }

  // Cache-first for versioned static assets: the ?v=N in the URL is what
  // invalidates them, so a hit is always the right file.
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
