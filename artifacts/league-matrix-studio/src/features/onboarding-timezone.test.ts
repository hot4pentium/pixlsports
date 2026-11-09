import assert from 'node:assert/strict';
import test from 'node:test';
import { getBrowserTimeZone, getGameOnTimeZoneOptions, isIanaTimeZone, resolveGameOnTimeZone } from './game-on-timezone';

test('onboarding detection provides a valid selectable IANA time zone', () => {
  const detected = getBrowserTimeZone();
  assert.equal(isIanaTimeZone(detected), true);
  assert.equal(getGameOnTimeZoneOptions(detected).includes(detected), true);
});

test('new events preserve the saved onboarding zone instead of substituting the current browser zone', () => {
  for (const saved of ['America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
    assert.equal(resolveGameOnTimeZone(saved), saved);
    assert.equal(getGameOnTimeZoneOptions(saved).includes(saved), true);
  }
});

test('legacy missing or invalid defaults fall back to the detected zone', () => {
  assert.equal(resolveGameOnTimeZone(undefined), getBrowserTimeZone());
  assert.equal(resolveGameOnTimeZone('Not/A_Zone'), getBrowserTimeZone());
});
