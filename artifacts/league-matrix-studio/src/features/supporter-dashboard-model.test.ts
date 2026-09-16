import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSupporterProfileSavePlan,
  getCalendarViewState,
  getStudioDestination,
  getUserRole,
  mapRecentSupporterProjects,
  supporterProfileFromUser,
} from './supporter-dashboard-model';

test('routes fan and coach accounts to their correct /studio experiences', () => {
  assert.equal(getStudioDestination(getUserRole({ unsafeMetadata: { role: 'fan' } })), 'supporter');
  assert.equal(getStudioDestination(getUserRole({ unsafeMetadata: { role: 'coach' } })), 'coach');
  assert.equal(getStudioDestination(getUserRole({ unsafeMetadata: { role: 'admin' } })), 'role-selection');
});

test('saved supporter metadata reloads as the same normalized profile', () => {
  const currentMetadata = { role: 'fan', accessMode: 'full', unrelatedPreference: true };
  const editedProfile = {
    displayName: '  Jamie Fan ',
    teamName: ' Wildcats ',
    athleteName: ' Taylor Fan ',
    jerseyNumber: ' #24 ',
    position: ' Guard ',
    relationship: ' Parent ',
    accessMode: 'full' as const,
  };
  const savePlan = createSupporterProfileSavePlan(currentMetadata, editedProfile);

  assert.deepEqual(savePlan, {
    unsafeMetadata: {
      role: 'fan',
      accessMode: 'full',
      unrelatedPreference: true,
      displayName: 'Jamie Fan',
      teamName: 'Wildcats',
      athleteName: 'Taylor Fan',
      jerseyNumber: '24',
      position: 'Guard',
      relationship: 'Parent',
    },
    redirectTo: '/studio',
    studioDestination: 'supporter',
  });
  assert.deepEqual(supporterProfileFromUser({ unsafeMetadata: savePlan.unsafeMetadata }), {
    displayName: 'Jamie Fan',
    teamName: 'Wildcats',
    athleteName: 'Taylor Fan',
    jerseyNumber: '24',
    position: 'Guard',
    relationship: 'Parent',
    accessMode: 'full',
  });
});

test('distinguishes calendar connection, empty, failure, and disconnected states', () => {
  assert.equal(getCalendarViewState({ calendarCode: '', loading: false, failed: false, calendar: undefined }), 'disconnected');
  assert.equal(getCalendarViewState({ calendarCode: 'TEAM', loading: true, failed: false, calendar: undefined }), 'loading');
  assert.equal(getCalendarViewState({ calendarCode: 'TEAM', loading: false, failed: true, calendar: undefined }), 'failed');
  assert.equal(getCalendarViewState({ calendarCode: 'TEAM', loading: false, failed: false, calendar: { events: [] } }), 'empty');
  assert.equal(getCalendarViewState({ calendarCode: 'TEAM', loading: false, failed: false, calendar: { events: [{}] } }), 'connected');
  assert.equal(getCalendarViewState({
    calendarCode: '',
    loading: false,
    failed: false,
    calendar: undefined,
    customSchedule: { events: [{}] },
  }), 'custom');
  assert.equal(getCalendarViewState({
    calendarCode: '',
    loading: false,
    failed: false,
    calendar: undefined,
    customSchedule: { events: [] },
  }), 'disconnected');
  assert.equal(getCalendarViewState({
    calendarCode: 'TEAM',
    loading: false,
    failed: false,
    calendar: { events: [{}] },
    customSchedule: { events: [{ id: 'local-only' }] },
  }), 'connected');
});

test('maps recent designs by kind and newest-first order, limited to four', () => {
  const projects = [
    { id: 'old', name: 'Old card', updatedAt: '2026-01-01T00:00:00Z', project: { tool: 'hype' } },
    { id: 'schedule', name: 'Schedule', updatedAt: '2026-05-01T00:00:00Z', project: { tool: 'schedule' } },
    { id: 'new', name: 'New card', updatedAt: '2026-06-01T00:00:00Z', project: {} },
    { id: 'middle', name: 'Middle card', updatedAt: '2026-04-01T00:00:00Z', project: { tool: 'hype' } },
    { id: 'fourth', name: 'Fourth card', updatedAt: '2026-03-01T00:00:00Z', project: { tool: 'hype' } },
  ];

  const recent = mapRecentSupporterProjects(projects);

  assert.deepEqual(recent.map(({ id }) => id), ['new', 'schedule', 'middle', 'fourth']);
  assert.deepEqual(recent.map(({ kind }) => kind), ['hype-card', 'schedule', 'hype-card', 'hype-card']);
  assert.equal(recent[0]?.href, '/studio/hype-card/new');
  assert.equal(recent[1]?.href, '/studio/schedule/schedule');
});