import assert from 'node:assert/strict';
import test from 'node:test';
import { act, create, type ReactTestRendererNode } from 'react-test-renderer';
import { createElement } from 'react';

import {
  addFootballPassReception,
  addStatEvent,
  adjustYardValue,
  adjustScore,
  buildGameReport,
  clearStoredTrackerConflict,
  countStatEventsByAttribution,
  createGameSession,
  endGame,
  getPreferredTrackerSport,
  getTrackerSportForProfile,
  getTrackerConflict,
  getTrackerSyncRecovery,
  getTrackerStorageKeys,
  getFootballYardMetricId,
  getSportRule,
  isTrackerRevisionConflict,
  migrateLegacyTrackerStorage,
  mergeTrackerData,
  normalizeTrackerData,
  readStoredActiveGame,
  readStoredTrackerConflict,
  readStoredTrackerData,
  saveStoredTrackerConflict,
  seasonTotals,
  seasonYardTotals,
  syncTrackerDataToCloud,
  trackerPayload,
  trackerSaveStatusMessage,
  trackerSaveErrorMessage,
  updateStatEventAttribution,
  updateStatEventYards,
  undoLastStatEvent,
} from './stat-tracker';
import {
  getNextScheduledGame,
  LiveTrackerGame,
  persistScheduledGameStatus,
  readLocalTrackerSession,
} from './stat-tracker-page';
import { GameReportView } from './stat-tracker-game-report';
import { readScheduleDraft, scheduleStorageKey, type ScheduleDraft } from './schedule-draft';

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

