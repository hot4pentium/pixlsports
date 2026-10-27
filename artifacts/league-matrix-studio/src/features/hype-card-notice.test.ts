import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getHypeCardNoticeTone, isHypeCardSuccessNotice } from './hype-card-notice';
import { audioCaptureUnavailableError, AUDIO_CAPTURE_UNAVAILABLE_MESSAGE } from './hype-card-export';

const editorSource = readFileSync(new URL('./hype-card.tsx', import.meta.url), 'utf8');

test('recognizes representative Hype Card readiness, copy, publish, and completion notices', () => {
  const successNotices = [
    'Game details and finished stats are ready. Choose media from your camera roll.',
    'Share link copied.',
    'Stats link ready for 7 days. Your video stays on this phone.',
    'HYPE Card published on your public HYPE Page for 7 days. Anyone with the link can view it.',
    'Video published on your public HYPE Page for 7 days. Anyone with the link can view it.',
    'This design and its prepared media are now saved to the cloud.',
  ];

  for (const notice of successNotices) {
    assert.equal(isHypeCardSuccessNotice(notice), true, notice);
    assert.equal(getHypeCardNoticeTone(notice), 'success', notice);
  }
});

test('classifies the editor reconnect, offline, and browser compatibility notices as warnings', () => {
  const warningNotices = [
    'This media is saved in the cloud but not on this phone. Reconnect to load it.',
    'You are offline. Reconnect when you want to save it to the cloud.',
    'Reconnect to publish a player page.',
    'Your Hype Card is ready on this phone. Reconnect to publish this HYPE Card on your public HYPE Page.',
    'Video preparation stopped because this browser was not making progress. The original video will stay local.',
    'This browser could not create a smaller MP4, so the original video will stay local.',
    'The prepared video is too large for the public HYPE Page. Choose a shorter clip or download the Hype Card to this device instead.',
    'Public HYPE Page upload cancelled. Your HYPE Card is still available for download on this device.',
    'Exported as WebM because MP4 encoding is not supported in this browser. If this video does not play on your phone, try exporting from a different browser like Chrome.',
    'The video exported without sound because this browser could not capture the clip audio.',
    AUDIO_CAPTURE_UNAVAILABLE_MESSAGE,
  ];

  for (const notice of warningNotices) {
    assert.equal(getHypeCardNoticeTone(notice), 'warning', notice);
  }
});

test('audio capture failures explain why posting stopped without losing the selected original', () => {
  const failure = audioCaptureUnavailableError();
  assert.equal(failure.name, 'AudioCaptureUnavailable');
  assert.match(failure.message, /audio.*not posted/i);
  assert.match(failure.message, /original video is still selected on this device/i);
  assert.match(failure.message, /supported browser or on another device/i);
});

test('keeps representative Hype Card failures in the error treatment', () => {
  const errorNotices = [
    'Could not publish the interactive Hype Card.',
    'Failed to migrate project to cloud.',
    'Cloud draft saved, but media upload failed.',
    'The stats link could not be revoked.',
  ];

  for (const notice of errorNotices) {
    assert.equal(isHypeCardSuccessNotice(notice), false, notice);
    assert.equal(getHypeCardNoticeTone(notice), 'error', notice);
  }
});

test('renders green successes and amber warnings as polite statuses, and red failures as assertive alerts', () => {
  assert.match(editorSource, /noticeTone === 'success'[\s\S]*?'border-emerald-800 bg-emerald-700 text-white'/);
  assert.match(editorSource, /noticeTone === 'warning'[\s\S]*?'border-amber-700 bg-amber-300 text-amber-950'/);
  assert.match(editorSource, /:\s*'border-border bg-destructive text-destructive-foreground'/);
  assert.match(editorSource, /role=\{noticeTone === 'error' \? 'alert' : 'status'\}/);
  assert.match(editorSource, /aria-live=\{noticeTone === 'error' \? 'assertive' : 'polite'\}/);
  assert.match(editorSource, /data-tone=\{noticeTone\}/);
});