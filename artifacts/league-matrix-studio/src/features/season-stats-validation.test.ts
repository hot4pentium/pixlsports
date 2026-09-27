import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStatCounts } from './season-stats-validation';

test('explains when athlete credit exceeds the tracked total', () => {
  assert.deepEqual(validateStatCounts('Save', '0', '1'), {
    valid: false,
    field: 'total',
    message: 'Save: 1 credited to the athlete exceeds 0 tracked in total. Increase total tracked to at least 1, or lower athlete credited to 0.',
  });
});

test('distinguishes invalid whole numbers from a valid zero', () => {
  assert.deepEqual(validateStatCounts('Save', '0', '0'), { valid: true, total: 0, athlete: 0 });
  const invalidTotal = validateStatCounts('Save', '0.5', '0');
  const invalidAthlete = validateStatCounts('Save', '1', '-1');
  assert.equal(invalidTotal.valid, false);
  assert.equal(invalidAthlete.valid, false);
  if (!invalidTotal.valid) assert.match(invalidTotal.message, /total tracked must be a whole number/);
  if (!invalidAthlete.valid) assert.match(invalidAthlete.message, /athlete credited must be a whole number/);
});

test('allows an athlete count that is part of the total', () => {
  assert.deepEqual(validateStatCounts('Save', '3', '1'), { valid: true, total: 3, athlete: 1 });
});