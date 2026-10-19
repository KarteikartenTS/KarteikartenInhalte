// Offline-Unterstützung.
// Seite, app.js, app.css und Karten-JSON: zuerst Netz (mit Zeitlimit), sonst Cache – so passen Seite und Skript
// immer zusammen (früher konnte eine neue Seite mit einem alten app.js aus dem Cache starten).
// Bilder/Medien/Icons: zuerst Cache, sonst Netz.
const CACHE = 'karteikarten-v22';
const KEEP = ['karteikarten-inhalt']; // Inhalts-Snapshot der App, nicht beim Update löschen
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/tuev-sued-logo.svg'];
const NET_TIMEOUT = 5000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function store(key, r) {
  if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
  return r;
}

/** Netz zuerst; bei Fehler oder nach NET_TIMEOUT der Cache. Nie eine leere Antwort. */
function networkFirst(request, cacheKey) {
  const fromCache = () => caches.match(cacheKey, { ignoreSearch: true });
  const net = fetch(request).then((r) => store(cacheKey, r));
  const timeout = new Promise((resolve) => setTimeout(resolve, NET_TIMEOUT));
  return Promise.race([net.catch(() => null), timeout])
    .then((r) => r || fromCache())
    .then((r) => r || net)            // nichts im Cache: doch auf das Netz warten
    .catch(() => fromCache().then((r) => r || Response.error()));
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(networkFirst(e.request, 'index.html'));
    return;
  }
  if (/\.(js|css|json|webmanifest)$/.test(url.pathname)) {
    e.respondWith(networkFirst(e.request, url.pathname.endsWith('.json') ? e.request : url.pathname));
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit
      || fetch(e.request).then((r) => store(e.request, r)).catch(() => Response.error())),
  );
});
