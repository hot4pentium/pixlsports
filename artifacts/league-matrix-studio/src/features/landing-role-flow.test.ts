import assert from 'node:assert/strict';
import test from 'node:test';

import { roleSignupHref, roleToolKinds } from './landing-role-flow';

test('signup always enters supporter onboarding', () => {
  assert.equal(roleSignupHref('fan'), '/sign-up');
});

test('landing role tools match the authenticated role tool sets', () => {
  assert.deepEqual(roleToolKinds.fan, ['schedule', 'checklist', 'stat-tracker', 'hype']);
});