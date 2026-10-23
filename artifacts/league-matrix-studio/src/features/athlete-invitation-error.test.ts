import assert from 'node:assert/strict';
import test from 'node:test';
import { athleteInvitationErrorMessage } from './athlete-invitation-error';

test('invitation errors preserve actionable server explanations', () => {
  for (const message of [
    'That email already has a Pixl Sports sign-in. Use a separate athlete email.',
    'An athlete invitation is already waiting for a response.',
    'This HYPE Card is already linked to an athlete sign-in.',
  ]) {
    assert.equal(athleteInvitationErrorMessage({ status: 409, data: { error: message } }), message);
  }
  const unavailable = 'The athlete email could not be checked. Try again.';
  assert.equal(athleteInvitationErrorMessage({ status: 503, data: { error: unavailable } }), unavailable);
});

test('expired sessions, rate limits and unknown failures have safe messages', () => {
  assert.match(athleteInvitationErrorMessage({ status: 401 }), /Sign in again/);
  assert.match(athleteInvitationErrorMessage({ status: 429 }), /Wait a moment/);
  for (const error of [null, new TypeError('Failed to fetch'), { status: 500, data: { error: 'internal database details' } }]) {
    assert.match(athleteInvitationErrorMessage(error), /Check your connection/);
    assert.doesNotMatch(athleteInvitationErrorMessage(error), /Check the email|internal database/);
  }
});
