import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addScheduleEvent,
  createScheduleAutosaveQueue,
  defaultScheduleEvents,
  getDefaultScheduleEvents,
  moveScheduleEvent,
  normalizeScheduleDraft,
  readScheduleDraft,
  removeScheduleEvent,
  saveScheduleEvent,
  saveScheduleDraft,
  scheduleLegacyDefaultsMigrationKey,
  scheduleStorageKey,
  updateScheduleEvent,
  createBlankScheduleEvent,
  getActiveCloudScheduleProject,
  getCloudScheduleProjectForIdentity,
  getCloudScheduleProjects,
  getLatestCloudScheduleProject,
  getScheduleIdentity,
  getSelectedCloudScheduleProject,
  findScheduleGameOwner,
  clearSupporterScheduleSelection,
  readSupporterScheduleSelection,
  saveSupporterScheduleSelection,
  updateScheduleEventStatus,
  type ScheduleEvent,
  type ScheduleDraft,
} from './schedule-draft';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const completeEvents: ScheduleEvent[] = [
  {
    id: 'game-1',
    type: 'game',
    date: '2026-09-18',
    time: '18:45',
    location: 'Westside Stadium',
    opponent: 'Riverside',
    snacks: 'Avery family',
    drinks: 'Sam family',
    notes: 'Arrive 30 minutes early.',
  },
  {
    id: 'meeting-1',
    type: 'meeting',
    date: '2026-09-19',
    time: '09:00',
    location: 'Clubhouse',
    opponent: '',
    snacks: 'Coffee',
    drinks: 'Water',
    notes: 'Bring the volunteer roster.',
  },
];

test('completion finds the saved Calendar that owns a published card even when another schedule is active', () => {
  const older = { id: 'older', revision: 2, updatedAt: '2026-09-20', project: {
    tool: 'schedule', teamName: 'Wolves', season: 'Fall', template: 0, events: completeEvents,
  } };
  const active = { id: 'active', revision: 4, updatedAt: '2026-09-24', project: {
    tool: 'schedule', teamName: 'Bears', season: 'Fall', template: 0, events: [],
  } };
  const owner = findScheduleGameOwner('game-1', [active, older], active, null);
  assert.equal(owner?.project?.id, 'older');
  assert.equal(findScheduleGameOwner('missing', [active, older], active, null), null);
});

test('local draft round trips team name, season, template, and every event field', () => {
  const storage = new MemoryStorage();
  const draft: ScheduleDraft = {
    teamName: 'Westside Wolves',
    season: 'Spring 2026',
    events: completeEvents,
    template: 2,
  };

  saveScheduleDraft(storage as Storage, draft);

  assert.deepEqual(readScheduleDraft(storage as Storage), draft);
});

test('empty and partially filled saved events normalize into safe preview data', () => {
  const draft = normalizeScheduleDraft({
    title: 'OPEN ROSTER',
    teamSeason: 'Wolves · 2026',
    template: 1,
    events: [
      { id: 'empty-event', type: 'practice' },
      { id: 'partial-game', type: 'game', opponent: 'Northside', notes: 'Bring water.' },
      null,
    ],
  });

  assert.ok(draft);
  assert.deepEqual(draft.events[0], {
    id: 'empty-event',
    type: 'practice',
    date: '',
    time: '',
    location: '',
    opponent: '',
    snacks: '',
    drinks: '',
    notes: '',
  });
  assert.equal(draft.events[1].opponent, 'Northside');
  assert.equal(draft.events[1].notes, 'Bring water.');
  assert.equal(draft.events[2].type, 'game');
  assert.equal(draft.events[2].date, '');
  assert.equal(draft.events[2].location, '');
  assert.equal(draft.teamName, 'Wolves');
  assert.equal(draft.season, '2026');
});

test('schedule statuses survive normalization and update only game events', () => {
  const completedAt = '2026-09-22T20:45:00Z';
  const draft = normalizeScheduleDraft({
    events: [
      { id: 'live-game', type: 'game', status: 'live', completedAt },
      { id: 'practice', type: 'practice', status: 'final' },
      { id: 'invalid-status', type: 'game', status: 'finished' },
    ],
  });

  assert.equal(draft?.events[0]?.status, 'live');
  assert.equal(draft?.events[0]?.completedAt, completedAt);
  assert.equal(draft?.events[1]?.status, undefined);
  assert.equal(draft?.events[2]?.status, undefined);
  assert.equal(
    updateScheduleEventStatus(draft!.events, 'live-game', 'final', completedAt)[0]?.status,
    'final',
  );
  assert.equal(
    updateScheduleEventStatus(draft!.events, 'live-game', 'final', completedAt)[0]?.completedAt,
    completedAt,
  );
  assert.equal(
    updateScheduleEventStatus(draft!.events, 'practice', 'live')[1]?.status,
    undefined,
  );
});

