import assert from 'node:assert/strict';
import test from 'node:test';
import { getLatestFanActivity } from './fan-activity-model';

test('recent Fan Hypes appear in the dashboard ahead of older media replies', () => {
  const items = getLatestFanActivity(
    [
      { id: 'latest', reaction: '🔥', senderName: 'Alex', message: 'Great game!', createdAt: '2026-09-26T21:42:00Z' },
      { id: 'earlier', reaction: '👏', senderName: null, message: null, createdAt: '2026-09-26T19:00:00Z' },
    ],
    {
      totalCount: 1,
      unreadCount: 0,
      groups: [{
        shareToken: 'shared-video',
        title: 'Game highlight',
        sentAt: '2026-09-26T18:00:00Z',
        unreadCount: 0,
        replies: [{ id: 'reply', reaction: '💪', message: 'Nice!', isRead: true, createdAt: '2026-09-26T20:00:00Z' }],
      }],
    },
  );

  assert.deepEqual(items.map((item) => item.id), ['hype-latest', 'reply-reply']);
  assert.equal(items[0]?.title, 'Fan Hype · Alex');
  assert.equal(items[1]?.title, 'Media reply · Game highlight');
});

test('anonymous Hypes still show without any media shares', () => {
  const items = getLatestFanActivity(
    [{ id: 'anonymous', reaction: '👏', senderName: null, message: null, createdAt: '2026-09-26T21:42:00Z' }],
    { totalCount: 0, unreadCount: 0, groups: [] },
  );
  assert.equal(items[0]?.title, 'Fan Hype · Anonymous');
  assert.equal(items[0]?.message, 'Sent a Hype');
});