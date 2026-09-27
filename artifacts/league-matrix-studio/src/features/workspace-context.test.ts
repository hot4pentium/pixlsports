import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkspaceToolHref,
  readWorkspaceEventContext,
  resolveWorkspaceEvent,
  saveWorkspaceEventContext,
  workspaceEventContextStorageKey,
} from './workspace-context';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

const game = {
  id: 'game-1',
  type: 'game' as const,
  date: '2026-10-02',
  time: '18:30',
  location: 'North Field',
  opponent: 'Rivals',
  snacks: 'Private snack note',
  drinks: '',
  notes: 'Private checklist prep',
};

test('workspace event context persists only safe event fields', () => {
  const storage = memoryStorage();
  saveWorkspaceEventContext(storage, game);
  const raw = storage.values.get(workspaceEventContextStorageKey) ?? '';
  assert.doesNotMatch(raw, /Private snack note|Private checklist prep/);
  assert.deepEqual(readWorkspaceEventContext(storage), {
    id: 'game-1',
    type: 'game',
    date: '2026-10-02',
    time: '18:30',
    location: 'North Field',
    opponent: 'Rivals',
  });
});

test('workspace links carry event identity without private draft data', () => {
  const context = readWorkspaceEventContext({
    getItem: () => JSON.stringify(game),
  })!;
  assert.equal(buildWorkspaceToolHref('prep', context), '/studio/checklist?gameId=game-1&eventType=game');
  assert.match(buildWorkspaceToolHref('stats', context), /eventId=game-1/);
  assert.equal(buildWorkspaceToolHref('hype', context), '/studio/athlete-page');
});

test('removed selections do not resolve and meetings are not persisted', () => {
  const storage = memoryStorage();
  saveWorkspaceEventContext(storage, { ...game, type: 'meeting' });
  assert.equal(storage.values.size, 0);
  assert.equal(resolveWorkspaceEvent([game], { ...game, id: 'missing' }), undefined);
});