import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSupporterProfileSavePlan,
  getActiveSupporterGame,
  getCalendarViewState,
  getSupporterGameStage,
  getSupporterScheduleSelection,
  getStudioDestination,
  getUserRole,
  mapRecentSupporterProjects,
  parseSupporterStorageSyncEvent,
  supporterProfileFromUser,
  supporterActiveGameStorageKey,
  supporterStageAcknowledgmentStoragePrefix,
  getSupporterStageAcknowledgmentKey,
  supporterToolRoutes,
} from './supporter-dashboard-model';

test('models upcoming, live, and completed supporter game phases', () => {
  const now = new Date(2026, 8, 19, 15, 0, 0);
  assert.equal(getSupporterGameStage({ date: '2026-09-20', time: '10:00' }, now), 'upcoming');
  assert.equal(getSupporterGameStage({ date: '2026-09-19', time: '14:00' }, now), 'live');
  assert.equal(getSupporterGameStage({ date: '2026-09-19', time: '10:00' }, now), 'completed');
  assert.equal(getSupporterGameStage({ date: '2026-09-18', time: '18:00' }, now), 'completed');
});

test('explicit schedule status wins over the clock fallback', () => {
  const now = new Date(2026, 8, 19, 15, 0, 0);

  assert.equal(getSupporterGameStage({
    id: 'delayed',
    date: '2026-09-18',
    time: '08:00',
    status: 'live',
  }, now), 'live');
  assert.equal(getSupporterGameStage({
    id: 'short-game',
    date: '2026-09-19',
    time: '14:00',
    status: 'final',
  }, now), 'completed');
  assert.equal(getSupporterGameStage({
    id: 'rescheduled',
    date: '2026-09-19',
    time: '14:00',
    status: 'upcoming',
  }, now), 'upcoming');
});

test('keeps a valid selected game and otherwise chooses the next relevant game', () => {
  const now = new Date(2026, 8, 19, 15, 0, 0);
  const games = [
    { id: 'past', date: '2026-09-18', time: '18:00' },
    { id: 'today', date: '2026-09-19', time: '14:00' },
    { id: 'future', date: '2026-09-21', time: '18:00' },
  ];
  assert.equal(getActiveSupporterGame(games, 'future', now)?.id, 'future');
  assert.equal(getActiveSupporterGame(games, 'missing', now)?.id, 'today');
  assert.equal(getActiveSupporterGame([games[0]], null, now)?.id, 'past');
});

test('routes fan and coach accounts to their correct /studio experiences', () => {
  assert.equal(getStudioDestination(getUserRole({ unsafeMetadata: { role: 'fan' } })), 'supporter');
  assert.equal(getStudioDestination(getUserRole({ unsafeMetadata: { role: 'coach' } })), 'coach');
  assert.equal(getStudioDestination(getUserRole({ unsafeMetadata: { role: 'admin' } })), 'role-selection');
});

test('keeps every supporter shortcut on its existing studio route', () => {
  assert.deepEqual(supporterToolRoutes, {
    hypeCard: '/studio/hype-card',
    schedule: '/studio/schedule',
    statTracker: '/studio/stat-tracker',
    checklist: '/studio/checklist',
  });
});

test('parses only valid supporter storage synchronization events', () => {
  assert.deepEqual(parseSupporterStorageSyncEvent({
    key: supporterActiveGameStorageKey,
    newValue: 'game-2',
  }), {
    type: 'active-game',
    gameId: 'game-2',
  });
  assert.deepEqual(parseSupporterStorageSyncEvent({
    key: getSupporterStageAcknowledgmentKey('game:2', 'live'),
    newValue: '1',
  }), {
    type: 'stage-acknowledgment',
    gameId: 'game:2',
    stage: 'live',
    key: getSupporterStageAcknowledgmentKey('game:2', 'live'),
  });

  for (const event of [
    { key: 'unrelated', newValue: '1' },
    { key: supporterActiveGameStorageKey, newValue: '' },
    { key: supporterActiveGameStorageKey, newValue: null },
    { key: `${getSupporterStageAcknowledgmentKey('game-1', 'upcoming')}-extra`, newValue: '1' },
    { key: getSupporterStageAcknowledgmentKey('game-1', 'upcoming'), newValue: '0' },
    { key: `${supporterStageAcknowledgmentStoragePrefix}:bad%ZZ:live`, newValue: '1' },
  ]) {
    assert.equal(parseSupporterStorageSyncEvent(event), null);
  }
});

test('saved supporter metadata reloads as the same normalized profile', () => {
  const currentMetadata = { role: 'fan', accessMode: 'full', unrelatedPreference: true };
  const editedProfile = {
    displayName: '  Jamie Fan ',
    teamName: ' Wildcats ',
    athleteName: ' Taylor Fan ',
    jerseyNumber: ' #24 ',
    position: ' Guard ',
    relationship: ' Parent ',
    accessMode: 'full' as const,
    sport: null,
  };
  const savePlan = createSupporterProfileSavePlan(currentMetadata, editedProfile);

  assert.deepEqual(savePlan, {
    unsafeMetadata: {
      role: 'fan',
      accessMode: 'full',
      unrelatedPreference: true,
      displayName: 'Jamie Fan',
      teamName: 'Wildcats',
      athleteName: 'Taylor Fan',
      jerseyNumber: '24',
      position: 'Guard',
      relationship: 'Parent',
      sport: null,
    },
    redirectTo: '/studio',
    studioDestination: 'supporter',
  });
  assert.deepEqual(supporterProfileFromUser({ unsafeMetadata: savePlan.unsafeMetadata }), {
    displayName: 'Jamie Fan',
    teamName: 'Wildcats',
    athleteName: 'Taylor Fan',
    jerseyNumber: '24',
    position: 'Guard',
    relationship: 'Parent',
    accessMode: 'full',
    sport: null,
  });
});

