import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPremiumHypeCardArtwork, buildPremiumNavStripPreview, preparePremiumCardPngExport } from './premium-hype-card-artwork';
test('placement changes the original fallback as well as the cutout in every premium design', () => {
  for (const design of ['gallery', 'spotlight', 'breakout'] as const) {
    for (const cutoutUrl of [null, 'data:image/png;base64,AAAA']) {
      const input = { athleteName: 'Jordan', photoUrl: 'data:image/png;base64,AAAA', cutoutUrl, appearance: defaultCardAppearance(design) };
      const before = buildPremiumHypeCardArtwork(input);
      const moved = buildPremiumHypeCardArtwork({ ...input, appearance: { ...input.appearance, athleteX: .1, athleteY: .08, athleteScale: 1.2 } });
      const placement = /data-photo-placement="[^"]+" transform="([^"]+)"/;
      assert.ok(placement.test(before));
      assert.notEqual(before.match(placement)![1], moved.match(placement)![1]);
      assert.match(moved, /scale\(1.2\)/);
    }
  }
});
import { defaultCardAppearance } from './hype-card-appearance';

const base = { athleteName: 'A <b>&"', sport: 'Soccer', jerseyNumber: '01', cutoutUrl: 'data:image/png;base64,AAAA' };

test('escapes text and keeps viewBox', () => {
  const svg = buildPremiumHypeCardArtwork({ ...base, appearance: defaultCardAppearance('gallery') });
  assert.match(svg, /viewBox="0 0 1000 1400"/);
  assert.ok(!svg.includes('<b>'));
});
test('Gallery moves the name, details, and long team label down beneath the photo window', () => {
  const svg = buildPremiumHypeCardArtwork({
    athleteName: 'Jordan Alexander Matthews',
    teamName: 'The Eastside Hurricanes',
    appearance: defaultCardAppearance('gallery'),
  });
  assert.match(svg, /<text x="500" y="1123\.0"[^>]*>JORDAN ALEXANDER<\/text>/);
  assert.match(svg, /<text x="500" y="1221\.0"[^>]*>MATTHEWS<\/text>/);
  assert.match(svg, /<text x="90" y="1063"/);
  assert.match(svg, /<text x="500" y="1273"[^>]*>#01\s+\|\s+QUARTERBACK<\/text>/);
  assert.match(svg, /<line x1="90" y1="1327" x2="910" y2="1327"/);
});
test('the premium designer preview separates its dressed nav strip from the card artwork', () => {
  for (const design of ['gallery', 'spotlight', 'breakout'] as const) {
    const nav = buildPremiumNavStripPreview(defaultCardAppearance(design), 'test');
    assert.match(nav, /viewBox="0 1294 1000 68"/);
    assert.match(nav, new RegExp(`data-design="${design}"`));
    assert.match(nav, /REPLIES/);
    assert.match(nav, /STATS/);
    assert.match(nav, /TAPS/);
    assert.match(nav, /EVENTS/);
    assert.match(nav, /id="test-nav-export-nav"/);
    if (design === 'gallery') assert.match(nav, /fill="#F6EFE2"/, 'the detached Gallery strip retains its paper background');
    else assert.match(nav, /fill="#0B1A33" stroke="#fff"/, `${design} retains its dark nav dressing`);
    assert.doesNotMatch(buildPremiumHypeCardArtwork({ ...base, appearance: defaultCardAppearance(design) }), /id="export-nav"/);
  }
});
test('PNG export omits the navigation strip and preserves Breakout avatar spillover', () => {
  for (const design of ['gallery', 'spotlight', 'breakout'] as const) {
    const appearance = defaultCardAppearance(design);
    const art = buildPremiumHypeCardArtwork({ ...base, appearance });
    const png = preparePremiumCardPngExport(art, appearance, { width: 1024, height: 1024 });
    assert.doesNotMatch(png.markup, /export-nav|>EVENTS</);
    if (design === 'breakout') {
      assert.match(png.markup, /viewBox="0 0 1000 1400"/, 'a square source fitted into the frame needs no extra spillover area');
      assert.deepEqual({ width: png.width, height: png.height }, { width: 2000, height: 2800 });
      assert.match(png.markup, /data-photo-placement="cutout"/);
      const portrait = preparePremiumCardPngExport(art, appearance, { width: 770, height: 1020 });
      assert.match(portrait.markup, /viewBox="0 -242 1000 1642"/);
      assert.match(portrait.markup, /width="1000" height="1642"/);
      assert.deepEqual({ width: portrait.width, height: portrait.height }, { width: 2000, height: 3284 });
      const moved = preparePremiumCardPngExport(
        art,
        { ...appearance, athleteScale: 1.45, athleteY: -.18 },
        { width: 770, height: 1020 },
      );
      assert.ok(moved.height > portrait.height, 'top padding expands to preserve moved and enlarged avatars too');
    } else {
      assert.match(png.markup, /viewBox="0 0 1000 1400"/);
      assert.deepEqual({ width: png.width, height: png.height }, { width: 2000, height: 2800 });
    }
  }
});
test('Breakout keeps resized avatars intact outside the SVG card boundary', () => {
  for (const layer of ['all', 'fg'] as const) {
    const svg = buildPremiumHypeCardArtwork({ ...base, appearance: { ...defaultCardAppearance('breakout'), athleteScale: 1.45, athleteY: -.18 } }, layer);
    assert.match(svg, /<svg[^>]*overflow="visible"/);
    assert.match(svg, /<g data-card-layer="avatar"><g data-photo-placement="cutout"/);
    assert.match(svg, /preserveAspectRatio="xMidYMax meet"/);
  }
});
test('Breakout paints every frame layer below the avatar and the nameplate above it', () => {
  for (const layer of ['all', 'fg'] as const) {
    const svg = buildPremiumHypeCardArtwork({ ...base, appearance: defaultCardAppearance('breakout') }, layer);
    const avatar = svg.indexOf('data-card-layer="avatar"');
    const plate = svg.indexOf('data-card-layer="name-plate"');
    assert.ok(avatar >= 0 && plate > avatar);
    for (const frame of svg.matchAll(/data-card-layer="frame"/g)) assert.ok(frame.index < avatar);
  }
});
test('splits layers', () => {
  const appearance = defaultCardAppearance('spotlight');
  assert.ok(!buildPremiumHypeCardArtwork({ ...base, appearance }, 'bg').includes('data:image/png'));
  const fg = buildPremiumHypeCardArtwork({ ...base, appearance }, 'fg');
  assert.ok(fg.includes('data:image/png'));
  assert.ok(!fg.includes('s-venue'));
});
test('omits number when missing', () => {
  assert.ok(!buildPremiumHypeCardArtwork({ athleteName: 'X', appearance: defaultCardAppearance('spotlight') }, 'bg').includes('url(#s-numtex)'));
});

test('each layer is self-contained and fg has no bg venue', () => {
  for (const design of ['gallery', 'spotlight', 'breakout'] as const) {
    for (const layer of ['all', 'bg', 'fg'] as const) {
      const svg = buildPremiumHypeCardArtwork({ ...base, athleteName: 'Maximilian Alexander Thornberry-Wells', appearance: defaultCardAppearance(design) }, layer, 'n');
      const ids = new Set(Array.from(svg.matchAll(/\sid="([^"]+)"/g), (m) => m[1]));
      for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.has(m[1]), `${design}/${layer} missing ${m[1]}`);
      for (const m of svg.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `${design}/${layer} missing ${m[1]}`);
    }
  }
});

test('Breakout keeps only the metallic outer frame, with no blue frames behind it', () => {
  const input = { ...base, appearance: defaultCardAppearance('breakout') };
  const bg = buildPremiumHypeCardArtwork(input, 'bg');
  const fg = buildPremiumHypeCardArtwork(input, 'fg');
  assert.match(bg, /id="b-window"/);
  assert.match(bg, /<clipPath id="b-card"><rect x="18" y="18" width="964" height="1364" rx="62"\/><\/clipPath>/);
  assert.match(bg, /<clipPath id="b-interior"><rect x="29" y="29" width="942" height="1342" rx="51"\/><\/clipPath>/);
  assert.match(bg, /<g clip-path="url\(#b-interior\)">\s*<rect x="29" y="29" width="942" height="1342" rx="51" fill="url\(#b-stage\)"\/>/);
  assert.doesNotMatch(bg, /<rect width="1000" height="1400" fill="#061225"\/>/);
  assert.doesNotMatch(bg, /<rect x="18" y="18" width="964" height="1364" rx="62" fill="url\(#b-stage\)"\/>/);
  assert.match(bg, /<rect x="24" y="24" width="952" height="1352" rx="56" fill="none" stroke="url\(#b-metal\)" stroke-width="10"\/>/);
  assert.doesNotMatch(fg, /<rect x="108" y="150" width="784" height="820" rx="56" fill="none" stroke=/);
  assert.doesNotMatch(bg, /<rect x="45" y="92"|<rect x="68" y="115"/);
  assert.doesNotMatch(bg, /stroke="url\(#b-metal\)" stroke-width="28"/);
  assert.doesNotMatch(bg, /M20 1260H980V1400H20Z/);
  assert.match(fg, /data-photo-placement="cutout" transform=/);
  assert.match(fg, /<image href="data:image\/png;base64,AAAA" x="115" y="-210"/);
  assert.match(fg, /<path d="M116 934H884/);
});

test('Breakout exposes independent frame, avatar, and name plate layers', () => {
  const appearance = { ...defaultCardAppearance('breakout'), namePlateX: .08, namePlateY: -.04 };
  const bg = buildPremiumHypeCardArtwork({ ...base, appearance }, 'bg');
  const fg = buildPremiumHypeCardArtwork({ ...base, appearance }, 'fg');
  assert.match(bg, /data-card-layer="frame"/);
  assert.match(fg, /data-card-layer="frame"/);
  assert.match(fg, /data-card-layer="avatar"/);
  assert.match(fg, /data-card-layer="name-plate" transform="translate\(80\.0 -56\.0\)"/);

  const originalPhoto = buildPremiumHypeCardArtwork({
    ...base,
    photoUrl: 'data:image/png;base64,BBBB',
    appearance: { ...appearance, removeBackground: false },
  });
  assert.doesNotMatch(originalPhoto, /data-photo-placement="cutout"/);
  assert.match(originalPhoto, /data-photo-placement="original"/);
});
