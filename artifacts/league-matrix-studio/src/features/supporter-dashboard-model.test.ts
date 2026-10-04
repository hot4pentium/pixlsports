import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getActiveSupporterGame,
  getVisibleSupporterSelection,
  getSupporterGameStage,
  isSupporterGameInPregameCaptureWindow,
  getNextUpcomingSupporterEvent,
  getSupporterPreparationContext,
  getSupporterScheduleSelection,
  getSupporterPreparationCopy,
  getSupporterWeekRecommendation,
  getSupporterFanCardHref,
  getSupporterFanCardReconnectionCandidates,
  getSupporterFanCardToSyncAfterProfileChange,
  getStudioDestination,
  getUserProfile,
  getUserRole,
  isSupporterSetupComplete,
  supporterProfileFromUser,
  createSupporterProfileSavePlan,
  supporterToolRoutes,
} from './supporter-dashboard-model';
import { getSupporterEventStart } from './supporter-event-time';

test('legacy metadata always reaches the supporter studio', () => {
  assert.equal(getStudioDestination(getUserRole({ unsafeMetadata: { role: 'fan' } })), 'supporter');
  assert.equal(getStudioDestination(getUserRole({ unsafeMetadata: { role: 'legacy' } })), 'supporter');
});

test('supporter setup persists sport and season while retaining legacy completion', () => {
  const user = {
    unsafeMetadata: {
      role: 'fan',
      displayName: 'Jamie Smith',
      teamName: 'Eastside Falcons',
      athleteName: 'Avery Smith',
      sport: 'soccer',
      seasonName: ' 2026–27 ',
    },
  };
  const profile = getUserProfile(user);

  assert.equal(profile.seasonName, '2026–27');
  assert.equal(profile.sport, 'soccer');
  assert.equal(isSupporterSetupComplete(profile), true);
  assert.equal(isSupporterSetupComplete({ ...profile, sport: null }), true,
    'completed legacy profiles without a sport must not be forced back through setup');
  assert.equal(isSupporterSetupComplete({ ...profile, athleteName: '' }), false);
  assert.equal(isSupporterSetupComplete({ ...profile, seasonName: '' }), false);

  const supportProfile = supporterProfileFromUser(user);
  const savePlan = createSupporterProfileSavePlan({ retainedMetadata: true }, {
    ...supportProfile,
    seasonName: ' 2026–27 ',
  });
  assert.equal(savePlan.unsafeMetadata.seasonName, '2026–27');
  assert.equal(savePlan.unsafeMetadata.sport, 'soccer');
  assert.equal(savePlan.unsafeMetadata.retainedMetadata, true);
});

test('the HYPE Card action opens the matching athlete page', () => {
  const invites = [
    { inviteToken: 'north-token', athleteName: 'Casey Rivera', teamName: 'North Stars', paused: false },
    { inviteToken: 'south-token', athleteName: 'Casey Rivera', teamName: 'South Stars', paused: false },
  ];

  assert.equal(
    getSupporterFanCardHref(invites, { athleteName: ' casey rivera ', teamName: 'NORTH STARS' }),
    '/fan/north-token',
  );
});

test('the Hype Card action falls back to setup when the card is missing or paused', () => {
  assert.equal(getSupporterFanCardHref([], { athleteName: 'Casey', teamName: 'North Stars' }), '/studio/athlete-page');
  assert.equal(
    getSupporterFanCardHref(
      [{ inviteToken: 'wrong-athlete', athleteName: 'Jordan', teamName: 'North Stars', paused: false }],
      { athleteName: 'Casey', teamName: 'North Stars' },
    ),
    '/studio/athlete-page',
  );
  assert.equal(
    getSupporterFanCardHref(
      [{ inviteToken: 'wrong-team', athleteName: 'Casey', teamName: 'South Stars', paused: false }],
      { athleteName: 'Casey', teamName: 'North Stars' },
    ),
    '/studio/athlete-page',
  );
  assert.equal(
    getSupporterFanCardHref(
      [
        { inviteToken: 'north-token', athleteName: 'Casey', teamName: 'North Stars', paused: false },
        { inviteToken: 'south-token', athleteName: 'Jordan', teamName: 'South Stars', paused: false },
      ],
      { athleteName: 'Unknown athlete', teamName: 'Unknown team' },
    ),
    '/studio/athlete-page',
  );
  assert.equal(
    getSupporterFanCardHref(
      [{ inviteToken: 'paused-token', athleteName: 'Casey', teamName: 'North Stars', paused: true }],
      { athleteName: 'Casey', teamName: 'North Stars' },
    ),
    '/studio/athlete-page',
  );
});

