import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventCardToolGuidance } from './event-card-tool-guidance';

const event = { type: 'game' as const, date: '2026-11-12', time: '18:30', timezone: 'America/New_York', status: 'Published' };
const kickoff = Date.parse('2026-11-12T23:30:00Z');
test('event tools follow the native ten-minute boundary in the event time zone', () => {
  assert.equal(getEventCardToolGuidance(event, kickoff - 600_001).recommended, 'prep');
  assert.equal(getEventCardToolGuidance(event, kickoff - 600_001).allowed, false);
  assert.equal(getEventCardToolGuidance(event, kickoff - 600_000).recommended, 'tracker');
  assert.equal(getEventCardToolGuidance(event, kickoff - 600_000).allowed, true);
  assert.equal(getEventCardToolGuidance(event, kickoff + 3_600_000).recommended, 'share');
  assert.equal(getEventCardToolGuidance(event, kickoff + 3_600_000).allowed, true, 'elapsed time is not finalization');
  assert.equal(getEventCardToolGuidance({ ...event, status: 'Live' }, kickoff + 7_199_999).recommended, 'tracker');
  assert.equal(getEventCardToolGuidance({ ...event, status: 'Live' }, kickoff + 7_200_000).recommended, 'share');
});
test('saved and local completion prevent restart but keep Share recommended', () => {
  for (const patch of [{ status: 'Complete' }, { recordedGameId: 'saved-final' }, { completedAt: '2026-11-12T23:45:00Z' }]) {
    const result = getEventCardToolGuidance({ ...event, ...patch }, kickoff);
    assert.equal(result.recommended, 'share');
    assert.equal(result.availability, 'Game complete');
    assert.equal(result.allowed, false);
  }
  assert.equal(getEventCardToolGuidance(event, kickoff, true).allowed, false);
  assert.equal(getEventCardToolGuidance(event, kickoff, true).recommended, 'share');
});
test('missing starts and practices retain native recommendations without enabling tracking', () => {
  assert.equal(getEventCardToolGuidance({ ...event, time: '' }, kickoff).availability, 'Add a game start time');
  assert.equal(getEventCardToolGuidance({ ...event, time: '99:99' }, kickoff).allowed, false);
  assert.equal(getEventCardToolGuidance({ ...event, type: 'practice' }, kickoff + 7_199_999).recommended, 'prep');
  assert.equal(getEventCardToolGuidance({ ...event, type: 'practice' }, kickoff + 7_200_000).recommended, 'share');
  assert.equal(getEventCardToolGuidance({ ...event, type: 'practice' }, kickoff).allowed, false);
});
