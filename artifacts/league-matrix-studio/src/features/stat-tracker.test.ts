import assert from 'node:assert/strict';
import test from 'node:test';
import { act, create } from 'react-test-renderer';
import { createElement } from 'react';

import {
  addStatEvent,
  adjustScore,
  createGameSession,
  endGame,
  getTrackerStorageKeys,
  getSportRule,
  isTrackerRevisionConflict,
  migrateLegacyTrackerStorage,
  mergeTrackerData,
  normalizeTrackerData,
  readStoredActiveGame,
  readStoredTrackerData,
  seasonTotals,
  trackerSaveErrorMessage,
  undoLastStatEvent,
} from './stat-tracker';
import { LiveTrackerGame } from './stat-tracker-page';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    has: (key: string) => values.has(key),
  };
}

test('mobile live game keeps scoreboard and stat controls ahead of recent activity', () => {
  const game = createGameSession('basketball', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  const rule = getSportRule('basketball');
  let changedGame = game;
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(createElement(LiveTrackerGame, {
      currentGame: game,
      rule,
      athleteName: 'Jordan',
      teamName: 'Northside',
      displayStats: rule.stats.filter((item) => item.featured),
      showAllStats: false,
      saving: false,
      onGameChange: (nextGame: typeof game) => { changedGame = nextGame; },
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });

  const layout = renderer.root.findByProps({ 'data-testid': 'live-tracker-layout' });
  const regionIds = new Set([
    'live-tracker-scoreboard',
    'live-tracker-stat-controls',
    'live-tracker-recent-activity',
  ]);
  const regions = layout
    .findAll((node) => regionIds.has(node.props['data-testid']))
    .map((node) => node.props['data-testid']);

  assert.deepEqual(regions, [
    'live-tracker-scoreboard',
    'live-tracker-stat-controls',
    'live-tracker-recent-activity',
  ]);
  assert.match(renderer.root.findByProps({ 'data-testid': 'live-tracker-scoreboard' }).parent.props.className, /order-1/);
  assert.match(renderer.root.findByProps({ 'data-testid': 'live-tracker-stat-controls' }).props.className, /order-2/);
  assert.match(renderer.root.findByProps({ 'data-testid': 'live-tracker-recent-activity' }).props.className, /order-3/);

  const addAthleteScore = renderer.root.findByProps({ 'data-testid': 'score-adjust-athlete-increase' });
  assert.match(addAthleteScore.props.className, /min-h-11/);
  assert.match(addAthleteScore.props.className, /min-w-11/);
  act(() => addAthleteScore.props.onClick());
  assert.equal(changedGame.score, 1);

  const threePointStat = renderer.root.findByProps({ 'data-testid': 'live-stat-three-point' });
  act(() => threePointStat.props.onClick());
  assert.equal(changedGame.stats['three-point'], 1);
});

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

test('legacy tracker storage migrates into the first signed-in account namespace', () => {
  const game = endGame(createGameSession('soccer', { opponent: 'Northside' }));
  const storage = createMemoryStorage({
    'leaguematrix-stat-tracker': JSON.stringify({ version: 1, games: [game] }),
    'leaguematrix-stat-tracker-active-game': JSON.stringify(createGameSession('basketball', {})),
  });

  const accountA = readStoredTrackerData(storage, 'user_a');
  const activeA = readStoredActiveGame(storage, 'user_a');

  assert.deepEqual(accountA.games.map((item) => item.id), [game.id]);
  assert.equal(activeA?.sport, 'basketball');
  assert.equal(storage.has('leaguematrix-stat-tracker'), false);
  assert.equal(storage.has('leaguematrix-stat-tracker-active-game'), false);
  assert.equal(storage.has(getTrackerStorageKeys('user_a').history), true);
  assert.equal(storage.has(getTrackerStorageKeys('user_a').activeGame), true);
});

test('switching accounts and reloading never reads or merges the previous account history', () => {
  const accountAGame = endGame(createGameSession('soccer', { opponent: 'Northside' }));
  const accountBGame = endGame(createGameSession('soccer', { opponent: 'Westview' }));
  const storage = createMemoryStorage({
    [getTrackerStorageKeys('user_a').history]: JSON.stringify({ version: 1, games: [accountAGame] }),
  });

  const accountA = readStoredTrackerData(storage, 'user_a');
  const accountBOnSwitch = readStoredTrackerData(storage, 'user_b');
  storage.setItem(getTrackerStorageKeys('user_b').history, JSON.stringify({ version: 1, games: [accountBGame] }));
  const accountBAfterReload = readStoredTrackerData(storage, 'user_b');
  const accountAAfterSwitchBack = readStoredTrackerData(storage, 'user_a');

  assert.deepEqual(accountA.games.map((item) => item.id), [accountAGame.id]);
  assert.deepEqual(accountBOnSwitch.games, []);
  assert.deepEqual(accountBAfterReload.games.map((item) => item.id), [accountBGame.id]);
  assert.deepEqual(accountAAfterSwitchBack.games.map((item) => item.id), [accountAGame.id]);
  assert.equal(accountBAfterReload.games.some((item) => item.id === accountAGame.id), false);
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

  assert.equal(isTrackerRevisionConflict({ status: 409 }), true);
  assert.match(message, /local history is safe/);
  assert.match(message, /refresh this page/);
});

test('ordinary sync failures remain retryable instead of looking like conflicts', () => {
  assert.equal(isTrackerRevisionConflict({ status: 503 }), false);
  assert.match(trackerSaveErrorMessage({ status: 503 }), /Try saving again/);
});