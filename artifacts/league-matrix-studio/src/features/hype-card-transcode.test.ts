import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preparedVideoDurationMatches } from './hype-card-transcode';

test('local preparation rejects a repeated tail that stretches an eight-second clip', () => {
  assert.equal(preparedVideoDurationMatches(8, 11), false);
  assert.equal(preparedVideoDurationMatches(8, 17.3), false);
  assert.equal(preparedVideoDurationMatches(8, 8.25), true);
  assert.equal(preparedVideoDurationMatches(8, Number.NaN), false);
  assert.equal(preparedVideoDurationMatches(0, 8), false);
});