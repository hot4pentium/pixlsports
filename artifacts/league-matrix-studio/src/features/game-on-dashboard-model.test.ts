import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGameOnDashboardEntries, getFeaturedGameOnCardId, getNextGameOnDashboardEntry, sortGameOnCardsByDate, type GameOnDashboardEvent } from './game-on-dashboard-model';

const now = new Date('2026-09-24T12:00:00');
const event = (id: string, type: GameOnDashboardEvent['type'], date: string): GameOnDashboardEvent => ({
  id, type, date, time: '10:00', location: 'North Field', opponent: 'Ravens', status: 'upcoming',
});

test('cards follow calendar order, including completed dates, and meetings are excluded', () => {
  const cards = buildGameOnDashboardEntries([
    event('past', 'game', '2026-09-02'),
    event('next-week', 'game', '2026-10-01'),
    event('next-day', 'practice', '2026-09-25'),
    event('meeting', 'meeting', '2026-09-26'),
  ], [], 'Alex', now);

  assert.deepEqual(cards.map((card) => card.eventId), ['past', 'next-day', 'next-week']);
  assert.equal(cards[0].status, 'Complete');
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
  const game = event('standalone-game', 'game', '2026-09-24');
  const share = { shareToken: 'game-share', title: 'Game', createdAt: now.toISOString(), events: [game] };
  const cards = buildGameOnDashboardEntries([], [share], 'Alex', now, [
    { date: game.date, opponent: 'ravens' },
  ]);
  assert.equal(cards[0].status, 'Complete');
  assert.equal(buildGameOnDashboardEntries([game], [share], 'Alex', now, [
    { date: game.date, opponent: 'Ravens' },
  ])[0].status, 'Live', 'Calendar-linked cards must use the saved Calendar status');
});

test('multi-event and meeting shares are not repurposed as Game On cards', () => {
  const game = event('game', 'game', '2026-09-28');
  const cards = buildGameOnDashboardEntries([], [
    { shareToken: 'calendar', title: 'Calendar', createdAt: now.toISOString(), events: [game, game] },
    { shareToken: 'meeting', title: 'Meeting', createdAt: now.toISOString(), events: [event('old', 'meeting', '2026-09-28')] },
  ], 'Alex', now);
  assert.deepEqual(cards, []);
});