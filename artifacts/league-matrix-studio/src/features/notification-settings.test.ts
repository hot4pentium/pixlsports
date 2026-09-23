import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./notification-settings.tsx', import.meta.url), 'utf8');

test('notification settings can recover from a failed availability check', () => {
  assert.match(source, /retry: 2/);
  assert.match(source, /refetchOnMount: 'always'/);
  assert.match(source, /refetchOnWindowFocus: true/);
  assert.match(source, /data-testid="button-retry-notification-config"/);
  assert.match(source, /configUnavailable = !config\.isLoading && !config\.isError/);
  assert.match(source, /Phone alerts are not configured on this deployment yet/);
});