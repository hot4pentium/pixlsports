import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { OwnedAthleteInvite, SoccerGearState } from '@workspace/api-client-react';
import { canOpenAthleteLockerCard, getAthleteLockerRewards, isSoccerGearForAthlete } from './athlete-locker-model';

test('the parent dashboard contains no Locker and offers a separate Player Showcase tab', () => {
  const source = readFileSync(new URL('./supporter-dashboard.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<AthleteLocker\b|useGetSoccerGear|soccerGearQuery/);
  assert.match(source, /data-testid="link-mobile-player-showcase"/);
  assert.match(source, /href="\/studio\/player-showcase"/);
  assert.equal((source.match(/<SupporterGameOnSummary\b/g) ?? []).length, 2);
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /data-testid="link-toolbar-player-showcase"/);
  assert.match(app, /<Route path="\/studio\/player-showcase"><PlayerShowcaseStudioPage \/><\/Route>/);
});

test('the studio toolbar contains only Supporter Hub and Player Showcase tabs', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const layout = app.slice(app.indexOf('function StudioLayout'), app.indexOf('\n\nfunction Studio('));
  assert.match(layout, /data-testid="link-studio-directory"/);
  assert.match(layout, /data-testid="link-toolbar-player-showcase"/);
  assert.equal((layout.match(/data-testid="link-[^"]+"/g) ?? []).length, 2);
  assert.doesNotMatch(layout, /AdminEntryLink/, 'the toolbar should not expose an admin tab');
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
