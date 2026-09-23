import assert from 'node:assert/strict';
import test from 'node:test';

import { hostedVideoBudgetBytes, isUsableHostedVideo } from './hype-card-share';

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