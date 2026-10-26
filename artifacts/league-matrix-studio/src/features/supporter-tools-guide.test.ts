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
  assert.match(
    guide,
    /<Link href="\/studio" data-testid="link-supporter-guide-hub">[\s\S]*?<ArrowLeft size=\{16\} aria-hidden="true" \/>[\s\S]*?Back to dashboard[\s\S]*?<\/Link>/,
  );
  assert.doesNotMatch(dashboard, /data-testid="link-(?:mobile|desktop)-supporter-guide"/);
  const printStyles = styles.slice(styles.indexOf('@media print'));
  assert.match(styles, /@page\s*\{\s*size:\s*letter portrait;/);
  assert.match(printStyles, /\.supporter-guide-actions\s*\{\s*display:\s*none;/);
  assert.match(printStyles, /\.supporter-tools-guide\s*\{\s*width:\s*7\.74in;/);
  assert.match(printStyles, /\.supporter-tools-guide\s*\{[^}]*break-inside:\s*avoid;[^}]*page-break-inside:\s*avoid;/s);
  assert.match(printStyles, /\.supporter-guide-columns\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\);/s);
  assert.match(printStyles, /\.supporter-guide-footer\s*\{\s*display:\s*flex;/);
});