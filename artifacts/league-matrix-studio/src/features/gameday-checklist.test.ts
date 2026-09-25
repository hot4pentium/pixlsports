import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyChecklistEventType,
  completedChecklistCount,
  createGamedayChecklist,
  readEventChecklist,
  saveEventChecklist,
  getChecklistTemplate,
  getChecklistEventCopy,
  getChecklistCompletionFeedback,
  getChecklistResetConfirmation,
  normalizeChecklist,
  resetGamedayChecklist,
} from './gameday-checklist';

test('private Prep is isolated by account and event and survives a reload', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } as Storage;
  const first = { ...createGamedayChecklist('game'), notes: 'Bring the blue jersey' };
  const second = { ...createGamedayChecklist('practice'), notes: 'Meet at the track' };
  saveEventChecklist(storage, 'parent-one', 'event-one', first);
  saveEventChecklist(storage, 'parent-one', 'event-two', second);
  assert.equal(readEventChecklist(storage, 'parent-one', 'event-one')?.notes, first.notes);
  assert.equal(readEventChecklist(storage, 'parent-one', 'event-two')?.notes, second.notes);
  assert.equal(readEventChecklist(storage, 'parent-two', 'event-one'), null);
});

test('starts with practical template items and keeps tournament mode available', () => {
  const checklist = createGamedayChecklist();
  const labels = checklist.items.map((item) => item.label);
  for (const label of [
    'Pack the uniform and game shoes',
    'Pack equipment and team bag',
    'Bring water and a quick snack',
    'Confirm arrival time and location',
  ]) assert.ok(labels.includes(label));
  assert.equal(normalizeChecklist({ ...checklist, mode: 'tournament' })?.mode, 'tournament');
});

test('keeps optional notes in saved and shared checklist data', () => {
  const checklist = createGamedayChecklist();
  assert.equal(normalizeChecklist(checklist)?.notes, '');
  assert.equal(normalizeChecklist({ ...checklist, notes: 'Meet by the north gate.' })?.notes, 'Meet by the north gate.');
  assert.equal(resetGamedayChecklist({ ...checklist, notes: 'Bring a spare jersey.' }).notes, 'Bring a spare jersey.');
});

test('uses event-specific starter items without changing the game template', () => {
  assert.deepEqual(
    createGamedayChecklist('practice').items.map((item) => item.label),
    [
      'Pack practice gear and shoes',
      'Pack practice equipment and team bag',
      'Bring water and a quick snack',
      'Confirm practice time and location',
      'Review the practice plan and player availability',
      'Review the practice schedule and field or court',
    ],
  );
  assert.deepEqual(
    createGamedayChecklist('meeting').items.map((item) => item.label),
    [
      'Bring a notebook and pen',
      'Gather meeting materials',
      'Bring water and any refreshments',
      'Confirm meeting time and location',
      'Review the meeting agenda and attendees',
      'Review the meeting schedule and location',
    ],
  );
  assert.equal(createGamedayChecklist().items[0]?.label, 'Pack the uniform and game shoes');
  assert.equal(getChecklistTemplate('game'), getChecklistTemplate());
});

test('switching an existing checklist to a meeting replaces its starter form', () => {
  const gameChecklist = {
    ...createGamedayChecklist('game'),
    selectedGame: {
      id: 'game-1',
      type: 'game' as const,
      date: '2026-09-23',
      time: '18:00',
      location: 'Field',
      opponent: 'Riverside',
    },
    items: [{ id: 'custom', label: 'Custom game task', completed: true }],
  };

  const meetingChecklist = applyChecklistEventType(gameChecklist, 'meeting');

  assert.equal(meetingChecklist.title, 'Meeting Checklist');
  assert.deepEqual(meetingChecklist.items, getChecklistTemplate('meeting'));
  assert.equal(meetingChecklist.selectedGame?.type, 'game');
});

test('uses event-specific checklist copy while keeping game copy unchanged', () => {
  assert.equal(getChecklistEventCopy('game').heading, 'GAMEDAY CHECKLIST.');
  assert.equal(getChecklistEventCopy('practice').heading, 'PRACTICE CHECKLIST.');
  assert.equal(getChecklistEventCopy('practice').description, 'Start with the essentials, then make the list yours for every practice.');
  assert.equal(getChecklistEventCopy('meeting').heading, 'MEETING CHECKLIST.');
  assert.equal(getChecklistEventCopy('meeting').description, 'Start with the essentials, then make the list yours for every meeting.');
  assert.equal(getChecklistEventCopy('game').completionMessage, 'Game day ready — every task is complete.');
});

