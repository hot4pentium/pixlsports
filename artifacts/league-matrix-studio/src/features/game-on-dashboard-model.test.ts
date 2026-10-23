import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGameOnDashboardEntries, getFeaturedGameOnCardId, getNextGameOnDashboardEntry, getSuggestedGameOnAction, sortGameOnCardsByDate, type GameOnDashboardEvent } from './game-on-dashboard-model';

const now = new Date('2026-09-24T12:00:00');
const event = (id: string, type: GameOnDashboardEvent['type'], date: string): GameOnDashboardEvent => ({
  id, type, date, time: '10:00', location: 'North Field', opponent: 'Ravens', status: 'upcoming',
});

test('Event Cards expire two hours after kickoff in the saved time zone, regardless of stale status', () => {
  for (const type of ['game', 'practice'] as const) {
    for (const status of ['upcoming', 'live'] as const) {
      const scheduled = {
        ...event('morning-event', type, '2026-10-24'),
        time: '09:00',
        timezone: 'America/New_York',
        status,
      };
      const share = { shareToken: 'morning-card', title: 'Morning event', createdAt: '2026-10-23T12:00:00Z', events: [scheduled] };
      const at = (time: string) => buildGameOnDashboardEntries([], [share], 'Alex', new Date(time));
      assert.equal(at('2026-10-24T12:59:59Z')[0].status, status === 'live' ? 'Live' : type === 'game' ? 'Starting Soon' : 'Published');
      assert.equal(at('2026-10-24T13:00:00Z')[0].status, 'Live');
      assert.equal(at('2026-10-24T14:00:00Z')[0].status, type === 'game' ? 'Sharing' : 'Live');
      assert.equal(at('2026-10-24T14:59:59Z')[0].status, type === 'game' ? 'Sharing' : 'Live');
      const passed = at('2026-10-24T15:00:00Z');
      assert.equal(passed[0].status, 'Complete', `${type}/${status} expires at 11 AM Eastern`);
      assert.equal(getFeaturedGameOnCardId(passed, new Date('2026-10-24T15:00:00Z')), undefined);
      assert.equal(getNextGameOnDashboardEntry(passed, new Date('2026-10-24T15:00:00Z')), undefined);
      if (type === 'game') assert.equal(getSuggestedGameOnAction(passed[0]), 'none', 'do not leave a passed game action highlighted');
      const withFuture = buildGameOnDashboardEntries([
        { ...scheduled, id: 'future-event', date: '2026-10-25', status: 'upcoming' },
      ], [share], 'Alex', new Date('2026-10-24T15:00:00Z'));
      assert.equal(getFeaturedGameOnCardId(withFuture, new Date('2026-10-24T15:00:00Z')), 'draft:future-event');
    }
  }
});

test('suggested Event Card actions follow the preparation, capture, share, and completed stages', () => {
  assert.equal(getSuggestedGameOnAction({ type: 'game', status: 'Draft' }), 'prep');
  assert.equal(getSuggestedGameOnAction({ type: 'game', status: 'Starting Soon' }), 'tracker');
  assert.equal(getSuggestedGameOnAction({ type: 'game', status: 'Live' }), 'tracker');
  assert.equal(getSuggestedGameOnAction({ type: 'game', status: 'Sharing', shareToken: 'published' }), 'share');
  assert.equal(getSuggestedGameOnAction({ type: 'game', status: 'Sharing' }), 'none', 'do not suggest an unavailable Share action');
  assert.equal(getSuggestedGameOnAction({ type: 'game', status: 'Complete' }), 'none');
  assert.equal(getSuggestedGameOnAction({ type: 'game', status: 'Complete', recordedGameId: 'saved-game' }), 'none');

  for (const status of ['Draft', 'Published', 'Starting Soon', 'Live', 'Sharing', 'Complete'] as const) {
    assert.equal(
      getSuggestedGameOnAction({ type: 'practice', status }),
      status === 'Complete' ? 'none' : 'prep',
      `${status} practices should not be routed to game-only actions`,
    );
  }
});

