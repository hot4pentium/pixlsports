import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildAuthEntryHref,
  getHomeEntryState,
  shouldBypassAccountLifecycle,
} from './auth-entry-routing';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const entrySource = readFileSync(new URL('../app-entry.tsx', import.meta.url), 'utf8');
const landingSource = readFileSync(new URL('./landing-home.tsx', import.meta.url), 'utf8');
const bootShellSource = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

test('auth choice destinations retain a protected destination for both account paths', () => {
  const search = '?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext';
  assert.equal(buildAuthEntryHref('sign-in', search), '/sign-in?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext');
  assert.equal(buildAuthEntryHref('sign-up', search), '/sign-up?redirect_url=%2Fstudio%2Fplanner%3Fweek%3Dnext');
  assert.equal(buildAuthEntryHref('sign-in'), '/sign-in');
  assert.equal(buildAuthEntryHref('sign-up'), '/sign-up');
});

test('first-time home stays public; returning sessions wait for Clerk before entering the studio', () => {
  assert.equal(getHomeEntryState(false, false), 'landing');
  assert.equal(getHomeEntryState(false, true), 'landing');
  assert.equal(getHomeEntryState(true, true), 'dashboard');
  assert.equal(getHomeEntryState(true, false), 'landing');
  assert.equal(getHomeEntryState(false, false, true), 'loading');
  assert.equal(getHomeEntryState(false, true, true), 'loading');
  assert.equal(getHomeEntryState(true, false, true), 'landing');
  assert.equal(getHomeEntryState(true, true, true), 'dashboard');
});

test('the initial HTML shell shows landing content before React starts', () => {
  assert.match(bootShellSource, /ALL IN,<br \/><em>ALL SEASON\.<\/em>/);
  assert.match(bootShellSource, /One season hub for youth-sports families/);
  assert.doesNotMatch(bootShellSource, /Loading Pixl Sports/);
});

test('returning sessions replace the static landing shell before first paint', () => {
  const sessionCheck = bootShellSource.indexOf(
    "window.localStorage.getItem('pixl:previous-private-session:v1') === 'seen'",
  );
  const staticLanding = bootShellSource.indexOf('<div id="app-boot-fallback"');
  assert.ok(sessionCheck >= 0 && sessionCheck < staticLanding);
  assert.match(bootShellSource, /isPrivateStudioRoute \|\| \(isHomeRoute && hasKnownPrivateSession\)/);
  assert.match(bootShellSource, /data-pixl-private-return="true"[\s\S]*#app-boot-fallback \.boot-main/);
  assert.match(bootShellSource, /id="app-boot-returning"[\s\S]*pixlsports-logo\.png/);
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
  assert.match(entrySource, /getHomeEntryState\(isLoaded, Boolean\(isSignedIn\), hasPriorPrivateSession\)/);
  assert.match(entrySource, /entryState === 'loading'.*<AccountLoadingScreen \/>/);
  assert.match(appSource, /lifecycle\?\.status !== 'active'[\s\S]*?rememberPrivateSession\(\)/);
  assert.match(entrySource, /<Redirect to="\/studio" \/>/);
  assert.match(entrySource, /return <PublicLandingPage \/>/);
  assert.match(entrySource, /const ApplicationRoutes = lazy\(\(\) => import\('\.\/App'\)\)/);
  assert.match(entrySource, /<Route path="\/" component=\{HomeEntry\} \/>/);
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
