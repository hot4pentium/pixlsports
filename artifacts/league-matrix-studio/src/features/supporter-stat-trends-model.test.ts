import assert from 'node:assert/strict';
import test from 'node:test';
import { getSportRule, type GameSession, type Sport } from './stat-tracker';
import {
  buildSupporterStatTrendModel,
  SUPPORTER_STAT_TREND_GAME_LIMIT,
} from './supporter-stat-trends-model';

function game(
  id: string,
  sport: Sport,
  date: string,
  options: Partial<GameSession> = {},
): GameSession {
  return {
    id,
    sport,
    status: 'final',
    date,
    opponent: `Opponent ${id}`,
    period: 1,
    score: 0,
    opponentScore: 0,
    scoreRecorded: false,
    notes: '',
    stats: {},
    events: [],
    startedAt: `${date}T18:00:00.000Z`,
    ...options,
  };
}

test('supporter trends follow the profile sport and use the latest completed game when it is unset', () => {
  const basketballStat = getSportRule('basketball').stats[0].id;
  const games = [
    game('baseball-old', 'baseball', '2026-09-01', { score: 4, scoreRecorded: true }),
    game('basketball-new', 'basketball', '2026-10-01', {
      score: 72,
      scoreRecorded: true,
      stats: { [basketballStat]: 8 },
    }),
  ];

  const inferred = buildSupporterStatTrendModel(games, null);
  assert.equal(inferred.sport, 'basketball');
  assert.deepEqual(inferred.points.map((point) => point.gameId), ['basketball-new']);

  const profileSport = buildSupporterStatTrendModel(games, 'baseball');
  assert.equal(profileSport.sport, 'baseball');
  assert.deepEqual(profileSport.points.map((point) => point.gameId), ['baseball-old']);
});

test('score trends omit unrecorded scores and include an intentionally recorded zero', () => {
  const games = [
    game('unknown-score', 'basketball', '2026-09-01', { score: 0 }),
    game('recorded-zero', 'basketball', '2026-09-02', { score: 0, scoreRecorded: true }),
    game('recorded-score', 'basketball', '2026-09-03', { score: 58, scoreRecorded: true }),
  ];

  const model = buildSupporterStatTrendModel(games, 'basketball', 'team-score');

  assert.deepEqual(model.points.map((point) => [point.gameId, point.value]), [
    ['recorded-zero', 0],
    ['recorded-score', 58],
  ]);
});

test('stat trends use chronological completed games and cap the visible window', () => {
  const statId = getSportRule('basketball').stats[0].id;
  const games = Array.from({ length: SUPPORTER_STAT_TREND_GAME_LIMIT + 2 }, (_, index) => (
    game(`game-${index + 1}`, 'basketball', `2026-09-${String(index + 1).padStart(2, '0')}`, {
      stats: { [statId]: index + 1 },
    })
  )).reverse();

  const model = buildSupporterStatTrendModel(games, 'basketball', statId);

  assert.equal(model.availableGameCount, SUPPORTER_STAT_TREND_GAME_LIMIT + 2);
  assert.deepEqual(model.points.map((point) => point.gameId), [
    'game-3',
    'game-4',
    'game-5',
    'game-6',
    'game-7',
    'game-8',
  ]);
  assert.deepEqual(model.points.map((point) => point.value), [3, 4, 5, 6, 7, 8]);
});

test('no trend metrics are invented when completed games contain no recorded stats or scores', () => {
  const model = buildSupporterStatTrendModel([
    game('empty-final', 'soccer', '2026-09-01'),
  ], 'soccer');

  assert.equal(model.sport, 'soccer');
  assert.deepEqual(model.metrics, []);
  assert.equal(model.selectedMetric, null);
  assert.deepEqual(model.points, []);
});