test('new identity fields take precedence over legacy combined schedule text', () => {
  const draft = normalizeScheduleDraft({
    teamName: 'Westside Wolves',
    season: 'Spring 2026',
    title: 'OLD TITLE',
    teamSeason: 'Old Team · Old Season',
    events: [],
    template: 0,
  });

  assert.ok(draft);
  assert.equal(draft.teamName, 'Westside Wolves');
  assert.equal(draft.season, 'Spring 2026');
});

test('a parent share token survives local draft round trips', () => {
  const storage = new MemoryStorage();
  const draft: ScheduleDraft = {
    teamName: 'Westside Wolves',
    season: 'Spring 2026',
    events: [],
    template: 0,
    shareToken: '9f1c9e9d-4f08-4cf7-9232-4d8de4e8f4a0',
  };

  saveScheduleDraft(storage as Storage, draft);

  assert.equal(readScheduleDraft(storage as Storage)?.shareToken, draft.shareToken);
});

test('opponent is only retained for game events when changing event type', () => {
  const game = completeEvents[0];
  const practice = updateScheduleEvent([game], game.id, { type: 'practice' })[0];
  const meeting = updateScheduleEvent([practice], game.id, { type: 'meeting' })[0];
  const gameAgain = updateScheduleEvent([meeting], game.id, { type: 'game' })[0];

  assert.equal(practice.opponent, '');
  assert.equal(meeting.opponent, '');
  assert.equal(gameAgain.opponent, '');
});

test('event controls add, reorder, remove, and reset without losing event data', () => {
  const first = completeEvents[0];
  const second = completeEvents[1];
  const withNewEvent = addScheduleEvent([first, second], 'practice');
  const newEvent = withNewEvent[2];
  const reordered = moveScheduleEvent(withNewEvent, newEvent.id, -1);
  const removed = removeScheduleEvent(reordered, second.id);
  const reset = getDefaultScheduleEvents();

  assert.deepEqual(reordered.map((event) => event.id), [first.id, newEvent.id, second.id]);
  assert.deepEqual(
    { ...newEvent, id: 'new-event' },
    {
      id: 'new-event',
      type: 'practice',
      date: '',
      time: '',
      location: '',
      opponent: '',
      snacks: '',
      drinks: '',
      notes: '',
    },
  );
  assert.equal(removed.some((event) => event.id === second.id), false);
  assert.equal(removed.find((event) => event.id === first.id)?.opponent, first.opponent);
  assert.deepEqual(reset, defaultScheduleEvents);
});

test('a new event stays out of the schedule until saved with all entered details', () => {
  const originalEvents = completeEvents.map((event) => ({ ...event }));
  const blankEvent = createBlankScheduleEvent('game');
  const enteredEvent: ScheduleEvent = {
    ...blankEvent,
    date: '2026-09-25',
    time: '17:30',
    location: 'Northside Field',
    opponent: 'Lakeside',
    snacks: 'Taylor family',
    drinks: 'Morgan family',
    notes: 'Bring pinnies and arrive early.',
  };

  assert.equal(originalEvents.some((event) => event.id === blankEvent.id), false);
  assert.deepEqual(originalEvents, completeEvents);

  const savedEvents = saveScheduleEvent(originalEvents, enteredEvent);

  assert.deepEqual(savedEvents, [...completeEvents, enteredEvent]);
  assert.equal(savedEvents.at(-1)?.date, '2026-09-25');
  assert.equal(savedEvents.at(-1)?.opponent, 'Lakeside');
  assert.equal(savedEvents.at(-1)?.notes, 'Bring pinnies and arrive early.');
});

test('discarding a new draft leaves saved events unchanged, while saving an existing event replaces it in place', () => {
  const originalEvents = completeEvents.map((event) => ({ ...event }));
  const blankEvent = createBlankScheduleEvent('practice');

  assert.deepEqual(originalEvents, completeEvents);
  assert.equal(originalEvents.some((event) => event.id === blankEvent.id), false);

  const updatedFirstEvent: ScheduleEvent = {
    ...originalEvents[0],
    date: '2026-09-26',
    location: 'Updated Stadium',
    notes: 'Updated arrival instructions.',
  };
  const updatedEvents = saveScheduleEvent(originalEvents, updatedFirstEvent);

  assert.deepEqual(updatedEvents, [updatedFirstEvent, originalEvents[1]]);
  assert.deepEqual(originalEvents, completeEvents);
});

