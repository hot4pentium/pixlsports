import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { defaultCardAppearance } from './hype-card-appearance';
import { buildPremiumHypeCardArtwork } from './premium-hype-card-artwork';

test('photo upload and design controls have no background-removal or cutout-upload tools', async () => {
  const photoManager = await readFile(new URL('./fan-card-photo-manager.tsx', import.meta.url), 'utf8');
  const editor = await readFile(new URL('./hype-card.tsx', import.meta.url), 'utf8');
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.doesNotMatch(photoManager, /removeAthleteBackground|saveAthleteCutout|processCutout|input-fan-card-cutout|button-retry-fan-card-cutout/);
  assert.doesNotMatch(editor, /removeAthleteBackground|preparePremiumCutout|button-retry-premium-cutout/);
  assert.match(photoManager, /await confirm\.mutateAsync/);
  assert.match(photoManager, /Your uploaded photo is ready to use/);
  assert.equal(packageJson.devDependencies['@huggingface/transformers'], undefined);
});

test('current card templates use the uploaded photo even when legacy cutout data exists', () => {
  const photoUrl = 'data:image/png;base64,T1JJR0lOQUw=';
  const cutoutUrl = 'data:image/png;base64,Q1VUT1VU';
  const svg = buildPremiumHypeCardArtwork({
    athleteName: 'Jordan',
    photoUrl,
    cutoutUrl,
    appearance: defaultCardAppearance('spotlight'),
  });
  assert.ok(svg.includes(photoUrl));
  assert.ok(!svg.includes(cutoutUrl));
});
