import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const scheduleEditor = appSource.slice(
  appSource.indexOf('<SchedulePreview'),
  appSource.indexOf('function SchedulePreview'),
);
const schedulePreview = appSource.slice(
  appSource.indexOf('function SchedulePreview'),
  appSource.indexOf('function PublicSchedulePage'),
);
const supporterDashboard = readFileSync(new URL('./supporter-dashboard.tsx', import.meta.url), 'utf8');
const gameOnCollection = readFileSync(new URL('./game-on-dashboard-collection.tsx', import.meta.url), 'utf8');
const gameOnNavigation = readFileSync(new URL('./game-on-navigation.ts', import.meta.url), 'utf8');

test('calendar preview uses the landing-page card and keeps creation controls inside it', () => {
  assert.match(schedulePreview, /bg-\[#102B4D\]/);
  assert.match(schedulePreview, /bg-\[#FF6433\]/);
  assert.match(schedulePreview, /max-w-\[976px\].*bg-\[#102B4D\].*p-2.*sm:p-3/);
  assert.doesNotMatch(schedulePreview, /min-h-\[600px\]|min-h-\[760px\]/);
  assert.match(
    schedulePreview,
    /data-testid="button-add-event"/,
  );
  assert.doesNotMatch(schedulePreview, /schedule-bottom-actions/);
  assert.doesNotMatch(appSource, /schedule-template-picker/);
  assert.match(appSource, /await persistSchedule\(/);
});

test('Add event actions lead to the visible Game On section instead of opening Schedule Maker flow', () => {
  assert.match(scheduleEditor, /onAddEvent=\{\(\) => navigateToGameOnSection\(setLocation\)\}/);
  assert.match(supporterDashboard, /onClick=\{\(\) => navigateToGameOnSection\(setLocation\)\}/);
  assert.match(gameOnCollection, /id=\{isActiveShell \? GAME_ON_COLLECTION_ID : undefined\}/);
  assert.match(gameOnNavigation, /navigate\('\/studio'\)/);
  assert.match(gameOnNavigation, /scrollIntoView/);
});

test('public schedule recipients get the same card without creation controls', () => {
  const publicSchedulePage = appSource.slice(
    appSource.indexOf('function PublicSchedulePage'),
    appSource.indexOf('function ChecklistPage'),
  );
  assert.match(publicSchedulePage, /<SchedulePreview/);
  assert.match(publicSchedulePage, /readOnly/);
  assert.doesNotMatch(publicSchedulePage, /button-add-event/);
});

test('public schedule cards include accessible phone-install guidance', () => {
  const publicScheduleCard = appSource.slice(
    appSource.indexOf('function ScheduleInstallPrompt'),
    appSource.indexOf('function SchedulePreview'),
  );
  assert.match(publicScheduleCard, /schedule-install-prompt/);
  assert.match(publicScheduleCard, /Install Pixl Sports on your phone/);
  assert.match(publicScheduleCard, /beforeinstallprompt/);
  assert.match(publicScheduleCard, /getScheduleInstallInstructions\(isIOS\)/);
  assert.match(publicScheduleCard, /aria-expanded=\{showInstructions\}/);
  assert.match(publicScheduleCard, /role="status"/);
  assert.match(publicScheduleCard, /type="button"/);
  assert.match(publicScheduleCard, /focus-visible:ring/);
  assert.doesNotMatch(publicScheduleCard, /button-publish-schedule/);
  assert.doesNotMatch(publicScheduleCard, /button-revoke-schedule/);
});
