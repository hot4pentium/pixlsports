import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consumeCompletionHandoff,
  saveCompletionHandoff,
} from './tracker-completion-handoff';

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    has: (key: string) => values.has(key),
  };
}

test('completion handoff is account-scoped, returned once, and removed before it is returned', () => {
  const storage = createMemoryStorage();
  saveCompletionHandoff(storage, 'acct/a', 'game-1', 'cloud-saved');

  assert.equal(consumeCompletionHandoff(storage, 'another-account'), null);
  const handoff = consumeCompletionHandoff(storage, 'acct/a');
  assert.equal(handoff?.gameId, 'game-1');
  assert.equal(handoff?.saveStatus, 'cloud-saved');
  assert.equal(storage.has('pixlsports-tracker-completion-handoff:acct%2Fa'), false);
  assert.equal(consumeCompletionHandoff(storage, 'acct/a'), null);
});

test('completion handoff rejects invalid, mismatched, and stale entries after removing them', () => {
  const storage = createMemoryStorage();
  const key = 'pixlsports-tracker-completion-handoff:acct';
  storage.setItem(key, JSON.stringify({
    accountId: 'different-account',
    gameId: 'game-1',
    saveStatus: 'local-saved',
    createdAt: Date.now(),
  }));
  assert.equal(consumeCompletionHandoff(storage, 'acct'), null);
  assert.equal(storage.has(key), false);

  storage.setItem(key, '{not-json');
  assert.equal(consumeCompletionHandoff(storage, 'acct'), null);
  assert.equal(storage.has(key), false);

  storage.setItem(key, JSON.stringify({
    accountId: 'acct',
    gameId: 'game-1',
    saveStatus: 'saving',
    createdAt: Date.now(),
  }));
  assert.equal(consumeCompletionHandoff(storage, 'acct'), null);
  assert.equal(storage.has(key), false);

  storage.setItem(key, JSON.stringify({
    accountId: 'acct',
    gameId: 'game-1',
    saveStatus: 'local-saved',
    createdAt: Date.now() - 25 * 60 * 60 * 1000,
  }));
  assert.equal(consumeCompletionHandoff(storage, 'acct'), null);
  assert.equal(storage.has(key), false);
});