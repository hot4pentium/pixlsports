import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { hostedVideoBudgetBytes, isUsableHostedVideo, monotonicProgress } from './hype-card-share';

const shareSource = readFileSync(new URL('./hype-card-share.tsx', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('./hype-card-export.ts', import.meta.url), 'utf8');
const thumbnailSource = readFileSync(new URL('./video-thumbnail.ts', import.meta.url), 'utf8');

test('preparation progress starts visibly and never moves backward between phases', () => {
  assert.equal(monotonicProgress(0, 0.01), 0.01);
  assert.equal(monotonicProgress(0.35, 0.1), 0.35);
  assert.equal(monotonicProgress(0.35, 0.9), 0.9);
  assert.equal(monotonicProgress(0.9, Number.NaN), 0.9);
  assert.equal(monotonicProgress(0.9, 1.5), 1);
});

test('hosted clip budget stays well below the previous 35 MB limit', () => {
  assert.equal(hostedVideoBudgetBytes(8.36), 6_270_000);
  assert.equal(hostedVideoBudgetBytes(15), 10 * 1024 * 1024);
  assert.equal(hostedVideoBudgetBytes(1), 3 * 1024 * 1024);
});

test('rejects oversized clips and clips that recorded longer than the selected segment', () => {
  assert.equal(isUsableHostedVideo(17.3, 8.36, 34_968_460), false);
  assert.equal(isUsableHostedVideo(17.3, 8.36, 4_000_000), false);
  assert.equal(isUsableHostedVideo(8.36, 8.36, 34_968_460), false);
  assert.equal(isUsableHostedVideo(8.5, 8.36, 4_000_000), true);
  assert.equal(isUsableHostedVideo(8.5, 8.36, 0), false);
  assert.equal(isUsableHostedVideo(Number.NaN, 8.36, 4_000_000), false);
});

test('video preparation loads the first frame and bounds stalled local preparation steps', () => {
  assert.match(
    exportSource,
    /videoElement\.readyState < HTMLMediaElement\.HAVE_CURRENT_DATA[\s\S]*?videoElement\.muted = true;[\s\S]*?videoElement\.play\(\)[\s\S]*?Video preparation stalled while loading the first frame/,
  );
  assert.match(exportSource, /waitForMediaEvent\([\s\S]*?'loadeddata'/);
  assert.match(shareSource, /VIDEO_PREPARATION_STEP_TIMEOUT_MS = 10_000/);
  assert.match(shareSource, /Video preparation stalled while opening the selected segment/);
  assert.match(shareSource, /captureVideoThumbnail\(clipUrl, options\.signal\)/);
  assert.match(thumbnailSource, /video\.currentTime = Math\.max\(0\.01, time\)/);
});

test('hosted preparation activates one audio context before awaiting and passes it through verification', () => {
  const preparationStart = shareSource.indexOf('export async function prepareHypeCardShareMedia');
  const bootstrapPosition = shareSource.indexOf('createAudioCaptureSession()', preparationStart);
  const firstAwaitPosition = shareSource.indexOf('await ', preparationStart);

  assert.ok(bootstrapPosition > preparationStart);
  assert.ok(firstAwaitPosition > bootstrapPosition, 'AudioContext.resume() must start before the first await');
  assert.match(shareSource, /finally \{[\s\S]*?audioSession\.context\.close\(\)/);
  assert.match(shareSource, /audioSession,\s*\n\s*\},\s*\n\s*\);/);
  assert.match(exportSource, /hasAudibleAudioSamples\(blob, signal, audioSession\)/);
});