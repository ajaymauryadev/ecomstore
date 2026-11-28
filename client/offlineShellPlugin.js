import { createHash } from 'node:crypto';

export function offlineShellPlugin() {
  return {
    name: 'saved-data-offline-shell',
    apply: 'build',
    generateBundle(_, bundle) {
      const assets = ['/', '/index.html', '/startup.css', '/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png',
        ...Object.keys(bundle).filter((name) => !name.endsWith('.map')).map((name) => `/${name}`)];
      const version = createHash('sha256').update(Object.values(bundle).map((entry) => entry.code || entry.source || '').join('')).digest('hex').slice(0, 16);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const SHELL = 'kirana-shell-${version}';
const IMAGES = 'kirana-public-images-v1';
const PRECACHE = ${JSON.stringify([...new Set(assets)])};
self.addEventListener('install', (event) => {
  // No skipWaiting: a new build never replaces chunks underneath an open bill.
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)));
});
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('kirana-shell-') && name !== SHELL) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const remotePublicImage = request.destination === 'image' && url.hostname === 'ik.imagekit.io' && url.pathname.includes('/public/') && !/token|signature|authorization/i.test(url.search);
  if (request.method !== 'GET' || (url.origin !== self.location.origin && !remotePublicImage) || request.headers.has('authorization') ||
      url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) return;
  if (request.mode === 'navigate' && new RegExp('^/(?:s|store|staff|super-admin)(?:/|$)|^/(?:login|register)?$').test(url.pathname)) {
    // All app routes share the versioned shell, including supplier-payments.
    // Opening a saved view must never wait on a stalled navigation request.
    event.respondWith(caches.open(SHELL).then(async (cache) => (await cache.match('/index.html')) || fetch(request)));
    return;
  }
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.open(SHELL).then(async (cache) => (await cache.match(request)) || fetch(request)));
    return;
  }
  // Public build chunks may be named SupplierPaymentsPage or BackupPage.
  // Exclude private uploads only after checking the explicit shell allowlist.
  if (/payment|proof|backup/i.test(url.pathname)) return;
  // Cache only public product uploads actually viewed, never authenticated responses.
  if (request.destination === 'image' && (url.pathname.startsWith('/uploads/public/') || remotePublicImage)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGES);
      const saved = await cache.match(request);
      if (saved) return saved;
      let response;
      try { response = await fetch(new Request(request, { credentials: 'omit', mode: 'cors' })); }
      catch { return fetch(new Request(request, { credentials: 'omit' })); }
      if (response.ok && response.type !== 'opaque') {
        try {
          await cache.put(request, response.clone());
          const keys = await cache.keys();
          for (const old of keys.slice(0, Math.max(0, keys.length - 160))) await cache.delete(old);
        } catch { /* A full image cache must never break a successfully downloaded image. */ }
      }
      return response;
    })());
  }
});
` });
    },
  };
}
