// Push-only preview worker: deliberately no fetch handler, shell cache, or client claiming.
const appBase = new URL('./', self.location.href);
function appUrl(value) {
  const url = new URL(typeof value === 'string' ? value.replace(/^\//, '') : '', appBase);
  return url.origin === appBase.origin && url.pathname.startsWith(appBase.pathname) ? url.href : appBase.href;
}
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = { body: event.data?.text() ?? '' }; }
  event.waitUntil((async () => {
    await self.registration.showNotification(payload.title || 'Pixl Sports', {
      body: payload.body || '',
      tag: payload.tag || 'pixl-sports-notification',
      data: { url: appUrl(payload.url) },
      icon: new URL('pwa-icon-192.png', appBase).href,
      badge: new URL('pwa-icon-192.png', appBase).href,
    });
    if (typeof payload.deliveryId !== 'string' || !payload.deliveryId) return;
    const subscription = await self.registration.pushManager.getSubscription();
    if (!subscription?.endpoint) return;
    await fetch(`/api/notifications/deliveries/${encodeURIComponent(payload.deliveryId)}/displayed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptionEndpoint: subscription.endpoint }),
    });
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(appUrl(event.notification.data?.url)));
});
