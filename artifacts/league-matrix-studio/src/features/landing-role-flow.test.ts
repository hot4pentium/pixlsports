import assert from 'node:assert/strict';
import test from 'node:test';

import { getRoleIntent, roleSignupHref, roleToolKinds } from './landing-role-flow';

test('landing role intent accepts only supported roles', () => {
  assert.equal(getRoleIntent('?role=coach'), 'coach');
  assert.equal(getRoleIntent('?role=fan'), 'fan');
  assert.equal(getRoleIntent('?role=admin'), null);
  assert.equal(getRoleIntent(''), null);
});

test('role signup links preserve onboarding intent', () => {
  assert.equal(roleSignupHref('coach'), '/sign-up?role=coach');
  assert.equal(roleSignupHref('fan'), '/sign-up?role=fan');
});

test('landing role tools match the authenticated role tool sets', () => {
  assert.deepEqual(roleToolKinds.coach, ['schedule', 'roster', 'checklist']);
  assert.deepEqual(roleToolKinds.fan, ['hype', 'schedule', 'stat-tracker', 'checklist']);
});