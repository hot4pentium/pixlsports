import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completedChecklistCount,
  createGamedayChecklist,
  getChecklistEventCopy,
  getChecklistCompletionFeedback,
  normalizeChecklist,
  resetGamedayChecklist,
} from './gameday-checklist';

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

test('uses event-specific checklist copy while keeping game copy unchanged', () => {
  assert.equal(getChecklistEventCopy('game').heading, 'GAMEDAY CHECKLIST.');
  assert.equal(getChecklistEventCopy('practice').heading, 'PRACTICE CHECKLIST.');
  assert.equal(getChecklistEventCopy('practice').description, 'Start with the essentials, then make the list yours for every practice.');
  assert.equal(getChecklistEventCopy('meeting').heading, 'MEETING CHECKLIST.');
  assert.equal(getChecklistEventCopy('meeting').description, 'Start with the essentials, then make the list yours for every meeting.');
  assert.equal(getChecklistEventCopy('game').completionMessage, 'Game day ready — every task is complete.');
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