import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSimpleHypeCardArtwork } from './simple-hype-card-artwork';

test('all three lower thirds retain a full photo, left logo and athlete identity', () => {
  const artwork = new Set<string>();
  for (const lowerThirdStyle of ['classic', 'split', 'angled']) {
    const svg = buildSimpleHypeCardArtwork({
      athleteName: 'Jordan Matthews', teamName: 'Eastside Falcons', jerseyNumber: '23',
      photoUrl: 'data:image/png;base64,photo', logoUrl: 'data:image/png;base64,logo', lowerThirdStyle,
    });
    assert.match(svg, /preserveAspectRatio="xMidYMid meet" data-testid="svg-card-photo"/);
    assert.match(svg, /x="22" y="20".*data-testid="svg-card-logo"/);
    assert.match(svg, /JORDAN MATTHEWS/);
    assert.match(svg, /EASTSIDE FALCONS/);
    assert.match(svg, />23<\/text>/);
    artwork.add(svg);
  }
  assert.equal(artwork.size, 3);
});

test('photo movement stays bounded, and unsafe text and URLs are escaped', () => {
  const svg = buildSimpleHypeCardArtwork({
    athleteName: '<script>alert(1)</script>', teamName: 'A & B', photoUrl: '" onload="bad',
    athleteX: 99, athleteY: -99, lowerThirdStyle: 'unknown',
  });
  assert.match(svg, /translate\(150.00 -111.60\)/);
  assert.match(svg, /data-lower-third="classic"/);
  assert.match(svg, /&lt;SCRIPT&gt;/);
  assert.match(svg, /A &amp; B/);
  assert.doesNotMatch(svg, /<script|href="" onload/);
  assert.match(buildSimpleHypeCardArtwork({ athleteName: 'Jordan Matthews' }), />JM<\/text>/);
});
