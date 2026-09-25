import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGameOnDashboardEntries, type GameOnDashboardEvent } from './game-on-dashboard-model';

const now = new Date('2026-09-24T12:00:00');
const event = (id: string, type: GameOnDashboardEvent['type'], date: string): GameOnDashboardEvent => ({
  id, type, date, time: '10:00', location: 'North Field', opponent: 'Ravens', status: 'upcoming',
});

test('upcoming cards lead, completed cards remain in View all, and meetings are excluded', () => {
  const cards = buildGameOnDashboardEntries([
    event('past', 'game', '2026-09-02'),
    event('next-week', 'game', '2026-10-01'),
    event('next-day', 'practice', '2026-09-25'),
    event('meeting', 'meeting', '2026-09-26'),
  ], [], 'Alex', now);

  assert.deepEqual(cards.map((card) => card.eventId), ['next-day', 'next-week', 'past']);
  assert.equal(cards[0].status, 'Draft');
  assert.equal(cards[0].opponent, '');
  assert.equal(cards[2].status, 'Complete');
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

test('multi-event and meeting shares are not repurposed as Game On cards', () => {
  const game = event('game', 'game', '2026-09-28');
  const cards = buildGameOnDashboardEntries([], [
    { shareToken: 'calendar', title: 'Calendar', createdAt: now.toISOString(), events: [game, game] },
    { shareToken: 'meeting', title: 'Meeting', createdAt: now.toISOString(), events: [event('old', 'meeting', '2026-09-28')] },
  ], 'Alex', now);
  assert.deepEqual(cards, []);
});