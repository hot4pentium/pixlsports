import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const supporterPanel = appSource.slice(
  appSource.indexOf('function FanCalendarConnectionPanel'),
  appSource.indexOf('function EditorPage'),
);

test('supporter calendar setup consistently describes a coach Pixl Sports schedule', () => {
  assert.match(supporterPanel, /Connect to your coach’s Pixl Sports schedule\./);
  assert.match(supporterPanel, /Coach’s Pixl Sports schedule link or code/);
  assert.match(supporterPanel, /Disconnect coach’s schedule/);
  assert.doesNotMatch(
    supporterPanel,
    /family calendar|connect your calendar|Pixl Sports calendar link|That calendar link|Coach calendar link or code/i,
  );
});