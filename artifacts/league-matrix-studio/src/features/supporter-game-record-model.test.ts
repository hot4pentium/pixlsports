import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSupporterGameRecord } from './supporter-game-record-model';

test('supporter record counts only explicitly scored final games for the selected sport', () => {
  const games = [
    { id: 'win', status: 'final', sport: 'baseball', score: 8, opponentScore: 2 },
    { id: 'loss', status: 'final', sport: 'baseball', score: 1, opponentScore: 4 },
    { id: 'tie', status: 'final', sport: 'baseball', score: 0, opponentScore: 0 },
    { id: 'unscored', status: 'final', sport: 'baseball', score: 5, opponentScore: 0 },
    { id: 'live', status: 'live', sport: 'baseball', score: 9, opponentScore: 1 },
    { id: 'other-sport', status: 'final', sport: 'softball', score: 7, opponentScore: 1 },
  ] as const;

  assert.deepEqual(
    buildSupporterGameRecord(games, new Set(['win', 'loss', 'tie', 'live', 'other-sport']), 'baseball'),
    { wins: 1, losses: 1, ties: 1, gamesPlayed: 3 },
  );
});

test('supporter record stays empty when there are no explicitly scored final games', () => {
  assert.deepEqual(
    buildSupporterGameRecord(
      [{ id: 'pending', status: 'final', sport: 'basketball', score: 0, opponentScore: 0 }],
      new Set(),
      'basketball',
    ),
    { wins: 0, losses: 0, ties: 0, gamesPlayed: 0 },
  );
});