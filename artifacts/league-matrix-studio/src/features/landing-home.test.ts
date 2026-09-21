import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const landingSource = readFileSync(new URL('./landing-home.tsx', import.meta.url), 'utf8');
const landingStyles = readFileSync(new URL('../landing-unified.css', import.meta.url), 'utf8');
const landingPage = landingSource.slice(landingSource.indexOf('export function PublicLandingPage'));

test('landing athlete photos render as visible entrance-animated tiles below the hero actions', () => {
  assert.match(landingSource, /landing-sport-ticker-track/);
  assert.match(landingSource, /landing-sport-ticker-group/);
  assert.match(landingSource, /landing-sport-tile/);
  assert.match(landingSource, /landing-tile-delay/);
  assert.doesNotMatch(landingSource, /isDuplicate/);
  assert.deepEqual(
    [...landingSource.matchAll(/id: '([^']+)',\s+label: '([^']+)'/g)].map(([, id, label]) => [id, label]),
    [
      ['soccer', 'Soccer'],
      ['football', 'Football'],
      ['basketball', 'Basketball'],
      ['volleyball', 'Volleyball'],
      ['baseball', 'Baseball'],
      ['softball', 'Softball'],
    ],
  );
  assert.ok(
    landingPage.indexOf('data-testid="link-hero-explore-tools"')
      < landingPage.indexOf('<LandingSportShowcase />'),
  );
});

test('before-game-day guidance names the three intended actions', () => {
  assert.match(landingSource, /Build the schedule/);
  assert.match(landingSource, /Share your event card to keep others up to date/);
  assert.match(landingSource, /Prepare with the game day checklist/);
  assert.doesNotMatch(landingSource, /Build or import the schedule/);
  assert.doesNotMatch(landingSource, /Keep locations and times current/);
});

test('before-game-day guidance includes the uploaded checklist video', () => {
  assert.match(landingSource, /Plan-Checklist_phone_1789955681318\.mp4/);
  assert.match(landingSource, /Plan-Checklist_phone-poster_1789955681318\.webp/);
  assert.match(landingSource, /<video/);
  assert.match(landingSource, /autoPlay/);
  assert.match(landingSource, /autoPlay=\{!prefersReducedMotion\}/);
  assert.doesNotMatch(landingSource, /\scontrols(?:\s|>|=)/);
  assert.match(landingSource, /playsInline/);
  assert.match(landingSource, /usePrefersReducedMotion/);
});

test('checklist video uses the phone crop without a native player shell', () => {
  assert.match(landingStyles, /\.landing-checklist-video \{[\s\S]*aspect-ratio: 760 \/ 1080;/);
  assert.match(landingStyles, /\.landing-checklist-video \{[\s\S]*overflow: hidden;[\s\S]*border-radius: 1\.5rem;/);
  assert.match(landingStyles, /\.landing-checklist-video \{[\s\S]*mix-blend-mode: multiply;/);
  assert.match(landingSource, /landing-before-game-day-title/);
  assert.match(landingSource, /flex flex-col gap-8 sm:gap-10/);
  assert.match(landingSource, /bg-landing-pale-blue/);
  assert.match(landingSource, /bg-\[#FFF1EA\]/);
});

test('landing athlete photos stay visible in a responsive grid and respect reduced motion', () => {
  assert.match(landingStyles, /\.landing-sport-ticker \{[\s\S]*overflow: visible;/);
  assert.match(landingStyles, /\.landing-sport-ticker-group \{[\s\S]*display: grid;/);
  assert.match(landingStyles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(landingStyles, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(landingStyles, /@keyframes landing-sport-tile-rubberband/);
  assert.match(landingStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(landingStyles, /animation-delay: var\(--landing-tile-delay\)/);
});