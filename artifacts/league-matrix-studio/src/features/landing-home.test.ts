import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./landing-home.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../landing-unified.css', import.meta.url), 'utf8');
const fanCard = readFileSync(new URL('./living-athlete-card.tsx', import.meta.url), 'utf8');
const gameOn = readFileSync(new URL('./game-on-card.tsx', import.meta.url), 'utf8');
const graphicMaker = readFileSync(new URL('./hype-card-preview.tsx', import.meta.url), 'utf8');

test('landing follows the concept with real product renderers and fictional examples', () => {
  for (const section of ['hero', 'week-ribbon', 'week-section', 'athlete-section', 'tools-section', 'closing', 'site-footer']) {
    assert.match(source, new RegExp(`className="${section}"`));
  }
  for (const step of ['Plan', 'Prep', 'Follow', 'Celebrate']) {
    assert.match(source, new RegExp(`title: '${step}'`));
  }
  assert.match(source, /Product preview · Fictional/);
  assert.match(source, /candidAthlete/);
  assert.match(source, /<LivingAthleteCardFront athleteName="Maya Rivera"/);
  assert.match(fanCard, /<LivingAthleteCardFront/);
  assert.match(source, /<PublicGameOnCardFrontFace/);
  assert.match(gameOn, /<PublicGameOnCardFrontFace/);
  assert.match(source, /<PreviewArtwork project=\{sampleProject\}/);
  assert.match(graphicMaker, /buildHypeCardSvg\(project/);
  assert.ok(existsSync(new URL('../assets/landing-candid-athlete.jpg', import.meta.url)));
  assert.doesNotMatch(source, /Hero athlete photo|Replace with a real PIXL|screenshot containing|\.pdf['"]|ADD PLAYER MEDIA/);
});

test('visitor actions use real destinations and preserve the explainer', () => {
  assert.match(source, /isSignedIn \? '\/studio' : '\/sign-up'/);
  assert.match(source, /isSignedIn \? '\/studio' : '\/sign-in'/);
  for (const anchor of ['how-it-works', 'athlete-cards', 'tools']) {
    assert.match(source, new RegExp(`id="${anchor}"`));
    assert.match(source, new RegExp(`href="#${anchor}"`));
  }
  for (const path of ['/help', '/privacy']) assert.ok(source.includes(`href="${path}"`));
  assert.match(source, /week-path-explainer\.mp4/);
  assert.doesNotMatch(source, /pricing|#pricing/i);
});

test('mobile navigation and accessibility basics are built in', () => {
  assert.match(source, /aria-expanded=\{menuOpen\}/);
  assert.match(source, /aria-controls="landing-mobile-menu"/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /candidAthlete from '@\/assets\/landing-candid-athlete\.jpg'/);
  assert.match(source, /fetchPriority="high"/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /@media \(max-width: 700px\)/);
});