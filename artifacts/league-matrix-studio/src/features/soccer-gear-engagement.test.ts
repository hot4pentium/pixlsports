import assert from 'node:assert/strict';
import test from 'node:test';
import { runGearQualifiedShareAction, retrySoccerGearShare } from './soccer-gear-engagement';

test('cancelled shares award nothing; failed reward saves retry only for their own account', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  let calls = 0;
  let fail = false;
  globalThis.fetch = async () => {
    calls++;
    if (fail) throw new TypeError('offline');
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(() => runGearQualifiedShareAction(
      async () => { throw new DOMException('Cancelled', 'AbortError'); }, 'account-one', 'public-token',
    ));
    assert.equal(calls, 0);
    assert.equal(storage.size, 0);
    fail = true;
    assert.equal(await runGearQualifiedShareAction(async () => {}, 'account-one', 'public-token'), false);
    assert.equal(storage.size, 1);
    const failedCalls = calls;
    assert.equal(await retrySoccerGearShare('account-two'), true);
    assert.equal(calls, failedCalls, 'another account must never submit queued progress');
    fail = false;
    assert.equal(await retrySoccerGearShare('account-one'), true);
    assert.equal(storage.size, 0);
    const successCalls = calls;
    await retrySoccerGearShare('account-one');
    assert.equal(calls, successCalls);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