test('a saved draft with no events stays empty after reload', () => {
  const storage = new MemoryStorage();
  const draft: ScheduleDraft = {
    teamName: 'Wolves',
    season: 'Fall 2026',
    events: [],
    template: 0,
  };

  saveScheduleDraft(storage as Storage, draft);

  assert.deepEqual(readScheduleDraft(storage as Storage)?.events, []);
});

test('a failed cloud save leaves the newly saved event recoverable after reload', async () => {
  const storage = new MemoryStorage();
  const draft: ScheduleDraft = {
    teamName: 'Wolves',
    season: 'Fall 2026',
    events: [completeEvents[0]],
    template: 0,
  };
  const autosaveQueue = createScheduleAutosaveQueue();

  saveScheduleDraft(storage as Storage, draft);
  await autosaveQueue.enqueue(async () => {
    throw new Error('cloud unavailable');
  }).catch(() => undefined);

  assert.deepEqual(readScheduleDraft(storage as Storage), draft);
});

test('cloud autosaves run in order so an older request cannot finish after a newer edit', async () => {
  const autosaveQueue = createScheduleAutosaveQueue();
  const calls: string[] = [];
  let releaseFirstSave!: () => void;
  const firstSave = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });

  const first = autosaveQueue.enqueue(async () => {
    calls.push('first-start');
    await firstSave;
    calls.push('first-finish');
  });
  const second = autosaveQueue.enqueue(async () => {
    calls.push('second-start');
    calls.push('second-finish');
  });

  await Promise.resolve();
  assert.deepEqual(calls, ['first-start']);

  releaseFirstSave();
  await Promise.all([first, second]);

  assert.deepEqual(calls, [
    'first-start',
    'first-finish',
    'second-start',
    'second-finish',
  ]);
});

test('new schedules do not seed example events, and old untouched examples are cleared once', () => {
  assert.deepEqual(getDefaultScheduleEvents(), []);

  const storage = new MemoryStorage();
  storage.setItem(scheduleStorageKey, JSON.stringify({
    teamName: 'Eastside Falcons',
    season: 'Fall 2024',
    events: [
      {
        id: 'schedule-event-default-1',
        type: 'game',
        date: '2024-10-12',
        time: '16:30',
        location: 'Central Field',
        opponent: 'Northside',
        snacks: 'Maya family',
        drinks: 'Jordan family',
        notes: '',
      },
      {
        id: 'schedule-event-default-2',
        type: 'practice',
        date: '2024-10-13',
        time: '10:00',
        location: 'Eastside Field',
        opponent: '',
        snacks: '',
        drinks: '',
        notes: 'Bring cleats and a water bottle.',
      },
    ],
    template: 0,
  }));

  assert.equal(readScheduleDraft(storage as Storage), null);
  assert.equal(storage.getItem(scheduleStorageKey), null);
  assert.equal(storage.getItem(scheduleLegacyDefaultsMigrationKey), '1');
});

test('the legacy cleanup preserves an edited version of the example schedule', () => {
  const storage = new MemoryStorage();
  const editedDraft: ScheduleDraft = {
    teamName: 'Eastside Falcons',
    season: 'Fall 2024',
    events: [
      {
        id: 'schedule-event-default-1',
        type: 'game',
        date: '2024-10-12',
        time: '16:30',
        location: 'Central Field',
        opponent: 'Northside',
        snacks: 'Maya family',
        drinks: 'Jordan family',
        notes: 'Arrive early.',
      },
      {
        id: 'schedule-event-default-2',
        type: 'practice',
        date: '2024-10-13',
        time: '10:00',
        location: 'Eastside Field',
        opponent: '',
        snacks: '',
        drinks: '',
        notes: 'Bring cleats and a water bottle.',
      },
    ],
    template: 0,
  };
  saveScheduleDraft(storage as Storage, editedDraft);

  assert.deepEqual(readScheduleDraft(storage as Storage), editedDraft);
  assert.equal(storage.getItem(scheduleStorageKey) !== null, true);
});

