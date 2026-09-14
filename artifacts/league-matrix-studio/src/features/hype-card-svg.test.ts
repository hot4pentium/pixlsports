import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPositionBadgeMarkup, getPositionBadgeLayout } from './position-badge';

test('keeps short position labels in the compact top-right badge', () => {
  const layout = getPositionBadgeLayout('GK');
  const markup = buildPositionBadgeMarkup('GK', '#123456', '#abcdef');

  assert.equal(layout.width, 152);
  assert.equal(layout.x, 786);
  assert.equal(layout.right, 938);
  assert.equal(layout.fontSize, 19);
  assert.equal(layout.textLength, null);
  assert.match(markup, /<path d="M786 46 H938 V114 H804 L786 96 Z"/);
  assert.match(markup, /<text x="920" y="95"[^>]*font-size="19"[^>]*>GK<\/text>/);
});

test('expands longer position labels to the left while keeping the right edge fixed', () => {
  const shortLayout = getPositionBadgeLayout('GK');
  const longLayout = getPositionBadgeLayout('GOALKEEPER');
  const markup = buildPositionBadgeMarkup('GOALKEEPER', '#123456', '#abcdef');

  assert.ok(longLayout.width > shortLayout.width);
  assert.equal(longLayout.right, shortLayout.right);
  assert.ok(longLayout.x < shortLayout.x);
  assert.match(markup, new RegExp(`<path d="M${longLayout.x} 46 H${longLayout.right} V114 H${longLayout.x + 18} L${longLayout.x} 96 Z"`));
  assert.match(markup, />GOALKEEPER<\/text>/);
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