test('Event Card recommendations advance on schedule boundaries and then choose the next card', () => {
  const scheduled = {
    ...event('timed-game', 'game', '2026-10-24'),
    time: '09:00',
    timezone: 'America/New_York',
  };
  const share = { shareToken: 'timed-share', title: 'Morning game', createdAt: '2026-10-23T12:00:00Z', events: [scheduled] };
  const entriesAt = (instant: string, events: GameOnDashboardEvent[] = []) =>
    buildGameOnDashboardEntries(events, [share], 'Alex', new Date(instant));
  const cases = [
    ['2026-10-24T11:59:59Z', 'Published', 'prep'],
    ['2026-10-24T12:00:00Z', 'Starting Soon', 'tracker'],
    ['2026-10-24T12:59:59Z', 'Starting Soon', 'tracker'],
    ['2026-10-24T13:00:00Z', 'Live', 'tracker'],
    ['2026-10-24T13:59:59Z', 'Live', 'tracker'],
    ['2026-10-24T14:00:00Z', 'Sharing', 'share'],
    ['2026-10-24T14:59:59Z', 'Sharing', 'share'],
    ['2026-10-24T15:00:00Z', 'Complete', 'none'],
  ] as const;

  for (const [instant, status, action] of cases) {
    const entries = entriesAt(instant);
    assert.equal(entries[0].status, status, `card status at ${instant}`);
    assert.equal(getSuggestedGameOnAction(entries[0]), action, `highlight at ${instant}`);
  }

  const afterTwoHours = new Date('2026-10-24T15:00:00Z');
  const withoutNext = entriesAt(afterTwoHours.toISOString());
  assert.equal(getFeaturedGameOnCardId(withoutNext, afterTwoHours), undefined);
  assert.equal(getNextGameOnDashboardEntry(withoutNext, afterTwoHours), undefined);
  const withNext = entriesAt(afterTwoHours.toISOString(), [
    { ...scheduled, id: 'next-game', date: '2026-10-25', status: 'upcoming' },
  ]);
  assert.equal(getFeaturedGameOnCardId(withNext, afterTwoHours), 'draft:next-game');
  assert.equal(getSuggestedGameOnAction(withNext.find((card) => card.id === 'draft:next-game')!), 'prep');
});

test('cards follow calendar order, including completed dates, and meetings are excluded', () => {
  const cards = buildGameOnDashboardEntries([
    event('past', 'game', '2026-09-02'),
    event('next-week', 'game', '2026-10-01'),
    event('next-day', 'practice', '2026-09-25'),
    event('meeting', 'meeting', '2026-09-26'),
  ], [], 'Alex', now);

  assert.deepEqual(cards.map((card) => card.eventId), ['past', 'next-day', 'next-week']);
  assert.equal(cards[0].status, 'Sharing');
  assert.equal(cards[1].status, 'Draft');
  assert.equal(cards[1].opponent, '');
});

test('date and time order survives new drafts, mixed publication, and undated cards', () => {
  const cards = sortGameOnCardsByDate([
    { id: 'later', date: '2026-10-01', time: '09:00' },
    { id: 'undated', date: '', time: '' },
    { id: 'published', date: '2026-09-25', time: '18:00' },
    { id: 'draft', date: '2026-09-25', time: '08:00' },
    { id: 'unknown-time', date: '2026-09-25', time: '' },
  ]);
  assert.deepEqual(cards.map((card) => card.id), ['draft', 'published', 'unknown-time', 'later', 'undated']);
});

test('the next dated card is featured unless an event is active', () => {
  const cards = buildGameOnDashboardEntries([
    event('yesterday', 'game', '2026-09-23'),
    event('later', 'practice', '2026-09-29'),
    event('next', 'game', '2026-09-25'),
    event('undated', 'game', ''),
  ], [], 'Alex', now);
  assert.equal(getFeaturedGameOnCardId(cards, now), 'draft:next');
  const liveCards = buildGameOnDashboardEntries([
    event('yesterday', 'game', '2026-09-23'),
    event('later', 'practice', '2026-09-29'),
    event('next', 'game', '2026-09-25'),
    { ...event('active', 'game', '2026-09-24'), time: '11:00', status: 'live' },
  ], [], 'Alex', now);
  assert.equal(getFeaturedGameOnCardId(liveCards, now), 'draft:active');
  assert.equal(getFeaturedGameOnCardId(cards.filter((card) => card.status === 'Complete'), now), undefined);
});

