import assert from 'node:assert/strict';
import test from 'node:test';

import { isMostlyBlackImage } from './video-thumbnail';

test('detects blank black posters without rejecting real night-game frames', () => {
  const black = new Uint8ClampedArray(32 * 18 * 4);
  for (let i = 0; i < black.length; i += 4) {
    black[i] = 5;
    black[i + 1] = 7;
    black[i + 2] = 10;
    black[i + 3] = 255;
  }
  assert.equal(isMostlyBlackImage(black), true);

  const nightGame = new Uint8ClampedArray(black);
  for (let i = 0; i < nightGame.length * 0.04; i += 4) {
    nightGame[i] = 120;
    nightGame[i + 1] = 140;
    nightGame[i + 2] = 95;
  }
  assert.equal(isMostlyBlackImage(nightGame), false);
});