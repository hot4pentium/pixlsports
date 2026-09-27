import assert from 'node:assert/strict';
import test from 'node:test';
import { getDashboardTourState, tourStateAfterSetup } from './supporter-dashboard-tour-state';

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