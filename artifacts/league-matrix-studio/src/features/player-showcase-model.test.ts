import assert from 'node:assert/strict';
import test from 'node:test';
import type { OwnedAthleteInvite } from '@workspace/api-client-react';
import { getShowcaseInvite, getShowcaseInviteCandidates } from './player-showcase-model';

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

test('a unique athlete card remains linked when the profile sport has changed', () => {
  const baseballCard = invite({ sport: 'baseball' });

  assert.equal(getShowcaseInvite([baseballCard], profile), baseballCard);
});

test('season selects the matching card when the athlete has multiple seasons', () => {
  const fall = invite({ inviteToken: 'fall', seasonName: 'Fall 2026' });
  const spring = invite({ inviteToken: 'spring', seasonName: 'Spring 2027' });

  assert.equal(getShowcaseInvite([fall, spring], profile), fall);
  assert.equal(getShowcaseInvite([fall, spring], { ...profile, seasonName: '' }), null);
  assert.equal(getShowcaseInvite([fall, spring], { ...profile, seasonName: 'Summer 2027' }), null);
});

test('sport disambiguates cards for the same athlete and team', () => {
  const soccerCard = invite({ inviteToken: 'soccer' });
  const baseballCard = invite({ inviteToken: 'baseball', sport: 'baseball' });

  assert.equal(getShowcaseInvite([soccerCard, baseballCard], profile), soccerCard);
  assert.equal(getShowcaseInvite([soccerCard, baseballCard], { ...profile, sport: 'basketball', seasonName: '' }), null);
});

test('unresolved same-athlete cards remain selectable without exposing other athletes', () => {
  const fall = invite({ inviteToken: 'fall', seasonName: 'Fall 2025' });
  const spring = invite({ inviteToken: 'spring', seasonName: 'Spring 2026' });
  const anotherAthlete = invite({ inviteToken: 'casey', athleteName: 'Casey Park', teamName: 'Other Team' });
  const staleProfile = { ...profile, seasonName: 'Summer 2026' };

  assert.equal(getShowcaseInvite([fall, spring, anotherAthlete], staleProfile), null);
  assert.deepEqual(getShowcaseInviteCandidates([fall, spring, anotherAthlete], staleProfile), [fall, spring]);
});

test('a truly missing card has no owner-choice candidates', () => {
  const anotherAthlete = invite({ athleteName: 'Casey Park', teamName: 'Other Team' });

  assert.deepEqual(getShowcaseInviteCandidates([anotherAthlete], profile), []);
  assert.equal(getShowcaseInvite([anotherAthlete], profile), null);
});

test('a card for another athlete or team is never linked to the selected athlete', () => {
  assert.equal(getShowcaseInvite([invite({ teamName: 'Other FC' })], profile), null);
  assert.equal(getShowcaseInvite([invite({ athleteName: 'Other Player' })], profile), null);
});
