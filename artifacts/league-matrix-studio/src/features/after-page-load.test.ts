import assert from 'node:assert/strict';
import test from 'node:test';
import { afterPageLoad } from './after-page-load';

test('late-loaded application entries still register the offline worker', () => {
  let registrations = 0;
  const events = new EventTarget();
  afterPageLoad({ readyState: 'complete' }, events, () => { registrations++; });
  assert.equal(registrations, 1);
  events.dispatchEvent(new Event('load'));
  assert.equal(registrations, 1);
});

test('early-loaded application entries wait for load and register only once', () => {
  for (const readyState of ['loading', 'interactive'] as const) {
    let registrations = 0;
    const events = new EventTarget();
    afterPageLoad({ readyState }, events, () => { registrations++; });
    assert.equal(registrations, 0);
    events.dispatchEvent(new Event('load'));
    events.dispatchEvent(new Event('load'));
    assert.equal(registrations, 1);
  }
});
