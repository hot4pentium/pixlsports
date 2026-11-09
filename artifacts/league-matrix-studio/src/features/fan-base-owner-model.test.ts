import assert from 'node:assert/strict';
import test from 'node:test';
import type { OwnedAthleteInvite } from '@workspace/api-client-react';
import { resolveFanBaseInvite } from './fan-base-owner-model';

const profile = { athleteName: 'Kim', teamName: 'Tigers', sport: 'soccer' as const, seasonName: '2026' };
const card = (inviteToken: string, athleteName = 'Kim', seasonName = '2026') => ({
  inviteToken, athleteName, teamName: 'Tigers', sport: 'soccer', seasonName,
}) as OwnedAthleteInvite;

test('Fan Base only resolves explicit links from the current account’s owned cards', () => {
  const current = card('current');
  assert.equal(resolveFanBaseInvite([current], profile, 'current'), current);
  assert.equal(resolveFanBaseInvite([current], profile, 'foreign-or-deleted'), null);
  assert.equal(resolveFanBaseInvite([], profile, 'current'), null);
});

test('Fan Base chooses the matching athlete and season only when no card was requested', () => {
  const current = card('current');
  const older = card('older', 'Kim', '2025');
  assert.equal(resolveFanBaseInvite([older, current], profile, ''), current);
  assert.equal(resolveFanBaseInvite([card('someone-else', 'Alex')], profile, ''), null);
});

test('ambiguous Fan Base cards require an explicit choice', () => {
  const first = card('first');
  const second = card('second');
  assert.equal(resolveFanBaseInvite([first, second], profile, ''), null);
  assert.equal(resolveFanBaseInvite([first, second], profile, 'second'), second);
});