function renderedText(renderer: { toJSON: () => ReactTestRendererNode | ReactTestRendererNode[] | null }): string {
  const visit = (node: ReactTestRendererNode | ReactTestRendererNode[] | null): string => {
    if (node === null) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(visit).join('');
    return (node.children ?? []).map(visit).join('');
  };
  return visit(renderer.toJSON());
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
      captureNotice: '',
      onCapture: () => {},
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

test('back-to-back scoreboard taps preserve both team scores from one render', () => {
  const game = createGameSession('basketball', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  const rule = getSportRule('basketball');
  let changedGame = game;
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(createElement(LiveTrackerGame, {
      currentGame: game,
      rule,
      athleteName: 'Jordan',
      teamName: 'Falcons',
      displayStats: rule.stats.filter((item) => item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: '',
      onCapture: () => {},
      onGameChange: (nextGame: typeof game) => { changedGame = nextGame; },
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });

  const athleteIncrease = renderer.root.findByProps({ 'data-testid': 'score-adjust-athlete-increase' });
  const opponentIncrease = renderer.root.findByProps({ 'data-testid': 'score-adjust-opponent-increase' });
  act(() => {
    athleteIncrease.props.onClick();
    athleteIncrease.props.onClick();
    opponentIncrease.props.onClick();
    opponentIncrease.props.onClick();
  });

  assert.equal(changedGame.score, 2);
  assert.equal(changedGame.opponentScore, 2);
});

test('score taps preserve live totals across pause and resume while ignoring paused taps', () => {
  const rule = getSportRule('basketball');
  let changedGame = createGameSession('basketball', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  let renderer!: ReturnType<typeof create>;
  const renderGame = () => createElement(LiveTrackerGame, {
    currentGame: changedGame,
    rule,
    athleteName: 'Jordan',
    teamName: 'Falcons',
    displayStats: rule.stats.filter((item) => item.featured),
    showAllStats: false,
    saving: false,
    captureNotice: '',
    onCapture: () => {},
    onGameChange: (nextGame: typeof changedGame) => { changedGame = nextGame; },
    onToggleShowAllStats: () => {},
    onLeaveGame: () => {},
    onEndGame: () => {},
  });

  act(() => {
    renderer = create(renderGame());
  });

  act(() => {
    renderer.root.findByProps({ 'data-testid': 'score-adjust-athlete-increase' }).props.onClick();
    renderer.root.findByProps({ 'data-testid': 'score-adjust-athlete-increase' }).props.onClick();
    renderer.root.findByProps({ 'data-testid': 'score-adjust-opponent-increase' }).props.onClick();
  });
  assert.equal(changedGame.score, 2);
  assert.equal(changedGame.opponentScore, 1);

  act(() => {
    renderer.update(renderGame());
  });
  act(() => {
    renderer.root.findByProps({ 'data-testid': 'button-toggle-live-game-pause' }).props.onClick();
  });
  assert.equal(changedGame.status, 'paused');

  act(() => {
    renderer.update(renderGame());
  });
  act(() => {
    renderer.root.findByProps({ 'data-testid': 'score-adjust-athlete-increase' }).props.onClick();
    renderer.root.findByProps({ 'data-testid': 'score-adjust-opponent-increase' }).props.onClick();
  });
  assert.equal(changedGame.score, 2);
  assert.equal(changedGame.opponentScore, 1);

  act(() => {
    renderer.root.findByProps({ 'data-testid': 'button-toggle-live-game-pause' }).props.onClick();
  });
  assert.equal(changedGame.status, 'live');

  act(() => {
    renderer.update(renderGame());
  });
  act(() => {
    renderer.root.findByProps({ 'data-testid': 'score-adjust-athlete-increase' }).props.onClick();
    renderer.root.findByProps({ 'data-testid': 'score-adjust-athlete-increase' }).props.onClick();
    renderer.root.findByProps({ 'data-testid': 'score-adjust-opponent-increase' }).props.onClick();
  });
  assert.equal(changedGame.score, 4);
  assert.equal(changedGame.opponentScore, 2);
});

test('back-to-back live stat taps preserve both events from one render', () => {
  const game = createGameSession('football', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  const rule = getSportRule('football');
  let changedGame = game;
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(createElement(LiveTrackerGame, {
      currentGame: game,
      rule,
      athleteName: 'Jordan',
      teamName: 'Falcons',
      displayStats: rule.stats.filter((item) => !item.liveHidden && item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: '',
      onCapture: () => {},
      onGameChange: (nextGame: typeof game) => { changedGame = nextGame; },
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });

  act(() => {
    renderer.root.findByProps({ 'data-testid': 'live-stat-touchdown' }).props.onClick();
    renderer.root.findByProps({ 'data-testid': 'live-stat-tackle' }).props.onClick();
  });

  assert.deepEqual(changedGame.stats, { touchdown: 1, tackle: 1 });
  assert.deepEqual(changedGame.events.map((event) => event.statId), ['touchdown', 'tackle']);
  assert.equal(changedGame.score, 6);
});

test('team card and athlete avatar taps preserve separate attribution during rapid play', () => {
  const game = createGameSession('basketball', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  const rule = getSportRule('basketball');
  let changedGame = game;
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(createElement(LiveTrackerGame, {
      currentGame: game,
      rule,
      athleteName: 'Jordan Lee',
      teamName: 'Falcons',
      displayStats: rule.stats.filter((item) => item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: '',
      onCapture: () => {},
      onGameChange: (nextGame: typeof game) => { changedGame = nextGame; },
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });

  const teamTarget = renderer.root.findByProps({ 'data-testid': 'live-stat-three-point' });
  const athleteTarget = renderer.root.findByProps({ 'data-testid': 'athlete-stat-target-three-point' });
  assert.equal(teamTarget.props['aria-label'], 'Record Three-point field goal for Falcons');
  assert.equal(athleteTarget.props['aria-label'], 'Record Three-point field goal for Jordan Lee');
  assert.match(athleteTarget.props.className, /min-h-11/);
  assert.match(athleteTarget.props.className, /min-w-11/);
  assert.equal(athleteTarget.findAllByType('img').length, 0);
  assert.equal(athleteTarget.findByType('span').children.join(''), 'JL');

  act(() => {
    teamTarget.props.onClick();
    athleteTarget.props.onClick();
    teamTarget.props.onClick();
  });

  assert.deepEqual(changedGame.events.map((event) => event.attribution), ['team', 'athlete', 'team']);
  assert.deepEqual(countStatEventsByAttribution(changedGame, 'three-point'), { team: 2, athlete: 1 });
  assert.equal(changedGame.stats['three-point'], 3);

  act(() => {
    renderer.update(createElement(LiveTrackerGame, {
      currentGame: changedGame,
      rule,
      athleteName: 'Jordan Lee',
      teamName: 'Falcons',
      displayStats: rule.stats.filter((item) => item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: '',
      onCapture: () => {},
      onGameChange: (nextGame: typeof game) => { changedGame = nextGame; },
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });
  const highlightedCard = renderer.root.findByProps({ 'data-testid': 'live-stat-card-three-point' });
  assert.equal(highlightedCard.props['data-athlete-assigned'], 'true');
  assert.match(highlightedCard.props.className, /border-accent/);
  assert.equal(
    renderer.root.findByProps({ 'data-testid': 'live-stat-three-point' }).props['aria-describedby'],
    'athlete-assignment-three-point',
  );
  assert.match(
    renderer.root.findByProps({ 'data-testid': 'athlete-stat-target-three-point' }).props.className,
    /ring-accent/,
  );
});

test('an earlier play can move to the athlete without changing later plays or totals', () => {
  let game = createGameSession('basketball', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  game = addStatEvent(game, 'three-point', new Date('2026-09-17T12:01:00Z'), 0, 'team');
  game = addStatEvent(game, 'rebound', new Date('2026-09-17T12:02:00Z'), 0, 'athlete');
  const before = structuredClone(game);
  const firstEventId = game.events[0]?.id;
  assert.ok(firstEventId);

  game = updateStatEventAttribution(game, firstEventId, 'athlete');

  assert.equal(game.events[0]?.attribution, 'athlete');
  assert.deepEqual(
    game.events.map(({ attribution, ...event }) => event),
    before.events.map(({ attribution, ...event }) => event),
  );
  assert.deepEqual(game.events[1], before.events[1]);
  assert.deepEqual(game.stats, before.stats);
  assert.equal(game.score, before.score);
  assert.equal(game.opponentScore, before.opponentScore);
  assert.deepEqual(game.yardStats, before.yardStats);
});

test('recent activity exposes a mobile-sized attribution correction with its destination', () => {
  let game = createGameSession('basketball', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  game = addStatEvent(game, 'three-point', new Date('2026-09-17T12:01:00Z'), 0, 'team');
  game = addStatEvent(game, 'rebound', new Date('2026-09-17T12:02:00Z'), 0, 'team');
  const firstEventId = game.events[0]!.id;
  let changedGame = game;
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(createElement(LiveTrackerGame, {
      currentGame: game,
      rule: getSportRule('basketball'),
      athleteName: 'Jordan Lee',
      teamName: 'Falcons',
      displayStats: getSportRule('basketball').stats.filter((item) => item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: '',
      onCapture: () => {},
      onGameChange: (nextGame: typeof game) => { changedGame = nextGame; },
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });

  const correction = renderer.root.findByProps({ 'data-testid': `button-correct-attribution-${firstEventId}` });
  assert.equal(correction.props['aria-label'], 'Change Three-point field goal attribution to Jordan Lee');
  assert.match(correction.props.className, /min-h-11/);

  act(() => correction.props.onClick());

  assert.deepEqual(changedGame.events.map((event) => event.attribution), ['athlete', 'team']);
  assert.deepEqual(changedGame.events.map((event) => event.statId), ['three-point', 'rebound']);
  assert.equal(changedGame.score, game.score);
});

test('athlete stat target uses the athlete portrait crop and falls back to initials when it fails', () => {
  const game = createGameSession('basketball', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  const rule = getSportRule('basketball');
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(createElement(LiveTrackerGame, {
      currentGame: game,
      rule,
      athleteName: 'Jordan Lee',
      athleteImageUrl: '/api/supporter-photo/image?v=1',
      athleteImageCrop: { x: 20, y: 70, zoom: 150 },
      teamName: 'Falcons',
      displayStats: rule.stats.filter((item) => item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: '',
      onCapture: () => {},
      onGameChange: () => {},
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });

  const athleteTarget = renderer.root.findByProps({ 'data-testid': 'athlete-stat-target-three-point' });
  const portrait = athleteTarget.findByType('img');
  assert.equal(portrait.props.src, '/api/supporter-photo/image?v=1');
  assert.equal(portrait.props.alt, '');
  assert.equal(portrait.props.style.objectPosition, '20% 70%');
  assert.equal(portrait.props.style.transform, 'scale(1.5)');

  act(() => portrait.props.onError());

  assert.equal(athleteTarget.findAllByType('img').length, 0);
  assert.equal(athleteTarget.findByType('span').children.join(''), 'JL');
  assert.equal(athleteTarget.props['aria-label'], 'Record Three-point field goal for Jordan Lee');
  assert.match(athleteTarget.props.className, /min-h-11/);
  assert.match(athleteTarget.props.className, /min-w-11/);
});

test('legacy tracker events normalize to team attribution', () => {
  const legacy = createGameSession('soccer', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  const normalized = normalizeTrackerData({
    version: 1,
    games: [{
      ...endGame(legacy),
      stats: { goal: 1 },
      events: [{
        id: 'legacy-event',
        statId: 'goal',
        createdAt: '2026-09-17T12:01:00.000Z',
        period: 1,
      }],
    }],
  });

  assert.equal(normalized.games[0]?.events[0]?.attribution, 'team');
  assert.deepEqual(countStatEventsByAttribution(normalized.games[0]!, 'goal'), { team: 1, athlete: 0 });
});

test('football yard tracking keeps play counts while recording passing, rushing, and receiving yards', () => {
  const firstTime = new Date('2026-09-17T12:01:00Z');
  let game = createGameSession('football', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  game = addFootballPassReception(game, firstTime, 15);
  game = addStatEvent(game, 'rush-yard', new Date('2026-09-17T12:02:00Z'), 7);

  assert.equal(game.trackYards, true);
  assert.deepEqual(game.stats, { 'pass-yard': 1, 'rush-yard': 1, reception: 1 });
  assert.deepEqual(game.yardStats, {
    'pass-yard': 15,
    'rush-yard': 7,
    'receiving-yard': 15,
  });
  assert.equal(game.events[0]?.playId, game.events[1]?.playId);
  assert.equal(game.events[0]?.yards, 15);
  assert.equal(game.events[1]?.yards, 15);
  assert.equal(getFootballYardMetricId('reception'), 'receiving-yard');

  game = undoLastStatEvent(game);
  assert.equal(game.stats['pass-yard'], 1);
  assert.equal(game.stats.reception, 1);
  assert.equal(game.stats['rush-yard'], undefined);
  assert.equal(game.yardStats?.['pass-yard'], 15);
  assert.equal(game.yardStats?.['receiving-yard'], 15);

  game = undoLastStatEvent(game);
  assert.equal(game.stats['pass-yard'], undefined);
  assert.equal(game.stats.reception, undefined);
  assert.equal(game.yardStats?.['pass-yard'], undefined);
  assert.equal(game.yardStats?.['receiving-yard'], undefined);
});

test('combined football play keeps athlete attribution and synchronized yard corrections', () => {
  let game = createGameSession('football', {}, new Date('2026-09-17T12:00:00Z'));
  game = addFootballPassReception(game, new Date('2026-09-17T12:01:00Z'), 0, 'athlete');
  const passEventId = game.events.find((event) => event.statId === 'pass-yard')?.id;
  assert.ok(passEventId);

  game = updateStatEventYards(game, passEventId, 18);
  assert.deepEqual(game.events.map((event) => event.yards), [18, 18]);
  assert.deepEqual(game.events.map((event) => event.attribution), ['athlete', 'athlete']);
  assert.equal(game.yardStats?.['pass-yard'], 18);
  assert.equal(game.yardStats?.['receiving-yard'], 18);

  game = updateStatEventYards(game, passEventId, 7);
  assert.deepEqual(game.events.map((event) => event.yards), [7, 7]);
  assert.equal(game.yardStats?.['pass-yard'], 7);
  assert.equal(game.yardStats?.['receiving-yard'], 7);
});

test('football yard corrections preserve the recorded athlete attribution', () => {
  let game = createGameSession('football', {}, new Date('2026-09-17T12:00:00Z'));
  game = addStatEvent(game, 'reception', new Date('2026-09-17T12:01:00Z'), 0, 'athlete');
  const eventId = game.events[0]?.id;
  assert.ok(eventId);

  game = updateStatEventYards(game, eventId, 18);
  assert.equal(game.events[0]?.yards, 18);
  assert.equal(game.events[0]?.attribution, 'athlete');
  game = undoLastStatEvent(game);
  assert.equal(game.events.length, 0);
  assert.deepEqual(game.stats, {});
});

test('football yard tracking can be ignored while preserving one-tap play counts', () => {
  let game = createGameSession('football', {}, new Date('2026-09-17T12:00:00Z'));
  game = { ...game, trackYards: false };
  game = addStatEvent(game, 'pass-yard', new Date('2026-09-17T12:01:00Z'), 40);

  assert.deepEqual(game.stats, { 'pass-yard': 1 });
  assert.deepEqual(game.yardStats, {});
  assert.equal(game.events[0]?.yards, undefined);
});

test('football yard controls use asymmetric five-forward and one-back steps', () => {
  assert.equal(adjustYardValue(0, 5), 5);
  assert.equal(adjustYardValue(5, -1), 4);
  assert.equal(adjustYardValue(0, -1), 0);
  assert.equal(adjustYardValue(8, 5), 13);
});

test('yard adjustments update one recorded football event without adding another play', () => {
  let game = createGameSession('football', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  game = addStatEvent(game, 'reception', new Date('2026-09-17T12:01:00Z'));
  const eventId = game.events[0]?.id;
  assert.ok(eventId);

  game = updateStatEventYards(game, eventId, 12);
  assert.equal(game.events.length, 1);
  assert.equal(game.stats.reception, 1);
  assert.equal(game.events[0]?.yards, 12);
  assert.equal(game.yardStats?.['receiving-yard'], 12);

  game = updateStatEventYards(game, eventId, 7);
  assert.equal(game.events.length, 1);
  assert.equal(game.events[0]?.yards, 7);
  assert.equal(game.yardStats?.['receiving-yard'], 7);

  game = updateStatEventYards(game, eventId, 0);
  assert.equal(game.events[0]?.yards, undefined);
  assert.equal(game.yardStats?.['receiving-yard'], undefined);
});

test('football live controls stay disabled until the stat card records one play', () => {
  const game = createGameSession('football', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  const rule = getSportRule('football');
  let changedGame = game;
  let renderer!: ReturnType<typeof create>;
  const renderGame = (currentGame: typeof game) => createElement(LiveTrackerGame, {
    currentGame,
    rule,
    athleteName: 'Jordan',
    teamName: 'Falcons',
    displayStats: rule.stats.filter((item) => item.featured),
    showAllStats: false,
    saving: false,
    captureNotice: '',
    onCapture: () => {},
    onGameChange: (nextGame: typeof game) => { changedGame = nextGame; },
    onToggleShowAllStats: () => {},
    onLeaveGame: () => {},
    onEndGame: () => {},
  });

  act(() => {
    renderer = create(renderGame(game));
  });

  const toggle = renderer.root.findByProps({ 'data-testid': 'toggle-football-yard-tracking' });
  assert.equal(toggle.props.checked, true);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.disabled, true);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'yard-adjust-pass-reception-increase' }).props.disabled, true);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'yard-control-pass-reception' }).props['aria-disabled'], true);

  act(() => renderer.root.findByProps({ 'data-testid': 'live-stat-pass-reception' }).props.onClick());
  assert.equal(changedGame.events.length, 2);
  assert.equal(changedGame.stats['pass-yard'], 1);
  assert.equal(changedGame.stats.reception, 1);
  assert.equal(changedGame.events[0]?.playId, changedGame.events[1]?.playId);

  act(() => renderer.update(renderGame(changedGame)));
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.disabled, false);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'yard-adjust-pass-reception-increase' }).props.disabled, false);

  act(() => renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.onWheel({ deltaY: -1, preventDefault: () => {} }));
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.value, 5);
  act(() => renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.onWheel({ deltaY: 1, preventDefault: () => {} }));
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.value, 4);
  act(() => renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.onChange({ currentTarget: { value: '12' } }));
  act(() => renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.onKeyDown({ key: 'Enter', preventDefault: () => {} }));

  assert.equal(changedGame.stats.reception, 1);
  assert.equal(changedGame.events.length, 2);
  assert.deepEqual(changedGame.events.map((event) => event.yards), [12, 12]);
  assert.equal(changedGame.yardStats?.['pass-yard'], 12);
  assert.equal(changedGame.yardStats?.['receiving-yard'], 12);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props['aria-valuenow'], 12);

  act(() => renderer.root.findByProps({ 'data-testid': 'live-stat-rush-yard' }).props.onClick());
  act(() => renderer.update(renderGame(changedGame)));
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-rush-yard' }).props.disabled, false);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-rush-yard' }).props.value, 0);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.disabled, true);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.value, 0);

  act(() => renderer.root.findByProps({ 'data-testid': 'yard-adjust-rush-yard-increase' }).props.onClick());
  assert.equal(changedGame.yardStats?.['pass-yard'], 12);
  assert.equal(changedGame.yardStats?.['receiving-yard'], 12);
  assert.equal(changedGame.yardStats?.['rush-yard'], 5);
  const rushEvent = changedGame.events.at(-1);
  assert.equal(rushEvent?.statId, 'rush-yard');
  assert.equal(rushEvent?.yards, 5);

  act(() => renderer.root.findByProps({ 'data-testid': 'live-stat-pass-reception' }).props.onClick());
  act(() => renderer.update(renderGame(changedGame)));
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.disabled, false);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.value, 0);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-rush-yard' }).props.disabled, true);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-rush-yard' }).props.value, 0);
  assert.equal(changedGame.yardStats?.['pass-yard'], 12);
  assert.equal(changedGame.yardStats?.['receiving-yard'], 12);
  assert.equal(changedGame.yardStats?.['rush-yard'], 5);
  assert.equal(changedGame.events.at(-3)?.yards, 5);
});

test('athlete football targets reset inactive yard controls while preserving paired attribution and totals', () => {
  const game = createGameSession('football', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  const rule = getSportRule('football');
  let changedGame = game;
  let renderer!: ReturnType<typeof create>;
  const renderGame = (currentGame: typeof game) => createElement(LiveTrackerGame, {
    currentGame,
    rule,
    athleteName: 'Jordan',
    teamName: 'Falcons',
    displayStats: rule.stats.filter((item) => item.featured),
    showAllStats: false,
    saving: false,
    captureNotice: '',
    onCapture: () => {},
    onGameChange: (nextGame: typeof game) => { changedGame = nextGame; },
    onToggleShowAllStats: () => {},
    onLeaveGame: () => {},
    onEndGame: () => {},
  });

  act(() => {
    renderer = create(renderGame(game));
  });

  act(() => renderer.root.findByProps({ 'data-testid': 'athlete-stat-target-pass-reception' }).props.onClick());
  act(() => renderer.update(renderGame(changedGame)));
  act(() => renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.onChange({ currentTarget: { value: '12' } }));
  assert.equal(changedGame.events.length, 2);
  assert.deepEqual(changedGame.events.map((event) => event.attribution), ['athlete', 'athlete']);
  assert.deepEqual(changedGame.events.map((event) => event.yards), [12, 12]);
  assert.equal(changedGame.yardStats?.['pass-yard'], 12);
  assert.equal(changedGame.yardStats?.['receiving-yard'], 12);

  act(() => renderer.root.findByProps({ 'data-testid': 'athlete-stat-target-rush-yard' }).props.onClick());
  act(() => renderer.update(renderGame(changedGame)));
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.disabled, true);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.value, 0);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-rush-yard' }).props.disabled, false);
  act(() => renderer.root.findByProps({ 'data-testid': 'input-yard-rush-yard' }).props.onChange({ currentTarget: { value: '7' } }));
  assert.equal(changedGame.events.at(-1)?.attribution, 'athlete');
  assert.equal(changedGame.events.at(-1)?.yards, 7);
  assert.equal(changedGame.yardStats?.['pass-yard'], 12);
  assert.equal(changedGame.yardStats?.['receiving-yard'], 12);
  assert.equal(changedGame.yardStats?.['rush-yard'], 7);

  act(() => renderer.root.findByProps({ 'data-testid': 'athlete-stat-target-pass-reception' }).props.onClick());
  act(() => renderer.update(renderGame(changedGame)));
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-rush-yard' }).props.disabled, true);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-rush-yard' }).props.value, 0);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.disabled, false);
  act(() => renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.onChange({ currentTarget: { value: '9' } }));

  assert.equal(changedGame.events.length, 5);
  assert.deepEqual(changedGame.events.map((event) => event.attribution), ['athlete', 'athlete', 'athlete', 'athlete', 'athlete']);
  assert.deepEqual(changedGame.events.map((event) => event.yards), [12, 12, 7, 9, 9]);
  assert.equal(changedGame.yardStats?.['pass-yard'], 21);
  assert.equal(changedGame.yardStats?.['receiving-yard'], 21);
  assert.equal(changedGame.yardStats?.['rush-yard'], 7);
});

