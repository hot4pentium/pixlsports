import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { toStatTrackerShareInput } from './stat-tracker-share';
import type { GameSession } from './stat-tracker';

const trackerPageSource = readFileSync(new URL('./stat-tracker-page.tsx', import.meta.url), 'utf8');
const spectatorSource = readFileSync(new URL('./stat-tracker-spectator.tsx', import.meta.url), 'utf8');

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

test('season snapshot and recipient scoreboard use readable dark-card contrast', () => {
  assert.match(trackerPageSource, /className="[^"]*bg-card[^"]*text-card-foreground[^"]*" data-testid="stat-tracker-season-snapshot"/);
  assert.match(trackerPageSource, /Season snapshot[\s\S]*?text-muted-foreground/);
  assert.match(spectatorSource, /className="[^"]*bg-card[^"]*text-card-foreground[^"]*" data-testid="stat-tracker-scores"/);
  assert.match(spectatorSource, /data-testid="stat-tracker-scores"[\s\S]*?text-muted-foreground/);
  assert.doesNotMatch(trackerPageSource, /Season snapshot[\s\S]*?text-white\/(?:55|60|70)/);
  assert.doesNotMatch(spectatorSource, /data-testid="stat-tracker-scores"[\s\S]*?text-white\/(?:40|60|80)/);
});