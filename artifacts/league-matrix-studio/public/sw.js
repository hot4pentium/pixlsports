const CACHE_PREFIX = 'pixl-sports-shell';
const CACHE_NAME = `${CACHE_PREFIX}-v4`;
const PRECACHE_URLS = __PIXL_PRECACHE_MANIFEST__;

function getScopePath() {
  return new URL(self.registration.scope).pathname;
}

function isInScope(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(getScopePath());
}

function resolveAppUrl(value) {
  const scope = new URL(self.registration.scope);
  if (typeof value !== 'string' || !value) return scope.href;
  const normalized = value.startsWith('/') ? value.slice(1) : value;
  const resolved = new URL(normalized, scope.href);
  return isInScope(resolved) ? resolved.href : scope.href;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([
        getScopePath(),
        ...PRECACHE_URLS.map(resolveAppUrl),
      ]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = { body: event.data?.text() ?? '' }; }
  const title = typeof payload.title === 'string' && payload.title.length > 0 ? payload.title : 'Pixl Sports';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const tag = typeof payload.tag === 'string' ? payload.tag : 'pixl-sports-notification';
  const url = resolveAppUrl(payload.url);
  event.waitUntil(self.registration.showNotification(title, {
    body, tag, data: { url },
    icon: `${getScopePath()}pwa-icon-192.png`,
    badge: `${getScopePath()}pwa-icon-192.png`,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = resolveAppUrl(event.notification.data?.url);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const scopePath = new URL(self.registration.scope).pathname;
    const matching = clients.find((client) => {
      try { return new URL(client.url).pathname.startsWith(scopePath); } catch { return false; }
    });
    if (matching && 'focus' in matching) { void matching.navigate(url); return matching.focus(); }
    return self.clients.openWindow(url);
  }));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isInScope(url) || url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(getScopePath(), copy));
          return response;
        })
        .catch(() => caches.match(getScopePath())),
    );
    return;
  }

  if (['script', 'style', 'font', 'image', 'manifest'].includes(request.destination)) {
    event.respondWith(
      caches.match(request)
        .then((cached) => {
          const refreshed = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
          });
          if (cached) {
            event.waitUntil(refreshed.catch(() => undefined));
            return cached;
          }
          return refreshed;
        }),
    );
  }
});