test('a restored football game can correct an earlier yard play without changing unrelated plays', () => {
  let game = createGameSession('football', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  game = addStatEvent(game, 'pass-yard', new Date('2026-09-17T12:01:00Z'), 5);
  game = addStatEvent(game, 'tackle', new Date('2026-09-17T12:02:00Z'));
  game = addStatEvent(game, 'pass-yard', new Date('2026-09-17T12:03:00Z'), 10);
  const firstPassId = game.events[0]?.id;
  const secondPassId = game.events[2]?.id;
  assert.ok(firstPassId);
  assert.ok(secondPassId);

  const rule = getSportRule('football');
  let changedGame = game;
  let renderer!: ReturnType<typeof create>;
  const renderGame = () => createElement(LiveTrackerGame, {
    currentGame: changedGame,
    rule,
    athleteName: 'Jordan',
    teamName: 'Falcons',
    displayStats: rule.stats.filter((item) => item.featured),
    showAllStats: false,
    saving: false,
    captureNotice: '',
    onCapture: () => {},
    onGameChange: (nextGame: typeof changedGame) => { changedGame = nextGame; },
    onToggleShowAllStats: () => {},
    onLeaveGame: () => {},
    onEndGame: () => {},
  });

  act(() => {
    renderer = create(renderGame());
  });

  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.disabled, false);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.value, 10);
  assert.match(renderedText(renderer), /Passing yards · 5 yds/);
  assert.match(renderedText(renderer), /Passing yards · 10 yds/);

  act(() => {
    renderer.root.findByProps({ 'data-testid': `button-correct-yards-${firstPassId}` }).props.onClick();
  });
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-pass-reception' }).props.value, 5);

  act(() => {
    renderer.root.findByProps({ 'data-testid': 'yard-adjust-pass-reception-increase' }).props.onClick();
    renderer.root.findByProps({ 'data-testid': 'yard-adjust-pass-reception-decrease' }).props.onClick();
  });

  assert.deepEqual(changedGame.events.map((event) => event.id), [firstPassId, game.events[1]?.id, secondPassId]);
  assert.deepEqual(changedGame.events.map((event) => event.yards), [9, undefined, 10]);
  assert.deepEqual(changedGame.stats, { 'pass-yard': 2, tackle: 1 });
  assert.equal(changedGame.yardStats?.['pass-yard'], 19);
});

