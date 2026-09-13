import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterRosterPlayers,
  getBenchPlayers,
  getDefaultRoster,
  getStarterPlayers,
  moveRosterPlayer,
  moveRosterPlayerWithinGroup,
  normalizeRosterDraft,
  readRosterDraft,
  removeRosterPlayer,
  saveRosterDraft,
  updateRosterPlayer,
  type RosterPlayer,
} from './roster-draft';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const players: RosterPlayer[] = [
  { id: 'one', name: 'One', jerseyNumber: '1', position: 'GK', isStarter: true, isCaptain: true },
  { id: 'two', name: 'Two', jerseyNumber: '2', position: 'MID', isStarter: false, isCaptain: false },
];

test('normalizes empty, partial, and long player data safely', () => {
  const draft = normalizeRosterDraft({
    teamName: '',
    season: 2026,
    layout: 'lineup',
    players: [null, { id: 'long', name: 'A'.repeat(180), isStarter: true }, { name: 'Bench' }],
  });
  assert.ok(draft);
  assert.equal(draft.teamName, 'Eastside Falcons');
  assert.equal(draft.layout, 'lineup');
  assert.equal(draft.players[0].name, '');
  assert.equal(draft.players[1].name.length, 180);
  assert.equal(draft.players[2].isStarter, false);
});

test('roster draft round trips through local persistence', () => {
  const storage = new MemoryStorage();
  const draft = { ...getDefaultRoster(), teamName: 'Westside Wolves', layout: 'lineup' as const, players };
  saveRosterDraft(storage as Storage, draft);
  assert.deepEqual(readRosterDraft(storage as Storage), draft);
});

test('player controls update, reorder, and remove without mutating the original list', () => {
  const updated = updateRosterPlayer(players, 'two', { name: 'Two Updated', isStarter: true });
  const moved = moveRosterPlayer(updated, 'two', -1);
  const removed = removeRosterPlayer(moved, 'one');
  assert.equal(players[1].name, 'Two');
  assert.deepEqual(moved.map((player) => player.id), ['two', 'one']);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].name, 'Two Updated');
});

test('starter and bench groups preserve player records and reorder independently', () => {
  const expandedPlayers: RosterPlayer[] = [
    players[0],
    { id: 'bench-two', name: 'Bench Two', jerseyNumber: '2', position: 'MID', isStarter: false, isCaptain: false },
    { id: 'starter-three', name: 'Starter Three', jerseyNumber: '3', position: 'FWD', isStarter: true, isCaptain: false },
    players[1],
  ];

  assert.deepEqual(getStarterPlayers(expandedPlayers).map((player) => player.id), ['one', 'starter-three']);
  assert.deepEqual(getBenchPlayers(expandedPlayers).map((player) => player.id), ['bench-two', 'two']);
  assert.deepEqual(
    moveRosterPlayerWithinGroup(expandedPlayers, 'starter-three', -1).map((player) => player.id),
    ['starter-three', 'bench-two', 'one', 'two'],
  );
  assert.deepEqual(
    moveRosterPlayerWithinGroup(expandedPlayers, 'bench-two', 1).map((player) => player.id),
    ['one', 'two', 'starter-three', 'bench-two'],
  );
});

test('both roster layouts filter the main canvas to starters', () => {
  assert.deepEqual(filterRosterPlayers({ layout: 'lineup', players }).map((player) => player.id), ['one']);
  assert.deepEqual(filterRosterPlayers({ layout: 'roster', players }).map((player) => player.id), ['one']);
});