test('warns that reset replaces custom items and completion state for each event type', () => {
  assert.equal(
    getChecklistResetConfirmation(),
    'Reset this game day checklist? Your custom items and completion state will be replaced with the game day starter template.',
  );
  assert.equal(
    getChecklistResetConfirmation('practice'),
    'Reset this practice checklist? Your custom items and completion state will be replaced with the practice starter template.',
  );
  assert.equal(
    getChecklistResetConfirmation('meeting'),
    'Reset this meeting checklist? Your custom items and completion state will be replaced with the meeting starter template.',
  );
});

test('describes item, final, and undo completion moments without changing checklist data', () => {
  const items = [
    { id: 'one', label: 'Pack shoes', completed: false },
    { id: 'two', label: 'Fill water bottle', completed: true },
  ];

  assert.deepEqual(getChecklistCompletionFeedback(items, 'one', true), {
    kind: 'complete',
    itemId: 'one',
    message: 'Game day ready — every task is complete.',
  });
  assert.deepEqual(getChecklistCompletionFeedback(items, 'two', false), {
    kind: 'undo',
    itemId: 'two',
    message: 'Back in progress — Fill water bottle.',
  });
  assert.deepEqual(getChecklistCompletionFeedback([
    ...items,
    { id: 'three', label: 'Bring snacks', completed: false },
  ], 'one', true), {
    kind: 'item',
    itemId: 'one',
    message: 'Nice work — Pack shoes is done. 2 of 3 ready.',
  });
  assert.equal(getChecklistCompletionFeedback(items, 'missing', true), null);
  assert.equal(items[0]?.completed, false);
});

test('normalizes malformed values and resets completion without dropping custom title', () => {
  const checklist = normalizeChecklist({
    title: 'Saturday tournament',
    mode: 'gameday',
    selectedGame: {
      id: 'game-1',
      date: '2026-09-19',
      time: '16:30',
      location: 'Central Field',
      opponent: 'Riverside',
    },
    items: [{ id: 'one', label: '  Bring cones  ', completed: true, section: 'Game 1' }],
  });
  assert.deepEqual(checklist, {
    title: 'Saturday tournament',
    notes: '',
    mode: 'gameday',
    selectedGame: {
      id: 'game-1',
      date: '2026-09-19',
      time: '16:30',
      location: 'Central Field',
      opponent: 'Riverside',
    },
    items: [{ id: 'one', label: 'Bring cones', completed: true, section: 'Game 1' }],
  });
  assert.equal(completedChecklistCount(checklist?.items ?? []), 1);
  assert.equal(resetGamedayChecklist(checklist!).items.every((item) => !item.completed), true);
  assert.equal(resetGamedayChecklist(checklist!).title, 'Saturday tournament');
});

test('resets selected practice and meeting checklists with the matching template', () => {
  const practice = {
    ...createGamedayChecklist('practice'),
    selectedGame: {
      id: 'practice-1',
      type: 'practice' as const,
      date: '2026-09-23',
      time: '17:00',
      location: 'Eastside Field',
      opponent: '',
    },
    items: [{ id: 'custom', label: 'Custom task', completed: true }],
  };
  assert.deepEqual(resetGamedayChecklist(practice).items, getChecklistTemplate('practice'));

  const meeting = {
    ...createGamedayChecklist('meeting'),
    selectedGame: {
      id: 'meeting-1',
      type: 'meeting' as const,
      date: '2026-09-24',
      time: '18:00',
      location: 'Clubhouse',
      opponent: '',
    },
    items: [{ id: 'custom', label: 'Custom task', completed: true }],
  };
  assert.deepEqual(resetGamedayChecklist(meeting).items, getChecklistTemplate('meeting'));
});

test('persists a selected preparation event type and treats legacy selections as games', () => {
  const practice = normalizeChecklist({
    ...createGamedayChecklist(),
    selectedGame: {
      id: 'practice-1',
      type: 'practice',
      date: '2026-09-23',
      time: '17:00',
      location: 'Eastside Field',
      opponent: '',
    },
  });
  assert.equal(practice?.selectedGame?.type, 'practice');

  const legacy = normalizeChecklist({
    ...createGamedayChecklist(),
    selectedGame: {
      id: 'game-1',
      date: '2026-09-19',
      time: '16:30',
      location: 'Central Field',
      opponent: 'Riverside',
    },
  });
  assert.equal(legacy?.selectedGame?.type, undefined);
  assert.equal(getChecklistEventCopy(legacy?.selectedGame?.type ?? 'game').heading, 'GAMEDAY CHECKLIST.');
});