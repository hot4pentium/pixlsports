import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildAuthEntryHref,
  getHomeEntryState,
  shouldBypassAccountLifecycle,
} from './auth-entry-routing';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const landingSource = readFileSync(new URL('./landing-home.tsx', import.meta.url), 'utf8');

test('auth choice destinations retain a protected destination for both account paths', () => {
  const search = '?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext';
  assert.equal(buildAuthEntryHref('sign-in', search), '/sign-in?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext');
  assert.equal(buildAuthEntryHref('sign-up', search), '/sign-up?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext');
  assert.equal(buildAuthEntryHref('sign-in'), '/sign-in');
  assert.equal(buildAuthEntryHref('sign-up'), '/sign-up');
});

test('home entry waits for Clerk before choosing the landing page or dashboard', () => {
  assert.equal(getHomeEntryState(false, false), 'loading');
  assert.equal(getHomeEntryState(false, true), 'loading');
  assert.equal(getHomeEntryState(true, true), 'dashboard');
  assert.equal(getHomeEntryState(true, false), 'landing');
});

test('only signed-out or unresolved home visits bypass account lifecycle checks', () => {
  assert.equal(shouldBypassAccountLifecycle('/', false, true), true);
  assert.equal(shouldBypassAccountLifecycle('/', true, false), true);
  assert.equal(shouldBypassAccountLifecycle('/', true, true), false);
  assert.equal(shouldBypassAccountLifecycle('/h/public-card', true, true), true);
  assert.equal(shouldBypassAccountLifecycle('/studio', true, true), false);
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