test('a standalone Game On card appears in the next-game summary before its 10 AM start', () => {
  const morning = new Date('2026-09-26T07:30:00');
  const standaloneGame = { ...event('today-10', 'game', '2026-09-26'), time: '10:00' };
  const laterScheduledGame = event('tomorrow', 'game', '2026-09-27');
  const cards = buildGameOnDashboardEntries([laterScheduledGame], [{
    shareToken: 'today-card', title: 'Game On', createdAt: morning.toISOString(), events: [standaloneGame],
  }], 'Alex', morning);

  assert.equal(getNextGameOnDashboardEntry(cards, morning)?.id, 'share:today-card');
  assert.equal(getNextGameOnDashboardEntry(cards, morning)?.date, '2026-09-26');
  assert.equal(getNextGameOnDashboardEntry(cards, morning)?.time, '10:00');
  assert.equal(getNextGameOnDashboardEntry(cards, new Date('2026-09-26T09:30:00'))?.id, 'share:today-card', 'an active game stays ahead of tomorrow');
  assert.equal(getNextGameOnDashboardEntry(cards, new Date('2026-09-26T14:00:00'))?.eventId, 'tomorrow');
});

test('a game card stays pre-game through the hour before kickoff in its saved time zone', () => {
  const easternGame = {
    ...event('eastern-game', 'game', '2026-01-15'),
    time: '10:22 PM',
    timezone: 'America/New_York',
  };
  const publishedShare = {
    shareToken: 'eastern-game-share',
    title: 'Game On',
    createdAt: now.toISOString(),
    events: [easternGame],
  };
  const oneMinuteBeforeCapture = new Date('2026-01-16T02:21:00Z');
  const oneHourBefore = new Date('2026-01-16T02:22:00Z');
  const oneMinuteBeforeKickoff = new Date('2026-01-16T03:21:00Z');
  const kickoff = new Date('2026-01-16T03:22:00Z');
  const beforeCaptureCards = buildGameOnDashboardEntries([easternGame], [publishedShare], 'Alex', oneMinuteBeforeCapture);
  const preGameCards = buildGameOnDashboardEntries([easternGame], [publishedShare], 'Alex', oneHourBefore);
  const oneMinuteBeforeCards = buildGameOnDashboardEntries([easternGame], [publishedShare], 'Alex', oneMinuteBeforeKickoff);
  const liveCards = buildGameOnDashboardEntries([easternGame], [publishedShare], 'Alex', kickoff);

  assert.equal(beforeCaptureCards[0].status, 'Published');
  assert.equal(preGameCards[0].status, 'Starting Soon');
  assert.equal(oneMinuteBeforeCards[0].status, 'Starting Soon');
  assert.equal(getFeaturedGameOnCardId(preGameCards, oneHourBefore), 'share:eastern-game-share');
  assert.equal(getNextGameOnDashboardEntry(preGameCards, oneHourBefore)?.id, 'share:eastern-game-share');
  assert.equal(liveCards[0].status, 'Live');

  const explicitlyLiveCards = buildGameOnDashboardEntries([
    { ...easternGame, status: 'live' },
  ], [], 'Alex', oneHourBefore);
  assert.equal(explicitlyLiveCards[0].status, 'Live');
});

test('Event Card badges use the forward-resolved spring clock-change start', () => {
  const springGame = {
    ...event('spring-forward', 'game', '2026-03-08'),
    time: '2:30 AM',
    timezone: 'America/New_York',
  };
  const share = {
    shareToken: 'spring-forward-share',
    title: 'Game On',
    createdAt: now.toISOString(),
    events: [springGame],
  };
  const statusAt = (instant: string) => buildGameOnDashboardEntries(
    [springGame],
    [share],
    'Alex',
    new Date(instant),
  )[0].status;

  assert.equal(statusAt('2026-03-08T06:29:59Z'), 'Published');
  assert.equal(statusAt('2026-03-08T06:30:00Z'), 'Starting Soon');
  assert.equal(statusAt('2026-03-08T07:29:59Z'), 'Starting Soon');
  assert.equal(statusAt('2026-03-08T07:30:00Z'), 'Live');
});

