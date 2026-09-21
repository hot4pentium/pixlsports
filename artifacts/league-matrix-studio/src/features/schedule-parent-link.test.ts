import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const appSourcePath = resolve(dirname(fileURLToPath(import.meta.url)), '../App.tsx');

test('the saved parent link stays near the schedule header on phones and in the desktop sidebar', async () => {
  const source = await readFile(appSourcePath, 'utf8');

  assert.match(
    source,
    /<div className="mb-6 lg:hidden">\s*\{renderScheduleSharePanel\('schedule-share-link-mobile'\)\}\s*<\/div>[\s\S]*?<div className="grid flex-1 gap-6 lg:grid-cols-\[minmax\(0,1fr\)_320px\]/,
    'the mobile parent link should render before the preview/sidebar grid',
  );
  assert.match(
    source,
    /<aside[\s\S]*?<div className="hidden lg:block">\s*\{renderScheduleSharePanel\('schedule-share-link'\)\}\s*<\/div>/,
    'the desktop parent link should remain in the existing sidebar',
  );
});

test('the parent link fits phone widths and keeps copy and revoke actions touch friendly', async () => {
  const source = await readFile(appSourcePath, 'utf8');

  assert.match(source, /className="h-11 min-w-0 flex-1 bg-transparent/);
  assert.match(source, /className="grid h-11 w-11 shrink-0/);
  assert.match(source, /className="mt-2 inline-flex min-h-11 items-center/);
  assert.match(source, /navigator\.clipboard\?\.writeText\(shareUrl\)/);
  assert.match(source, /void revokeScheduleShare\(\)/);
  assert.match(source, /Update this link after changing the schedule\. Parents keep the same URL\./);
});

test('schedule edits keep reusing the saved parent-link token', async () => {
  const source = await readFile(appSourcePath, 'utf8');

  assert.match(source, /const cloudSchedule = \(nextEvents = events\)[\s\S]*?\.\.\.\(shareToken \? \{ shareToken \} : \{\}\)/);
  assert.match(source, /saveCurrentDraft\(nextEvents\)/);
  assert.match(source, /if \(nextShareToken\) \{\s*await updateShare\.mutateAsync/);
});