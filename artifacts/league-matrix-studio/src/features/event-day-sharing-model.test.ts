import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dismissEventDaySharing,
  getEventDaySharingDismissalKey,
  getEventLocalDate,
  getOwnerEventDayReminders,
  hasDismissedEventDaySharing,
  type OwnerAthletePage,
} from './event-day-sharing-model';

const baseInvite: OwnerAthletePage = {
  inviteToken: 'invite-1',
  athleteName: 'Alex',
  timezone: 'America/Los_Angeles',
  paused: false,
  showHypeCard: true,
  events: [{
    eventId: 'game-1',
    shareToken: 'share-1',
    title: 'Game On',
    date: '2026-04-20',
    time: '18:00',
    type: 'game',
    status: 'upcoming',
    opponent: 'Falcons',
    location: 'Home',
  }],
};

test('event-day reminder uses the athlete page saved timezone local date', () => {
  const now = new Date('2026-04-21T02:00:00.000Z');
  assert.equal(getEventLocalDate(now, 'America/Los_Angeles'), '2026-04-20');
  assert.equal(getEventLocalDate(now, 'invalid/timezone'), null);
  const reminders = getOwnerEventDayReminders({
    invites: [baseInvite],
    dashboardEvents: [{ id: 'game-1', type: 'game', date: '2026-04-20', status: 'upcoming' }],
    now,
  });
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].events[0].eventId, 'game-1');
});

test('event-day reminder excludes inactive, final, moved, and unlinked events', () => {
  const now = new Date('2026-04-21T02:00:00.000Z');
  const excluded: OwnerAthletePage[] = [
    { ...baseInvite, paused: true },
    { ...baseInvite, showHypeCard: false },
    { ...baseInvite, events: [{ ...baseInvite.events![0], status: 'final' }] },
    { ...baseInvite, events: [{ ...baseInvite.events![0], shareToken: '' }] },
  ];
  assert.deepEqual(getOwnerEventDayReminders({
    invites: excluded,
    dashboardEvents: [{ id: 'game-1', type: 'game', date: '2026-04-20', status: 'final' }],
    now,
  }), []);
  assert.deepEqual(getOwnerEventDayReminders({
    invites: [baseInvite],
    dashboardEvents: [{ id: 'game-1', type: 'game', date: '2026-04-21', status: 'upcoming' }],
    now,
  }), []);
});

test('event-day reminder includes explicitly linked standalone shares without a dashboard event', () => {
  const now = new Date('2026-04-21T02:00:00.000Z');
  const standalone = { ...baseInvite.events![0], eventId: 'standalone-game' };
  const reminders = getOwnerEventDayReminders({
    invites: [{ ...baseInvite, events: [standalone] }],
    dashboardEvents: [],
    now,
  });
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].events[0].eventId, 'standalone-game');
});

test('event-day reminder includes linked practice cards and consolidates same-day events', () => {
  const now = new Date('2026-04-21T02:00:00.000Z');
  const practice = { ...baseInvite.events![0], eventId: 'practice-1', shareToken: 'share-practice', type: 'practice' };
  const reminders = getOwnerEventDayReminders({
    invites: [{ ...baseInvite, events: [baseInvite.events![0], practice] }],
    dashboardEvents: [
      { id: 'game-1', type: 'game', date: '2026-04-20', status: 'upcoming' },
      { id: 'practice-1', type: 'practice', date: '2026-04-20', status: 'upcoming' },
    ],
    now,
  });
  assert.equal(reminders.length, 1);
  assert.deepEqual(reminders[0].events.map((event) => event.eventId), ['game-1', 'practice-1']);
});

test('dismissal is scoped to owner and local event date', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  dismissEventDaySharing(storage, 'owner-1', ['2026-04-20']);
  assert.equal(hasDismissedEventDaySharing(storage, 'owner-1', '2026-04-20'), true);
  assert.equal(hasDismissedEventDaySharing(storage, 'owner-2', '2026-04-20'), false);
  assert.equal(hasDismissedEventDaySharing(storage, 'owner-1', '2026-04-21'), false);
  assert.equal(getEventDaySharingDismissalKey('owner-1', '2026-04-20'), 'pixlsports-owner-event-day-sharing:owner-1:2026-04-20');
});