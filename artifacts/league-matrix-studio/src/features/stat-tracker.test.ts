import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addStatEvent,
  createGameSession,
  endGame,
  normalizeTrackerData,
  seasonTotals,
  undoLastStatEvent,
} from './stat-tracker';

test('sport rules award points while retaining zero-point stat counts', () => {
  let game = createGameSession('soccer', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  game = addStatEvent(game, 'goal', new Date('2026-09-17T12:01:00Z'));
  game = addStatEvent(game, 'shot', new Date('2026-09-17T12:02:00Z'));

  assert.equal(game.score, 1);
  assert.deepEqual(game.stats, { goal: 1, shot: 1 });
  assert.equal(game.events.length, 2);
});

test('undo reverses the most recent event and its score contribution', () => {
  let game = createGameSession('basketball', {}, new Date('2026-09-17T12:00:00Z'));
  game = addStatEvent(game, 'three-point', new Date('2026-09-17T12:01:00Z'));
  game = addStatEvent(game, 'rebound', new Date('2026-09-17T12:02:00Z'));
  game = undoLastStatEvent(game);

  assert.equal(game.score, 3);
  assert.deepEqual(game.stats, { 'three-point': 1 });
  assert.equal(game.events.length, 1);
});

test('paused games ignore stat taps until resumed', () => {
  const game = { ...createGameSession('football', {}, new Date('2026-09-17T12:00:00Z')), status: 'paused' as const };
  assert.deepEqual(addStatEvent(game, 'touchdown'), game);
});

test('season totals only include completed games of the selected sport', () => {
  let soccer = createGameSession('soccer', {}, new Date('2026-09-17T12:00:00Z'));
  soccer = endGame(addStatEvent(soccer, 'goal', new Date('2026-09-17T12:01:00Z')), new Date('2026-09-17T13:00:00Z'));
  const basketball = endGame(createGameSession('basketball', {}, new Date('2026-09-18T12:00:00Z')));

  assert.deepEqual(seasonTotals([soccer, basketball], 'soccer'), {
    gamesPlayed: 1,
    score: 1,
    stats: { goal: 1 },
  });
});

test('invalid saved tracker payloads normalize to an empty season', () => {
  assert.deepEqual(normalizeTrackerData({ version: 99, games: [{ id: 'bad', sport: 'curling' }] }), {
    version: 1,
    games: [],
  });
});