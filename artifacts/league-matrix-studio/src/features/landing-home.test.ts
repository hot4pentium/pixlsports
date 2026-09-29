import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./landing-home.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../landing-unified.css', import.meta.url), 'utf8');

test('landing shows the dashboard in mobile and landscape with fictional examples', () => {
  assert.match(source, /data-testid="text-landing-headline">ALL IN,<br \/><em>ALL SEASON\.<\/em><\/h1>/);
  assert.doesNotMatch(source, /For the people in their corner|Your front<br \/>row\./);
  for (const capability of [
    'One link for the season',
    "Share your athlete's HYPE Card with fans!",
    "That's all they need to stay in the game.",
    'Share game details',
    'Get ready together',
    'Opt in to Event Card reminders',
    'HYPE Card',
    'public Event Card link',
    'checklist edit link',
    'manual follower announcements',
  ]) {
    assert.ok(source.includes(capability), `landing should explain ${capability}`);
  }
  assert.doesNotMatch(source, /name: 'Schedule Maker'|name: 'Gameday Checklist'|name: 'Stat Tracker'/);
  assert.match(source, /data-testid="landing-capability-highlights"/);
  for (const section of ['hero', 'week-ribbon', 'week-section', 'offline-section', 'athlete-section', 'tools-section', 'closing', 'site-footer']) {
    assert.match(source, new RegExp(`className="${section}"`));
  }
  const offline = source.indexOf('data-testid="landing-offline-section"');
  const hypeCard = source.indexOf('id="athlete-cards"');
  assert.ok(offline >= 0 && hypeCard > offline, 'offline guidance should appear above the HYPE Card section');
  for (const message of [
    'Game details, ready',
    'Reopen game details and checklists you’ve already loaded on this device.',
    'Check off prep items offline. Shared checklist edits stay here and may need Retry to sync to collaborators.',
    'Record game stats locally. Completed results stay here and can be retried when service returns.',
    'Saved on this device',
    'Retry cloud sync when you’re back online if prompted',
    'On iPhone, tap Share, then Add to Home Screen.',
    'On Android, open your browser menu and choose Install app or Add to Home screen.',
    'Open PIXL online and load each game and checklist you’ll need. This will give you the full benefit of PIXL Sports, with offline content saved on this device.',
    'Creating or updating Event Card shares, fetching new replies, and sending alerts need a connection.',
  ]) assert.ok(source.includes(message), `offline section should explain ${message}`);
  assert.doesNotMatch(source, /Will sync when connected/);
  assert.match(styles, /offline-grid \{[^}]*grid-template-columns/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*offline-grid \{grid-template-columns:1fr/);
  assert.match(styles, /offline-install-note \{[^}]*border-left/);
  for (const step of ['Plan', 'Prep', 'Follow', 'Celebrate']) {
    assert.match(source, new RegExp(`title: '${step}'`));
  }
  assert.match(source, /Product preview · Fictional/);
  assert.match(source, /DashboardPreview variant="mobile"/);
  assert.match(source, /DashboardPreview variant="landscape"/);
  assert.match(source, /Your athlete’s week/);
  assert.ok(existsSync(new URL('../assets/landing-dashboard-mobile.png', import.meta.url)));
  assert.ok(existsSync(new URL('../assets/landing-dashboard-landscape.png', import.meta.url)));
  assert.doesNotMatch(source, /Make game day feel real|Share the excitement/);
  assert.doesNotMatch(source, /Hero athlete photo|Replace with a real PIXL|screenshot containing|\.pdf['"]|ADD PLAYER MEDIA/);
});

test('Hype Card copy comes before its preview on phones without changing the desktop columns', () => {
  const copy = source.indexOf('<div className="athlete-copy">');
  const preview = source.indexOf('<AthletePreview />');
  assert.ok(copy >= 0 && preview > copy);
  assert.match(styles, /athlete-grid \{[^}]*grid-template-areas: "preview copy"/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*athlete-grid \{[^}]*grid-template-areas:"copy" "preview"/);
  assert.match(styles, /capability-highlight-list \{[^}]*grid-template-columns: repeat\(4/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*capability-highlight-list \{ grid-template-columns: repeat\(2/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*capability-highlight-list \{ grid-template-columns: 1fr/);
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
  assert.match(source, /dashboardMobile from '@\/assets\/landing-dashboard-mobile\.png'/);
  assert.match(source, /fetchPriority="high"/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /@media \(max-width: 700px\)/);
});

test('week steps offer reversible, accessible image previews', () => {
  assert.match(source, /stepPreviews\[step\.number\]\s*\?\s*<FlippableStepCard/);
  assert.match(source, /type="button"[\s\S]*aria-pressed=\{flipped\}/);
  assert.match(source, /aria-hidden=\{flipped\}/);
  assert.match(source, /aria-hidden=\{!flipped\}/);
  assert.match(source, /planEventDetails/);
  assert.ok(existsSync(new URL('../assets/landing-plan-event-details.png', import.meta.url)));
  assert.match(styles, /rotateY\(180deg\)/);
  assert.match(styles, /plan-face--back img[\s\S]*object-fit:\s*fill/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*plan-face--back/);
});