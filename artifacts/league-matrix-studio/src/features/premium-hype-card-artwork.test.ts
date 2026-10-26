import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultCardAppearance, normalizeCardAppearance } from './hype-card-appearance';
import { HYPE_CARD_SELECTABLE_TEMPLATES, HYPE_CARD_TEMPLATES } from './hype-card-template-artwork';
import { buildPremiumHypeCardArtwork, preparePremiumCardPngExport } from './premium-hype-card-artwork';

const base = {
  athleteName: 'Jordan Matthews',
  teamName: 'River City Falcons',
  jerseyNumber: '27',
  position: 'Forward',
  photoUrl: 'data:image/png;base64,AAAA',
  brandLogoUrl: 'data:image/png;base64,TE9HTw==',
};

test('all six supplied templates render as 3:4 cards with editable athlete details', () => {
  assert.deepEqual(HYPE_CARD_TEMPLATES.map(({ id }) => id), [
    'velocity', 'wave', 'glass', 'varsity', 'spotlight', 'pixel-edge',
  ]);
  for (const template of HYPE_CARD_TEMPLATES) {
    const appearance = defaultCardAppearance(template.id);
    const svg = buildPremiumHypeCardArtwork({ ...base, appearance }, 'all', `test-${template.id}`);
    assert.match(svg, /width="900" height="1200" viewBox="0 0 900 1200"/);
    assert.match(svg, new RegExp(`data-frame-template="${template.id}"`));
    assert.match(svg, new RegExp(`data-lower-third-template="${template.id}"`));
    assert.match(svg, /data-testid="svg-card-photo"/);
    assert.match(svg, /preserveAspectRatio="xMidYMid slice"/);
    assert.match(svg, /data-testid="svg-card-athlete-name">JORDAN MATTHEWS<\/text>/);
    assert.match(svg, /data-testid="svg-card-position">FORWARD<\/text>/);
    assert.match(svg, /data-testid="svg-card-jersey-number">27<\/text>/);
    assert.match(svg, /data-testid="svg-card-logo"/);
    assert.match(svg, /data-testid="text-hype-card-watermark">HYPE Card<\/text>/);
    assert.match(svg, /opacity="\.5" data-testid="text-hype-card-watermark"/);
    assert.match(svg, new RegExp(`id="test-${template.id}-card-clip"`));
    assert.match(svg, new RegExp(`id="test-${template.id}-lower-third-safe-clip"`));
    assert.match(svg, new RegExp(`<g clip-path="url\\(#test-${template.id}-card-clip\\)"><g clip-path="url\\(#test-${template.id}-lower-third-safe-clip\\)">`));
  }
});

test('rounded card layers keep lower thirds inside the card silhouette', () => {
  const svg = buildPremiumHypeCardArtwork({
    ...base,
    appearance: defaultCardAppearance('spotlight'),
  }, 'all', 'round-safe');
  assert.match(svg, /id="round-safe-card-clip"><rect x="0" y="0" width="900" height="1200" rx="54"\/>/);
  assert.match(svg, /id="round-safe-lower-third-safe-clip"><rect x="28" y="28" width="844" height="1144" rx="48"\/>/);
  assert.match(svg, /<g clip-path="url\(#round-safe-card-clip\)"><g clip-path="url\(#round-safe-lower-third-safe-clip\)">/);
});

test('Pixel Edge remains renderable for saved cards but is not offered as a new design', () => {
  assert.deepEqual(HYPE_CARD_SELECTABLE_TEMPLATES.map(({ id }) => id), [
    'velocity', 'wave', 'glass', 'varsity', 'spotlight',
  ]);
  const savedPixelEdge = buildPremiumHypeCardArtwork({
    ...base,
    appearance: defaultCardAppearance('pixel-edge'),
  });
  assert.match(savedPixelEdge, /data-frame-template="pixel-edge"/);
  assert.match(savedPixelEdge, /data-testid="svg-card-logo"/);
  assert.match(savedPixelEdge, /data-testid="text-hype-card-watermark">HYPE Card<\/text>/);
});

