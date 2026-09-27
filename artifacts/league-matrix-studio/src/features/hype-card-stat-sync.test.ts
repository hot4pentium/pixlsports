import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultProject,
  designOnlyProject,
  normalizeHypeCardProject,
} from './hype-card-types';
import { applyLatestLinkedStat } from './hype-card-stat-sync';

const linked = {
  ...defaultProject(),
  stat: '1 goal',
  statSource: {
    trackerProjectId: 'tracker-1',
    gameId: 'game-1',
    lastGeneratedStat: '1 goal',
  },
};

test('a new export uses corrected finalized stats from the linked game', () => {
  const revised = applyLatestLinkedStat(linked, '2 goals');
  assert.equal(revised.stat, '2 goals');
  assert.equal(revised.statSource?.lastGeneratedStat, '2 goals');
  assert.equal(linked.stat, '1 goal');
});

test('a manually authored stat is never overwritten by a tracker refresh', () => {
  const custom = { ...linked, stat: 'My best game yet' };
  assert.equal(applyLatestLinkedStat(custom, '2 goals'), custom);
  assert.equal(applyLatestLinkedStat(defaultProject(), '2 goals').stat, '12 points');
});

test('saved designs retain their linked game, but portable templates do not', () => {
  assert.deepEqual(normalizeHypeCardProject(linked).statSource, linked.statSource);
  assert.equal(designOnlyProject(linked).statSource, null);
  assert.equal(normalizeHypeCardProject({ ...linked, statSource: { gameId: 1 } }).statSource, null);
});