import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./landing-home.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../landing-unified.css', import.meta.url), 'utf8');
const demoSource = readFileSync(new URL('./landing-tool-demo.tsx', import.meta.url), 'utf8');
const demoStyles = readFileSync(new URL('./landing-tool-demo.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('landing shows the dashboard in mobile and landscape with fictional examples', () => {
  assert.match(source, /data-testid="text-landing-headline">ALL IN,<br \/><em>ALL SEASON\.<\/em><\/h1>/);
  assert.match(source, /One season hub for youth-sports families\. Plan games and practices, get ready for game day, track stats, and share your athlete’s HYPE Card\./);
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
  assert.match(source, /An interactive HYPE Card lets fans explore season stats and event details, see public Fan Shoutouts, and send their own\./);
  for (const section of ['hero', 'week-ribbon', 'week-section', 'offline-section', 'athlete-section', 'tools-section', 'closing', 'site-footer']) {
    assert.match(source, new RegExp(`className="${section}"`));
  }
  const offline = source.indexOf('data-testid="landing-offline-section"');
  const hypeCard = source.indexOf('id="athlete-cards"');
  assert.ok(hypeCard >= 0 && offline > hypeCard, 'HYPE Card section should appear above offline guidance');
  for (const message of [
    'Game details, ready',
    'Reopen game details and checklists you’ve already loaded on this device.',
    'Check off prep items on your device, even without service. Shared checklist edits stay here and may need Retry to sync to collaborators.',
    'Record game stats locally and sync your saved result when you’re back online.',
    'Saved on this device',
    'Will sync when connected',
    'On iPhone, tap Share, then Add to Home Screen.',
    'On Android, open your browser menu and choose Install app or Add to Home screen.',
    'Open PIXL online and load each game and checklist you’ll need.',
    'New Event Card drafts stay private on this device until published online. Updating public cards, receiving new replies, and sending alerts still need a connection.',
  ]) assert.ok(source.includes(message), `offline section should explain ${message}`);
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

test('supported sports appear as plain text above the ribbon, not over the photo', () => {
  assert.doesNotMatch(source, /photo-caption|The moments that make a season/);
  assert.match(source, /alt="Youth soccer player smiling while running on a field"/);
  assert.match(source, /<div className="supported-sports" role="group" aria-label="Sports PIXL supports" data-testid="hero-supported-sports">/);
  assert.ok(source.indexOf('className="supported-sports"') < source.indexOf('className="week-ribbon"'), 'sports list should appear above the lime ribbon');
  const imageFrame = source.indexOf('<div className="hero-image-frame">');
  const imageFrameEnd = source.indexOf('</div>', imageFrame);
  const sportsList = source.indexOf('data-testid="hero-supported-sports"');
  assert.ok(imageFrame >= 0 && imageFrameEnd >= 0 && sportsList > imageFrameEnd, 'sports list should be outside the image frame');
  for (const sport of ['Football', 'Soccer', 'Basketball', 'Baseball', 'Softball', 'Volleyball']) {
    assert.ok(source.includes(`data-testid={\`hero-supported-sport-\${sport.toLowerCase()}\`}>{sport}</li>`), `landing page should list ${sport}`);
  }
  assert.match(styles, /supported-sports-list \{[^}]*display: flex; flex-wrap: wrap/);
  assert.doesNotMatch(styles, /hero-sports/);
});

test('landing offers accurate iPhone and Android PWA install guidance', () => {
  assert.doesNotMatch(source, /data-testid="button-landing-install"/);
  assert.match(source, /useAppInstallPrompt\('landing'\)/);
  assert.match(source, /YOUR GAME WEEK, ONE TAP AWAY/);
  assert.match(source, /Keep your game week close\. Open PIXL Sports in your browser, or add it to your Home Screen for quick access to your schedule, checklists, and athlete’s HYPE Card\./);
  assert.match(source, /Progressive Web App \(PWA\)/);
  assert.match(source, /Add PIXL to your Home Screen/);
  assert.match(source, /iPhone &amp; iPad/);
  assert.match(source, /Open this page in <strong>Safari<\/strong>[\s\S]*Add to Home Screen[\s\S]*Open as Web App/);
  assert.match(source, /Android/);
  assert.doesNotMatch(source, /THE FUTURE OF WEB APPLICATIONS|landing-install-security|does not go through Apple App Store/);
  assert.match(appSource, /How does installing PIXL from the web work\?/);
  assert.match(appSource, /official website over HTTPS/);
  assert.match(appSource, /does not go through Apple App Store or Google Play review/);
  assert.match(source, /className="install-section" id="landing-install"/);
  assert.match(source, /data-testid="button-install-section"/);
  const demo = source.indexOf('steps.map(step => <DemoStepCard');
  const offline = source.indexOf('data-testid="landing-offline-section"');
  const tools = source.indexOf('className="tools-section"');
  const install = source.indexOf('className="install-section"');
  assert.ok(demo >= 0 && offline > demo && tools > offline && install > tools, 'show the product and let visitors try it before installation guidance');
  assert.match(styles, /\.install-section/);
  assert.match(styles, /\.install-phone/);
  assert.match(styles, /\.install-action \{[^}]*border: 1px solid[^}]*background: #ffffff08/);
  assert.doesNotMatch(styles, /install-security|install-proof/);
});

test('hero message omits the numbered athlete-card label', () => {
  assert.doesNotMatch(source, /PIXL athlete card \/ 07/);
  assert.match(source, /Every player has a story worth sharing\./);
});

test('week step numbers use circular badges and a one-time staggered reveal', () => {
  assert.match(source, /IntersectionObserver/);
  assert.match(source, /observer\.unobserve\(grid\)/);
  assert.match(source, /week-grid--visible/);
  assert.match(source, /data-testid=\{`landing-step-number-\$\{number\}`\}/);
  assert.match(styles, /\.step-card \.step-number \{[^}]*width: 52px; height: 52px;[^}]*border-radius: 50%;[^}]*background: var\(--pixl-lime\)/);
  assert.match(styles, /\.week-grid--visible \.step-card:nth-child\(2\) \.step-number \{ animation-delay: 120ms; \}/);
  assert.match(styles, /\.week-grid--visible \.step-card:nth-child\(3\) \.step-number \{ animation-delay: 240ms; \}/);
  assert.match(styles, /\.week-grid--visible \.step-card:nth-child\(4\) \.step-number \{ animation-delay: 360ms; \}/);
  assert.match(styles, /@keyframes step-number-grow/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.step-card \.step-number \{ animation: none !important; opacity: 1 !important/);
});

test('landing Hype Card artwork shows the current sides without video references', () => {
  assert.match(source, /className="landing-hype-card-tabs"/);
  for (const side of ['Card front', 'Stats', 'Events']) {
    assert.ok(source.includes(`<span>${side}</span>`), `landing artwork should show ${side}`);
  }
  assert.match(styles, /landing-hype-card-tabs/);
  assert.doesNotMatch(source, /\bvideos?\b/i);
  assert.doesNotMatch(demoSource, /\bvideos?\b|<video/i);
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

test('visitor actions use real destinations without the week-path video link', () => {
  assert.match(source, /isSignedIn \? '\/studio' : '\/sign-up'/);
  assert.match(source, /isSignedIn \? '\/studio' : '\/auth'/);
  for (const anchor of ['how-it-works', 'athlete-cards', 'tools']) {
    assert.match(source, new RegExp(`id="${anchor}"`));
    assert.match(source, new RegExp(`href="#${anchor}"`));
  }
  for (const path of ['/help', '/privacy']) assert.ok(source.includes(`href="${path}"`));
  assert.doesNotMatch(source, /week-path-explainer\.mp4|link-landing-week-path-video|Watch the week path explainer/);
  assert.doesNotMatch(source, /pricing|#pricing/i);
});

test('public support entry points open the managed help desk instead of email', () => {
  assert.match(source, /<Link href="\/help" data-testid="link-footer-support">Contact support<\/Link>/);
  assert.match(appSource, /<SupportCenter \/>/);
  assert.doesNotMatch(source, /mailto:support@pixlsports\.com/);
  assert.doesNotMatch(appSource, /mailto:support@pixlsports\.com/);
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

test('week steps open temporary demos and Celebrate has the photo-first Hype Card sides', () => {
  assert.match(source, /steps\.map\(step => <DemoStepCard/);
  assert.match(source, /const LandingToolDemo = lazy\(\(\) => import\('\.\/landing-tool-demo'\)/);
  assert.match(source, /activeDemo && <Suspense/);
  assert.match(source, /<LandingToolDemo step=\{activeDemo\}/);
  assert.match(demoSource, /<LivingAthleteCardFront/);
  for (const side of ['front', 'stats', 'events']) {
    assert.match(demoSource, new RegExp(`id: '${side}'`));
    assert.match(demoSource, new RegExp(`side === '${side}' && <div`));
  }
  assert.doesNotMatch(demoSource, /id: 'videos'|face-demo-hype-videos|<video/);
  assert.match(demoSource, /aria-pressed=\{side === id\}/);
  assert.match(demoStyles, /pixl-demo-hype-controls \{[^}]*grid-template-columns: repeat\(3/);
});