test('the latest valid cloud schedule is shared by dashboard and schedule maker', () => {
  const projects = [
    {
      id: 'older',
      revision: 2,
      updatedAt: '2026-09-10T12:00:00Z',
      project: { tool: 'schedule', events: [], teamName: 'Older Team' },
    },
    {
      id: 'not-a-schedule',
      revision: 4,
      updatedAt: '2026-09-20T12:00:00Z',
      project: { tool: 'other', payload: [] },
    },
    {
      id: 'latest',
      revision: 3,
      updatedAt: '2026-09-15T12:00:00Z',
      project: {
        tool: 'schedule',
        teamName: 'Westside Wolves',
        season: 'Fall 2026',
        events: completeEvents,
      },
    },
  ];

  assert.equal(getLatestCloudScheduleProject(projects)?.id, 'latest');
});

test('the newest valid project is the active schedule for an exact team and season', () => {
  const projects = [
    {
      id: 'different-team',
      revision: 4,
      updatedAt: '2026-09-20T12:00:00Z',
      project: { tool: 'schedule', events: [], teamName: 'Other Team', season: 'Fall 2026' },
    },
    {
      id: 'older-copy',
      revision: 2,
      updatedAt: '2026-09-10T12:00:00Z',
      project: { tool: 'schedule', events: [], teamName: ' Wildcats ', season: 'Fall 2026' },
    },
    {
      id: 'newer-copy',
      revision: 3,
      updatedAt: '2026-09-15T12:00:00Z',
      project: { tool: 'schedule', events: [], teamName: 'WILDCATS', season: '  Fall   2026 ' },
    },
  ];

  assert.equal(getScheduleIdentity({ teamName: ' Wildcats ', season: 'Fall 2026' }), 'wildcats::fall 2026');
  assert.equal(getCloudScheduleProjectForIdentity(projects, {
    teamName: 'wildcats',
    season: 'fall 2026',
  })?.id, 'newer-copy');
  assert.equal(getActiveCloudScheduleProject(projects, {
    teamName: 'wildcats',
    season: 'fall 2026',
  })?.id, 'newer-copy');
});

test('a complete identity with no cloud match does not select another season', () => {
  const projects = [{
    id: 'other-season',
    revision: 1,
    updatedAt: '2026-09-20T12:00:00Z',
    project: { tool: 'schedule', events: [], teamName: 'Wildcats', season: 'Spring 2026' },
  }];

  assert.equal(getCloudScheduleProjectForIdentity(projects, {
    teamName: 'Wildcats',
    season: 'Fall 2026',
  }), null);
  assert.equal(getScheduleIdentity({ teamName: 'Wildcats', season: '' }), null);
  assert.equal(getActiveCloudScheduleProject(projects, {
    teamName: 'Wildcats',
    season: '',
  })?.id, 'other-season');
});

test('supporters can select an older valid cloud schedule instead of the newest one', () => {
  const projects = [
    {
      id: 'older',
      name: 'Older schedule',
      revision: 2,
      updatedAt: '2026-09-10T12:00:00Z',
      project: { tool: 'schedule', events: completeEvents, teamName: 'Older Team' },
    },
    {
      id: 'latest',
      name: 'Latest schedule',
      revision: 3,
      updatedAt: '2026-09-15T12:00:00Z',
      project: { tool: 'schedule', events: completeEvents, teamName: 'Latest Team' },
    },
    {
      id: 'other',
      name: 'Other',
      revision: 4,
      updatedAt: '2026-09-20T12:00:00Z',
      project: { tool: 'other', events: completeEvents },
    },
  ];

  assert.deepEqual(getCloudScheduleProjects(projects).map(({ id }) => id), ['latest', 'older']);
  assert.equal(getSelectedCloudScheduleProject(projects, 'older')?.id, 'older');
  assert.equal(getSelectedCloudScheduleProject(projects, 'missing')?.id, 'latest');
});

test('selected supporter schedule survives local storage round trips', () => {
  const storage = new MemoryStorage();

  saveSupporterScheduleSelection(storage as Storage, 'older');

  assert.equal(readSupporterScheduleSelection(storage as Storage), 'older');
});

test('removing supporter schedule selection clears stale local state', () => {
  const storage = new MemoryStorage();
  saveSupporterScheduleSelection(storage as Storage, 'removed-schedule');

  clearSupporterScheduleSelection(storage as Storage);

  assert.equal(readSupporterScheduleSelection(storage as Storage), null);
});