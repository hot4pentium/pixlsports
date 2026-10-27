const CACHE_PREFIX = 'pixl-sports-shell';
const CACHE_NAME = `${CACHE_PREFIX}-v18`;
const PRECACHE_URLS = __PIXL_PRECACHE_MANIFEST__;
const SCHEDULE_CACHE_HEADER = 'X-Pixl-Schedule-Cache';

function getScopePath() {
  return new URL(self.registration.scope).pathname;
}

function isInScope(url) {
  return url.origin === self.location.origin && url.pathname.startsWith(getScopePath());
}

function isAppRoute(url) {
  const path = url.pathname.slice(getScopePath().length);
  if (!path) return true;
  const firstSegment = path.split('/')[0];
  return [
    'studio', 'sign-in', 'sign-up', 'schedule', 'game-on', 'checklist',
    'meeting', 'h', 'watch', 'live', 'fan', 'player', 'help', 'privacy',
  ].includes(firstSegment);
}

function resolveAppUrl(value) {
  const scope = new URL(self.registration.scope);
  if (typeof value !== 'string' || !value) return scope.href;
  const normalized = value.startsWith('/') ? value.slice(1) : value;
  const resolved = new URL(normalized, scope.href);
  return isInScope(resolved) ? resolved.href : scope.href;
}

async function acknowledgeDisplayed(deliveryId) {
  if (typeof deliveryId !== 'string' || !deliveryId) return;
  const subscription = await self.registration.pushManager.getSubscription();
  if (!subscription?.endpoint) return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${self.location.origin}/api/notifications/deliveries/${encodeURIComponent(deliveryId)}/displayed`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptionEndpoint: subscription.endpoint }),
    });
    if (response.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
}

async function migrateShellCache(oldCacheName) {
  const oldCache = await caches.open(oldCacheName);
  const currentCache = await caches.open(CACHE_NAME);
  const requests = await oldCache.keys();

  for (const request of requests) {
    const pathname = new URL(request.url).pathname;
    if (!pathname.includes('/api/schedule-shares/') && !pathname.includes('/api/__clerk/npm/')) {
      continue;
    }

    const response = await oldCache.match(request);
    if (response) await currentCache.put(request, response);
  }
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
    (async () => {
      const oldCacheNames = (await caches.keys())
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
      for (const oldCacheName of oldCacheNames) {
        await migrateShellCache(oldCacheName);
        await caches.delete(oldCacheName);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = { body: event.data?.text() ?? '' }; }
  const title = typeof payload.title === 'string' && payload.title.length > 0 ? payload.title : 'Pixl Sports';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const tag = typeof payload.tag === 'string' ? payload.tag : 'pixl-sports-notification';
  const url = resolveAppUrl(payload.url);
  const display = self.registration.showNotification(title, {
    body, tag, data: { url },
    icon: `${getScopePath()}pwa-icon-192.png`,
    badge: `${getScopePath()}pwa-icon-192.png`,
  });
  event.waitUntil(display.then(() => acknowledgeDisplayed(payload.deliveryId)).catch(() => undefined));
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
  if (!isInScope(url)) return;

  if (url.pathname.includes('/api/schedule-shares/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
          }
          return response;
        })
        .catch(async (error) => {
          const cached = await caches.match(request);
          if (!cached) throw error;

          const headers = new Headers(cached.headers);
          headers.set(SCHEDULE_CACHE_HEADER, 'offline');
          return new Response(await cached.arrayBuffer(), {
            status: cached.status,
            statusText: cached.statusText,
            headers,
          });
        }),
    );
    return;
  }

  // Clerk's versioned browser bundles are public static code. Cache those so
  // an installed app can restore its already-known local session offline, but
  // never cache Clerk session, environment, or other authenticated API data.
  if (url.pathname.includes('/api/__clerk/npm/') && request.destination === 'script') {
    event.respondWith(
      caches.match(request).then((cached) => {
        const refreshed = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
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
    return;
  }

  if (url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    // Only serve this app's SPA routes; other artifacts may share our origin
    // when the studio is mounted at /.
    if (!isAppRoute(url)) return;
    event.respondWith(
      caches.open(CACHE_NAME)
        .then((cache) => cache.match(getScopePath()))
        .catch(() => undefined)
        .then((cached) => cached || fetch(request)),
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
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
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
