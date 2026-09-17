import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addStatEvent,
  adjustScore,
  createGameSession,
  endGame,
  mergeTrackerData,
  normalizeTrackerData,
  seasonTotals,
  trackerSaveErrorMessage,
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

test('manual score adjustments track both sides and never go below zero', () => {
  let game = createGameSession('basketball', {}, new Date('2026-09-17T12:00:00Z'));
  game = addStatEvent(game, 'three-point', new Date('2026-09-17T12:01:00Z'));
  game = adjustScore(game, 'opponent', 4);
  game = adjustScore(game, 'athlete', -10);

  assert.equal(game.score, 0);
  assert.equal(game.opponentScore, 4);
  assert.equal(game.stats['three-point'], 1);
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

test('legacy saved games receive safe opponent score and notes defaults', () => {
  const game = createGameSession('soccer', { opponent: 'Northside' });
  const normalized = normalizeTrackerData({ games: [{ ...game, opponentScore: undefined, notes: undefined }] });

  assert.equal(normalized.games[0]?.opponentScore, 0);
  assert.equal(normalized.games[0]?.notes, '');
});

test('reload merges locally saved games with cloud history without replacing either copy', () => {
  const localGame = endGame(
    addStatEvent(createGameSession('soccer', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z')), 'goal'),
    new Date('2026-09-17T13:00:00Z'),
  );
  const cloudGame = endGame(
    addStatEvent(createGameSession('soccer', { opponent: 'Westview' }, new Date('2026-09-16T12:00:00Z')), 'assist'),
    new Date('2026-09-16T13:00:00Z'),
  );

  const merged = mergeTrackerData(
    { version: 1, games: [localGame] },
    { version: 1, games: [cloudGame] },
  );

  assert.deepEqual(merged.games.map((game) => game.id), [localGame.id, cloudGame.id]);
  assert.equal(merged.games.find((game) => game.id === localGame.id)?.opponent, 'Northside');
  assert.equal(seasonTotals(merged.games, 'soccer').gamesPlayed, 2);
});

test('a later successful sync preserves games kept locally through a failed sync and reload', () => {
  const firstGame = endGame(
    addStatEvent(createGameSession('basketball', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z')), 'three-point'),
    new Date('2026-09-17T13:00:00Z'),
  );
  const secondGame = endGame(
    addStatEvent(createGameSession('basketball', { opponent: 'Westview' }, new Date('2026-09-18T12:00:00Z')), 'two-point'),
    new Date('2026-09-18T13:00:00Z'),
  );

  // The failed update leaves the first completed game only on the device.
  const afterFailedSync = { version: 1 as const, games: [firstGame] };
  // Reload must merge that local copy with the older cloud project rather than
  // replacing it, so the next successful save can send both games.
  const afterReload = mergeTrackerData(afterFailedSync, { version: 1, games: [] });
  const afterLaterSave = mergeTrackerData(
    { ...afterReload, games: [...afterReload.games, secondGame] },
    { version: 1, games: [firstGame, secondGame] },
  );

  assert.deepEqual(afterLaterSave.games.map((game) => game.id), [firstGame.id, secondGame.id]);
  assert.deepEqual(seasonTotals(afterLaterSave.games, 'basketball'), {
    gamesPlayed: 2,
    score: 5,
    stats: { 'three-point': 1, 'two-point': 1 },
  });
});

test('revision conflicts explain how to recover without discarding the local game', () => {
  const message = trackerSaveErrorMessage({ status: 409 });

  assert.match(message, /local game is safe/);
  assert.match(message, /reload this page/);
});