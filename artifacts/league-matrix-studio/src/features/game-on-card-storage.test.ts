import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gameOnCardStorageKey,
  gameOnCardStorageListKey,
  readSavedGameOnCards,
  readSavedGameOnCard,
  removeSavedGameOnCard,
  revokeGameOnCardForScheduleEvent,
  upsertSavedGameOnCard,
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
  upsertSavedGameOnCard('parent-user', savedCard('calendar-game'), storage);

  await revokeGameOnCardForScheduleEvent({
    userId: 'parent-user',
    eventId: 'calendar-game',
    storage,
    revokeShare: async () => upsertSavedGameOnCard('parent-user', newerCard, storage),
  });

  assert.deepEqual(readSavedGameOnCards('parent-user', storage), [newerCard]);
  assert.equal(gameOnCardStorageKey('parent-user'), 'pixlsports-game-on-card:parent-user');
  assert.equal(removeSavedGameOnCard('parent-user', 'share-linked', storage), false);
});

test('saved-card list upserts by token and keeps distinct cards and the legacy record', () => {
  const storage = createStorage();
  const legacy = savedCard('legacy-event', 'legacy-token');
  const first = savedCard('event-one', 'share-one');
  const second = savedCard('event-two', 'share-two');
  const replacement = { ...first, title: 'Updated title' };
  writeSavedGameOnCard('parent-user', legacy, storage);
  upsertSavedGameOnCard('parent-user', first, storage);
  upsertSavedGameOnCard('parent-user', second, storage);
  upsertSavedGameOnCard('parent-user', replacement, storage);

  assert.deepEqual(readSavedGameOnCards('parent-user', storage), [
    legacy,
    replacement,
    second,
  ]);
  assert.deepEqual(readSavedGameOnCard('parent-user', storage), legacy);
  assert.notEqual(storage.getItem(gameOnCardStorageKey('parent-user')), null);
});

test('list reader returns only validated records and handles corrupt list JSON', () => {
  const storage = createStorage();
  const valid = savedCard('valid-event', 'valid-share');
  storage.setItem(gameOnCardStorageListKey('parent-user'), JSON.stringify([
    valid,
    { ...valid, shareToken: 42 },
    { ...valid, event: { ...valid.event, status: 'unknown' } },
  ]));
  assert.deepEqual(readSavedGameOnCards('parent-user', storage), [valid]);

  storage.setItem(gameOnCardStorageListKey('parent-user'), '{broken');
  assert.deepEqual(readSavedGameOnCards('parent-user', storage), []);
});

test('a saved practice stays a practice after reload without changing legacy game records', () => {
  const storage = createStorage();
  const practice = {
    ...savedCard('practice-event', 'practice-share'),
    event: { ...savedCard('practice-event', 'practice-share').event, type: 'practice' as const, opponent: '' },
  };
  upsertSavedGameOnCard('parent-user', practice, storage);
  assert.deepEqual(readSavedGameOnCards('parent-user', storage), [practice]);
  assert.equal(readSavedGameOnCards('parent-user', storage)[0]?.event.type, 'practice');
});

test('a saved event keeps its optional IANA timezone through local storage', () => {
  const storage = createStorage();
  const card = {
    ...savedCard('timezone-event', 'timezone-share'),
    event: { ...savedCard('timezone-event', 'timezone-share').event, timezone: 'America/Los_Angeles' },
  };

  upsertSavedGameOnCard('parent-user', card, storage);

  assert.equal(readSavedGameOnCards('parent-user', storage)[0]?.event.timezone, 'America/Los_Angeles');
});

test('deleting an event revokes every linked list card and preserves independent cards', async () => {
  const storage = createStorage();
  const linkedOne = savedCard('calendar-game', 'linked-one');
  const linkedTwo = savedCard('calendar-game', 'linked-two');
  const independent = savedCard('standalone-game', 'independent');
  upsertSavedGameOnCard('parent-user', linkedOne, storage);
  upsertSavedGameOnCard('parent-user', linkedTwo, storage);
  upsertSavedGameOnCard('parent-user', independent, storage);
  const revoked: string[] = [];

  const didRevoke = await revokeGameOnCardForScheduleEvent({
    userId: 'parent-user',
    eventId: 'calendar-game',
    storage,
    revokeShare: async (shareToken) => { revoked.push(shareToken); },
  });

  assert.equal(didRevoke, true);
  assert.deepEqual(revoked, ['linked-one', 'linked-two']);
  assert.deepEqual(readSavedGameOnCards('parent-user', storage), [independent]);
});

test('calendar deletion also revokes owner-listed cards from another device without touching independent cards', async () => {
  const storage = createStorage();
  const independent = savedCard('standalone-game', 'independent');
  upsertSavedGameOnCard('parent-user', independent, storage);
  const revoked: string[] = [];
  const didRevoke = await revokeGameOnCardForScheduleEvent({
    userId: 'parent-user',
    eventId: 'calendar-practice',
    linkedShareTokens: ['remote-practice'],
    storage,
    revokeShare: async (shareToken) => { revoked.push(shareToken); },
  });
  assert.equal(didRevoke, true);
  assert.deepEqual(revoked, ['remote-practice']);
  assert.deepEqual(readSavedGameOnCards('parent-user', storage), [independent]);
});

test('failed revocation preserves that list card and remaining cards for retry', async () => {
  const storage = createStorage();
  const first = savedCard('calendar-game', 'successful-token');
  const failed = savedCard('calendar-game', 'failed-token');
  const independent = savedCard('other-event', 'independent-token');
  upsertSavedGameOnCard('parent-user', first, storage);
  upsertSavedGameOnCard('parent-user', failed, storage);
  upsertSavedGameOnCard('parent-user', independent, storage);

  await assert.rejects(
    revokeGameOnCardForScheduleEvent({
      userId: 'parent-user',
      eventId: 'calendar-game',
      storage,
      revokeShare: async (shareToken) => {
        if (shareToken === 'failed-token') throw new Error('server unavailable');
      },
    }),
    /server unavailable/,
  );
  assert.deepEqual(readSavedGameOnCards('parent-user', storage), [failed, independent]);
});

test('token removal clears matching list and legacy entries only', () => {
  const storage = createStorage();
  const legacy = savedCard('legacy-event', 'same-token');
  const matchingList = savedCard('list-event', 'same-token');
  const unrelated = savedCard('other-event', 'other-token');
  writeSavedGameOnCard('parent-user', legacy, storage);
  upsertSavedGameOnCard('parent-user', matchingList, storage);
  upsertSavedGameOnCard('parent-user', unrelated, storage);

  assert.equal(removeSavedGameOnCard('parent-user', 'same-token', storage), true);
  assert.deepEqual(readSavedGameOnCards('parent-user', storage), [unrelated]);
  assert.equal(removeSavedGameOnCard('parent-user', undefined, storage), true);
  assert.deepEqual(readSavedGameOnCards('parent-user', storage), []);
});
