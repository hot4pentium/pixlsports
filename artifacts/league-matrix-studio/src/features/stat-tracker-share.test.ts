import assert from 'node:assert/strict';
import test from 'node:test';
import { toStatTrackerShareInput } from './stat-tracker-share';
import type { GameSession } from './stat-tracker';

function game(): GameSession {
  return {
    id: 'game-1',
    sport: 'football',
    status: 'live',
    date: '2026-09-21',
    opponent: 'Northside',
    period: 2,
    score: 14,
    opponentScore: 7,
    notes: 'private note',
    stats: { touchdown: 2 },
    trackYards: true,
    yardStats: { 'pass-yard': 20 },
    startedAt: '2026-09-21T18:00:00.000Z',
    events: Array.from({ length: 11 }, (_, index) => ({
      id: `event-${index}`,
      statId: 'touchdown',
      createdAt: `2026-09-21T18:0${index}:00.000Z`,
      period: 2,
      ...(index % 2 ? { yards: index } : {}),
    })),
  };
}

test('tracker share input is explicitly sanitized and keeps the last ten events', () => {
  const input = toStatTrackerShareInput(game(), 'Maya', 'Falcons');
  assert.deepEqual(Object.keys(input), ['athleteName', 'teamName', 'game']);
  assert.equal(input.game.events.length, 10);
  assert.equal(input.game.events[0]?.id, 'event-1');
  assert.equal(input.game.events.at(-1)?.id, 'event-10');
  assert.equal(input.game.events[0]?.yards, 1);
  assert.equal(input.game.events[1]?.yards, null);
  assert.equal('notes' in input.game, false);
  assert.equal('startedAt' in input.game, false);
  assert.equal('endedAt' in input.game, false);
  assert.deepEqual(Object.keys(input.game.events[0] ?? {}).sort(), ['createdAt', 'id', 'period', 'statId', 'yards']);
});