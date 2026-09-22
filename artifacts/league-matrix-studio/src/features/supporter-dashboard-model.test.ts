import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSupporterScheduleSelection,
  getSupporterPreparationCopy,
  getSupporterWeekRecommendation,
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

test('upcoming practice and meeting events become preparation recommendations', () => {
  const now = new Date('2026-09-22T12:00:00');
  const practice = { id: 'practice', type: 'practice' as const, date: '2026-09-23', time: '17:00' };
  const meeting = { id: 'meeting', type: 'meeting' as const, date: '2026-09-23', time: '18:00' };

  assert.equal(getSupporterWeekRecommendation([practice], now)?.kind, 'practice');
  assert.equal(getSupporterWeekRecommendation([meeting], now)?.kind, 'meeting');
});

test('preparation copy names each event type and has a no-event fallback', () => {
  assert.equal(getSupporterPreparationCopy('game').title, 'Get ready for game day.');
  assert.equal(getSupporterPreparationCopy('practice').title, 'Get ready for practice.');
  assert.equal(getSupporterPreparationCopy('meeting').title, 'Get ready for your meeting.');
  assert.equal(getSupporterPreparationCopy(null).title, 'Get ready for your next event.');
  assert.match(getSupporterPreparationCopy(null).description, /Add an event/);
});