test('distinguishes calendar connection, empty, failure, and disconnected states', () => {
  assert.equal(getCalendarViewState({ calendarCode: '', loading: false, invalid: false, failed: false, calendar: undefined }), 'disconnected');
  assert.equal(getCalendarViewState({ calendarCode: 'TEAM', loading: true, invalid: false, failed: false, calendar: undefined }), 'loading');
  assert.equal(getCalendarViewState({ calendarCode: 'TEAM', loading: false, invalid: true, failed: true, calendar: undefined }), 'invalid');
  assert.equal(getCalendarViewState({ calendarCode: 'TEAM', loading: false, invalid: false, failed: true, calendar: undefined }), 'failed');
  assert.equal(getCalendarViewState({ calendarCode: 'TEAM', loading: false, invalid: false, failed: false, calendar: { events: [] } }), 'empty');
  assert.equal(getCalendarViewState({ calendarCode: 'TEAM', loading: false, invalid: false, failed: false, calendar: { events: [{}] } }), 'connected');
  assert.equal(getCalendarViewState({
    calendarCode: '',
    loading: false,
    invalid: false,
    failed: false,
    calendar: undefined,
    customSchedule: { events: [{}] },
  }), 'custom');
  assert.equal(getCalendarViewState({
    calendarCode: '',
    loading: false,
    invalid: false,
    failed: false,
    calendar: undefined,
    customSchedule: { events: [] },
  }), 'disconnected');
  assert.equal(getCalendarViewState({
    calendarCode: 'TEAM',
    loading: false,
    invalid: false,
    failed: false,
    calendar: { events: [{}] },
    customSchedule: { events: [{ id: 'local-only' }] },
  }), 'connected');
});

test('selects local custom events only when no team connection is active', () => {
  const localSchedule = { events: [{ id: 'local-event' }] };

  assert.deepEqual(getSupporterScheduleSelection({
    hasTeamConnection: false,
    teamSchedule: undefined,
    customSchedule: localSchedule,
  }), {
    events: localSchedule.events,
    source: 'custom',
  });
});

test('connected team events win over custom events, including after a dashboard reload', () => {
  const localSchedule = { events: [{ id: 'local-event' }] };
  const teamSchedule = { events: [{ id: 'team-event' }] };

  assert.deepEqual(getSupporterScheduleSelection({
    hasTeamConnection: true,
    teamSchedule,
    customSchedule: localSchedule,
  }), {
    events: teamSchedule.events,
    source: 'team',
  });

  const reloadedCustomSchedule = {
    events: localSchedule.events.map((event) => ({ ...event })),
  };
  assert.deepEqual(getSupporterScheduleSelection({
    hasTeamConnection: false,
    teamSchedule,
    customSchedule: reloadedCustomSchedule,
  }), {
    events: reloadedCustomSchedule.events,
    source: 'custom',
  });
});

test('does not fall back to custom events while a team calendar is loading or has failed', () => {
  const customSchedule = { events: [{ id: 'local-event' }] };

  assert.equal(getCalendarViewState({
    calendarCode: 'TEAM',
    loading: true,
    invalid: false,
    failed: false,
    calendar: undefined,
    customSchedule,
  }), 'loading');
  assert.deepEqual(getSupporterScheduleSelection({
    hasTeamConnection: true,
    teamSchedule: undefined,
    customSchedule,
  }), {
    events: [],
    source: null,
  });

  assert.equal(getCalendarViewState({
    calendarCode: 'TEAM',
    loading: false,
    invalid: false,
    failed: true,
    calendar: undefined,
    customSchedule,
  }), 'failed');
  assert.deepEqual(getSupporterScheduleSelection({
    hasTeamConnection: true,
    teamSchedule: undefined,
    customSchedule,
  }), {
    events: [],
    source: null,
  });
});

test('an empty local draft keeps the disconnected empty state after reload', () => {
  const emptyLocalDraft = { events: [] };

  assert.deepEqual(getSupporterScheduleSelection({
    hasTeamConnection: false,
    teamSchedule: undefined,
    customSchedule: emptyLocalDraft,
  }), {
    events: [],
    source: null,
  });
  assert.equal(getCalendarViewState({
    calendarCode: '',
    loading: false,
    invalid: false,
    failed: false,
    calendar: undefined,
    customSchedule: emptyLocalDraft,
  }), 'disconnected');
});

test('maps only recent designs in newest-first order, limited to four', () => {
  const projects = [
    { id: 'old', name: 'Old card', updatedAt: '2026-01-01T00:00:00Z', project: { tool: 'hype' } },
    { id: 'schedule', name: 'Schedule', updatedAt: '2026-05-01T00:00:00Z', project: { tool: 'schedule' } },
    { id: 'new', name: 'New card', updatedAt: '2026-06-01T00:00:00Z', project: {} },
    { id: 'middle', name: 'Middle card', updatedAt: '2026-04-01T00:00:00Z', project: { tool: 'hype' } },
    { id: 'fourth', name: 'Fourth card', updatedAt: '2026-03-01T00:00:00Z', project: { tool: 'hype' } },
  ];

  const recent = mapRecentSupporterProjects(projects);

  assert.deepEqual(recent.map(({ id }) => id), ['new', 'middle', 'fourth', 'old']);
  assert.deepEqual(recent.map(({ kind }) => kind), ['hype-card', 'hype-card', 'hype-card', 'hype-card']);
  assert.equal(recent[0]?.href, '/studio/hype-card/new');
  assert.equal(recent[0]?.thumbnailProject, projects[2]?.project);
  assert.equal(recent.some(({ id }) => id === 'schedule'), false);
});