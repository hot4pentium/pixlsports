import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { shouldRequireSupporterSetup } from './supporter-setup-routing';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('all studio pages require completed supporter setup except the setup page', () => {
  for (const path of [
    '/studio',
    '/studio/profile',
    '/studio/stat-tracker',
    '/studio/athlete-page',
  ]) {
    assert.equal(shouldRequireSupporterSetup(path), true);
  }

  for (const path of [
    '/',
    '/sign-in',
    '/sign-in/sso-callback',
    '/sign-up',
    '/fan/invite-token',
    '/studio/setup',
    '/studio/setup?from=signin',
    '/studio/setup/',
  ]) {
    assert.equal(shouldRequireSupporterSetup(path), false);
  }
});

test('first-time sign-ins enter setup and incomplete profiles are gated before studio routes', () => {
  assert.match(
    appSource,
    /fallbackRedirectUrl=\{redirectUrl \|\| `\$\{basePath\}\/studio\/setup`\}/,
  );
  assert.match(appSource, /function SupporterSetupGate\(/);
  assert.match(appSource, /shouldRequireSupporterSetup\(location\)/);
  assert.match(appSource, /isSupporterSetupComplete\(getUserProfile\(user\)\)/);
  assert.match(appSource, /<Redirect to="\/studio\/setup" \/>/);
  assert.match(appSource, /<SupporterSetupGate>\s*<Switch>/);
});