import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyFinalGameCorrection,
  combineTrackerReviewHistory,
  createGameSession,
  endGame,
  mergeTrackerData,
} from './stat-tracker';

test('season review keeps the cloud version of a shared game and includes device-only finals', () => {
  const original = endGame(createGameSession('soccer', { date: '2026-09-26', opponent: 'North' }));
  const localOnly = endGame(createGameSession('soccer', { date: '2026-09-27', opponent: 'South' }));
  const newerCloud = { ...original, score: 3, opponentScore: 1, scoreRecorded: true, outcome: 'win' as const };
  const result = combineTrackerReviewHistory(
    { version: 1, games: [original, localOnly] },
    { version: 1, games: [newerCloud] },
  );
  assert.deepEqual(result.games.find((game) => game.id === original.id), newerCloud);
  assert.ok(result.games.some((game) => game.id === localOnly.id));
});

test('scoreless manual results survive an unrelated final-stat correction', () => {
  const game = endGame({ ...createGameSession('soccer', { opponent: 'North' }), outcome: 'win' });
  const corrected = applyFinalGameCorrection(game, {
    scoreRecorded: false, score: 0, opponentScore: 0, outcome: 'win',
    stats: { goal: 2 }, athleteStats: { goal: 1 },
  });
  assert.equal(corrected.outcome, 'win');
  assert.equal(corrected.scoreRecorded, false);
  assert.equal(corrected.stats.goal, 2);
  assert.equal(corrected.finalCorrection?.athleteStats.goal, 1);
  assert.deepEqual(corrected.events, game.events);
});

test('a later tracker save from a stale device preserves a corrected cloud final', () => {
  const staleFinal = endGame(createGameSession('soccer', { date: '2026-09-26', opponent: 'North' }));
  const correctedCloudFinal = applyFinalGameCorrection(staleFinal, {
    scoreRecorded: true, score: 2, opponentScore: 1, outcome: 'win',
    stats: { goal: 2 }, athleteStats: { goal: 1 },
  });
  const laterGame = endGame(createGameSession('soccer', { date: '2026-09-27', opponent: 'South' }));
  const merged = mergeTrackerData(
    { version: 1, games: [staleFinal, laterGame] },
    { version: 1, games: [correctedCloudFinal] },
  );
  assert.deepEqual(merged.games.find((game) => game.id === staleFinal.id), correctedCloudFinal);
  assert.ok(merged.games.some((game) => game.id === laterGame.id));
  assert.deepEqual(merged.games.find((game) => game.id === staleFinal.id)?.events, staleFinal.events);
});