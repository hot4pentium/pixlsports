import assert from 'node:assert/strict';
import test from 'node:test';

import { getGuestUsageKey } from './guest-access';

test('new editor claims receive distinct usage keys', () => {
  const first = getGuestUsageKey('hype_card', 'editor', false);
  const second = getGuestUsageKey('hype_card', 'editor', false);

  assert.ok(first.length > 0);
  assert.ok(second.length > 0);
  assert.notEqual(first, second);
});