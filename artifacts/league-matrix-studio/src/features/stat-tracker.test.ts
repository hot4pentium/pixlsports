import assert from 'node:assert/strict';
import test from 'node:test';
import { act, create, type ReactTestRendererNode } from 'react-test-renderer';
import { createElement } from 'react';

import {
  addStatEvent,
  adjustYardValue,
  adjustScore,
  buildGameReport,
  clearStoredTrackerConflict,
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

test('football yard tracking keeps play counts while recording passing, rushing, and receiving yards', () => {
  const firstTime = new Date('2026-09-17T12:01:00Z');
  let game = createGameSession('football', { opponent: 'Northside' }, new Date('2026-09-17T12:00:00Z'));
  game = addStatEvent(game, 'pass-yard', firstTime, 15);
  game = addStatEvent(game, 'rush-yard', new Date('2026-09-17T12:02:00Z'), 7);
  game = addStatEvent(game, 'reception', new Date('2026-09-17T12:03:00Z'), 12);

  assert.equal(game.trackYards, true);
  assert.deepEqual(game.stats, { 'pass-yard': 1, 'rush-yard': 1, reception: 1 });
  assert.deepEqual(game.yardStats, {
    'pass-yard': 15,
    'rush-yard': 7,
    'receiving-yard': 12,
  });
  assert.equal(game.events.at(-1)?.yards, 12);
  assert.equal(getFootballYardMetricId('reception'), 'receiving-yard');

  game = undoLastStatEvent(game);
  assert.equal(game.stats.reception, undefined);
  assert.equal(game.yardStats?.['receiving-yard'], undefined);
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

test('football live controls expose accessible yard entry and record reception yards', () => {
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

  const toggle = renderer.root.findByProps({ 'data-testid': 'toggle-football-yard-tracking' });
  assert.equal(toggle.props.checked, true);
  const receptionInput = renderer.root.findByProps({ 'data-testid': 'input-yard-reception' });
  act(() => receptionInput.props.onWheel({ deltaY: -1, preventDefault: () => {} }));
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-reception' }).props.value, 5);
  act(() => renderer.root.findByProps({ 'data-testid': 'input-yard-reception' }).props.onWheel({ deltaY: 1, preventDefault: () => {} }));
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-reception' }).props.value, 4);
  act(() => renderer.root.findByProps({ 'data-testid': 'input-yard-reception' }).props.onChange({ currentTarget: { value: '12' } }));
  act(() => renderer.root.findByProps({ 'data-testid': 'live-stat-reception' }).props.onClick());

  assert.equal(changedGame.stats.reception, 1);
  assert.equal(changedGame.yardStats?.['receiving-yard'], 12);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'input-yard-reception' }).props['aria-valuenow'], 0);
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

test('connected coach schedules remain read-only when tracker actions request phase changes', async () => {
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
  const game = endGame(
    addStatEvent(createGameSession('soccer', { opponent: 'Northside', notes: 'Strong finish.' }), 'goal'),
  );
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

test('retry resends the complete local history and stores the returned cloud revision', async () => {
  const firstGame = endGame(
    addStatEvent(createGameSession('basketball', { opponent: 'Northside' }), 'three-point'),
  );
  const secondGame = endGame(
    addStatEvent(createGameSession('basketball', { opponent: 'Westview' }), 'two-point'),
  );
  const data = { version: 1 as const, games: [firstGame, secondGame] };
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
  const saved = await syncTrackerDataToCloud({
    data,
    cloudProject,
    athleteName: 'Jordan',
    guestUsageKey: 'guest-key',
    client,
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1]?.data.project, trackerPayload(data));
  assert.deepEqual(requests[1]?.data.project.games, [firstGame, secondGame]);
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