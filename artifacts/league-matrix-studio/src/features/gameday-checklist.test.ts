import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completedChecklistCount,
  createGamedayChecklist,
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