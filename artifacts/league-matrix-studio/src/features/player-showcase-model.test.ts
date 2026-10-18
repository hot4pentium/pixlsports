import assert from 'node:assert/strict';
import test from 'node:test';
import type { OwnedAthleteInvite } from '@workspace/api-client-react';
import { getShowcaseInvite } from './player-showcase-model';

const profile = {
  athleteName: 'Jordan Lee',
  teamName: 'River FC',
  seasonName: 'Fall 2026',
  sport: 'soccer' as const,
};

function invite(overrides: Partial<OwnedAthleteInvite> = {}) {
  return {
    inviteToken: 'jordan-fall',
    athleteName: 'Jordan Lee',
    teamName: 'River FC',
    seasonName: 'Fall Season',
    sport: 'soccer',
    ...overrides,
  } as OwnedAthleteInvite;
}

test('a unique athlete card is found when the profile season is stale or blank', () => {
  const card = invite();

  assert.equal(getShowcaseInvite([card], profile), card);
  assert.equal(getShowcaseInvite([card], { ...profile, seasonName: '' }), card);
});

test('season selects the matching card when the athlete has multiple seasons', () => {
  const fall = invite({ inviteToken: 'fall', seasonName: 'Fall 2026' });
  const spring = invite({ inviteToken: 'spring', seasonName: 'Spring 2027' });

  assert.equal(getShowcaseInvite([fall, spring], profile), fall);
  assert.equal(getShowcaseInvite([fall, spring], { ...profile, seasonName: '' }), null);
  assert.equal(getShowcaseInvite([fall, spring], { ...profile, seasonName: 'Summer 2027' }), null);
});

test('a card for another team or sport is never linked to the selected athlete', () => {
  assert.equal(getShowcaseInvite([invite({ teamName: 'Other FC' })], profile), null);
  assert.equal(getShowcaseInvite([invite({ sport: 'basketball' })], profile), null);
});
