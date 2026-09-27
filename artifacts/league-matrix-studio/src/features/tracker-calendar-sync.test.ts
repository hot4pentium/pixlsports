import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearPendingTrackerCalendarSync,
  readPendingTrackerCalendarSync,
  savePendingTrackerCalendarSync,
} from './tracker-calendar-sync';

test('failed Calendar updates remain recoverable and account-scoped until a successful retry', () => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
  };
  const pending = { eventId: 'event-a', gameId: 'game-a', completedAt: '2026-09-26T12:00:00Z' };
  savePendingTrackerCalendarSync(storage, 'account-a', pending);
  assert.deepEqual(readPendingTrackerCalendarSync(storage, 'account-a'), [pending]);
  assert.deepEqual(readPendingTrackerCalendarSync(storage, 'account-b'), []);
  savePendingTrackerCalendarSync(storage, 'account-a', pending);
  assert.equal(readPendingTrackerCalendarSync(storage, 'account-a').length, 1);
  clearPendingTrackerCalendarSync(storage, 'account-a', pending.gameId);
  assert.deepEqual(readPendingTrackerCalendarSync(storage, 'account-a'), []);
});