// Offline-Unterstützung. App-Dateien: zuerst Cache, im Hintergrund auffrischen.
// Karten (cards.json, modules.json): zuerst Netz, offline aus dem Cache. Medien: Cache, sonst Netz.
const CACHE = 'karteikarten-v21';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/tuev-sued-logo.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Seitenaufruf (Start vom Homescreen, Zurückkehren): zuerst Netz (max. 4 s), sonst gespeicherte Startseite –
  // nie eine leere Antwort, sonst bleibt der Bildschirm schwarz
  if (e.request.mode === 'navigate') {
    const fromCache = () => caches.match('index.html').then((r) => r || caches.match('./'));
    e.respondWith(
      Promise.race([
        fetch(e.request).then((r) => {
          if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); }
          return r;
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('langsam')), 4000)),
      ]).catch(() => fromCache().then((r) => r || fetch(e.request))),
    );
    return;
  }

  if (url.pathname.endsWith('.json')) {
    e.respondWith(
      fetch(e.request).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return r;
      }).catch(() => caches.match(e.request, { ignoreSearch: true })),
    );
    return;
  }

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const net = fetch(e.request).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return r;
      }).catch(() => hit || Response.error());
      return hit || net;
    }),
  );
});
