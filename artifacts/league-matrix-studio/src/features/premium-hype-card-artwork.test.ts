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
    sport: 'Soccer',
    jerseyNumber: '01',
    position: 'Quarterback',
    cutoutUrl: 'data:image/png;base64,AAAA',
    appearance: defaultCardAppearance('gallery'),
  });
  assert.match(svg, /<text x="500" y="1185"[^>]*>JORDAN ALEXANDER<\/text>/);
  assert.match(svg, /<text x="500" y="1263.4"[^>]*>MATTHEWS<\/text>/);
  assert.match(svg, /<text x="90" y="1086"/);
  assert.match(svg, /<text x="500" y="1320"[^>]*>#01\s+\|\s+QUARTERBACK<\/text>/);
  assert.match(svg, /<line x1="90" y1="1327" x2="910" y2="1327"/);
  assert.ok(svg.indexOf('stroke-width="5"/>') < svg.indexOf('>SOCCER</text>')
    && svg.indexOf('>SOCCER</text>') < svg.indexOf('data-photo-placement="cutout"'),
  'the Gallery cutout overlays its frame and sport label');
  assert.match(svg, /<svg[^>]*overflow="visible"[^>]*data-design="gallery"/);
});
test('Gallery extends the photo frame below the avatar and fits short and wrapped names beneath it', () => {
  for (const athleteName of ['Kimberly', 'Jordan Alexander Matthews']) {
    for (const teamName of ['Falcons', 'The Eastside Hurricanes']) {
      for (const layer of ['all', 'bg', 'fg'] as const) {
        const svg = buildPremiumHypeCardArtwork({
          ...base, athleteName, teamName, position: 'Keeper',
          appearance: defaultCardAppearance('gallery'),
        }, layer);
        if (layer !== 'fg') {
          assert.match(svg, /data-gallery-photo-frame="true" x="90" y="160" width="820" height="880"/);
          assert.match(svg, /<clipPath[^>]*><rect x="90" y="160" width="820" height="880"/);
        }
        if (layer !== 'bg') {
          assert.match(svg, /<image[^>]*x="120" y="60" width="760" height="900"/,
            'avatar placement stays unchanged while the frame gains 80px below its feet');
          const identity = [...svg.matchAll(/<text x="500" y="([\d.]+)"[^>]*font-size="([\d.]+)"/g)];
          assert.ok(identity.length >= 2);
          for (const [, baseline, fontSize] of identity) {
            assert.ok(Number(baseline) - Number(fontSize) > 1058, 'identity stays below the taller frame');
            assert.ok(Number(baseline) <= 1320, 'identity fits inside the card');
          }
        }
      }
    }
  }
});
test('Gallery paints an opaque name container above the avatar in composed and foreground artwork', () => {
  const input = { ...base, athleteName: 'Kimberly', appearance: { ...defaultCardAppearance('gallery'), athleteY: .12 } };
  for (const layer of ['all', 'fg'] as const) {
    const svg = buildPremiumHypeCardArtwork(input, layer);
    const avatar = svg.indexOf('data-photo-placement="cutout"');
    const plate = svg.indexOf('data-card-layer="name-plate"');
    const name = svg.indexOf('>KIMBERLY</text>');
    assert.ok(avatar >= 0 && plate > avatar && name > plate, 'the name container and text paint over the avatar');
    assert.match(svg, /<rect x="60" y="1060" width="880" height="285" rx="28" fill="#F6EFE2"/,
      'the name container uses a solid ivory background to hide the lower avatar');
  }
  assert.doesNotMatch(buildPremiumHypeCardArtwork(input, 'bg'), /data-card-layer="name-plate"/);
});
test('Breakout fixes the name plate over the avatar and ignores legacy plate offsets', () => {
  const appearance = { ...defaultCardAppearance('breakout'), namePlateX: .08, namePlateY: -.04 };
  const svg = buildPremiumHypeCardArtwork({ ...base, athleteName: 'Kimberly', teamName: 'Hurricanes', appearance });
  const avatar = svg.indexOf('data-card-layer="avatar"');
  const plate = svg.indexOf('data-card-layer="name-plate"');
  assert.ok(avatar >= 0 && plate > avatar, 'the fixed name plate paints over the lower avatar');
  assert.match(svg, /data-card-layer="name-plate" data-position="fixed" transform="translate\(0 126\)" filter=/);
  const plateCenter = (934 + 1160) / 2 + 126;
  assert.equal(plateCenter, (150 + 820 + 1376) / 2, 'the nameplate center sits midway between the background graphic and card bottoms');
  assert.match(svg, /M116 934H884L924 978V1128/);
});
test('Spotlight keeps Gallery-style avatar placement and paints the full cutout over the frame', () => {
  const appearance = { ...defaultCardAppearance('spotlight'), athleteScale: 1.2, athleteX: .08, athleteY: -.04 };
  const svg = buildPremiumHypeCardArtwork({ ...base, logoUrl: 'https://example.com/logo.png', appearance });
  const frame = svg.indexOf('stroke-width="5"/>');
  const avatar = svg.indexOf('data-photo-placement="cutout"');
  const logo = svg.indexOf('preserveAspectRatio="xMinYMin meet"');
  const sport = svg.indexOf('>SOCCER</text>');
  const plate = svg.indexOf('<g filter="url(#s-plate)">');
  assert.ok(frame >= 0 && logo > frame && sport > logo && avatar > sport && plate > avatar, 'the avatar overlays the frame and sport label while the nameplate stays above the avatar');
  assert.match(svg, /<svg[^>]*overflow="visible"[^>]*data-design="spotlight"/);
  assert.match(svg, /<image href="data:image\/png;base64,AAAA" x="90" y="120" width="820" height="1130" preserveAspectRatio="xMidYMax meet"/);
  assert.match(svg, /translate\(580 1194\) scale\(1\.2\)/);
  assert.match(svg, /<rect x="70" y="1067" width="860" height="283" rx="28" fill="url\(#s-sheen\)"/);
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
test('PNG export omits navigation and preserves avatar spillover for every premium design', () => {
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
    } else if (design === 'gallery' || design === 'spotlight') {
      const enlarged = { ...appearance, athleteScale: 1.45, athleteY: -.18 };
      const movedArt = buildPremiumHypeCardArtwork({ ...base, appearance: enlarged });
      const spill = preparePremiumCardPngExport(movedArt, enlarged, { width: 770, height: 1020 });
      assert.match(spill.markup, /viewBox="0 -\d+ 1000 2\d{3}"/);
      assert.ok(spill.height > 2800, `${design} export expands to show the whole avatar`);
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
  assert.ok(!buildPremiumHypeCardArtwork({ athleteName: 'X', appearance: defaultCardAppearance('spotlight') }, 'bg').includes('data-jersey-number'));
});
test('Spotlight uses outlined Anton numerals behind the avatar without changing name typography', () => {
  for (const jerseyNumber of ['9', '10', '123']) {
    const input = { ...base, jerseyNumber, appearance: defaultCardAppearance('spotlight') };
    for (const layer of ['all', 'bg'] as const) {
      const svg = buildPremiumHypeCardArtwork(input, layer);
      assert.match(svg, /data-jersey-number="true"[^>]*font-family="'Anton'[^>]*font-weight="400"/);
      assert.match(svg, /data-jersey-number="true"[^>]*stroke="#F6EFE2"[^>]*stroke-width="8"[^>]*paint-order="stroke fill"/);
      const number = svg.match(/data-jersey-number="true"[^>]*y="([\d.]+)"[^>]*font-size="([\d.]+)"/)!;
      const visibleCenter = Number(number[1]) - Number(number[2]) * (1760 / 2048) / 2;
      const fg = buildPremiumHypeCardArtwork(input, 'fg');
      const plateTop = Number(fg.match(/<rect x="70" y="([\d.]+)"[^>]*data-spotlight-name-block="true"/)![1]);
      assert.ok(Math.abs(visibleCenter - (14 + plateTop) / 2) < .01, `${jerseyNumber} centers between the card top and name block`);
      assert.doesNotMatch(svg, /<g filter="url\(#[^"]*s-numtex\)">/);
      if (layer === 'all') {
        assert.ok(svg.indexOf('data-jersey-number') < svg.indexOf('data-photo-placement="cutout"'));
        assert.match(svg, /font-family="'Barlow Condensed'[^>]*font-weight="700"/);
      }
    }
    assert.doesNotMatch(buildPremiumHypeCardArtwork(input, 'fg'), /data-jersey-number/);
  }
  for (const design of ['gallery', 'breakout'] as const) {
    assert.doesNotMatch(buildPremiumHypeCardArtwork({ ...base, appearance: defaultCardAppearance(design) }), /font-family="'Anton'/);
  }
});
test('Spotlight number centering follows the height of short and wrapped name blocks', () => {
  for (const athleteName of ['Kimberly', 'Jordan Alexander Matthews']) {
    for (const jerseyNumber of ['9', '10', '123']) {
      const svg = buildPremiumHypeCardArtwork({ ...base, athleteName, jerseyNumber, appearance: defaultCardAppearance('spotlight') });
      const plateTop = Number(svg.match(/<rect x="70" y="([\d.]+)"[^>]*data-spotlight-name-block="true"/)![1]);
      const number = svg.match(/data-jersey-number="true"[^>]*y="([\d.]+)"[^>]*font-size="([\d.]+)"/)!;
      const center = Number(number[1]) - Number(number[2]) * (1760 / 2048) / 2;
      assert.ok(Math.abs(center - (14 + plateTop) / 2) < .01);
    }
  }
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

test('Breakout exposes frame and avatar controls while fixing the name plate above them', () => {
  const appearance = { ...defaultCardAppearance('breakout'), namePlateX: .08, namePlateY: -.04 };
  const bg = buildPremiumHypeCardArtwork({ ...base, appearance }, 'bg');
  const fg = buildPremiumHypeCardArtwork({ ...base, appearance }, 'fg');
  assert.match(bg, /data-card-layer="frame"/);
  assert.match(fg, /data-card-layer="frame"/);
  assert.match(fg, /data-card-layer="avatar"/);
  assert.match(fg, /data-card-layer="name-plate" data-position="fixed" transform="translate\(0 126\)"/);

  const originalPhoto = buildPremiumHypeCardArtwork({
    ...base,
    photoUrl: 'data:image/png;base64,BBBB',
    appearance: { ...appearance, removeBackground: false },
  });
  assert.doesNotMatch(originalPhoto, /data-photo-placement="cutout"/);
  assert.match(originalPhoto, /data-photo-placement="original"/);
});
