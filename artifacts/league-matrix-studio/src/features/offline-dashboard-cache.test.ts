import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearOfflineDashboardSnapshot,
  clearPrivateOfflineAccountData,
  offlineDashboardStorageKey,
  readOfflineDashboardSnapshot,
  updateOfflineDashboardSnapshot,
} from './offline-dashboard-cache';
import {
  clearPendingScheduleSync,
  hasPendingScheduleSync,
  markPendingScheduleSync,
  readScheduleDraft,
  saveScheduleDraft,
} from './schedule-draft';

function storage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const lifecycle = {
  status: 'active' as const,
  pauseEndsAt: null,
  planTier: 'free' as const,
  cancelledAt: null,
  lastActivityAt: null,
  deletionEligibleAt: null,
  retentionDays: 90,
  expired: false,
};

test('private snapshots are isolated by account and removed on sign-out', () => {
  const target = storage();
  updateOfflineDashboardSnapshot(target, 'user-a', { lifecycle, verifiedAt: '2026-09-29T12:00:00.000Z' });
  assert.equal(readOfflineDashboardSnapshot(target, 'user-b'), null);
  assert.equal(readOfflineDashboardSnapshot(target, 'user-a', Date.parse('2026-09-30T12:00:00.000Z'))?.lifecycle.status, 'active');
  clearOfflineDashboardSnapshot(target, 'user-a');
  assert.equal(target.getItem(offlineDashboardStorageKey('user-a')), null);
});

test('expired and malformed snapshots never unlock the dashboard', () => {
  const target = storage();
  updateOfflineDashboardSnapshot(target, 'user-a', { lifecycle, verifiedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(readOfflineDashboardSnapshot(target, 'user-a', Date.parse('2026-03-01T00:00:00.000Z')), null);
  target.setItem(offlineDashboardStorageKey('user-a'), '{"version":1,"accountId":"user-a","verifiedAt":"bad"}');
  assert.equal(readOfflineDashboardSnapshot(target, 'user-a'), null);
});

test('confirmed missing accounts clear private offline data and are never saved as dashboard snapshots', () => {
  const target = storage();
  updateOfflineDashboardSnapshot(target, 'user-a', { lifecycle, verifiedAt: '2026-09-29T12:00:00.000Z' });
  target.setItem('leaguematrix-stat-tracker:user-a', 'private');

  const missingLifecycle = { ...lifecycle, status: 'not_provisioned' as const };
  assert.equal(updateOfflineDashboardSnapshot(target, 'user-a', { lifecycle: missingLifecycle }), null);
  clearPrivateOfflineAccountData(target as Storage, 'user-a');

  assert.equal(readOfflineDashboardSnapshot(target, 'user-a'), null);
  assert.equal(target.getItem('leaguematrix-stat-tracker:user-a'), null);
});

test('schedule drafts and pending sync markers stay account-scoped', () => {
  const target = storage();
  const draft = { teamName: 'Falcons', season: 'Fall', events: [], template: 0 };
  saveScheduleDraft(target as Storage, draft, 'user-a');
  markPendingScheduleSync(target, 'user-a');
  assert.deepEqual(readScheduleDraft(target as Storage, 'user-a'), draft);
  assert.equal(readScheduleDraft(target as Storage, 'user-b'), null);
  assert.equal(hasPendingScheduleSync(target, 'user-a'), true);
  assert.equal(hasPendingScheduleSync(target, 'user-b'), false);
  clearPendingScheduleSync(target, 'user-a');
  assert.equal(hasPendingScheduleSync(target, 'user-a'), false);
});

test('sign-out removes only the previous account private device data', () => {
  const target = storage();
  target.setItem('leaguematrix-stat-tracker:user-a', 'private-a');
  target.setItem('pixlsports-checklist:user-a:event-1', 'private-a');
  target.setItem('leaguematrix-stat-tracker:user-b', 'private-b');
  target.setItem('leaguematrix-workspace-event-context', 'private-a');
  target.setItem('unrelated-setting', 'keep');
  clearPrivateOfflineAccountData(target as Storage, 'user-a');
  assert.equal(target.getItem('leaguematrix-stat-tracker:user-a'), null);
  assert.equal(target.getItem('pixlsports-checklist:user-a:event-1'), null);
  assert.equal(target.getItem('leaguematrix-workspace-event-context'), null);
  assert.equal(target.getItem('leaguematrix-stat-tracker:user-b'), 'private-b');
  assert.equal(target.getItem('unrelated-setting'), 'keep');
});