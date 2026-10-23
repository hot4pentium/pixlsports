import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { needsFinalTrackerShareUpdate, toStatTrackerShareInput } from './stat-tracker-share';
import { addFootballPassReception, createGameSession } from './stat-tracker';
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
      attribution: index === 10 ? 'athlete' as const : 'team' as const,
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
  assert.equal(input.game.events[0]?.attribution, 'team');
  assert.equal(input.game.events.at(-1)?.attribution, 'athlete');
  assert.deepEqual(Object.keys(input.game.events[0] ?? {}).sort(), ['attribution', 'createdAt', 'id', 'period', 'possessionSide', 'statId', 'yards']);
});

test('athlete snapshots include full-game assigned stats before the recent feed is truncated', () => {
  const source = game();
  source.events = [
    { id: 'early-athlete', statId: 'tackle', createdAt: '2026-09-21T17:00:00Z', period: 1, attribution: 'athlete' },
    ...source.events,
    { id: 'opponent', statId: 'touchdown', createdAt: '2026-09-21T18:30:00Z', period: 2, attribution: 'athlete', possessionSide: 'opponent' },
  ];
  const input = toStatTrackerShareInput(source, 'Maya', 'Falcons');
  assert.equal(input.game.events.some((event) => event.id === 'early-athlete'), false);
  assert.deepEqual(input.game.athleteStats, { tackle: 1, touchdown: 1 });
  assert.equal(input.game.stats.touchdown, 2, 'team totals stay separate');
});

test('a cloud conflict can correct an already-final public game without duplicating unchanged shares', () => {
  const finalGame = { ...game(), status: 'final' as const };
  const published = toStatTrackerShareInput(finalGame, 'Maya', 'Falcons');
  assert.equal(needsFinalTrackerShareUpdate(published, finalGame, 'Maya', 'Falcons'), false);
  const correctedGame = { ...finalGame, score: 21, events: finalGame.events.slice(0, -1) };
  assert.equal(needsFinalTrackerShareUpdate(published, correctedGame, 'Maya', 'Falcons'), true);
  assert.equal(needsFinalTrackerShareUpdate(published, finalGame, 'Maya', 'Renamed Falcons'), true);
});

test('paired football pass and reception events keep their shared play id in a share', () => {
  const game = addFootballPassReception(
    createGameSession('football', { opponent: 'Northside' }),
    new Date('2026-09-21T18:00:00.000Z'),
    14,
    'athlete',
  );
  const input = toStatTrackerShareInput(game, 'Maya', 'Falcons');
  const [passEvent, receptionEvent] = input.game.events;

  assert.ok(passEvent?.playId);
  assert.equal(passEvent?.playId, receptionEvent?.playId);
  assert.equal(passEvent?.attribution, 'athlete');
  assert.equal(receptionEvent?.attribution, 'athlete');
  assert.equal(passEvent?.yards, 14);
  assert.equal(receptionEvent?.yards, 14);
});

test('a soccer share keeps its chosen period format for supporters', () => {
  const quarters = createGameSession('soccer', { soccerPeriodFormat: 'quarters' });
  const halves = createGameSession('soccer', { soccerPeriodFormat: 'halves' });
  assert.equal(toStatTrackerShareInput(quarters, 'Maya', 'Falcons').game.soccerPeriodFormat, 'quarters');
  assert.equal(toStatTrackerShareInput(halves, 'Maya', 'Falcons').game.soccerPeriodFormat, 'halves');
  assert.equal(toStatTrackerShareInput(game(), 'Maya', 'Falcons').game.soccerPeriodFormat, undefined);
});

test('season snapshot and recipient scoreboard use readable dark-card contrast', () => {
  assert.match(trackerPageSource, /className="[^"]*bg-card[^"]*text-card-foreground[^"]*" data-testid="stat-tracker-season-snapshot"/);
  assert.match(trackerPageSource, /Season snapshot[\s\S]*?text-muted-foreground/);
  assert.match(spectatorSource, /className="[^"]*bg-card[^"]*text-card-foreground[^"]*" data-testid="stat-tracker-scores"/);
  assert.match(spectatorSource, /data-testid="stat-tracker-scores"[\s\S]*?text-muted-foreground/);
  assert.doesNotMatch(trackerPageSource, /Season snapshot[\s\S]*?text-white\/(?:55|60|70)/);
  assert.doesNotMatch(spectatorSource, /data-testid="stat-tracker-scores"[\s\S]*?text-white\/(?:40|60|80)/);
});

test('public play-by-play labels each event with its team or athlete attribution', () => {
  assert.match(spectatorSource, /event\.attribution === "athlete"/);
  assert.match(spectatorSource, /data\.athleteName \|\| "Athlete"/);
  assert.match(spectatorSource, /data\.teamName \|\| "Team"/);
  assert.match(spectatorSource, /recent-activity-attribution-/);
});