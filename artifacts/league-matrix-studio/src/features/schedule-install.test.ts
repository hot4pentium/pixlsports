import assert from 'node:assert/strict';
import test from 'node:test';

import { getScheduleInstallAction, isIosDevice } from './schedule-install';

test('recognizes iPhone and iPad user agents, including iPad desktop mode', () => {
  assert.equal(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5), true);
  assert.equal(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 5), true);
  assert.equal(isIosDevice('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64', 0), false);
});

test('chooses install prompt, fallback instructions, or installed state', () => {
  assert.equal(getScheduleInstallAction({ isStandalone: false, canPrompt: true }), 'install');
  assert.equal(getScheduleInstallAction({ isStandalone: false, canPrompt: false }), 'instructions');
  assert.equal(getScheduleInstallAction({ isStandalone: true, canPrompt: true }), 'installed');
});