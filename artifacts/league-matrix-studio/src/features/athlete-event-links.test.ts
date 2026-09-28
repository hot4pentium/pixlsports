import assert from 'node:assert/strict';
import test from 'node:test';
import type { AthleteInviteEventSummary } from '@workspace/api-client-react';
import { athleteLocalDate, gameOnHref, hasEventToday } from './athlete-event-links';

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