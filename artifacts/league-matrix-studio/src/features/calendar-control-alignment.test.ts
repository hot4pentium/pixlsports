import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const supporterDashboard = readFileSync(new URL('./supporter-dashboard.tsx', import.meta.url), 'utf8');
const gameOnCollection = readFileSync(new URL('./game-on-dashboard-collection.tsx', import.meta.url), 'utf8');
const gameOnNavigation = readFileSync(new URL('./game-on-navigation.ts', import.meta.url), 'utf8');
const tourSource = readFileSync(new URL('./supporter-dashboard-tour.tsx', import.meta.url), 'utf8');

test('standalone Calendar routes show a clear retired notice and cannot reach the old schedule canvas', () => {
  assert.match(appSource, /<Route path="\/schedule\/:shareToken" component=\{RetiredSchedulePage\}/);
  assert.match(appSource, /<Route path="\/studio\/schedule\/:id\?" component=\{RetiredSchedulePage\}/);
  assert.match(appSource, /function RetiredSchedulePage\(\)[\s\S]*?Schedule Maker retired[\s\S]*?Standalone Calendar schedules and shared schedule links are no longer available/);
  assert.match(appSource, /data-testid="link-retired-schedule-dashboard"/);
  assert.doesNotMatch(appSource, /function SchedulePreview|PIXL SPORTS \/ YOUR WEEK|<SchedulePreview/);
  assert.match(appSource, /function PublicSchedulePage\(\)[\s\S]*?return <RetiredSchedulePage \/>/);
});

test('the supporter tour has four steps and omits Calendar', () => {
  assert.equal((tourSource.match(/title: "/g) ?? []).length, 4);
  assert.doesNotMatch(tourSource, /title: "Calendar"|Open Calendar|supporterToolRoutes\.schedule/);
  assert.match(tourSource, /title: "Prep"/);
  assert.doesNotMatch(tourSource, /title: "Checklist"|supporterToolRoutes\.checklist|supporterToolRoutes\.statTracker/);
  assert.match(tourSource, /Show compact tracker/);
  assert.match(tourSource, /onOpenCardPanel\?\.\(step\.panel!/);
  assert.match(supporterDashboard, /tourPanelRequest=\{tourPanelRequest\}/);
  assert.match(gameOnCollection, /setOpenPanel\(\{ cardId: tourPanelRequest\.cardId, panel: tourPanelRequest\.panel \}\)/);
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
  assert.match(checklistPage, /Game On card details/);
});
