import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addStatEvent,
  applyFinalGameCorrection,
  combineTrackerReviewHistory,
  countStatEventsByAttribution,
  createGameSession,
  endGame,
  mergeTrackerData,
  normalizeTrackerData,
} from './stat-tracker';
import { otherStatCount, validateCorrectedStatCounts } from './season-stats-validation';

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

test('athlete-only edits survive save and reload while preserving legacy non-athlete counts and final score', () => {
  const original = endGame({
    ...createGameSession('soccer', { opponent: 'North' }),
    stats: { goal: 4, save: 0 },
    score: 2,
    opponentScore: 1,
    scoreRecorded: true,
    outcome: 'win',
  });
  const saved = (game: typeof original, goal: string, save: string) => {
    const goalCounts = validateCorrectedStatCounts('Goal', goal, String(otherStatCount(
      game.stats.goal ?? 0, countStatEventsByAttribution(game, 'goal').athlete,
    )));
    const saveCounts = validateCorrectedStatCounts('Save', save, String(otherStatCount(
      game.stats.save ?? 0, countStatEventsByAttribution(game, 'save').athlete,
    )));
    assert.equal(goalCounts.valid, true);
    assert.equal(saveCounts.valid, true);
    if (!goalCounts.valid || !saveCounts.valid) throw new Error('Invalid fixture');
    return applyFinalGameCorrection(game, {
      scoreRecorded: true, score: 2, opponentScore: 1, outcome: 'win',
      stats: { goal: goalCounts.total, save: saveCounts.total },
      athleteStats: { goal: goalCounts.athlete, save: saveCounts.athlete },
    });
  };
  const first = saved(original, '2', '1');
  assert.deepEqual(first.stats, { goal: 6, save: 1 });
  const reopened = normalizeTrackerData(JSON.parse(JSON.stringify({ version: 1, games: [first] }))).games[0]!;
  assert.equal(countStatEventsByAttribution(reopened, 'goal').athlete, 2);
  assert.equal(otherStatCount(reopened.stats.goal, countStatEventsByAttribution(reopened, 'goal').athlete), 4);
  const second = saved(reopened, '1', '0');
  assert.deepEqual(second.stats, { goal: 5, save: 0 });
  assert.deepEqual(second.finalCorrection?.athleteStats, { goal: 1, save: 0 });
  assert.deepEqual(second.events, original.events);
  assert.equal(second.score, 2);
  assert.equal(second.opponentScore, 1);
  assert.equal(second.outcome, 'win');
});

test('a live-recorded team count and an older unassigned count survive an athlete correction', () => {
  let game = createGameSession('soccer', { opponent: 'South' });
  game = addStatEvent(game, 'goal', new Date(), 0, 'team');
  game = addStatEvent(game, 'goal', new Date(), 0, 'athlete');
  const original = endGame({ ...game, stats: { ...game.stats, goal: 3 } });
  const athleteBefore = countStatEventsByAttribution(original, 'goal').athlete;
  const nonAthlete = otherStatCount(original.stats.goal, athleteBefore);
  assert.equal(nonAthlete, 2);
  const counts = validateCorrectedStatCounts('Goal', '2', String(nonAthlete));
  assert.equal(counts.valid, true);
  if (!counts.valid) throw new Error('Invalid fixture');
  const corrected = applyFinalGameCorrection(original, {
    scoreRecorded: false, score: 0, opponentScore: 0, outcome: null,
    stats: { goal: counts.total }, athleteStats: { goal: counts.athlete },
  });
  assert.equal(corrected.stats.goal, 4);
  assert.equal(countStatEventsByAttribution(corrected, 'goal').athlete, 2);
  assert.deepEqual(corrected.events, original.events);
});