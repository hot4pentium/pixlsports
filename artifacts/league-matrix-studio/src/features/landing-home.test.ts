import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const landingSource = readFileSync(new URL('./landing-home.tsx', import.meta.url), 'utf8');
const landingStyles = readFileSync(new URL('../landing-unified.css', import.meta.url), 'utf8');
const landingPage = landingSource.slice(landingSource.indexOf('export function PublicLandingPage'));

test('landing athlete photos render as a compact duplicated ticker below the hero actions', () => {
  assert.match(landingSource, /landing-sport-ticker-track/);
  assert.match(landingSource, /landing-sport-ticker-group/);
  assert.match(landingSource, /landing-sport-tile/);
  assert.match(landingSource, /aria-hidden=\{isDuplicate\}/);
  assert.ok(
    landingPage.indexOf('data-testid="link-hero-explore-tools"')
      < landingPage.indexOf('<LandingSportShowcase />'),
  );
});

test('landing athlete ticker protects the page width and respects reduced motion', () => {
  assert.match(landingStyles, /\.landing-sport-ticker \{[\s\S]*overflow: hidden;/);
  assert.match(landingStyles, /\.landing-sport-tile \{[\s\S]*flex: 0 0 clamp/);
  assert.match(landingStyles, /@keyframes landing-sport-ticker-scroll/);
  assert.match(landingStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(landingStyles, /\.landing-sport-ticker:hover \.landing-sport-ticker-track/);
});