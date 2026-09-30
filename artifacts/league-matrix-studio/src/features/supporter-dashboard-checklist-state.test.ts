import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dashboardChecklistStateAfterSetup,
  getDashboardChecklistItemIds,
  getDashboardChecklistStatus,
  isDashboardChecklistComplete,
  normalizeDashboardChecklistItemIds,
  SUPPORTER_DASHBOARD_CHECKLIST_ITEMS,
} from './supporter-dashboard-checklist-state';

test('only an explicitly new supporter is enrolled in the dashboard checklist', () => {
  assert.equal(dashboardChecklistStateAfterSetup({}, false), 'pending');
  assert.equal(dashboardChecklistStateAfterSetup({ role: 'fan', teamName: 'Falcons' }, true), null);
  assert.equal(dashboardChecklistStateAfterSetup({ dashboardTour: 'done' }, false), 'done');
  assert.equal(dashboardChecklistStateAfterSetup({ dashboardTour: 'pending' }, true), 'pending');
});

test('checklist progress is account metadata, normalized and ordered by the checklist', () => {
  const metadata = {
    dashboardChecklist: {
      checkedItemIds: ['event-card', 'profile', 'unknown', 'profile'],
      dismissed: false,
    },
  };
  assert.deepEqual(getDashboardChecklistItemIds(metadata), ['profile', 'event-card']);
  assert.deepEqual(normalizeDashboardChecklistItemIds(null), []);
  assert.deepEqual(getDashboardChecklistItemIds({ dashboardChecklist: 'invalid' }), []);
});

test('the checklist completes only after all five valid items are checked', () => {
  const allItems = SUPPORTER_DASHBOARD_CHECKLIST_ITEMS.map((item) => item.id);
  assert.equal(isDashboardChecklistComplete(allItems), true);
  assert.equal(isDashboardChecklistComplete([...allItems, 'unexpected']), true);
  assert.equal(isDashboardChecklistComplete(allItems.slice(1)), false);
  assert.equal(getDashboardChecklistStatus({ dashboardTour: 'unexpected' }), null);
});