test('baseball hit waits for a single, double, or triple choice before recording', () => {
  const game = createGameSession('baseball', { opponent: 'Northside' }, new Date('2026-09-20T12:00:00Z'));
  const rule = getSportRule('baseball');
  let changedGame = game;
  let renderer!: ReturnType<typeof create>;
  const renderGame = (currentGame: typeof game) => createElement(LiveTrackerGame, {
    currentGame,
    rule,
    athleteName: 'Jordan',
    teamName: 'Falcons',
    displayStats: rule.stats.filter((item) => !item.liveHidden && item.featured),
    showAllStats: false,
    saving: false,
    captureNotice: '',
    onCapture: () => {},
    onGameChange: (nextGame: typeof game) => { changedGame = nextGame; },
    onToggleShowAllStats: () => {},
    onLeaveGame: () => {},
    onEndGame: () => {},
  });

  act(() => {
    renderer = create(renderGame(game));
  });

  assert.deepEqual(
    rule.stats.filter((item) => item.liveHidden && ['single', 'double', 'triple'].includes(item.id)).map((item) => item.id),
    ['single', 'double', 'triple'],
  );
  act(() => renderer.root.findByProps({ 'data-testid': 'live-stat-hit' }).props.onClick());
  assert.equal(changedGame.events.length, 0);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'baseball-hit-choices' }).children.length, 3);

  act(() => renderer.root.findByProps({ 'data-testid': 'baseball-hit-double' }).props.onClick());
  assert.equal(changedGame.events.length, 1);
  assert.equal(changedGame.events[0]?.statId, 'double');
  assert.equal(changedGame.stats.double, 1);
  assert.equal(changedGame.stats.hit, undefined);

  act(() => renderer.update(renderGame(changedGame)));
  assert.equal(renderer.root.findAllByProps({ 'data-testid': 'baseball-hit-choices' }).length, 0);
  assert.match(renderedText(renderer), /HIT1 · tracked/);
});

test('baseball follow-on choices retain the athlete target that opened them', () => {
  const game = createGameSession('baseball', { opponent: 'Northside' }, new Date('2026-09-20T12:00:00Z'));
  const rule = getSportRule('baseball');
  let changedGame = game;
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(createElement(LiveTrackerGame, {
      currentGame: game,
      rule,
      athleteName: 'Jordan',
      teamName: 'Falcons',
      displayStats: rule.stats.filter((item) => !item.liveHidden && item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: '',
      onCapture: () => {},
      onGameChange: (nextGame: typeof game) => { changedGame = nextGame; },
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });

  act(() => renderer.root.findByProps({ 'data-testid': 'athlete-stat-target-hit' }).props.onClick());
  act(() => renderer.root.findByProps({ 'data-testid': 'baseball-hit-double' }).props.onClick());
  assert.equal(changedGame.events[0]?.statId, 'double');
  assert.equal(changedGame.events[0]?.attribution, 'athlete');
});

test('baseball pitch expands its choices without expanding the walk card', () => {
  const game = createGameSession('baseball', { opponent: 'Northside' }, new Date('2026-09-20T12:00:00Z'));
  const rule = getSportRule('baseball');
  let changedGame = game;
  let renderer!: ReturnType<typeof create>;
  const renderGame = (currentGame: typeof game) => createElement(LiveTrackerGame, {
    currentGame,
    rule,
    athleteName: 'Jordan',
    teamName: 'Falcons',
    displayStats: rule.stats.filter((item) => !item.liveHidden && item.featured),
    showAllStats: false,
    saving: false,
    captureNotice: '',
    onCapture: () => {},
    onGameChange: (nextGame: typeof game) => { changedGame = nextGame; },
    onToggleShowAllStats: () => {},
    onLeaveGame: () => {},
    onEndGame: () => {},
  });

  act(() => {
    renderer = create(renderGame(game));
  });

  assert.equal(rule.stats.find((item) => item.id === 'strikeout')?.liveHidden, true);
  assert.deepEqual(
    rule.stats.filter((item) => item.liveHidden && ['fastball', 'changeup', 'slider', 'strikeout', 'curveball'].includes(item.id)).map((item) => item.id),
    ['strikeout', 'fastball', 'changeup', 'slider', 'curveball'],
  );
  act(() => renderer.root.findByProps({ 'data-testid': 'live-stat-pitch' }).props.onClick());
  assert.equal(changedGame.events.length, 0);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'baseball-pitch-choices' }).children.length, 5);
  for (const choiceId of ['fastball', 'changeup', 'slider', 'strikeout', 'curveball']) {
    assert.ok(renderer.root.findByProps({ 'data-testid': `baseball-pitch-${choiceId}` }));
  }
  assert.match(renderedText(renderer), /Fastball/);
  assert.match(renderedText(renderer), /Changeup/);
  assert.match(renderedText(renderer), /Slider/);
  assert.match(renderedText(renderer), /Strike \(K\)/);
  assert.match(renderedText(renderer), /Curveball/);

  const walkCard = renderer.root.findByProps({ 'data-testid': 'live-stat-card-walk' });
  assert.equal(walkCard.findByProps({ 'data-testid': 'live-stat-walk' }).props['aria-expanded'], undefined);
  assert.equal(walkCard.findAll((node) => node.props['data-testid'] === 'baseball-pitch-choices').length, 0);

  act(() => renderer.root.findByProps({ 'data-testid': 'baseball-pitch-strikeout' }).props.onClick());
  assert.equal(changedGame.events.length, 1);
  assert.equal(changedGame.events[0]?.statId, 'strikeout');
  assert.equal(changedGame.stats.strikeout, 1);
});

