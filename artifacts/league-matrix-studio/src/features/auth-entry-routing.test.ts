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
const bootShellSource = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

test('auth choice destinations retain a protected destination for both account paths', () => {
  const search = '?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext';
  assert.equal(buildAuthEntryHref('sign-in', search), '/sign-in?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext');
  assert.equal(buildAuthEntryHref('sign-up', search), '/sign-up?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext');
  assert.equal(buildAuthEntryHref('sign-in'), '/sign-in');
  assert.equal(buildAuthEntryHref('sign-up'), '/sign-up');
});

test('home entry shows the landing page while Clerk initializes and redirects loaded users to the studio', () => {
  assert.equal(getHomeEntryState(false, false), 'landing');
  assert.equal(getHomeEntryState(false, true), 'landing');
  assert.equal(getHomeEntryState(true, true), 'dashboard');
  assert.equal(getHomeEntryState(true, false), 'landing');
});

test('the initial HTML shell shows landing content before React starts', () => {
  assert.match(bootShellSource, /ALL IN,<br \/><em>ALL SEASON\.<\/em>/);
  assert.match(bootShellSource, /One season hub for youth-sports families/);
  assert.doesNotMatch(bootShellSource, /Loading Pixl Sports/);
});

test('only signed-out or unresolved home visits bypass account lifecycle checks', () => {
  assert.equal(shouldBypassAccountLifecycle('/', false, true), true);
  assert.equal(shouldBypassAccountLifecycle('/', true, false), true);
  assert.equal(shouldBypassAccountLifecycle('/', true, true), false);
  assert.equal(shouldBypassAccountLifecycle('/h/public-card', true, true), true);
  assert.equal(shouldBypassAccountLifecycle('/studio', true, true), false);
});

test('the app bypasses lifecycle checks on public home visits and opens the studio for signed-in users', () => {
  assert.match(appSource, /shouldBypassAccountLifecycle\(location, isLoaded, Boolean\(isSignedIn\)\)/);
  assert.match(appSource, /location === '\/' && canShowInitialAccountSetup\(user\)/);
  assert.match(appSource, /const homeEntryState = getHomeEntryState\(isLoaded, Boolean\(isSignedIn\)\)/);
  assert.match(appSource, /if \(homeEntryState === 'dashboard'\) return <Redirect to="\/studio" \/>;/);
  assert.match(appSource, /return <PublicLandingPage \/>;/);
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