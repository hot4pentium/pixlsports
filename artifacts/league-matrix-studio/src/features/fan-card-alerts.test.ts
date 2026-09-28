import assert from 'node:assert/strict';
import test from 'node:test';
import { nextFanAlertPreferences } from './fan-card-alerts';

test('pre-event alerts remain off when a follower enables only Game Day Live', () => {
  assert.deepEqual(nextFanAlertPreferences({ liveAlerts: false, preEventAlerts: false }, 'live'), {
    liveAlerts: true,
    preEventAlerts: false,
  });
});

test('disabling one consent preserves the other', () => {
  assert.deepEqual(nextFanAlertPreferences({ liveAlerts: true, preEventAlerts: true }, 'live'), {
    liveAlerts: false,
    preEventAlerts: true,
  });
  assert.deepEqual(nextFanAlertPreferences({ liveAlerts: true, preEventAlerts: true }, 'event'), {
    liveAlerts: true,
    preEventAlerts: false,
  });
});