test('rapid baseball hit and pitch choices preserve both plays and recent activity order', () => {
  const rule = getSportRule('baseball');

  const verifyRapidChoices = ({
    cardId,
    choiceIds,
    activityLabels,
  }: {
    cardId: 'hit' | 'pitch';
    choiceIds: [string, string];
    activityLabels: [string, string];
  }) => {
    let changedGame = createGameSession('baseball', { opponent: 'Northside' }, new Date('2026-09-20T12:00:00Z'));
    let renderer!: ReturnType<typeof create>;
    const renderGame = () => createElement(LiveTrackerGame, {
      currentGame: changedGame,
      rule,
      athleteName: 'Jordan',
      teamName: 'Falcons',
      displayStats: rule.stats.filter((item) => !item.liveHidden && item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: '',
      onCapture: () => {},
      onGameChange: (nextGame: typeof changedGame) => { changedGame = nextGame; },
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    });

    act(() => {
      renderer = create(renderGame());
    });
    act(() => {
      renderer.root.findByProps({ 'data-testid': `live-stat-${cardId}` }).props.onClick();
    });

    const firstChoice = renderer.root.findByProps({ 'data-testid': `baseball-${cardId}-${choiceIds[0]}` });
    const secondChoice = renderer.root.findByProps({ 'data-testid': `baseball-${cardId}-${choiceIds[1]}` });
    act(() => {
      firstChoice.props.onClick();
      secondChoice.props.onClick();
    });

    assert.deepEqual(changedGame.events.map((event) => event.statId), choiceIds);
    assert.equal(changedGame.stats[choiceIds[0]], 1);
    assert.equal(changedGame.stats[choiceIds[1]], 1);

    act(() => {
      renderer.update(renderGame());
    });
    const recentActivity = renderedText(renderer);
    assert.ok(recentActivity.indexOf(activityLabels[1]) < recentActivity.indexOf(activityLabels[0]));
  };

  verifyRapidChoices({
    cardId: 'hit',
    choiceIds: ['single', 'double'],
    activityLabels: ['Single', 'Double'],
  });
  verifyRapidChoices({
    cardId: 'pitch',
    choiceIds: ['fastball', 'slider'],
    activityLabels: ['Fastball', 'Slider'],
  });
});

test('softball is available with inning-based game tracking', () => {
  const rule = getSportRule('softball');
  const game = createGameSession('softball', { opponent: 'Westview' }, new Date('2026-09-20T12:00:00Z'));

  assert.equal(rule.label, 'Softball');
  assert.equal(rule.phaseLabel, 'Inning');
  assert.deepEqual(rule.stats.slice(0, 4).map((item) => item.id), ['run', 'hit', 'rbi', 'home-run']);
  assert.equal(game.sport, 'softball');
});

test('live scoreboard keeps camera actions compact, labeled, and attached to the scoreboard', () => {
  const game = createGameSession('basketball', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  const rule = getSportRule('basketball');
  const captures: Array<{ kind: string; file?: File }> = [];
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(createElement(LiveTrackerGame, {
      currentGame: game,
      rule,
      athleteName: 'Jordan',
      teamName: 'Falcons',
      displayStats: rule.stats.filter((item) => item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: 'Photo ready for Falcons vs Northside.',
      onCapture: (kind, file) => captures.push({ kind, file }),
      onGameChange: () => {},
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });

  const scoreboard = renderer.root.findByProps({ 'data-testid': 'live-tracker-scoreboard' });
  const captureControls = renderer.root.findByProps({ 'data-testid': 'live-tracker-capture-controls' });
  assert.equal(captureControls.parent, scoreboard);
  assert.match(captureControls.props.className, /top-3/);
  assert.doesNotMatch(captureControls.props.className, /bottom-/);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'status-stat-tracker-capture-notice' }).props.role, 'status');
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-stat-tracker-capture-photo' }).props.accept, 'image/*');
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-stat-tracker-capture-video' }).props.accept, 'video/*');

  const file = { name: 'moment.jpg' } as File;
  act(() => renderer.root.findByProps({ 'data-testid': 'input-stat-tracker-capture-photo' }).props.onChange({
    currentTarget: { files: [file], value: 'selected' },
  }));
  assert.deepEqual(captures, [{ kind: 'photo', file }]);
});

test('profile sport controls the tracker while accounts without one resume their latest sport', () => {
  const olderBasketballGame = createGameSession(
    'basketball',
    { opponent: 'Northside' },
    new Date('2026-09-10T12:00:00Z'),
  );
  const newerVolleyballGame = createGameSession(
    'volleyball',
    { opponent: 'Westview' },
    new Date('2026-09-12T12:00:00Z'),
  );

  const history = { version: 1, games: [newerVolleyballGame, olderBasketballGame] };

  assert.equal(getTrackerSportForProfile(history, 'soccer'), 'soccer');
  assert.equal(getTrackerSportForProfile(history, null), 'volleyball');
  assert.equal(getPreferredTrackerSport({ version: 1, games: [] }, 'baseball'), 'baseball');
});

test('tracker prefers a connected live game and skips explicit finals', () => {
  const selected = getNextScheduledGame([
    { id: 'final', type: 'game', date: '2026-09-19', time: '08:00', opponent: 'Early', status: 'final' },
    { id: 'upcoming', type: 'game', date: '2026-09-19', time: '18:00', opponent: 'Later', status: 'upcoming' },
    { id: 'live', type: 'game', date: '2026-09-18', time: '18:00', opponent: 'Delayed', status: 'live' },
  ]);

  assert.equal(selected?.id, 'live');
});

test('fan-owned game start and end persist locally and to the owned schedule in order', async () => {
  const scheduledGame = {
    id: 'game-1',
    type: 'game',
    date: '2026-09-19',
    time: '18:00',
    opponent: 'Northside',
    location: 'Central Field',
    snacks: '',
    drinks: '',
    notes: '',
    status: 'upcoming' as const,
  };
  const draft: ScheduleDraft = {
    teamName: 'Falcons',
    season: 'Fall 2026',
    events: [scheduledGame],
    template: 0,
  };
  const storage = createMemoryStorage({
    [scheduleStorageKey]: JSON.stringify(draft),
  }) as unknown as Storage;
  const cloudWrites: Array<{ status: string | undefined; expectedRevision: number }> = [];
  let revision = 4;
  const updateCloudProject = async (input: {
    data: { project: { events: typeof draft.events }; expectedRevision: number };
  }) => {
    cloudWrites.push({
      status: input.data.project.events[0]?.status,
      expectedRevision: input.data.expectedRevision,
    });
    revision += 1;
    return { revision };
  };
  const ownedScheduleProject = {
    id: 'schedule-1',
    revision: 4,
    project: { tool: 'schedule' as const, events: draft.events },
  };

  let queued = Promise.resolve();
  let latestRevision = ownedScheduleProject.revision;
  const queueStatus = (status: 'live' | 'final') => {
    queued = queued
      .catch(() => undefined)
      .then(async () => {
        const updated = await persistScheduledGameStatus({
          scheduledGame,
          status,
          canWrite: true,
          storage,
          ownedScheduleProject,
          expectedRevision: latestRevision,
          updateCloudProject,
        });
        if (updated) latestRevision = updated.revision;
      });
  };

  queueStatus('live');
  queueStatus('final');
  await queued;

  assert.equal(readScheduleDraft(storage)?.events[0]?.status, 'final');
  assert.deepEqual(cloudWrites, [
    { status: 'live', expectedRevision: 4 },
    { status: 'final', expectedRevision: 5 },
  ]);
});

test('ending a fan-owned game stays final locally when its cloud write fails', async () => {
  const scheduledGame = {
    id: 'game-1',
    type: 'game',
    date: '2026-09-19',
    time: '18:00',
    opponent: 'Northside',
    location: '',
    snacks: '',
    drinks: '',
    notes: '',
    status: 'live' as const,
  };
  const draft: ScheduleDraft = {
    teamName: 'Falcons',
    season: 'Fall 2026',
    events: [scheduledGame],
    template: 0,
  };
  const storage = createMemoryStorage({
    [scheduleStorageKey]: JSON.stringify(draft),
  }) as unknown as Storage;

  await assert.rejects(persistScheduledGameStatus({
    scheduledGame,
    status: 'final',
    canWrite: true,
    storage,
    ownedScheduleProject: {
      id: 'schedule-1',
      revision: 8,
      project: { tool: 'schedule', events: draft.events },
    },
    updateCloudProject: async () => {
      throw new Error('cloud unavailable');
    },
  }));

  assert.equal(readScheduleDraft(storage)?.events[0]?.status, 'final');
});

test('connected team schedules remain read-only when tracker actions request phase changes', async () => {
  const scheduledGame = {
    id: 'connected-game',
    type: 'game',
    date: '2026-09-19',
    time: '18:00',
    opponent: 'Westview',
    location: '',
    snacks: '',
    drinks: '',
    notes: '',
    status: 'upcoming' as const,
  };
  const draft: ScheduleDraft = {
    teamName: 'Falcons',
    season: 'Fall 2026',
    events: [scheduledGame],
    template: 0,
  };
  const storage = createMemoryStorage({
    [scheduleStorageKey]: JSON.stringify(draft),
  }) as unknown as Storage;
  let cloudWriteCount = 0;

  await persistScheduledGameStatus({
    scheduledGame,
    status: 'live',
    canWrite: false,
    storage,
    ownedScheduleProject: {
      id: 'schedule-1',
      revision: 2,
      project: { tool: 'schedule', events: draft.events },
    },
    updateCloudProject: async () => {
      cloudWriteCount += 1;
      return { revision: 3 };
    },
  });

  assert.equal(readScheduleDraft(storage)?.events[0]?.status, 'upcoming');
  assert.equal(cloudWriteCount, 0);
});

test('long live tracker names cannot push score or featured stat controls off-screen', () => {
  const game = createGameSession('basketball', {
    opponent: 'The Very Long Opponent Name That Should Stay Inside The Scoreboard',
  }, new Date('2026-09-17T12:00:00Z'));
  const rule = getSportRule('basketball');
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(createElement(LiveTrackerGame, {
      currentGame: game,
      rule,
      athleteName: 'Athlete With An Exceptionally Long Name',
      teamName: 'A Team Name That Is Much Longer Than A Phone Should Need To Display',
      displayStats: rule.stats.filter((item) => item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: '',
      onCapture: () => {},
      onGameChange: () => {},
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });

  assert.match(
    renderer.root.findByProps({ 'data-testid': 'live-tracker-scoreboard' }).props.className,
    /min-w-0/,
  );
  assert.match(
    renderer.root.findByProps({ 'data-testid': 'live-tracker-matchup' }).props.className,
    /truncate/,
  );
  for (const side of ['athlete', 'opponent']) {
    const scoreCard = renderer.root.findByProps({ 'data-testid': `live-tracker-score-card-${side}` });
    assert.match(scoreCard.props.className, /min-w-0/);
    assert.match(
      renderer.root.findByProps({ 'data-testid': `score-adjust-${side}-increase` }).props.className,
      /shrink-0/,
    );
    assert.match(
      renderer.root.findByProps({ 'data-testid': `score-adjust-${side}-decrease` }).props.className,
      /shrink-0/,
    );
  }

  assert.match(renderer.root.findByType('h2').props.className, /break-words/);
  assert.match(
    renderer.root.findByProps({ 'data-testid': 'live-tracker-stat-controls' }).props.className,
    /min-w-0/,
  );
  const featuredStatButtons = renderer.root.findAll(
    (node) => typeof node.props['data-testid'] === 'string' && node.props['data-testid'].startsWith('live-stat-'),
  );
  assert.ok(featuredStatButtons.length > 0);
  for (const button of featuredStatButtons) {
    assert.match(button.props.className, /min-w-0/);
    assert.match(button.props.className, /overflow-hidden/);
    for (const label of button.findAllByType('span')) {
      assert.match(label.props.className, /truncate/);
    }
  }
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

test('game reports calculate season-to-date values through the selected game', () => {
  const first = endGame(
    addStatEvent(createGameSession('soccer', { opponent: 'Northside' }, new Date('2026-09-10T12:00:00Z')), 'goal'),
    new Date('2026-09-10T13:00:00Z'),
  );
  const second = endGame(
    addStatEvent(
      addStatEvent(createGameSession('soccer', { opponent: 'Westview' }, new Date('2026-09-12T12:00:00Z')), 'assist'),
      'assist',
    ),
    new Date('2026-09-12T13:00:00Z'),
  );
  const later = endGame(
    addStatEvent(createGameSession('soccer', { opponent: 'Central' }, new Date('2026-09-14T12:00:00Z')), 'goal'),
    new Date('2026-09-14T13:00:00Z'),
  );
  const otherSport = endGame(createGameSession('basketball', {}, new Date('2026-09-11T12:00:00Z')));

  const report = buildGameReport([later, otherSport, second, first], 'soccer', second.id);

  assert.ok(report);
  assert.deepEqual(report.games.map((game) => game.id), [first.id, second.id, later.id]);
  assert.equal(report.previousGame?.id, first.id);
  assert.deepEqual(report.seasonToDate, {
    gamesPlayed: 2,
    score: 1,
    stats: { goal: 1, assist: 2 },
  });
  assert.equal(report.averages.score, 0.5);
  assert.equal(report.averages.stats.assist, 1);
});

test('football reports calculate game, season, and average yard totals', () => {
  let first = createGameSession('football', { opponent: 'Northside' }, new Date('2026-09-10T12:00:00Z'));
  first = addStatEvent(first, 'pass-yard', new Date('2026-09-10T12:01:00Z'), 20);
  first = addStatEvent(first, 'reception', new Date('2026-09-10T12:02:00Z'), 8);
  first = endGame(first, new Date('2026-09-10T13:00:00Z'));

  let second = createGameSession('football', { opponent: 'Westview' }, new Date('2026-09-12T12:00:00Z'));
  second = addStatEvent(second, 'pass-yard', new Date('2026-09-12T12:01:00Z'), 10);
  second = addStatEvent(second, 'rush-yard', new Date('2026-09-12T12:02:00Z'), 5);
  second = addStatEvent(second, 'reception', new Date('2026-09-12T12:03:00Z'), 4);
  second = endGame(second, new Date('2026-09-12T13:00:00Z'));

  const report = buildGameReport([second, first], 'football', second.id);

  assert.ok(report);
  assert.deepEqual(report.selectedGame.yardStats, {
    'pass-yard': 10,
    'rush-yard': 5,
    'receiving-yard': 4,
  });
  assert.deepEqual(report.seasonToDateYards, {
    'pass-yard': 30,
    'rush-yard': 5,
    'receiving-yard': 12,
  });
  assert.equal(report.averages.yards['pass-yard'], 15);
  assert.equal(report.averages.yards['receiving-yard'], 6);
  assert.deepEqual(seasonYardTotals([second, first], 'football'), report.seasonToDateYards);
});

test('game reports safely reject missing and unfinished selections', () => {
  const live = createGameSession('soccer', {}, new Date('2026-09-10T12:00:00Z'));
  assert.equal(buildGameReport([live], 'soccer', live.id), null);
  assert.equal(buildGameReport([], 'soccer', 'missing'), null);
});

test('game report renders every sport stat and closes without changing the report', () => {
  const game = endGame(addStatEvent(
    createGameSession('soccer', { opponent: 'Northside', notes: 'Strong finish.' }),
    'goal',
    new Date(),
    0,
    'athlete',
  ));
  const report = buildGameReport([game], 'soccer', game.id);
  assert.ok(report);
  let closeCount = 0;
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(createElement(GameReportView, {
      report,
      rule: getSportRule('soccer'),
      onClose: () => { closeCount += 1; },
      onSelectGame: () => {},
    }));
  });

  assert.equal(renderer.root.findAll((node) => (
    typeof node.props['data-testid'] === 'string'
    && node.props['data-testid'].startsWith('report-stat-')
  )).length, getSportRule('soccer').stats.length);
  assert.match(renderedText(renderer), /Season: 1/);
  assert.match(renderedText(renderer), /Team 0 · Athlete 1/);
  assert.match(renderedText(renderer), /Strong finish/);
  act(() => renderer.root.findByProps({ 'data-testid': 'game-report-close' }).props.onClick());
  assert.equal(closeCount, 1);
  assert.equal(report.selectedGame.id, game.id);
});

test('game report keeps statistics visible and retries a failed chart download', async () => {
  const first = endGame(addStatEvent(createGameSession('soccer', { opponent: 'Northside' }), 'goal'));
  const second = endGame(addStatEvent(createGameSession('soccer', { opponent: 'Westview' }), 'assist'));
  const report = buildGameReport([first, second], 'soccer', second.id);
  assert.ok(report);
  let loadAttempts = 0;
  let retryCount = 0;
  const TestCharts = () => createElement('div', { 'data-testid': 'loaded-test-charts' }, 'Charts loaded');
  const loadCharts = async () => {
    loadAttempts += 1;
    if (loadAttempts === 1) throw new Error('Network connection lost');
    return { default: TestCharts };
  };
  let renderer!: ReturnType<typeof create>;

  await act(async () => {
    renderer = create(createElement(GameReportView, {
      report,
      rule: getSportRule('soccer'),
      onClose: () => {},
      onSelectGame: () => {},
      loadCharts,
      onRetryCharts: () => { retryCount += 1; },
    }));
  });

  assert.match(renderedText(renderer), /Charts couldn’t load/);
  assert.match(renderedText(renderer), /Season to Date/);
  assert.match(renderedText(renderer), /Box Score/);
  assert.equal(report.selectedGame.id, second.id);

  await act(async () => {
    renderer.root.findByProps({ 'data-testid': 'report-charts-retry' }).props.onClick();
  });

  assert.equal(retryCount, 1);
  assert.equal(loadAttempts, 2);
  assert.match(renderedText(renderer), /Charts loaded/);
  assert.match(renderedText(renderer), /Box Score/);
  assert.equal(report.selectedGame.id, second.id);
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

test('football yard data survives normalization, local storage, and cloud payloads', () => {
  let game = createGameSession('football', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  game = endGame(addStatEvent(game, 'reception', new Date('2026-09-17T12:01:00Z'), 11));
  const storage = createMemoryStorage({
    [getTrackerStorageKeys('yard_user').history]: JSON.stringify({ version: 1, games: [game] }),
  });

  const restored = readStoredTrackerData(storage, 'yard_user');
  assert.equal(restored.games[0]?.trackYards, true);
  assert.deepEqual(restored.games[0]?.yardStats, { 'receiving-yard': 11 });
  assert.equal(restored.games[0]?.events[0]?.yards, 11);
  assert.deepEqual(trackerPayload(restored).games[0]?.yardStats, { 'receiving-yard': 11 });
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

test('signed-in tracker reload restores the active game into the live scoreboard', () => {
  const accountId = 'user_phone_reload';
  const activeGame = {
    ...addStatEvent(
      createGameSession('basketball', {
        date: '2026-09-17',
        opponent: 'Northside',
        notes: 'Keep attacking the paint.',
      }, new Date('2026-09-17T12:00:00Z')),
      'three-point',
      new Date('2026-09-17T12:01:00Z'),
    ),
    period: 3,
    opponentScore: 41,
  };
  const storage = createMemoryStorage({
    [getTrackerStorageKeys(accountId).activeGame]: JSON.stringify(activeGame),
    [getTrackerStorageKeys('another_account').activeGame]: JSON.stringify(
      createGameSession('soccer', { opponent: 'Different team' }),
    ),
  });

  const restored = readLocalTrackerSession(storage, accountId);
  assert.deepEqual(restored.currentGame, activeGame);
  assert.notEqual(readLocalTrackerSession(storage, 'another_account').currentGame?.id, activeGame.id);
  assert.equal(readLocalTrackerSession(storage, 'another_account').currentGame?.sport, 'soccer');

  const rule = getSportRule('basketball');
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(LiveTrackerGame, {
      currentGame: restored.currentGame!,
      rule,
      athleteName: 'Jordan',
      teamName: 'Northside',
      displayStats: rule.stats.filter((item) => item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: '',
      onCapture: () => {},
      onGameChange: () => {},
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });

  assert.equal(
    renderer.root.findByProps({ 'data-testid': 'live-tracker-score-card-athlete' })
      .findAllByType('p')[1]?.children[0],
    '3',
  );
  assert.equal(
    renderer.root.findByProps({ 'data-testid': 'live-tracker-score-card-opponent' })
      .findAllByType('p')[1]?.children[0],
    '41',
  );
  assert.deepEqual(
    renderer.root.findByProps({ 'data-testid': 'live-stat-three-point' }).findAllByType('span')[2]?.children,
    ['1', ' · +3'],
  );
  assert.equal(renderer.root.findByType('textarea').props.value, 'Keep attacking the paint.');
  assert.match(renderedText(renderer), /Quarter 3/);
});

test('a score tap survives tracker refresh and remains in the next sync payload', () => {
  const accountId = 'user_score_refresh';
  const activeGame = createGameSession('basketball', {
    date: '2026-09-17',
    opponent: 'Northside',
  }, new Date('2026-09-17T12:00:00Z'));
  const activeKey = getTrackerStorageKeys(accountId).activeGame;
  const storage = createMemoryStorage({ [activeKey]: JSON.stringify(activeGame) });
  let currentGame = readLocalTrackerSession(storage, accountId).currentGame!;
  let renderer!: ReturnType<typeof create>;

  act(() => {
    renderer = create(createElement(LiveTrackerGame, {
      currentGame,
      rule: getSportRule('basketball'),
      athleteName: 'Jordan',
      teamName: 'Falcons',
      displayStats: getSportRule('basketball').stats.filter((item) => item.featured),
      showAllStats: false,
      saving: false,
      captureNotice: '',
      onCapture: () => {},
      onGameChange: (nextGame: typeof currentGame) => {
        currentGame = nextGame;
        storage.setItem(activeKey, JSON.stringify(nextGame));
      },
      onToggleShowAllStats: () => {},
      onLeaveGame: () => {},
      onEndGame: () => {},
    }));
  });

  act(() => {
    renderer.root.findByProps({ 'data-testid': 'score-adjust-athlete-increase' }).props.onClick();
    renderer.root.findByProps({ 'data-testid': 'score-adjust-opponent-increase' }).props.onClick();
  });

  const refreshed = readLocalTrackerSession(storage, accountId).currentGame;
  assert.equal(refreshed?.score, 1);
  assert.equal(refreshed?.opponentScore, 1);
  const payload = trackerPayload({ version: 1, games: [endGame(refreshed!)] });
  assert.equal(payload.games[0]?.score, 1);
  assert.equal(payload.games[0]?.opponentScore, 1);
});

test('selected conflict history survives reload until cloud sync succeeds', () => {
  const localGame = endGame(createGameSession('soccer', { opponent: 'Northside' }));
  const cloudGame = endGame(createGameSession('soccer', { opponent: 'Westview' }));
  const storage = createMemoryStorage();
  const pending = {
    resolution: 'local' as const,
    data: { version: 1 as const, games: [localGame] },
    cloudData: { version: 1 as const, games: [cloudGame] },
    cloudProject: { id: 'tracker-1', revision: 4 },
  };

  saveStoredTrackerConflict(storage, 'user_a', pending);
  assert.deepEqual(readStoredTrackerConflict(storage, 'user_a'), pending);

  clearStoredTrackerConflict(storage, 'user_a');
  assert.equal(readStoredTrackerConflict(storage, 'user_a'), null);
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

test('revision conflicts explain how to choose a history without discarding the local game', () => {
  const message = trackerSaveErrorMessage({ status: 409 });
  const recovery = getTrackerSyncRecovery({ status: 409 });

  assert.equal(isTrackerRevisionConflict({ status: 409 }), true);
  assert.match(message, /local history is safe/);
  assert.match(message, /choose which history to keep/);
  assert.equal(recovery.revisionConflict, true);
  assert.equal(recovery.retryAvailable, false);
  assert.match(recovery.message, /syncing again/);
});

test('revision conflicts expose the newer cloud history and revision for in-page resolution', () => {
  const localGame = endGame(createGameSession('soccer', { opponent: 'Northside' }));
  const cloudGame = endGame(createGameSession('soccer', { opponent: 'Westview' }));
  const conflict = getTrackerConflict({
    status: 409,
    data: {
      error: 'Project revision is stale',
      current: {
        id: 'tracker-1',
        revision: 9,
        project: { tool: 'stat-tracker', version: 1, games: [cloudGame] },
      },
    },
  }, { version: 1, games: [localGame] });

  assert.deepEqual(conflict?.cloudProject, { id: 'tracker-1', revision: 9 });
  assert.deepEqual(conflict?.localData.games.map((game) => game.id), [localGame.id]);
  assert.deepEqual(conflict?.cloudData.games.map((game) => game.id), [cloudGame.id]);
});

test('malformed revision conflict payloads do not create an unsafe recovery choice', () => {
  const localData = { version: 1 as const, games: [] };

  assert.equal(getTrackerConflict({ status: 409 }, localData), null);
  assert.equal(getTrackerConflict({
    status: 409,
    data: { current: { id: 'tracker-1', revision: 0, project: {} } },
  }, localData), null);
});

test('ordinary sync failures remain retryable instead of looking like conflicts', () => {
  const recovery = getTrackerSyncRecovery({ status: 503 });

  assert.equal(isTrackerRevisionConflict({ status: 503 }), false);
  assert.match(trackerSaveErrorMessage({ status: 503 }), /Try saving again/);
  assert.equal(recovery.revisionConflict, false);
  assert.equal(recovery.retryAvailable, true);
});

test('completed-game save statuses explain cloud and local outcomes', () => {
  assert.equal(trackerSaveStatusMessage('saving'), 'Saving game to cloud…');
  assert.equal(trackerSaveStatusMessage('cloud-saved'), 'Game saved to cloud');
  assert.equal(
    trackerSaveStatusMessage('local-saved'),
    'Saved on this device — cloud sync needs attention',
  );
});

test('retry preserves locally saved scores and resends them after cloud failure', async () => {
  let firstLiveGame = createGameSession('basketball', { opponent: 'Northside' });
  firstLiveGame = adjustScore(firstLiveGame, 'athlete', 8);
  firstLiveGame = adjustScore(firstLiveGame, 'opponent', 2);
  const firstGame = endGame(firstLiveGame);
  const secondGame = endGame(
    addStatEvent(createGameSession('basketball', { opponent: 'Westview' }), 'two-point'),
  );
  const data = { version: 1 as const, games: [firstGame, secondGame] };
  const accountId = 'user_retry_scores';
  const storage = createMemoryStorage({
    [getTrackerStorageKeys(accountId).history]: JSON.stringify(data),
  });
  const requests: Array<{ projectId: string; data: { project: ReturnType<typeof trackerPayload>; expectedRevision: number } }> = [];
  let attempts = 0;
  const client = {
    createProject: async () => {
      throw new Error('retry should update the existing project');
    },
    updateProject: async (input: typeof requests[number]) => {
      requests.push(input);
      attempts += 1;
      if (attempts === 1) throw { status: 503 };
      return { id: 'tracker-1', revision: 8 };
    },
  };
  const cloudProject = { id: 'tracker-1', revision: 7 };

  await assert.rejects(
    syncTrackerDataToCloud({
      data,
      cloudProject,
      athleteName: 'Jordan',
      guestUsageKey: 'guest-key',
      client,
    }),
    (error: unknown) => (error as { status?: number }).status === 503,
  );
  const localAfterFailure = readLocalTrackerSession(storage, accountId).data;
  assert.equal(localAfterFailure.games[0]?.score, 8);
  assert.equal(localAfterFailure.games[0]?.opponentScore, 2);
  const localReport = buildGameReport(localAfterFailure.games, 'basketball', firstGame.id);
  assert.equal(localReport?.selectedGame.score, 8);
  assert.equal(localReport?.selectedGame.opponentScore, 2);

  const saved = await syncTrackerDataToCloud({
    data: localAfterFailure,
    cloudProject,
    athleteName: 'Jordan',
    guestUsageKey: 'guest-key',
    client,
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1]?.data.project, trackerPayload(localAfterFailure));
  assert.deepEqual(requests[1]?.data.project.games, [firstGame, secondGame]);
  assert.equal(requests[1]?.data.project.games[0]?.score, 8);
  assert.equal(requests[1]?.data.project.games[0]?.opponentScore, 2);
  assert.equal(requests[1]?.data.expectedRevision, 7);
  assert.deepEqual(saved, { id: 'tracker-1', revision: 8 });
});

test('a revision conflict preserves local history until a selected copy is synced', async () => {
  const localGame = endGame(createGameSession('soccer', { opponent: 'Northside' }));
  const data = { version: 1 as const, games: [localGame] };
  const client = {
    createProject: async () => {
      throw { status: 409 };
    },
    updateProject: async () => {
      throw { status: 409 };
    },
  };

  await assert.rejects(
    syncTrackerDataToCloud({
      data,
      cloudProject: null,
      athleteName: 'Jordan',
      client,
    }),
    (error: unknown) => (error as { status?: number }).status === 409,
  );

  assert.deepEqual(data.games, [localGame]);
  const recovery = getTrackerSyncRecovery({ status: 409 });
  assert.equal(recovery.retryAvailable, false);
  assert.equal(recovery.revisionConflict, true);
  assert.match(recovery.message, /choose which history to keep/);
});