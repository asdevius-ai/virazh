/* Service worker «Вираж». Шлях-незалежний: база береться зі scope реєстрації. */
const VERSION = 'v1';
const SHELL = `virazh-shell-${VERSION}`;
const DATA = `virazh-data-${VERSION}`;
const TILES = `virazh-tiles-${VERSION}`;
const MAX_TILES = 800;
const TILE_HOST = 'tiles.openfreemap.org';

const SCOPE = self.registration.scope; // напр. https://host/virazh/

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll([SCOPE, SCOPE + 'manifest.webmanifest', SCOPE + 'icons/icon-192.png']).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('virazh-') && ![SHELL, DATA, TILES].includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  return (await network) || Response.error();
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
  }
}

async function cacheFirstTiles(request) {
  const cache = await caches.open(TILES);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      await cache.put(request, res.clone());
      trim(TILES, MAX_TILES);
    }
    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === TILE_HOST) {
    // Власне тайли/шрифти/спрайти — cache-first з обмеженням; стиль і TileJSON — SWR.
    const isStatic = /\/(planet|natural_earth|fonts|sprites)\//.test(url.pathname) && !url.pathname.endsWith('/planet');
    event.respondWith(isStatic ? cacheFirstTiles(req) : staleWhileRevalidate(req, TILES));
    return;
  }

  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(SCOPE, copy));
          return res;
        })
        .catch(() => caches.match(SCOPE).then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(staleWhileRevalidate(req, DATA));
    return;
  }

  // Хешовані асети, іконки, manifest.
  event.respondWith(staleWhileRevalidate(req, SHELL));
});
