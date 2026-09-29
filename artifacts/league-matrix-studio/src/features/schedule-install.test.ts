import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_SCHEDULE_INSTALL_INSTRUCTIONS,
  getScheduleInstallAction,
  getScheduleInstallInstructions,
  IOS_SCHEDULE_INSTALL_INSTRUCTIONS,
  isIosDevice,
  isStandaloneInstallMode,
} from './schedule-install';

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

test('recognizes standalone launches using either display mode or iOS standalone state', () => {
  assert.equal(isStandaloneInstallMode(true, false), true);
  assert.equal(isStandaloneInstallMode(false, true), true);
  assert.equal(isStandaloneInstallMode(false, false), false);
  assert.equal(isStandaloneInstallMode(false, undefined), false);
});

test('gives iPhone and iPad users the Share-menu path, while other browsers get a usable fallback', () => {
  assert.equal(getScheduleInstallInstructions(true), IOS_SCHEDULE_INSTALL_INSTRUCTIONS);
  assert.match(getScheduleInstallInstructions(true), /Share.*Add to Home Screen.*Add/);
  assert.equal(getScheduleInstallInstructions(false), BROWSER_SCHEDULE_INSTALL_INSTRUCTIONS);
  assert.match(getScheduleInstallInstructions(false), /bookmark this link/);
});