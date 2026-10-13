import assert from 'node:assert/strict';
import test from 'node:test';
import { nonnegativeInteger, otherStatCount, validateCorrectedStatCounts } from './season-stats-validation';

test('a first athlete stat supplies its combined total without a second entry', () => {
  assert.deepEqual(validateCorrectedStatCounts('Goal', '1', '0'), { valid: true, total: 1, athlete: 1 });
  assert.deepEqual(validateCorrectedStatCounts('Save', '0', '0'), { valid: true, total: 0, athlete: 0 });
});

test('increasing or decreasing athlete credit preserves the team and older unassigned portion', () => {
  const other = otherStatCount(7, 2);
  assert.equal(other, 5);
  assert.deepEqual(validateCorrectedStatCounts('Save', '4', String(other)), { valid: true, total: 9, athlete: 4 });
  assert.deepEqual(validateCorrectedStatCounts('Save', '1', String(other)), { valid: true, total: 6, athlete: 1 });
  assert.equal(otherStatCount(3, 0), 3);
  assert.equal(otherStatCount(0, 0), 0);
});

test('optional team or unassigned counts can be corrected separately', () => {
  assert.deepEqual(validateCorrectedStatCounts('Goal', '2', '4'), { valid: true, total: 6, athlete: 2 });
});

test('each invalid count names its field and rejecting an unsafe combined total', () => {
  assert.equal(nonnegativeInteger('0'), 0);
  assert.deepEqual(validateCorrectedStatCounts('Save', '', '0'), {
    valid: false, field: 'athlete', message: 'Save: athlete count must be a whole number (0 or greater).',
  });
  assert.deepEqual(validateCorrectedStatCounts('Save', '1', '-1'), {
    valid: false, field: 'other', message: 'Save: team or unassigned count must be a whole number (0 or greater).',
  });
  assert.equal(validateCorrectedStatCounts('Save', '1.5', '0').valid, false);
  assert.equal(validateCorrectedStatCounts('Save', String(Number.MAX_SAFE_INTEGER), '1').valid, false);
});