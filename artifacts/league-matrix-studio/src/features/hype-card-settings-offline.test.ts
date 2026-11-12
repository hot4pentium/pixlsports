import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearPendingHypeCardSettings,
  createPendingHypeCardSettings,
  mergePendingHypeCardSettings,
  readPendingHypeCardSettings,
  retryWouldMakeHypeCardPublic,
  savePendingHypeCardSettings,
} from './hype-card-settings-offline';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

const activeSettings = { showHypeCard: true, showStats: true, showEvents: true, paused: false };

test('pending settings persist separately for each signed-in owner and invite', () => {
  const storage = memoryStorage();
  const pending = createPendingHypeCardSettings(
    'owner one',
    'invite/a',
    activeSettings,
    { ...activeSettings, showStats: false },
    '2026-11-12T12:00:00.000Z',
  );
  savePendingHypeCardSettings(storage, pending);

  assert.deepEqual(readPendingHypeCardSettings(storage, 'owner one', 'invite/a'), pending);
  assert.equal(readPendingHypeCardSettings(storage, 'owner two', 'invite/a'), null);
  assert.equal(readPendingHypeCardSettings(storage, 'owner one', 'invite/b'), null);
});

test('a pending save merges only edited settings onto the latest server state', () => {
  const pending = createPendingHypeCardSettings(
    'owner',
    'invite',
    activeSettings,
    { ...activeSettings, showStats: false },
  );
  const currentServer = { ...activeSettings, paused: true, showEvents: false };

  assert.deepEqual(mergePendingHypeCardSettings(currentServer, pending), {
    showHypeCard: true,
    showStats: false,
    showEvents: false,
    paused: true,
  });
});

test('automatic retry cannot publish a card that is currently hidden or paused', () => {
  assert.equal(retryWouldMakeHypeCardPublic(
    { ...activeSettings, showHypeCard: false },
    activeSettings,
  ), true);
  assert.equal(retryWouldMakeHypeCardPublic(
    { ...activeSettings, paused: true },
    activeSettings,
  ), true);
  assert.equal(retryWouldMakeHypeCardPublic(
    { ...activeSettings, paused: true },
    { ...activeSettings, paused: true },
  ), false);
});

test('a confirmed save removes only the exact pending version it submitted', () => {
  const storage = memoryStorage();
  const previous = createPendingHypeCardSettings('owner', 'invite', activeSettings, { ...activeSettings, showStats: false }, '2026-11-12T12:00:00.000Z');
  const newer = createPendingHypeCardSettings('owner', 'invite', activeSettings, { ...activeSettings, showEvents: false }, '2026-11-12T12:01:00.000Z');
  savePendingHypeCardSettings(storage, previous);
  savePendingHypeCardSettings(storage, newer);

  clearPendingHypeCardSettings(storage, previous);
  assert.deepEqual(readPendingHypeCardSettings(storage, 'owner', 'invite'), newer);
});
