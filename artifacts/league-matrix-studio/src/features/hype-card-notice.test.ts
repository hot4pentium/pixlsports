import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isHypeCardSuccessNotice } from './hype-card-notice';

const editorSource = readFileSync(new URL('./hype-card.tsx', import.meta.url), 'utf8');

test('recognizes representative Hype Card readiness, copy, publish, and completion notices', () => {
  const successNotices = [
    'Game details and finished stats are ready. Choose media from your camera roll.',
    'Share link copied.',
    'Stats link ready for 7 days. Your video stays on this phone.',
    'Hype Card added to Athlete Hype Page for 7 days.',
    'This design and its prepared media are now saved to the cloud.',
  ];

  for (const notice of successNotices) {
    assert.equal(isHypeCardSuccessNotice(notice), true, notice);
  }
});

test('keeps representative Hype Card failures out of the success treatment', () => {
  const errorNotices = [
    'Could not publish the interactive Hype Card.',
    'Failed to migrate project to cloud.',
    'Cloud draft saved, but media upload failed.',
    'The stats link could not be revoked.',
  ];

  for (const notice of errorNotices) {
    assert.equal(isHypeCardSuccessNotice(notice), false, notice);
  }
});

test('renders success notices as accessible green statuses and failures as red alerts', () => {
  assert.match(editorSource, /isSuccessNotice\s*\?\s*'border-emerald-800 bg-emerald-700 text-white'/);
  assert.match(editorSource, /:\s*'border-border bg-destructive text-destructive-foreground'/);
  assert.match(editorSource, /role=\{isSuccessNotice \? 'status' : 'alert'\}/);
  assert.match(editorSource, /data-tone=\{isSuccessNotice \? 'success' : 'error'\}/);
});