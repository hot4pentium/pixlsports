import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

test('preview worker displays alerts and receipts without caching or controlling the app', async () => {
  const listeners = new Map<string, (event: any) => void>();
  const displays: Array<{ title: string; options: any }> = [];
  const receipts: string[] = [];
  const opened: string[] = [];
  runInNewContext(readFileSync(new URL('../../public/preview-push-sw.js', import.meta.url), 'utf8'), {
    URL,
    fetch: async (url: string) => { receipts.push(url); },
    self: {
      location: { href: 'https://sports.example/app/preview-push-sw.js' },
      addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener),
      skipWaiting: async () => undefined,
      registration: {
        showNotification: async (title: string, options: any) => { displays.push({ title, options }); },
        pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/device' }) },
      },
      clients: { openWindow: async (url: string) => { opened.push(url); } },
    },
  });
  assert.deepEqual([...listeners.keys()].sort(), ['install', 'notificationclick', 'push']);
  let work: Promise<unknown> | undefined;
  listeners.get('push')!({
    data: { json: () => ({ title: 'Event update', body: 'See the card', url: '/fan/athlete', deliveryId: 'delivery-1' }) },
    waitUntil: (promise: Promise<unknown>) => { work = promise; },
  });
  await work;
  assert.equal(displays[0].title, 'Event update');
  assert.equal(displays[0].options.data.url, 'https://sports.example/app/fan/athlete');
  assert.deepEqual(receipts, ['/api/notifications/deliveries/delivery-1/displayed']);
  listeners.get('notificationclick')!({
    notification: { close() {}, data: { url: 'https://external.example/unsafe' } },
    waitUntil: (promise: Promise<unknown>) => { work = promise; },
  });
  await work;
  assert.deepEqual(opened, ['https://sports.example/app/']);
});
