import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildAuthEntryHref } from './auth-entry-routing';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const landingSource = readFileSync(new URL('./landing-home.tsx', import.meta.url), 'utf8');

test('auth choice destinations retain a protected destination for both account paths', () => {
  const search = '?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext';
  assert.equal(buildAuthEntryHref('sign-in', search), '/sign-in?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext');
  assert.equal(buildAuthEntryHref('sign-up', search), '/sign-up?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext');
  assert.equal(buildAuthEntryHref('sign-in'), '/sign-in');
  assert.equal(buildAuthEntryHref('sign-up'), '/sign-up');
});

test('generic account entry points show the choice before Google sign-in', () => {
  assert.match(appSource, /<Route path="\/auth" component=\{AuthChoicePage\} \/>/);
  assert.match(appSource, /New to Pixl Sports\?<\/strong> Create your account first/);
  assert.match(landingSource, /isSignedIn \? '\/studio' : '\/auth'/);
  assert.match(landingSource, /isSignedIn \? 'Studio' : 'Sign up \/ sign in'/);
});

test('Google sign-in and sign-up ask the provider to show the account chooser', () => {
  assert.match(appSource, /<SignIn\b[^>]*oidcPrompt="select_account"[^>]*\/>/);
  assert.match(appSource, /<SignUp\b[^>]*oidcPrompt="select_account"[^>]*\/>/);
});