import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forgetPrivateSession,
  hasPreviousPrivateSession,
  rememberPrivateSession,
} from './previous-private-session';

test('remembers prior dashboard use with a non-sensitive local marker', () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };

  assert.equal(hasPreviousPrivateSession(storage), false);
  rememberPrivateSession(storage);
  assert.equal(hasPreviousPrivateSession(storage), true);
  assert.deepEqual([...entries.values()], ['seen']);
  forgetPrivateSession(storage);
  assert.equal(hasPreviousPrivateSession(storage), false);
});

test('restricted storage cannot break home entry or account access checks', () => {
  const storage = {
    getItem: () => { throw new Error('storage unavailable'); },
    setItem: () => { throw new Error('storage unavailable'); },
    removeItem: () => { throw new Error('storage unavailable'); },
  };

  assert.equal(hasPreviousPrivateSession(storage), false);
  assert.doesNotThrow(() => rememberPrivateSession(storage));
  assert.doesNotThrow(() => forgetPrivateSession(storage));
});
