import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMeetingPhase,
  isMeetingUnscheduled,
  listCompletedMeetingRecords,
  meetingStorageKey,
  normalizeMeetingState,
} from './meeting-capture-model';

function makeStorage(entries: Record<string, string>): Storage {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

test('scheduled meetings stay in prep until their scheduled start', () => {
  const context = { date: '2026-09-25', time: '17:00' };
  assert.equal(getMeetingPhase(context, { startedAt: null, endedAt: null }, new Date('2026-09-25T16:59:59')), 'prep');
  assert.equal(getMeetingPhase(context, { startedAt: null, endedAt: null }, new Date('2026-09-25T17:00:00')), 'live');
  assert.equal(getMeetingPhase(context, { startedAt: null, endedAt: '2026-09-25T18:00:00Z' }), 'share');
});

test('meetings without a complete schedule stay in prep until started manually', () => {
  assert.equal(isMeetingUnscheduled({ date: '', time: '' }), true);
  assert.equal(isMeetingUnscheduled({ date: '2026-09-25', time: '' }), true);
  assert.equal(isMeetingUnscheduled({ date: '', time: '17:00' }), true);
  assert.equal(isMeetingUnscheduled({ date: '2026-09-25', time: '17:00' }), false);
  assert.equal(
    getMeetingPhase({ date: '', time: '' }, { startedAt: null, endedAt: null }),
    'prep',
  );
  assert.equal(
    getMeetingPhase({ date: '', time: '' }, { startedAt: '2026-09-23T12:00:00.000Z', endedAt: null }),
    'live',
  );
});

test('legacy meeting records normalize without losing captured content', () => {
  const state = normalizeMeetingState({
    notes: 'Keep defense focused.',
    participants: [{ id: 'p1', name: 'Morgan', present: true }],
    agenda: [{ id: 'a1', label: 'Defense', completed: true }],
    decisions: [{ id: 'd1', text: 'Stay compact.' }],
    followUps: [{ id: 'f1', task: 'Send drills', owner: 'Morgan', dueDate: '2026-09-26' }],
    endedAt: '2026-09-25T18:00:00Z',
  });

  assert.equal(state?.notes, 'Keep defense focused.');
  assert.equal(state?.participants[0]?.name, 'Morgan');
  assert.equal(state?.agenda[0]?.completed, true);
  assert.equal(state?.startedAt, null);
  assert.equal(state?.endedAt, '2026-09-25T18:00:00Z');
});

test('completed meeting history is scoped and sorted by ended time', () => {
  const scope = 'user-1';
  const otherScope = 'user-2';
  const storage = makeStorage({
    [meetingStorageKey(scope, 'meeting-old')]: JSON.stringify({
      notes: '',
      participants: [],
      agenda: [],
      decisions: [],
      followUps: [],
      endedAt: '2026-09-25T18:00:00Z',
      context: { id: 'meeting-old', title: 'Old meeting', date: '2026-09-25', time: '17:00', location: '' },
    }),
    [meetingStorageKey(scope, 'meeting-new')]: JSON.stringify({
      notes: '',
      participants: [],
      agenda: [],
      decisions: [],
      followUps: [],
      endedAt: '2026-09-26T18:00:00Z',
      context: { id: 'meeting-new', title: 'New meeting', date: '2026-09-26', time: '17:00', location: '' },
    }),
    [meetingStorageKey(otherScope, 'private')]: JSON.stringify({
      notes: '',
      participants: [],
      agenda: [],
      decisions: [],
      followUps: [],
      endedAt: '2026-09-27T18:00:00Z',
      context: { id: 'private', title: 'Other account', date: '2026-09-27', time: '17:00', location: '' },
    }),
  });

  assert.deepEqual(
    listCompletedMeetingRecords(storage, scope).map((record) => record.context.id),
    ['meeting-new', 'meeting-old'],
  );
});