import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPrivateEntrySplashRemainingMs,
  PRIVATE_ENTRY_SPLASH_MIN_DURATION_MS,
} from './private-entry-splash';

test('private-entry splash remains for five seconds from the initial HTML paint', () => {
  assert.equal(PRIVATE_ENTRY_SPLASH_MIN_DURATION_MS, 5_000);
  assert.equal(getPrivateEntrySplashRemainingMs('1000', 1_250), 4_750);
  assert.equal(getPrivateEntrySplashRemainingMs('1000', 5_999), 1);
  assert.equal(getPrivateEntrySplashRemainingMs('1000', 6_000), 0);
});

test('missing or invalid startup timestamps do not add an artificial delay', () => {
  assert.equal(getPrivateEntrySplashRemainingMs(null, 1_250), 0);
  assert.equal(getPrivateEntrySplashRemainingMs('', 1_250), 0);
  assert.equal(getPrivateEntrySplashRemainingMs('not-a-time', 1_250), 0);
});
