import assert from 'node:assert/strict';
import test from 'node:test';

import { getActiveCarouselIndex } from './athlete-video-carousel';

test('carousel activity uses container-relative positions', () => {
  assert.equal(getActiveCarouselIndex({
    scrollLeft: 640,
    clientWidth: 600,
    scrollWidth: 1800,
    containerLeft: 176,
    itemLefts: [-480, 180, 840],
  }), 1);
});

test('carousel activity selects the final partially aligned slide at the scroll limit', () => {
  assert.equal(getActiveCarouselIndex({
    scrollLeft: 1200,
    clientWidth: 600,
    scrollWidth: 1800,
    containerLeft: 176,
    itemLefts: [-1024, -364, 296],
  }), 2);
});