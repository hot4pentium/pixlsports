import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSupporterScheduleSelection,
  getStudioDestination,
  getUserRole,
  mapRecentSupporterProjects,
} from './supporter-dashboard-model';

test('legacy metadata always reaches the supporter studio', () => {
  assert.equal(getStudioDestination(getUserRole({ unsafeMetadata: { role: 'fan' } })), 'supporter');
  assert.equal(getStudioDestination(getUserRole({ unsafeMetadata: { role: 'legacy' } })), 'supporter');
});

test('custom saved schedules are selected when available', () => {
  const schedule = { events: [{ id: 'saved-event' }] };
  assert.deepEqual(getSupporterScheduleSelection({ customSchedule: schedule }), {
    events: schedule.events,
    source: 'custom',
  });
  assert.deepEqual(getSupporterScheduleSelection({ customSchedule: { events: [] } }), {
    events: [],
    source: null,
  });
});

test('recent projects ignore unrelated cloud tools', () => {
  const projects = [
    { id: 'other', name: 'Other', updatedAt: '2026-06-01', project: { tool: 'other' } },
    { id: 'card', name: 'Card', updatedAt: '2026-06-02', project: { tool: 'hype-card' } },
  ];
  assert.deepEqual(mapRecentSupporterProjects(projects).map(({ id }) => id), ['card']);
});