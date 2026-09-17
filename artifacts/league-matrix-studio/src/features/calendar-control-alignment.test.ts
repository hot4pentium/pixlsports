import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const compactConnectionPanel = appSource.slice(
  appSource.indexOf('function FanCalendarConnectionPanel'),
  appSource.indexOf('function EditorPage'),
);
const scheduleEditor = appSource.slice(
  appSource.indexOf('<SchedulePreview'),
  appSource.indexOf('function SchedulePreview'),
);
const schedulePreview = appSource.slice(
  appSource.indexOf('function SchedulePreview'),
  appSource.indexOf('function PublicSchedulePage'),
);

test('calendar controls stay pinned to their current phone and desktop edges', () => {
  assert.match(
    schedulePreview,
    /data-testid="schedule-bottom-actions"/,
  );
  assert.match(
    schedulePreview,
    /w-\[calc\(100%-2rem\)\].*max-w-\[960px\].*items-end.*justify-end.*sm:w-\[calc\(100%-4rem\)\]/,
  );
  assert.match(
    schedulePreview,
    /data-testid="button-add-event"/,
  );
  assert.match(
    scheduleEditor,
    /<FanCalendarConnectionPanel compact/,
  );
});

test('compact connection controls can shrink without overlapping', () => {
  assert.match(compactConnectionPanel, /compact \? 'flex items-center gap-2'/);
  assert.match(compactConnectionPanel, /compact \? 'shrink-0'/);
  assert.match(compactConnectionPanel, /compact \? 'min-w-0 flex-1 gap-1'/);
  assert.match(compactConnectionPanel, /className=\{`min-w-0 flex-1/);
  assert.match(compactConnectionPanel, /className=\{`shrink-0 bg-foreground/);
});

test('standalone connection form keeps its full-size layout', () => {
  assert.match(compactConnectionPanel, /'mb-6 p-5 sm:p-6'/);
  assert.match(compactConnectionPanel, /'flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between'/);
  assert.match(compactConnectionPanel, /'w-full max-w-md gap-2'/);
  assert.match(compactConnectionPanel, /compact \? 'px-2 py-2 text-xs' : 'px-4 py-3 text-sm'/);
  assert.match(compactConnectionPanel, /compact \? 'px-3 py-2 text-\[9px\] tracking-wider' : 'px-5 py-3 text-xs tracking-widest'/);
});