test('only offers explicit HYPE Card reconnection when no card matches a complete profile', () => {
  const savedCards = [
    { inviteToken: 'old-card', athleteName: 'Casey Rivera', teamName: 'North Stars', paused: false },
    { inviteToken: 'another-card', athleteName: 'Jordan Lee', teamName: 'South Stars', paused: false },
  ];

  assert.deepEqual(
    getSupporterFanCardReconnectionCandidates(savedCards, { athleteName: 'Casey Rivera', teamName: 'North Stars' }),
    [],
    'a matching card suppresses reconnection options',
  );
  assert.deepEqual(
    getSupporterFanCardReconnectionCandidates(savedCards, { athleteName: 'Casey Rivera', teamName: 'New Stars' }),
    savedCards,
    'mismatched cards are offered for an explicit owner choice, not selected automatically',
  );
  assert.deepEqual(
    getSupporterFanCardReconnectionCandidates(savedCards, { athleteName: 'Casey Rivera', teamName: '' }),
    [],
    'reconnection is unavailable until both profile identity fields are present',
  );
});

test('a profile edit syncs only the card that matched the previous identity', () => {
  const savedCards = [
    { inviteToken: 'old-card', athleteName: 'Casey Rivera', teamName: 'North Stars', paused: false },
    { inviteToken: 'new-card', athleteName: 'Casey Rivera', teamName: 'West Stars', paused: false },
  ];

  assert.equal(
    getSupporterFanCardToSyncAfterProfileChange(
      savedCards,
      { athleteName: 'Casey Rivera', teamName: 'North Stars' },
      { athleteName: 'Casey R.', teamName: 'North Stars' },
    )?.inviteToken,
    'old-card',
  );
  assert.equal(
    getSupporterFanCardToSyncAfterProfileChange(
      savedCards,
      { athleteName: 'Casey Rivera', teamName: 'North Stars' },
      { athleteName: 'Casey Rivera', teamName: 'West Stars' },
    ),
    undefined,
    'an already matching card for the new identity takes precedence',
  );
  assert.equal(
    getSupporterFanCardToSyncAfterProfileChange(
      [savedCards[1]],
      { athleteName: 'Unknown athlete', teamName: 'Unknown team' },
      { athleteName: 'Casey R.', teamName: 'West Stars' },
    ),
    undefined,
    'an unrelated sole card is never assumed to belong to the profile',
  );
  assert.equal(
    getSupporterFanCardToSyncAfterProfileChange(
      savedCards,
      { athleteName: 'Casey Rivera', teamName: '' },
      { athleteName: 'Casey R.', teamName: 'North Stars' },
    ),
    undefined,
    'the old card identity must include its team before an automatic profile sync',
  );
  assert.equal(
    getSupporterFanCardToSyncAfterProfileChange(
      savedCards,
      { athleteName: 'Casey Rivera', teamName: 'North Stars' },
      { athleteName: 'Casey Rivera', teamName: 'North Stars' },
    ),
    undefined,
    'unchanged identity does not rewrite the card',
  );
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

test('the HYPE Card manager is the studio card entrypoint', () => {
  assert.equal(supporterToolRoutes.athletePage, '/studio/athlete-page');
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

test('Event Card timing uses the event time zone and keeps pre-game capture distinct from Live', () => {
  const event = {
    type: 'game' as const,
    date: '2026-01-15',
    time: '10:22 PM',
    timezone: 'America/New_York',
    status: 'upcoming' as const,
  };
  const oneHourBefore = new Date('2026-01-16T02:22:00Z');
  const oneMinuteBefore = new Date('2026-01-16T03:21:00Z');
  const kickoff = new Date('2026-01-16T03:22:00Z');

  assert.equal(getSupporterGameStage(event, oneHourBefore), 'live', 'pre-game capture remains available');
  assert.equal(
    getSupporterGameStage(event, oneHourBefore, { includePregameCaptureWindow: false }),
    'upcoming',
  );
  assert.equal(
    getSupporterGameStage(event, oneMinuteBefore, { includePregameCaptureWindow: false }),
    'upcoming',
  );
  assert.equal(getSupporterGameStage(event, kickoff, { includePregameCaptureWindow: false }), 'live');
  assert.equal(
    getSupporterGameStage(
      { ...event, status: 'live' },
      oneHourBefore,
      { includePregameCaptureWindow: false },
    ),
    'live',
    'an explicitly live event remains Live before its scheduled time',
  );
});

test('spring-forward Event Card capture and Live timing share the forward-resolved instant', () => {
  const event = {
    type: 'game' as const,
    date: '2026-03-08',
    time: '2:30 AM',
    timezone: 'America/New_York',
    status: 'upcoming' as const,
  };
  const start = getSupporterEventStart(event.date, { hour: 2, minute: 30 }, event.timezone);
  assert.equal(start?.toISOString(), '2026-03-08T07:30:00.000Z', '02:30 is shifted forward to 03:30 EDT');

  assert.equal(getSupporterGameStage(event, new Date('2026-03-08T06:29:59Z')), 'upcoming');
  assert.equal(getSupporterGameStage(event, new Date('2026-03-08T06:30:00Z')), 'live');
  assert.equal(
    getSupporterGameStage(event, new Date('2026-03-08T06:30:00Z'), { includePregameCaptureWindow: false }),
    'upcoming',
  );
  assert.equal(getSupporterGameStage(event, new Date('2026-03-08T07:29:59Z')), 'live');
  assert.equal(isSupporterGameInPregameCaptureWindow(event, new Date('2026-03-08T07:29:59Z')), true);
  assert.equal(
    getSupporterGameStage(event, new Date('2026-03-08T07:30:00Z'), { includePregameCaptureWindow: false }),
    'live',
  );
  assert.equal(isSupporterGameInPregameCaptureWindow(event, new Date('2026-03-08T07:30:00Z')), false);
});

test('fall-back Event Card capture and Live timing use the earlier repeated instant', () => {
  const event = {
    type: 'game' as const,
    date: '2026-11-01',
    time: '1:30 AM',
    timezone: 'America/New_York',
    status: 'upcoming' as const,
  };
  const start = getSupporterEventStart(event.date, { hour: 1, minute: 30 }, event.timezone);
  assert.equal(start?.toISOString(), '2026-11-01T05:30:00.000Z', 'the first 01:30 occurs in EDT');

  assert.equal(getSupporterGameStage(event, new Date('2026-11-01T04:29:59Z')), 'upcoming');
  assert.equal(getSupporterGameStage(event, new Date('2026-11-01T04:30:00Z')), 'live');
  assert.equal(
    getSupporterGameStage(event, new Date('2026-11-01T04:30:00Z'), { includePregameCaptureWindow: false }),
    'upcoming',
  );
  assert.equal(isSupporterGameInPregameCaptureWindow(event, new Date('2026-11-01T04:30:00Z')), true);
  assert.equal(
    getSupporterGameStage(event, new Date('2026-11-01T05:30:00Z'), { includePregameCaptureWindow: false }),
    'live',
  );
  assert.equal(isSupporterGameInPregameCaptureWindow(event, new Date('2026-11-01T05:30:00Z')), false);
  assert.equal(
    getSupporterGameStage(event, new Date('2026-11-01T06:30:00Z'), { includePregameCaptureWindow: false }),
    'live',
    'the second 01:30 does not change the selected start',
  );
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

test('a remembered September 18 game yields to the latest September 23 game but remains reviewable when chosen now', () => {
  const now = new Date('2026-09-26T12:00:00');
  const oldGame = { id: 'game-18', type: 'game' as const, date: '2026-09-18', time: '10:00', status: 'upcoming' as const };
  const latestGame = { id: 'game-23', type: 'game' as const, date: '2026-09-23', time: '18:00', status: 'final' as const };
  const games = [latestGame, oldGame];

  assert.equal(getVisibleSupporterSelection(games, 'game-18', now), undefined);
  assert.equal(getActiveSupporterGame(games, 'game-18', now)?.id, 'game-23');
  assert.equal(getSupporterWeekRecommendation(games, now)?.event.id, 'game-23');
  assert.equal(getVisibleSupporterSelection(games, 'game-18', now, true)?.id, 'game-18');
  assert.equal(getActiveSupporterGame(games, 'game-18', now, true)?.id, 'game-18');
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