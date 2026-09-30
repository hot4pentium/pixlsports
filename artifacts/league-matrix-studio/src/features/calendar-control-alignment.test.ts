import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const supporterDashboard = readFileSync(new URL('./supporter-dashboard.tsx', import.meta.url), 'utf8');
const gameOnCollection = readFileSync(new URL('./game-on-dashboard-collection.tsx', import.meta.url), 'utf8');
const gameOnNavigation = readFileSync(new URL('./game-on-navigation.ts', import.meta.url), 'utf8');
const checklistSource = readFileSync(new URL('./supporter-dashboard-checklist.tsx', import.meta.url), 'utf8');
const checklistStateSource = readFileSync(new URL('./supporter-dashboard-checklist-state.ts', import.meta.url), 'utf8');
const inlinePrepSource = readFileSync(new URL('./game-on-inline-prep-checklist.tsx', import.meta.url), 'utf8');
const checklistStyles = readFileSync(new URL('./supporter-dashboard-checklist.css', import.meta.url), 'utf8');

test('standalone Calendar routes show a clear retired notice and cannot reach the old schedule canvas', () => {
  assert.match(appSource, /<Route path="\/schedule\/:shareToken" component=\{RetiredSchedulePage\}/);
  assert.match(appSource, /<Route path="\/studio\/schedule\/:id\?" component=\{RetiredSchedulePage\}/);
  assert.match(appSource, /function RetiredSchedulePage\(\)[\s\S]*?Schedule Maker retired[\s\S]*?Standalone Calendar schedules and shared schedule links are no longer available/);
  assert.match(appSource, /data-testid="link-retired-schedule-dashboard"/);
  assert.doesNotMatch(appSource, /function SchedulePreview|PIXL SPORTS \/ YOUR WEEK|<SchedulePreview/);
  assert.match(appSource, /function PublicSchedulePage\(\)[\s\S]*?return <RetiredSchedulePage \/>/);
});

test('new supporters get a non-blocking checklist with manual steps and existing dashboard actions', () => {
  assert.equal((checklistStateSource.match(/\{ id: '/g) ?? []).length, 5);
  assert.match(checklistSource, /Get to know your Dashboard/);
  assert.match(checklistSource, /Explore the tools when you’re ready/);
  assert.match(checklistSource, /type="checkbox"/);
  assert.match(checklistSource, /Dismiss the dashboard checklist/);
  assert.match(checklistSource, /<Link[\s\S]*?href={profileHref}/);
  assert.match(checklistSource, /<HypeCardReplyInboxTrigger/);
  assert.match(checklistSource, /href={hypeCardHref}/);
  assert.match(checklistSource, /onClick={onCreateEventCard}/);
  assert.match(checklistSource, /onInstall\(\)/);
  assert.match(checklistSource, /role="progressbar"/);
  assert.match(checklistSource, /role="alert"/);
  assert.match(checklistStyles, /linear-gradient\(135deg, #102846 0%, #0b1c32 100%\)/);
  assert.match(checklistStyles, /@media \(max-width: 480px\)/);
  assert.match(checklistStateSource, /dashboardChecklist/);
  assert.match(checklistStateSource, /dashboardTour/);
  assert.match(appSource, /showDashboardChecklist={dashboardChecklistPending/);
  assert.match(appSource, /dashboardChecklistStateAfterSetup/);
  assert.doesNotMatch(appSource, /autoStartTour|onTourDismiss|SupporterDashboardTour/);
  assert.doesNotMatch(supporterDashboard, /SupporterDashboardTour|autoStartTour|onTourDismiss/);
  assert.doesNotMatch(gameOnCollection, /tourPanelRequest|handledTourRequestRef/);
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

test('saved Calendar events support the private dashboard without restoring retired schedule links', () => {
  assert.doesNotMatch(supporterDashboard, /\/studio\/schedule|View Calendar|Schedule Maker/);
  const supporterStudio = appSource.slice(appSource.indexOf('function SupporterStudio'), appSource.indexOf('function SupporterProfilePage'));
  assert.match(supporterStudio, /normalizeScheduleDraft\(project\.project\)/);
  assert.match(supporterStudio, /calendarProjectId: project\.id/);
  assert.doesNotMatch(supporterStudio, /getActiveCloudScheduleProject|getSupporterScheduleSelection|readScheduleDraft/);
  const checklistPage = appSource.slice(appSource.indexOf('export function ChecklistPage'), appSource.indexOf('function StudioPortal'));
  assert.doesNotMatch(checklistPage, /\/studio\/schedule|select-checklist-game|calendarEvents/);
  assert.match(checklistPage, /Event Card details/);
});
