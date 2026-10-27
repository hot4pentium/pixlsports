import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSimpleHypeCardArtwork } from './simple-hype-card-artwork';
import { HYPE_CARD_TEMPLATE_IDS } from './hype-card-template-artwork';

test('no-photo placeholders retain the silhouette and nameplate without player initials', () => {
  for (const design of [...HYPE_CARD_TEMPLATE_IDS, undefined]) {
    for (const athleteName of ['Billy', 'Billy King', '']) {
      const svg = buildSimpleHypeCardArtwork({ athleteName, design });
      assert.match(svg, /<circle cx="(?:450|300)" cy="(?:460|345)" r="(?:155|100)"/);
      assert.doesNotMatch(svg, /<text\b[^>]*>\s*(?:B|BK|P)\s*<\/text>/);
      if (athleteName) {
        const labels = Array.from(svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g), (match) => match[1].toLowerCase());
        assert.ok(labels.includes(athleteName.toLowerCase()), `${design ?? 'legacy'} should retain the nameplate`);
      }
    }
  }
});

test('all lower-third choices retain the photo, left logo and athlete identity', () => {
  const artwork = new Set<string>();
  for (const lowerThirdStyle of ['classic', 'split', 'angled', 'none']) {
    const svg = buildSimpleHypeCardArtwork({
      athleteName: 'Jordan Matthews', teamName: 'Eastside Falcons', jerseyNumber: '23', position: 'Forward',
      photoUrl: 'data:image/png;base64,photo', logoUrl: 'data:image/png;base64,logo', lowerThirdStyle,
    });
    assert.match(svg, /preserveAspectRatio="xMidYMid meet" data-testid="svg-card-photo"/);
    assert.match(svg, /viewBox="0 0 600 900"/);
    assert.match(svg, /<image href="data:image\/png;base64,photo" x="0" y="0" width="600" height="900"/);
    assert.match(svg, /x="22" y="20".*data-testid="svg-card-logo"/);
    assert.match(svg, /JORDAN MATTHEWS/);
    assert.match(svg, /EASTSIDE FALCONS/);
    assert.match(svg, /data-testid="svg-card-position"[^>]*>FORWARD<\/text>/);
    assert.match(svg, />23<\/text>/);
    if (lowerThirdStyle === 'classic') {
      assert.match(svg, /<rect y="720" width="600" height="180"/);
    }
    if (lowerThirdStyle === 'none') {
      assert.match(svg, /data-lower-third="none"/);
      assert.doesNotMatch(svg, /<rect y="720" width="600" height="180"/);
    }
    artwork.add(svg);
  }
  assert.equal(artwork.size, 4);
});

test('photo movement stays bounded, and unsafe text and URLs are escaped', () => {
  const svg = buildSimpleHypeCardArtwork({
    athleteName: '<script>alert(1)</script>', teamName: 'A & B', photoUrl: '" onload="bad',
    athleteX: 99, athleteY: -99, lowerThirdStyle: 'unknown',
  });
  assert.match(svg, /translate\(150.00 -162.00\)/);
  assert.match(svg, /data-lower-third="classic"/);
  assert.match(svg, /&lt;SCRIPT&gt;/);
  assert.match(svg, /A &amp; B/);
  assert.doesNotMatch(svg, /<script|href="" onload/);
  assert.doesNotMatch(buildSimpleHypeCardArtwork({ athleteName: 'Jordan Matthews' }), />JM<\/text>/);
});

test('the simplified public-card renderer uses a selected frame and independent lower third', () => {
  const svg = buildSimpleHypeCardArtwork({
    athleteName: 'Jordan Matthews',
    teamName: 'River City Falcons',
    jerseyNumber: '27',
    position: 'Forward',
    photoUrl: 'data:image/png;base64,athlete-photo',
    design: 'pixel-edge',
    lowerThirdTemplate: 'glass',
    athleteX: .1,
    athleteY: -.05,
    athleteScale: 1.2,
  }, 'template-test');
  assert.match(svg, /width="900" height="1200" viewBox="0 0 900 1200"/);
  assert.match(svg, /data-frame-template="pixel-edge" data-lower-third-template="glass"/);
  assert.match(svg, /href="data:image\/png;base64,athlete-photo"/);
  assert.match(svg, /transform="translate\(90 -60\)"/);
  assert.match(svg, /data-testid="svg-card-jersey-number">27<\/text>/);
});
