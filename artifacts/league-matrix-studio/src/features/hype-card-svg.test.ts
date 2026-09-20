import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPositionBadgeMarkup, getPositionBadgeLayout } from './position-badge';
import { buildStadiumCardClipMarkup, buildStadiumLowerThirdTextMarkup } from './hype-card-geometry';
import { getDimensions } from './hype-card-types';

test('portrait stadium cards fill the full output height', () => {
  assert.match(
    buildStadiumCardClipMarkup('full-height'),
    /<clipPath id="stadiumCardClip-full-height"><rect x="8" y="8" width="984" height="1384" rx="46"\/><\/clipPath>/,
  );
});

test('landscape output preserves a wide video frame and its canvas ratio', () => {
  const dimensions = getDimensions('landscape');

  assert.deepEqual(dimensions, { width: 1920, height: 1080 });
  assert.equal(dimensions.width / dimensions.height, 16 / 9);
});

test('lower third keeps player details without the graphic panel', () => {
  const markup = buildStadiumLowerThirdTextMarkup({
    player: 'JORDAN SMITH',
    details: 'EASTSIDE FALCONS',
    playerSize: 76,
    detailsSize: 23,
    accent: '#f5c94d',
    ns: 'text-only',
  });

  assert.match(markup, /aria-label="Lower third text"/);
  assert.match(markup, />JORDAN SMITH<\/text>/);
  assert.match(markup, />EASTSIDE FALCONS<\/text>/);
  assert.doesNotMatch(markup, /<rect|lowerBar|accent rails|divider/);
});

test('lower third text can be omitted when no details were entered', () => {
  const markup = buildStadiumLowerThirdTextMarkup({
    player: '',
    details: '',
    playerSize: 0,
    detailsSize: 0,
    accent: '#f5c94d',
    ns: 'empty-text',
  });

  assert.doesNotMatch(markup, />[^<]+<\/text>/);
});

test('keeps short position labels in the compact top-right badge', () => {
  const layout = getPositionBadgeLayout('GK');
  const markup = buildPositionBadgeMarkup('GK', '#123456', '#abcdef');

  assert.equal(layout.width, 152);
  assert.equal(layout.x, 786);
  assert.equal(layout.right, 938);
  assert.equal(layout.textX, 871);
  assert.equal(layout.fontSize, 19);
  assert.equal(layout.textLength, null);
  assert.match(markup, /<path d="M786 46 H938 V114 H804 L786 96 Z"/);
  assert.match(markup, /<text x="871" y="95" text-anchor="middle"[^>]*font-size="19"[^>]*>GK<\/text>/);
});

test('expands longer position labels to the left while keeping the right edge fixed', () => {
  const shortLayout = getPositionBadgeLayout('GK');
  const longLayout = getPositionBadgeLayout('GOALKEEPER');
  const markup = buildPositionBadgeMarkup('GOALKEEPER', '#123456', '#abcdef');

  assert.ok(longLayout.width > shortLayout.width);
  assert.equal(longLayout.right, shortLayout.right);
  assert.ok(longLayout.x < shortLayout.x);
  assert.ok(longLayout.textX < shortLayout.textX);
  assert.equal(longLayout.textX, (longLayout.x + 18 + longLayout.right) / 2);
  assert.match(markup, new RegExp(`<path d="M${longLayout.x} 46 H${longLayout.right} V114 H${longLayout.x + 18} L${longLayout.x} 96 Z"`));
  assert.match(markup, /text-anchor="middle"[^>]*>GOALKEEPER<\/text>/);
});

test('compresses very long position labels inside the maximum badge width', () => {
  const position = 'CENTER BACK DEFENSIVE MIDFIELDER EXTRAORDINARY';
  const layout = getPositionBadgeLayout(position);
  const markup = buildPositionBadgeMarkup(position, '#123456', '#abcdef');

  assert.equal(layout.width, 310);
  assert.equal(layout.x, 628);
  assert.equal(layout.right, 938);
  assert.equal(layout.textLength, layout.maxTextWidth);
  assert.match(
    markup,
    new RegExp(
      `font-size="${layout.fontSize}"[^>]*textLength="${layout.textLength}" lengthAdjust="spacingAndGlyphs"`,
    ),
  );
  assert.match(markup, />CENTER BACK DEFENSIVE MIDFIELDER EXTRAORDINARY<\/text>/);
});