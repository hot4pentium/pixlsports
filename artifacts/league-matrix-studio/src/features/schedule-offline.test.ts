import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchScheduleShareWithCache,
} from './schedule-offline';

const shareToken = '11111111-1111-4111-8111-111111111111';
const firstSchedule = {
  shareToken,
  title: 'Saturday Tigers',
  teamSeason: 'Fall 2026',
  events: [],
  createdAt: '2026-09-20T12:00:00.000Z',
};
const updatedSchedule = {
  ...firstSchedule,
  title: 'Saturday Tigers Updated',
  createdAt: '2026-09-21T12:00:00.000Z',
};

const storage = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
};

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });
});

test.after(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
  globalThis.fetch = originalFetch;
});

test('replaces the device snapshot after a successful online refresh', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(firstSchedule), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  const fresh = await fetchScheduleShareWithCache(shareToken);
  assert.equal(fresh.cacheStatus, 'fresh');
  assert.equal(fresh.refreshFailed, false);

  globalThis.fetch = async () => {
    throw new TypeError('offline');
  };

  const cached = await fetchScheduleShareWithCache(shareToken);
  assert.equal(cached.title, firstSchedule.title);
  assert.equal(cached.cacheStatus, 'cached');
  assert.equal(cached.refreshFailed, true);
});

test('does not show stale schedule data for a link that the server revoked', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(firstSchedule), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  await fetchScheduleShareWithCache(shareToken);

  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Schedule share not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    () => fetchScheduleShareWithCache(shareToken),
    { status: 404 },
  );
});

test('an online response replaces an older saved schedule before the next offline open', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(firstSchedule), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  await fetchScheduleShareWithCache(shareToken);

  globalThis.fetch = async () => new Response(JSON.stringify(updatedSchedule), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const refreshed = await fetchScheduleShareWithCache(shareToken);

  globalThis.fetch = async () => {
    throw new TypeError('offline');
  };
  const cached = await fetchScheduleShareWithCache(shareToken);

  assert.equal(refreshed.title, updatedSchedule.title);
  assert.equal(cached.title, updatedSchedule.title);
});