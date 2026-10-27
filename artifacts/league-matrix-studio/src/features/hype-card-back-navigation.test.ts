import assert from 'node:assert/strict';
import test from 'node:test';
import { getHypeCardBackNavigation } from './hype-card-back-navigation';

test('a verified card owner returns to the private Player Showcase', () => {
  assert.deepEqual(getHypeCardBackNavigation('athlete-token', true), {
    href: '/studio/player-showcase',
    label: 'Back to Showcase',
    testId: 'link-back-owner-showcase',
  });
});

test('Open public card returns to Player Showcase before ownership finishes loading', () => {
  assert.equal(
    getHypeCardBackNavigation('athlete-token', false, '?from=player-showcase&side=stats').href,
    '/studio/player-showcase',
  );
});

test('ordinary shared links return recipients to the public Showcase', () => {
  assert.deepEqual(getHypeCardBackNavigation('athlete/token'), {
    href: '/showcase/athlete%2Ftoken',
    label: 'Back to Dynamic Showcase',
    testId: 'link-back-public-showcase',
  });
});

test('arbitrary return destinations cannot change the card back link', () => {
  assert.equal(
    getHypeCardBackNavigation('athlete-token', false, '?from=https://example.com&returnTo=https://example.com').href,
    '/showcase/athlete-token',
  );
});
