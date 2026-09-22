import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const landingSource = readFileSync(new URL('./landing-home.tsx', import.meta.url), 'utf8');
const landingStyles = readFileSync(new URL('../landing-unified.css', import.meta.url), 'utf8');
const landingPage = landingSource.slice(landingSource.indexOf('export function PublicLandingPage'));

test('uploaded sports banner replaces the photo grid below the hero actions', () => {
  assert.match(landingSource, /homepagesportsbanner_1790120971871\.png/);
  assert.match(landingSource, /data-testid="landing-sports-banner"/);
  assert.doesNotMatch(landingSource, /landing-sport-tile/);
  assert.match(landingSource, /soccer, football, basketball, volleyball, baseball, and softball/);
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

test('landing tool benefit previews are informational rather than clickable', () => {
  assert.doesNotMatch(landingSource, /href="\/studio\/schedule"/);
  assert.doesNotMatch(landingSource, /href="\/studio\/checklist"/);
  assert.doesNotMatch(landingSource, /href="\/studio\/stat-tracker"/);
  assert.doesNotMatch(landingSource, /href="\/studio\/hype-card"/);
  assert.match(landingSource, /data-testid="preview-schedule"/);
  assert.match(landingSource, /data-testid="preview-checklist"/);
  assert.match(landingSource, /data-testid="preview-stat-tracker"/);
  assert.match(landingSource, /data-testid="preview-hype-card"/);
});

test('before-game-day guidance includes the uploaded checklist video', () => {
  assert.match(landingSource, /Officialprep_1789962901507\.mp4/);
  assert.match(landingSource, /Officialprep_1789962901507-poster\.webp/);
  assert.match(landingSource, /<video/);
  assert.match(landingSource, /autoPlay/);
  assert.match(landingSource, /autoPlay=\{!prefersReducedMotion\}/);
  assert.doesNotMatch(landingSource, /\scontrols(?:\s|>|=)/);
  assert.match(landingSource, /playsInline/);
  assert.match(landingSource, /usePrefersReducedMotion/);
});

test('checklist video uses the phone crop without a native player shell', () => {
  assert.match(landingStyles, /\.landing-checklist-video \{[\s\S]*aspect-ratio: 760 \/ 1080;/);
  assert.match(landingSource, /landing-checklist-video w-full max-w-\[240px\] object-cover/);
  assert.match(landingStyles, /\.landing-checklist-video \{[\s\S]*overflow: hidden;[\s\S]*border-radius: 1\.5rem;/);
  assert.doesNotMatch(landingStyles, /mix-blend-mode: multiply;/);
  assert.match(landingSource, /landing-before-game-day-title/);
  assert.match(landingSource, /flex flex-col gap-8 sm:gap-10/);
  assert.match(landingSource, /bg-landing-pale-blue/);
  assert.match(landingSource, /bg-\[#FFF1EA\]/);
});

test('banner stays full width on desktop and scrolls within its own region on phones', () => {
  assert.match(landingStyles, /\.landing-sports-banner-scroll \{[\s\S]*overflow-x: auto;/);
  assert.match(landingStyles, /\.landing-sports-banner \{[\s\S]*width: 100%;/);
  assert.match(landingStyles, /@media \(max-width: 767px\) \{[\s\S]*\.landing-sports-banner \{[\s\S]*width: 900px;/);
  assert.match(landingSource, /role="region" aria-label="Supported sports banner" tabIndex=\{0\}/);
  assert.match(landingSource, /Swipe to see all six sports/);
});

test('landing neutral sections use a subtle moving texture with a reduced-motion fallback', () => {
  assert.match(landingStyles, /\.new-landing > main > section\.bg-landing-bg::before \{[\s\S]*background-image:/);
  assert.match(landingStyles, /\.new-landing > main > section\.bg-landing-bg::before \{[\s\S]*animation: landing-background-drift 38s/);
  assert.match(landingStyles, /@keyframes landing-background-drift/);
  assert.match(landingStyles, /\.new-landing > main > section\.bg-landing-bg > \* \{[\s\S]*z-index: 1;/);
  assert.match(landingStyles, /\.new-landing > main > section\.bg-landing-bg::before \{[\s\S]*animation: none;/);
});
