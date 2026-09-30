import assert from 'node:assert/strict';
import test from 'node:test';
import { canShowInitialAccountSetup } from './initial-account-setup';

test('first-time setup is shown only for a recent, unprovisioned identity', () => {
  const now = Date.parse('2026-09-30T12:00:00.000Z');
  const freshIdentity = { createdAt: now - 60_000, publicMetadata: {}, unsafeMetadata: {} };

  assert.equal(canShowInitialAccountSetup(freshIdentity, now), true);
  assert.equal(canShowInitialAccountSetup({
    ...freshIdentity,
    publicMetadata: { pixlSportsAccountProvisioned: true },
  }, now), false);
  assert.equal(canShowInitialAccountSetup({
    ...freshIdentity,
    unsafeMetadata: { role: 'fan' },
  }, now), false);
  assert.equal(canShowInitialAccountSetup({
    ...freshIdentity,
    createdAt: now - 8 * 24 * 60 * 60 * 1000,
  }, now), false);
  assert.equal(canShowInitialAccountSetup(null, now), false);
});