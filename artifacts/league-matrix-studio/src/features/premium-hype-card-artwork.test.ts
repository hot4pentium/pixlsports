import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPremiumHypeCardArtwork } from './premium-hype-card-artwork';
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
  for (const design of ['gallery', 'spotlight'] as const) {
    for (const layer of ['all', 'bg', 'fg'] as const) {
      const svg = buildPremiumHypeCardArtwork({ ...base, athleteName: 'Maximilian Alexander Thornberry-Wells', appearance: defaultCardAppearance(design) }, layer, 'n');
      const ids = new Set(Array.from(svg.matchAll(/\sid="([^"]+)"/g), (m) => m[1]));
      for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.has(m[1]), `${design}/${layer} missing ${m[1]}`);
      for (const m of svg.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `${design}/${layer} missing ${m[1]}`);
    }
  }
});