test('each frame can be combined with every lower-third template independently', () => {
  for (const frame of HYPE_CARD_TEMPLATES) {
    for (const lowerThird of HYPE_CARD_TEMPLATES) {
      const appearance = normalizeCardAppearance({
        ...defaultCardAppearance(frame.id),
        lowerThirdTemplate: lowerThird.id,
      });
      const svg = buildPremiumHypeCardArtwork({ ...base, appearance }, 'all', `pair-${frame.id}-${lowerThird.id}`);
      assert.match(svg, new RegExp(`data-frame-template="${frame.id}"`));
      assert.match(svg, new RegExp(`data-lower-third-template="${lowerThird.id}"`));
    }
  }
});

test('photo pan and zoom are preserved in the shared 3:4 photo layer', () => {
  const appearance = {
    ...defaultCardAppearance('wave'),
    athleteX: .1,
    athleteY: -.08,
    athleteScale: 1.2,
  };
  const svg = buildPremiumHypeCardArtwork({ ...base, appearance }, 'bg', 'positioned');
  assert.match(svg, /data-photo-placement="true"/);
  assert.match(svg, /transform="translate\(90 -96\)"/);
  assert.match(svg, /x="-90\.00" y="-120\.00" width="1080\.00" height="1440\.00"/);
  assert.doesNotMatch(svg, /svg-card-athlete-name|svg-card-position|svg-card-jersey-number/);
});

test('layered artwork keeps frame, lower third, photo, and editable text on the correct layers', () => {
  const appearance = {
    ...defaultCardAppearance('pixel-edge'),
    lowerThirdTemplate: 'glass' as const,
  };
  const bg = buildPremiumHypeCardArtwork({ ...base, appearance }, 'bg', 'layered');
  const fg = buildPremiumHypeCardArtwork({ ...base, appearance }, 'fg', 'layered');
  assert.match(bg, /data-layer="bg"/);
  assert.match(bg, /svg-card-photo/);
  assert.doesNotMatch(bg, /svg-card-athlete-name|svg-card-jersey-number|stroke="#087DFF"/);
  assert.doesNotMatch(bg, /svg-card-logo|text-hype-card-watermark/);
  assert.match(fg, /data-layer="fg"/);
  assert.doesNotMatch(fg, /data:image\/png;base64,AAAA/);
  assert.match(fg, /svg-card-athlete-name/);
  assert.match(fg, /svg-card-jersey-number/);
  assert.match(fg, /svg-card-logo/);
  assert.match(fg, /text-hype-card-watermark/);
  assert.match(fg, /id="layered-glass"/);
});

test('custom colors, escaped text, missing numbers, and PNG sizing are safe', () => {
  const appearance = {
    ...defaultCardAppearance('velocity'),
    borderColor: '#123456',
    accentColor: '#654321',
  };
  const svg = buildPremiumHypeCardArtwork({
    ...base,
    athleteName: 'A <B>&"',
    jerseyNumber: '',
    appearance,
  }, 'all', 'safe');
  assert.match(svg, /A &lt;B&gt;&amp;&quot;/);
  assert.doesNotMatch(svg, /data-testid="svg-card-jersey-number"/);
  assert.match(svg, /#123456/);
  assert.match(svg, /#654321/);
  const png = preparePremiumCardPngExport(svg, appearance);
  assert.deepEqual({ width: png.width, height: png.height }, { width: 1800, height: 2400 });
  assert.equal(png.markup, svg);

  const longName = buildPremiumHypeCardArtwork({
    ...base,
    athleteName: 'W'.repeat(100),
    appearance,
  });
  assert.equal((longName.match(/data-athlete-name-line="true"/g) ?? []).length, 2);
  assert.match(longName, /font-size="14\.39" font-weight="800"/);
});
