import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addScheduleEvent,
  defaultScheduleEvents,
  getDefaultScheduleEvents,
  moveScheduleEvent,
  normalizeScheduleDraft,
  readScheduleDraft,
  removeScheduleEvent,
  saveScheduleDraft,
  updateScheduleEvent,
  type ScheduleEvent,
  type ScheduleDraft,
} from './schedule-draft';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
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
  assert.equal(removed.some((event) => event.id === second.id), false);
  assert.equal(removed.find((event) => event.id === first.id)?.opponent, first.opponent);
  assert.deepEqual(reset, defaultScheduleEvents);
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