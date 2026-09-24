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

test('upcoming practices remain preparation recommendations while meetings leave the active journey', () => {
  const now = new Date('2026-09-22T12:00:00');
  const practice = { id: 'practice', type: 'practice' as const, date: '2026-09-23', time: '17:00' };
  const meeting = { id: 'meeting', type: 'meeting' as const, date: '2026-09-23', time: '18:00' };

  assert.equal(getSupporterWeekRecommendation([practice], now)?.kind, 'practice');
  assert.equal(getSupporterWeekRecommendation([meeting], now), null);
});

test('active meetings do not replace game and practice recommendations', () => {
  const now = new Date('2026-09-23T18:00:00');
  const meeting = {
    id: 'meeting',
    type: 'meeting' as const,
    date: '2026-09-23',
    time: '17:00',
    location: 'Northside Clubhouse',
  };

  const practice = { id: 'practice', type: 'practice' as const, date: '2026-09-24', time: '18:00' };

  assert.deepEqual(getSupporterWeekRecommendation([meeting, practice], now), {
    event: practice,
    kind: 'practice',
    stage: 'upcoming',
  });
});

test('an ended local meeting yields to the next scheduled event', () => {
  const now = new Date('2026-09-23T12:00:00');
  const meeting = {
    id: 'meeting',
    type: 'meeting' as const,
    date: '2026-09-25',
    time: '17:00',
  };
  const practice = { id: 'practice', type: 'practice' as const, date: '2026-09-24', time: '18:00' };

  assert.deepEqual(getSupporterWeekRecommendation([practice, meeting], now, ['meeting']), {
    event: practice,
    kind: 'practice',
    stage: 'upcoming',
  });
});

test('an ended local meeting returns the weekly path to Plan when no event is upcoming', () => {
  const now = new Date('2026-09-23T12:00:00');
  const meeting = {
    id: 'meeting',
    type: 'meeting' as const,
    date: '2026-09-22',
    time: '17:00',
  };

  assert.equal(getSupporterWeekRecommendation([meeting], now, ['meeting']), null);
});

test('meeting-only schedules return the weekly path to Calendar', () => {
  const now = new Date('2026-09-23T12:00:00');
  const endedMeeting = {
    id: 'ended-meeting',
    type: 'meeting' as const,
    date: '2026-09-24',
    time: '17:00',
  };
  const nextMeeting = {
    id: 'next-meeting',
    type: 'meeting' as const,
    date: '2026-09-25',
    time: '17:00',
  };

  assert.equal(getSupporterWeekRecommendation([endedMeeting, nextMeeting], now, ['ended-meeting']), null);
});

test('an active game remains higher priority than the next event after a meeting ends', () => {
  const now = new Date('2026-09-23T18:00:00');
  const activeGame = {
    id: 'game',
    type: 'game' as const,
    date: '2026-09-23',
    time: '17:00',
    status: 'live' as const,
  };
  const nextPractice = { id: 'practice', type: 'practice' as const, date: '2026-09-24', time: '18:00' };
  const endedMeeting = { id: 'meeting', type: 'meeting' as const, date: '2026-09-22', time: '17:00' };

  assert.deepEqual(getSupporterWeekRecommendation([activeGame, nextPractice, endedMeeting], now, ['meeting']), {
    event: activeGame,
    kind: 'game',
    stage: 'live',
  });
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

test('a recently finished tracked game stays on Send before the next scheduled event', () => {
  const now = new Date('2026-09-22T21:00:00Z');
  const finishedGame = {
    id: 'finished-game',
    type: 'game' as const,
    date: '2026-09-22',
    time: '18:00',
    status: 'final' as const,
    completedAt: '2026-09-22T20:45:00Z',
  };
  const practice = { id: 'practice', type: 'practice' as const, date: '2026-09-23', time: '17:00' };

  const recommendation = getSupporterWeekRecommendation([finishedGame, practice], now);

  assert.equal(recommendation?.event.id, 'finished-game');
  assert.equal(recommendation?.stage, 'completed');
});

test('an older finished game yields to the next scheduled event', () => {
  const now = new Date('2026-09-24T12:00:00Z');
  const finishedGame = {
    id: 'finished-game',
    type: 'game' as const,
    date: '2026-09-22',
    time: '18:00',
    status: 'final' as const,
    completedAt: '2026-09-22T20:45:00Z',
  };
  const practice = { id: 'practice', type: 'practice' as const, date: '2026-09-25', time: '17:00' };

  const recommendation = getSupporterWeekRecommendation([finishedGame, practice], now);

  assert.equal(recommendation?.event.id, 'practice');
  assert.equal(recommendation?.stage, 'upcoming');
});

test('past games cannot remain upcoming or live just because their saved status was not updated', () => {
  const now = new Date('2026-09-22T12:00:00');
  assert.equal(getSupporterGameStage({ date: '2026-09-21', time: '18:30', status: 'upcoming' }, now), 'completed');
  assert.equal(getSupporterGameStage({ date: '2026-09-21', time: '18:30', status: 'live' }, now), 'completed');
  assert.equal(getSupporterGameStage({ date: '2026-09-24', time: '18:30', status: 'upcoming' }, now), 'upcoming');
  assert.equal(getSupporterGameStage({ date: '2026-09-21', time: '18:30', status: 'final' }, now), 'completed');
});

test('the week path moves a game to Capture one hour before start', () => {
  const event = { type: 'game' as const, date: '2026-09-22', time: '18:00', status: 'upcoming' as const };
  assert.equal(getSupporterGameStage(event, new Date('2026-09-22T16:59:59')), 'upcoming');
  assert.equal(getSupporterGameStage(event, new Date('2026-09-22T17:00:00')), 'live');
  assert.equal(getSupporterGameStage(event, new Date('2026-09-22T19:00:00')), 'live');
});

test('the week path handles imported AM/PM event times', () => {
  const event = { type: 'practice' as const, date: '2026-09-22', time: '10:00 AM' };
  assert.equal(getSupporterGameStage(event, new Date('2026-09-22T09:59:59')), 'upcoming');
  assert.equal(getSupporterGameStage(event, new Date('2026-09-22T10:00:00')), 'live');
});

test('non-game events stay in preparation until their scheduled start', () => {
  const practice = { type: 'practice' as const, date: '2026-09-22', time: '18:00' };
  assert.equal(getSupporterGameStage(practice, new Date('2026-09-22T17:30:00')), 'upcoming');
  assert.equal(getSupporterGameStage(practice, new Date('2026-09-22T18:00:00')), 'live');
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

test('active preparation copy names games and practices and has a no-event fallback', () => {
  assert.equal(getSupporterPreparationCopy('game').title, 'Get ready for game day.');
  assert.equal(getSupporterPreparationCopy('practice').title, 'Get ready for practice.');
  assert.equal(getSupporterPreparationCopy(null).title, 'Get ready for your next event.');
  assert.match(getSupporterPreparationCopy(null).description, /Add an event/);
});