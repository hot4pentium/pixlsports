import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearDashboardTourProgress,
  getDashboardTourState,
  readDashboardTourProgress,
  saveDashboardTourProgress,
  tourStateAfterSetup,
} from './supporter-dashboard-tour-state';

test('unfinished tour steps survive remounts in this tab and stay scoped to the supporter', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  assert.equal(readDashboardTourProgress(storage, 'supporter-a', 4), null);
  saveDashboardTourProgress(storage, 'supporter-a', 2);
  assert.equal(readDashboardTourProgress(storage, 'supporter-a', 4), 2);
  assert.equal(readDashboardTourProgress(storage, 'supporter-b', 4), null);
  clearDashboardTourProgress(storage, 'supporter-a');
  assert.equal(readDashboardTourProgress(storage, 'supporter-a', 4), null);
});

test('invalid saved tour steps cannot reopen the tour at a nonexistent step', () => {
  const storage = {
    getItem: () => '{"step":100}',
  };
  assert.equal(readDashboardTourProgress(storage, 'supporter-a', 4), null);
  assert.equal(readDashboardTourProgress({ getItem: () => 'not JSON' }, 'supporter-a', 4), null);
});

test('newly set-up supporters are eligible, but existing accounts without a marker are not', () => {
  assert.equal(tourStateAfterSetup({}, false), 'pending');
  assert.equal(tourStateAfterSetup({ role: 'fan', teamName: 'Falcons' }, true), null);
  assert.equal(tourStateAfterSetup({ dashboardTour: 'done' }, false), 'done');
});

test('tour choices remain scoped to each account metadata and survive repeated reads', () => {
  const firstAccount = { dashboardTour: 'pending' };
  const secondAccount = { dashboardTour: 'done' };
  assert.equal(getDashboardTourState(firstAccount), 'pending');
  assert.equal(getDashboardTourState(secondAccount), 'done');
  assert.equal(getDashboardTourState({ ...firstAccount, dashboardTour: 'done' }), 'done');
  assert.equal(getDashboardTourState(firstAccount), 'pending');
  assert.equal(getDashboardTourState({ dashboardTour: 'unexpected' }), null);
});