import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entrySource = readFileSync(new URL('../app-entry.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('the private-entry splash stays mounted above routes while they initialize', () => {
  const splashGate = entrySource.match(/function PrivateEntrySplashGate[\s\S]*?\n\}/)?.[0];
  assert.ok(splashGate);
  assert.match(splashGate, /aria-hidden=\{shouldKeepSplash \|\| undefined\}/);
  assert.match(splashGate, /inert=\{shouldKeepSplash \|\| undefined\}/);
  assert.match(splashGate, /visibility: shouldKeepSplash \? 'hidden' : undefined/);
  assert.match(splashGate, /\{children\}/);
  assert.match(splashGate, /data-testid="private-entry-splash-overlay"/);
  assert.doesNotMatch(splashGate, /if \(shouldKeepSplash\) return/);
});

test('app and account loading use compact progress states beneath the splash', () => {
  assert.match(entrySource, /<Suspense fallback=\{<EntryModuleLoadingState \/>\}>/);
  assert.doesNotMatch(entrySource, /<Suspense fallback=\{<AccountLoadingScreen \/>\}>/);
  assert.match(appSource, /waitingForFreshLifecycle[\s\S]*?return <RouteLoadingState \/>;/);
  assert.match(appSource, /location\.startsWith\('\/studio'\) && !isLoaded\) return <RouteLoadingState \/>/);
});
