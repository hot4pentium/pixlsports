import test from 'node:test';
import assert from 'node:assert/strict';
import { getOwnerHypeCardSides } from './owner-hype-card-surface-model';

test('private, paused, and hidden owner cards expose only the front preview', () => {
  for (const isPublicActive of [false]) {
    assert.deepEqual(getOwnerHypeCardSides({
      isPublicActive,
      inviteAllowsStats: true,
      cardHasStats: true,
      inviteAllowsEvents: true,
      cardAllowsEvents: true,
    }), ['front']);
  }
});

test('public owner sides require both invite and published-card permission', () => {
  assert.deepEqual(getOwnerHypeCardSides({
    isPublicActive: true,
    inviteAllowsStats: true,
    cardHasStats: true,
    inviteAllowsEvents: true,
    cardAllowsEvents: true,
  }), ['front', 'videos', 'stats', 'events']);
  assert.deepEqual(getOwnerHypeCardSides({
    isPublicActive: true,
    inviteAllowsStats: false,
    cardHasStats: true,
    inviteAllowsEvents: true,
    cardAllowsEvents: false,
  }), ['front', 'videos']);
});

test('stats require finalized stats and events require both sharing flags', () => {
  assert.deepEqual(getOwnerHypeCardSides({
    isPublicActive: true,
    inviteAllowsStats: true,
    cardHasStats: false,
    inviteAllowsEvents: true,
    cardAllowsEvents: true,
  }), ['front', 'videos', 'events']);
  assert.deepEqual(getOwnerHypeCardSides({
    isPublicActive: true,
    inviteAllowsStats: true,
    cardHasStats: true,
    inviteAllowsEvents: false,
    cardAllowsEvents: true,
  }), ['front', 'videos', 'stats']);
});
