import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSupporterGameStage,
  getNextUpcomingSupporterEvent,
  getSupporterPreparationContext,
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

test('the next practice is recommended before a later upcoming game', () => {
  const now = new Date('2026-09-22T12:00:00');
  const practice = { id: 'practice', type: 'practice' as const, date: '2026-09-24', time: '18:30' };
  const game = { id: 'game', type: 'game' as const, date: '2026-09-27', time: '14:00', status: 'upcoming' as const };

  const recommendation = getSupporterWeekRecommendation([game, practice], now);

  assert.equal(recommendation?.event.id, 'practice');
  assert.equal(recommendation?.kind, 'practice');
  assert.equal(recommendation?.stage, 'upcoming');
});

test('past games cannot remain upcoming or live just because their saved status was not updated', () => {
  const now = new Date('2026-09-22T12:00:00');
  assert.equal(getSupporterGameStage({ date: '2026-09-21', time: '18:30', status: 'upcoming' }, now), 'completed');
  assert.equal(getSupporterGameStage({ date: '2026-09-21', time: '18:30', status: 'live' }, now), 'completed');
  assert.equal(getSupporterGameStage({ date: '2026-09-24', time: '18:30', status: 'upcoming' }, now), 'upcoming');
  assert.equal(getSupporterGameStage({ date: '2026-09-21', time: '18:30', status: 'final' }, now), 'completed');
});

test('a saved September 21 game selection cannot hide the next September 24 practice', () => {
  const now = new Date('2026-09-22T12:00:00');
  const oldGame = { id: 'game-21', type: 'game' as const, date: '2026-09-21', time: '18:30', status: 'upcoming' as const };
  const practice = { id: 'practice-24', type: 'practice' as const, date: '2026-09-24', time: '18:30' };
  const events = [oldGame, practice];
  const recommendation = getSupporterWeekRecommendation(events, now);

  assert.equal(recommendation?.event.id, 'practice-24');
  assert.equal(getSupporterPreparationContext(recommendation, [oldGame], 'game-21', false, now)?.id, 'practice-24');
  assert.equal(getSupporterPreparationContext(recommendation, [oldGame], 'game-21', true, now), undefined);
});

test('Coming up shows the closest future event even when it is also the prep recommendation', () => {
  const now = new Date('2026-09-22T21:19:00');
  const oldGame = { id: 'game-21', type: 'game' as const, date: '2026-09-21', time: '18:30', status: 'upcoming' as const };
  const game = { id: 'game-23', type: 'game' as const, date: '2026-09-23', time: '17:00', status: 'upcoming' as const };
  const practice = { id: 'practice-24', type: 'practice' as const, date: '2026-09-24', time: '18:30' };
  const events = [practice, oldGame, game];

  assert.equal(getSupporterWeekRecommendation(events, now)?.event.id, 'game-23');
  assert.equal(getNextUpcomingSupporterEvent(events, now)?.id, 'game-23');
  assert.equal(getNextUpcomingSupporterEvent([oldGame, practice], now)?.id, 'practice-24');
  assert.equal(getNextUpcomingSupporterEvent([oldGame], now), undefined);
});

test('preparation copy names each event type and has a no-event fallback', () => {
  assert.equal(getSupporterPreparationCopy('game').title, 'Get ready for game day.');
  assert.equal(getSupporterPreparationCopy('practice').title, 'Get ready for practice.');
  assert.equal(getSupporterPreparationCopy('meeting').title, 'Get ready for your meeting.');
  assert.equal(getSupporterPreparationCopy(null).title, 'Get ready for your next event.');
  assert.match(getSupporterPreparationCopy(null).description, /Add an event/);
});