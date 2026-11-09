import assert from 'node:assert/strict';
import test from 'node:test';
import type { AthleteInviteEventSummary } from '@workspace/api-client-react';
import {
  athleteLocalDate,
  athleteEventTimeDisplay,
  gameOnHref,
  hasEventToday,
  recentUpcomingAthleteEvents,
} from './athlete-event-links';

test('shared event times consistently use 12-hour AM/PM without changing the wall time', () => {
  for (const [input, expected] of [
    ['00:00', '12:00 AM'], ['12:00', '12:00 PM'], ['21:05', '9:05 PM'],
    ['9:05 pm', '9:05 PM'], ['09:05', '9:05 AM'], ['23:59', '11:59 PM'],
    ['', ''], ['TBA', 'TBA'], ['25:00', '25:00'], ['12:65', '12:65'],
  ]) assert.equal(athleteEventTimeDisplay(input!), expected);
});

const event: AthleteInviteEventSummary = {
  shareToken: 'marked_card', eventId: 'game-7', title: 'Saturday fixture',
  date: '2026-05-20', time: '18:30', type: 'game', status: 'upcoming',
  opponent: 'Westside', location: 'Community field',
};

test('today belongs to the invite timezone, not the viewer timezone', () => {
  const instant = new Date('2026-05-21T01:30:00Z');
  assert.equal(athleteLocalDate(instant, 'America/Los_Angeles'), '2026-05-20');
  assert.equal(hasEventToday([event], 'America/Los_Angeles', instant), true);
  assert.equal(hasEventToday([event], 'UTC', instant), false);
  assert.equal(hasEventToday([event], null, instant), false);
  assert.equal(hasEventToday([event], 'Not/A_Timezone', instant), false);
  assert.equal(hasEventToday([{ ...event, status: 'final' }], 'America/Los_Angeles', instant), false);
  assert.equal(hasEventToday([{ ...event, status: 'live' }], 'America/Los_Angeles', instant), true);
});

test('linked card navigation uses only the explicit share token, safely encoded', () => {
  assert.equal(gameOnHref('abc_def-123'), '/game-on/abc_def-123');
  assert.equal(gameOnHref('a/b?c'), '/game-on/a%2Fb%3Fc');
});

test('shared Event Cards prioritize the next three upcoming dates and fill from recent past events', () => {
  const events = [
    { ...event, date: '2026-05-18', eventId: 'past-1' },
    { ...event, date: '2026-05-19', eventId: 'past-2' },
    { ...event, date: '2026-05-20', eventId: 'past-3' },
    { ...event, date: '2026-05-21', eventId: 'today-final', status: 'final' as const },
    { ...event, date: '2026-05-22', eventId: 'next-1' },
    { ...event, date: '2026-05-23', eventId: 'next-2' },
    { ...event, date: '2026-05-24', eventId: 'next-3' },
    { ...event, date: '2026-05-25', eventId: 'next-4' },
  ];

  assert.deepEqual(
    recentUpcomingAthleteEvents(events, '2026-05-21').map(({ eventId }) => eventId),
    ['next-1', 'next-2', 'next-3'],
  );
  assert.deepEqual(
    recentUpcomingAthleteEvents(events.slice(0, 6), '2026-05-21').map(({ eventId }) => eventId),
    ['today-final', 'next-1', 'next-2'],
  );
  assert.deepEqual(
    recentUpcomingAthleteEvents(events.slice(0, 4), '2026-05-21').map(({ eventId }) => eventId),
    ['past-2', 'past-3', 'today-final'],
  );
});