import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPremiumHypeCardArtwork } from './premium-hype-card-artwork';
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
