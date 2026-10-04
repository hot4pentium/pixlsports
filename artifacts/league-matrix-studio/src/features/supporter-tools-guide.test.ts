import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const guideUrl = new URL('./supporter-tools-guide.tsx', import.meta.url);
const stylesUrl = new URL('./supporter-tools-guide.css', import.meta.url);
const dashboardUrl = new URL('./supporter-dashboard.tsx', import.meta.url);
const appUrl = new URL('../App.tsx', import.meta.url);

test('supporter guide separates account tools from public-card actions', async () => {
  const guide = await readFile(guideUrl, 'utf8');
  const [dashboard, app, styles] = await Promise.all([
    readFile(dashboardUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  for (const phrase of [
    'Pixl Sports — Family Supporter Guide',
    'For the supporter account',
    'Game-day preparation',
    'Stat Tracker',
    'For family &amp; friends',
    'Anyone with the public link can view the card. No account is needed.',
    'Follow on your device without an account.',
    'private family QR created by the card owner',
    'the owner can revoke the QR access',
  ]) {
    assert.ok(guide.includes(phrase), `guide includes: ${phrase}`);
  }

  assert.match(app, /<Route path="\/supporter-guide" component={SupporterToolsGuidePage} \/>/);
  assert.match(dashboard, /href="\/supporter-guide"[^>]*data-testid="link-mobile-supporter-guide"/);
  assert.match(dashboard, /href="\/supporter-guide"[^>]*data-testid="link-desktop-supporter-guide"/);
  assert.match(styles, /@page\s*\{\s*size:\s*letter portrait;/);
  assert.match(styles, /\.supporter-guide-actions\s*\{\s*display:\s*none;/);
});