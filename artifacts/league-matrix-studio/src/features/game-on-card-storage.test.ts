import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gameOnCardStorageKey,
  readSavedGameOnCard,
  removeSavedGameOnCard,
  revokeGameOnCardForScheduleEvent,
  writeSavedGameOnCard,
  type SavedGameOnCard,
} from './game-on-card-storage';

function createStorage() {
  const records = new Map<string, string>();
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => records.set(key, value),
    removeItem: (key: string) => records.delete(key),
  };
}

function savedCard(eventId: string, shareToken = 'share-linked'): SavedGameOnCard {
  return {
    shareToken,
    title: 'Northside game',
    savedAt: '2026-09-24T12:00:00.000Z',
    event: {
      id: eventId,
      date: '2026-10-03',
      time: '09:30',
      location: 'North Field',
      opponent: 'Ravens',
      status: 'upcoming',
    },
  };
}

test('deleting a linked calendar event revokes its share and removes the saved card', async () => {
  const storage = createStorage();
  writeSavedGameOnCard('parent-user', savedCard('calendar-game'), storage);
  const revoked: string[] = [];

  const didRevoke = await revokeGameOnCardForScheduleEvent({
    userId: 'parent-user',
    eventId: 'calendar-game',
    storage,
    revokeShare: async (shareToken) => { revoked.push(shareToken); },
  });

  assert.equal(didRevoke, true);
  assert.deepEqual(revoked, ['share-linked']);
  assert.equal(readSavedGameOnCard('parent-user', storage), null);
});

test('a legacy saved card still matches its original calendar event ID', async () => {
  const storage = createStorage();
  storage.setItem(gameOnCardStorageKey('parent-user'), JSON.stringify({
    shareToken: 'legacy-share',
    title: 'Older game card',
    savedAt: '2026-08-01T12:00:00.000Z',
    event: {
      id: 'legacy-calendar-game',
      date: '2026-08-08',
      time: '10:00',
      location: 'North Field',
      opponent: 'Ravens',
    },
  }));
  const revoked: string[] = [];

  const didRevoke = await revokeGameOnCardForScheduleEvent({
    userId: 'parent-user',
    eventId: 'legacy-calendar-game',
    storage,
    revokeShare: async (shareToken) => { revoked.push(shareToken); },
  });

  assert.equal(didRevoke, true);
  assert.deepEqual(revoked, ['legacy-share']);
  assert.equal(readSavedGameOnCard('parent-user', storage), null);
});

test('deleting another event leaves an independent Game On Card untouched', async () => {
  const storage = createStorage();
  const card = savedCard('standalone-card-event');
  writeSavedGameOnCard('parent-user', card, storage);
  let revokeCalls = 0;

  const didRevoke = await revokeGameOnCardForScheduleEvent({
    userId: 'parent-user',
    eventId: 'different-calendar-game',
    storage,
    revokeShare: async () => { revokeCalls += 1; },
  });

  assert.equal(didRevoke, false);
  assert.equal(revokeCalls, 0);
  assert.deepEqual(readSavedGameOnCard('parent-user', storage), card);
});

test('a failed server revocation keeps the saved card available for retry', async () => {
  const storage = createStorage();
  const card = savedCard('calendar-game');
  writeSavedGameOnCard('parent-user', card, storage);

  await assert.rejects(
    revokeGameOnCardForScheduleEvent({
      userId: 'parent-user',
      eventId: 'calendar-game',
      storage,
      revokeShare: async () => { throw new Error('server unavailable'); },
    }),
    /server unavailable/,
  );
  assert.deepEqual(readSavedGameOnCard('parent-user', storage), card);
});

test('revocation does not remove a newer card saved while the request was pending', async () => {
  const storage = createStorage();
  const newerCard = savedCard('new-calendar-game', 'share-newer');
  writeSavedGameOnCard('parent-user', savedCard('calendar-game'), storage);

  await revokeGameOnCardForScheduleEvent({
    userId: 'parent-user',
    eventId: 'calendar-game',
    storage,
    revokeShare: async () => writeSavedGameOnCard('parent-user', newerCard, storage),
  });

  assert.deepEqual(readSavedGameOnCard('parent-user', storage), newerCard);
  assert.equal(gameOnCardStorageKey('parent-user'), 'pixlsports-game-on-card:parent-user');
  assert.equal(removeSavedGameOnCard('parent-user', 'share-linked', storage), false);
});