test('Event Card badges use the earlier occurrence of a repeated fall clock-change start', () => {
  const fallGame = {
    ...event('fall-back', 'game', '2026-11-01'),
    time: '1:30 AM',
    timezone: 'America/New_York',
  };
  const share = {
    shareToken: 'fall-back-share',
    title: 'Game On',
    createdAt: now.toISOString(),
    events: [fallGame],
  };
  const statusAt = (instant: string) => buildGameOnDashboardEntries(
    [fallGame],
    [share],
    'Alex',
    new Date(instant),
  )[0].status;

  assert.equal(statusAt('2026-11-01T04:29:59Z'), 'Published');
  assert.equal(statusAt('2026-11-01T04:30:00Z'), 'Starting Soon');
  assert.equal(statusAt('2026-11-01T05:29:59Z'), 'Starting Soon');
  assert.equal(statusAt('2026-11-01T05:30:00Z'), 'Live');
  assert.equal(statusAt('2026-11-01T06:30:00Z'), 'Sharing', 'the repeated 1:30 AM does not restart the event phase clock');
});

test('a finalized card is not announced as an upcoming game', () => {
  const morning = new Date('2026-09-26T07:30:00');
  const todayGame = { ...event('done', 'game', '2026-09-26'), time: '10:00', status: 'final' as const };
  const cards = buildGameOnDashboardEntries([todayGame], [], 'Alex', morning);
  assert.equal(getNextGameOnDashboardEntry(cards, morning), undefined);
});

test('published events reuse their schedule identity and do not appear again as drafts', () => {
  const scheduled = event('linked', 'game', '2026-09-27');
  const cards = buildGameOnDashboardEntries([scheduled], [{
    shareToken: 'share-linked', title: 'Game On', createdAt: now.toISOString(), events: [scheduled],
  }], 'Alex', now);

  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0], {
    id: 'share:share-linked', eventId: 'linked', shareToken: 'share-linked',
    type: 'game', athleteName: 'Alex', opponent: 'Ravens', date: '2026-09-27',
    time: '10:00', location: 'North Field', status: 'Published', isPublished: true,
  });
});

test('a linked card reflects the current Calendar event without changing its public identity', () => {
  const scheduled = event('linked', 'game', '2026-10-07');
  const oldShared = { ...scheduled, date: '2026-09-27', opponent: 'Old opponent' };
  const cards = buildGameOnDashboardEntries([scheduled], [{
    shareToken: 'card-link', title: 'Game On', createdAt: now.toISOString(), events: [oldShared],
  }], 'Alex', now);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'share:card-link');
  assert.equal(cards[0].date, '2026-10-07');
  assert.equal(cards[0].opponent, 'Ravens');
});

test('independent game and practice shares appear without a calendar', () => {
  const game = event('standalone-game', 'game', '2026-09-28');
  const practice = event('standalone-practice', 'practice', '2026-09-29');
  const cards = buildGameOnDashboardEntries([], [
    { shareToken: 'game-share', title: 'Game', createdAt: now.toISOString(), events: [game] },
    { shareToken: 'practice-share', title: 'Practice', createdAt: now.toISOString(), events: [practice] },
  ], 'Alex', now);

  assert.deepEqual(cards.map((card) => card.status), ['Published', 'Published']);
  assert.equal(cards[1].type, 'practice');
  assert.equal(cards[1].opponent, '');
});

test('a standalone badge reflects its locally ended tracker after reopening', () => {
  const game = { ...event('standalone-game', 'game', '2026-09-24'), time: '11:00' };
  const share = { shareToken: 'game-share', title: 'Game', createdAt: now.toISOString(), events: [game] };
  const cards = buildGameOnDashboardEntries([], [share], 'Alex', now, [
    { date: game.date, opponent: 'ravens' },
  ]);
  assert.equal(cards[0].status, 'Complete');
  assert.equal(buildGameOnDashboardEntries([game], [share], 'Alex', now, [
    { date: game.date, opponent: 'Ravens' },
  ])[0].status, 'Sharing', 'Calendar-linked cards must use the current post-start Event Card phase');
});

test('multi-event and meeting shares are not repurposed as Game On cards', () => {
  const game = event('game', 'game', '2026-09-28');
  const cards = buildGameOnDashboardEntries([], [
    { shareToken: 'calendar', title: 'Calendar', createdAt: now.toISOString(), events: [game, game] },
    { shareToken: 'meeting', title: 'Meeting', createdAt: now.toISOString(), events: [event('old', 'meeting', '2026-09-28')] },
  ], 'Alex', now);
  assert.deepEqual(cards, []);
});