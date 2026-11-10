import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { OwnedAthleteInvite, SoccerGearState } from '@workspace/api-client-react';
import { canOpenAthleteLockerCard, getAthleteLockerRewards, isSoccerGearForAthlete } from './athlete-locker-model';

test('the dashboard HYPE Card remains the Showcase entry without a separate mobile tab', () => {
  const source = readFileSync(new URL('./supporter-dashboard.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<AthleteLocker\b|useGetSoccerGear|soccerGearQuery/);
  assert.doesNotMatch(source, /mobile-supporter-tabs|link-mobile-player-showcase/);
  assert.equal((source.match(/<SupporterGameOnSummary\b/g) ?? []).length, 2);
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /data-testid="link-toolbar-player-showcase"/);
  assert.match(app, /<Route path="\/studio\/player-showcase"><PlayerShowcaseStudioPage \/><\/Route>/);
});

test('dashboard HYPE Cards use the basic iOS front without decorative frames', () => {
  const source = readFileSync(new URL('./supporter-hype-card-preview.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./supporter-hype-card-preview.css', import.meta.url), 'utf8');
  const dashboard = source.slice(source.indexOf('<div className="supporter-hype-preview__surface">'), source.indexOf('<DialogTrigger asChild>'));
  assert.match(dashboard, /<NativeHypeCardFront/);
  assert.doesNotMatch(dashboard, /<LivingAthleteCardFront|cutoutUrl|data-design/);
  assert.match(dashboard, /seasonName=\{card\.seasonName\}/);
  assert.match(dashboard, /appearance=\{appearance\}/, 'saved photo placement and athlete details are preserved');
  assert.doesNotMatch(css, /clip-path: polygon|surface\[data-design/);
  assert.match(css, /surface > \.lc-native-front\s*\{[^}]*box-shadow: none/);
});

test('the studio toolbar keeps the home destination without a Player Showcase tab', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const layout = app.slice(app.indexOf('function StudioLayout'), app.indexOf('\n\nfunction Studio('));
  assert.match(layout, /data-testid="link-studio-directory"/);
  assert.doesNotMatch(layout, /Player Showcase|link-toolbar-player-showcase/);
  assert.equal((layout.match(/data-testid="link-[^"]+"/g) ?? []).length, 1);
  assert.doesNotMatch(layout, /AdminEntryLink/, 'the toolbar should not expose an admin tab');
});

test('the private owner HYPE Card screen shares its direct link and saves all owner privacy choices', () => {
  const source = readFileSync(new URL('./player-showcase.tsx', import.meta.url), 'utf8');
  assert.match(source, /ownerExperience/);
  assert.match(source, /\/fan\/\$\{encodeURIComponent\(inviteToken\)\}/);
  assert.match(source, /returnTo=showcase/);
  assert.match(source, /inviteToken=\$\{encodeURIComponent\(matchedInvite\.inviteToken\)\}/);
  assert.match(source, /Show HYPE Card/);
  assert.match(source, /Share finalized stats/);
  assert.match(source, /Share Event Cards/);
  assert.match(source, /Pause public page/);
  assert.match(source, /useUpdateAthleteInvite/);
  assert.match(source, /getGetAthleteInviteQueryKey\(matchedInvite\.inviteToken\)/);
  assert.match(source, /getGetAthleteFanCardQueryKey\(matchedInvite\.inviteToken\)/);
});

test('the athlete details editor includes only the selected matching HYPE Card photo controls', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /getShowcasePhotoInvite\(ownedInvites, savedProfile, photoInviteToken\)/);
  assert.match(app, /<FanCardPhotoManager/);
  assert.match(app, /disabled=\{!athleteDetailsAreSaved \|\| !photoInviteMatchesSavedProfile \|\| saving\}/);
  const profile = readFileSync(new URL('./supporter-dashboard.tsx', import.meta.url), 'utf8');
  assert.match(profile, /athletePhotoControls\?: ReactNode/);
  assert.match(profile, /data-testid="section-athlete-photo-controls"/);
});

function invite(overrides: Partial<OwnedAthleteInvite> = {}) {
  return {
    paused: false,
    showHypeCard: true,
    ...overrides,
  } as OwnedAthleteInvite;
}

test('the public card is openable only when ready, visible, active, and given an href', () => {
  assert.equal(canOpenAthleteLockerCard('ready', invite(), '/fan/card-token'), true);
  assert.equal(canOpenAthleteLockerCard('loading', invite(), '/fan/card-token'), false);
  assert.equal(canOpenAthleteLockerCard('ready', null, '/fan/card-token'), false);
  assert.equal(canOpenAthleteLockerCard('ready', invite(), null), false);
  assert.equal(canOpenAthleteLockerCard('ready', invite({ paused: true }), '/fan/card-token'), false);
  assert.equal(canOpenAthleteLockerCard('ready', invite({ showHypeCard: false }), '/fan/card-token'), false);
});

function gear(overrides: Partial<SoccerGearState> = {}) {
  return {
    canSave: true,
    athleteName: 'Jordan Lee',
    ...overrides,
  } as SoccerGearState;
}

test('saved soccer gear is shown only for the selected soccer athlete', () => {
  assert.equal(isSoccerGearForAthlete(gear(), '  Jordan   Lee ', 'soccer'), true);
  assert.equal(isSoccerGearForAthlete(gear(), 'Taylor Lee', 'soccer'), false);
  assert.equal(isSoccerGearForAthlete(gear(), 'Jordan Lee', 'basketball'), false);
  assert.equal(isSoccerGearForAthlete(gear({ canSave: false }), 'Jordan Lee', 'soccer'), false);
  assert.equal(isSoccerGearForAthlete(null, 'Jordan Lee', 'soccer'), false);
});

test('locker equipment follows durable return, Event Card, and completed tracker milestones', () => {
  const rewards = getAthleteLockerRewards({
    activeWeeks: 1,
    eventCardsCreated: 1,
    trackerGamesCompleted: 1,
    hypeCardShared: false,
  });
  assert.deepEqual(
    rewards.filter((reward) => reward.earned).map((reward) => reward.id),
    ['match-ball', 'event-bag', 'tactics-board'],
  );

  const fullLocker = getAthleteLockerRewards({
    activeWeeks: 1,
    eventCardsCreated: 10,
    trackerGamesCompleted: 5,
    hypeCardShared: false,
  });
  assert.equal(fullLocker.every((reward) => reward.earned), true);
  assert.equal(getAthleteLockerRewards(null).some((reward) => reward.earned), false);
});
