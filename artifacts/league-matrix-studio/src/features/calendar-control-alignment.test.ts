import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const supporterDashboard = readFileSync(new URL('./supporter-dashboard.tsx', import.meta.url), 'utf8');
const gameOnCollection = readFileSync(new URL('./game-on-dashboard-collection.tsx', import.meta.url), 'utf8');
const gameOnNavigation = readFileSync(new URL('./game-on-navigation.ts', import.meta.url), 'utf8');
const tourSource = readFileSync(new URL('./supporter-dashboard-tour.tsx', import.meta.url), 'utf8');
const inlinePrepSource = readFileSync(new URL('./game-on-inline-prep-checklist.tsx', import.meta.url), 'utf8');
const tourStyles = readFileSync(new URL('./supporter-dashboard-tour.css', import.meta.url), 'utf8');

test('standalone Calendar routes show a clear retired notice and cannot reach the old schedule canvas', () => {
  assert.match(appSource, /<Route path="\/schedule\/:shareToken" component=\{RetiredSchedulePage\}/);
  assert.match(appSource, /<Route path="\/studio\/schedule\/:id\?" component=\{RetiredSchedulePage\}/);
  assert.match(appSource, /function RetiredSchedulePage\(\)[\s\S]*?Schedule Maker retired[\s\S]*?Standalone Calendar schedules and shared schedule links are no longer available/);
  assert.match(appSource, /data-testid="link-retired-schedule-dashboard"/);
  assert.doesNotMatch(appSource, /function SchedulePreview|PIXL SPORTS \/ YOUR WEEK|<SchedulePreview/);
  assert.match(appSource, /function PublicSchedulePage\(\)[\s\S]*?return <RetiredSchedulePage \/>/);
});

test('the supporter tour is an informational modal with optional phone install guidance', () => {
  assert.equal((tourSource.match(/title: "/g) ?? []).length, 6);
  assert.match(tourSource, /title: "Welcome to Pixl Sports"[\s\S]*?Here's the gameplan/);
  assert.match(tourSource, /title: "Event Cards"/);
  assert.ok(
    tourSource.indexOf('title: "Welcome to Pixl Sports"') < tourSource.indexOf('title: "Event Cards"'),
    'the welcome slide comes before Event Cards',
  );
  assert.doesNotMatch(tourSource, /Game On cards?/);
  assert.doesNotMatch(tourSource, /title: "Calendar"|Open Calendar|supporterToolRoutes\.schedule/);
  assert.match(tourSource, /title: "Prep"/);
  assert.doesNotMatch(tourSource, /title: "Checklist"|supporterToolRoutes\.checklist|supporterToolRoutes\.statTracker/);
  assert.match(tourSource, /title: "Stat Tracker"/);
  assert.match(tourSource, /homeScreenGuide: true/);
  assert.match(tourSource, /iPhone or iPad/);
  assert.match(tourSource, /Android/);
  assert.match(tourSource, /On desktop/);
  assert.match(tourSource, /Share \(or More → Share in some layouts\)/);
  assert.match(tourSource, /Edit Actions → Add to Home Screen/);
  assert.match(tourSource, /Share → View More → Add to Home Screen/);
  assert.match(tourSource, /Open as Web App if it appears/);
  assert.match(tourSource, /Install and create shortcut/);
  assert.match(tourSource, /Some versions say Add to Home screen/);
  assert.match(tourSource, /bookmark this page/);
  assert.match(tourSource, /Both phone guides stay visible here/);
  assert.match(tourStyles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(tourStyles, /@media \(max-width: 480px\)[\s\S]*?grid-template-columns: 1fr/);
  assert.match(tourSource, /aria-modal="true"/);
  assert.doesNotMatch(tourSource, /supporter-dashboard-tour-link|onOpenCardPanel|<a\b/);
  assert.doesNotMatch(supporterDashboard, /tourPanelRequest|openTourCardPanel/);
  assert.doesNotMatch(gameOnCollection, /tourPanelRequest|handledTourRequestRef/);
  assert.match(tourSource, /readDashboardTourProgress\(sessionStorageOrNull\(\), userId, steps\.length\)/);
});

test('the Game On card keeps list editing and link sharing in Prep without a second editor button', () => {
  assert.match(inlinePrepSource, /Add prep item/);
  assert.match(inlinePrepSource, /Prep notes/);
  assert.match(inlinePrepSource, /Create edit link/);
  assert.doesNotMatch(inlinePrepSource, /Edit full Prep checklist|link-open-full-prep|buildWorkspaceToolHref/);
});

test('Game On cards remain the active event-card workspace', () => {
  assert.doesNotMatch(supporterDashboard, /href="\/studio\/schedule"/);
  assert.match(supporterDashboard, /<GameOnDashboardCollection/);
  assert.match(gameOnCollection, /id=\{isActiveShell \? GAME_ON_COLLECTION_ID : undefined\}/);
  assert.match(gameOnCollection, /data-testid="button-create-game-on-card"/);
  assert.match(gameOnNavigation, /navigate\('\/studio'\)/);
  assert.match(gameOnNavigation, /scrollIntoView/);
});

test('standalone schedule events are not exposed through supporter dashboard or checklist links', () => {
  assert.doesNotMatch(supporterDashboard, /\/studio\/schedule|View Calendar|Schedule Maker/);
  const supporterStudio = appSource.slice(appSource.indexOf('function SupporterStudio'), appSource.indexOf('function SupporterProfilePage'));
  assert.match(supporterStudio, /const events: SupporterEvent\[\] = \[\]/);
  assert.doesNotMatch(supporterStudio, /getCloudScheduleProjects|getActiveCloudScheduleProject|getSupporterScheduleSelection|readScheduleDraft/);
  const checklistPage = appSource.slice(appSource.indexOf('export function ChecklistPage'), appSource.indexOf('function StudioPortal'));
  assert.doesNotMatch(checklistPage, /\/studio\/schedule|select-checklist-game|calendarEvents/);
  assert.match(checklistPage, /Event Card details/);
});
