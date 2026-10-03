import assert from 'node:assert/strict';
import test from 'node:test';

import { hasUsableTransparency } from './hype-card-breakout-validation';

function rgbaFromAlpha(alphaValues: number[]) {
  const rgba = new Uint8Array(alphaValues.length * 4);
  alphaValues.forEach((alpha, index) => {
    rgba[index * 4] = 255;
    rgba[index * 4 + 3] = alpha;
  });
  return rgba;
}

test('accepts a cutout with clear background pixels and visible player pixels', () => {
  const alpha = Array(1_000).fill(255);
  alpha[0] = 0;
  alpha[1] = 0;

  assert.equal(hasUsableTransparency(rgbaFromAlpha(alpha), 50, 20), true);
});

test('rejects opaque photos, empty transparent images, and incomplete pixel buffers', () => {
  assert.equal(hasUsableTransparency(rgbaFromAlpha(Array(1_000).fill(255)), 50, 20), false);
  assert.equal(hasUsableTransparency(rgbaFromAlpha(Array(1_000).fill(0)), 50, 20), false);
  assert.equal(hasUsableTransparency(new Uint8Array([0, 0, 0, 0]), 2, 2), false);
  assert.equal(hasUsableTransparency(new Uint8Array(16), 1.5, 2), false);
});