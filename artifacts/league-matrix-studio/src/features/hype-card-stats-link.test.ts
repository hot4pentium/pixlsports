import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editorSource = readFileSync(new URL('./hype-card.tsx', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../../../api-server/src/routes/hypeCardShares.ts', import.meta.url), 'utf8');

test('Hype Card sharing offers device download or Athlete Hype Page posting', () => {
  assert.match(editorSource, /data-testid="button-download-hype-card"/);
  assert.match(editorSource, /data-testid="button-post-athlete-hype-page"/);
  assert.doesNotMatch(editorSource, /data-testid="button-share-stats-only"/);
  assert.doesNotMatch(editorSource, /data-testid="button-share-hosted-card"/);
  assert.doesNotMatch(editorSource, /data-testid="link-preview-recipient"/);
  assert.match(editorSource, /Hype Card added to Athlete Hype Page/);
  assert.match(editorSource, /const isStatsOnly = shareMode === 'stats'/);
  assert.match(editorSource, /if \(isStatsOnly\) \{\s*mediaKind = project\.mediaType === 'image' \? 'image' : 'video';\s*setShareProgress\(0\.75\);/);
  assert.match(editorSource, /mediaUploadClaimId: isStatsOnly \? null : claimId/);
  assert.match(editorSource, /data-testid="link-preview-stats-recipient"/);
});

test('stats-only shares have no hosted media object paths and still require a linked tracker', () => {
  assert.match(serverSource, /shareMode === "stats" && !parsed\.data\.trackerProjectId/);
  assert.match(serverSource, /videoObjectPath: mediaClaim\?\.objectPath \?\? null/);
  assert.match(serverSource, /posterObjectPath: posterClaim\?\.objectPath \?\? null/);
  assert.match(serverSource, /share\.shareMode === "stats"/);
});

test('linked exports create or reuse a stats URL and burn it into still and video renders', () => {
  assert.match(editorSource, /data-testid="button-export-stats-link"/);
  assert.match(editorSource, /const handleExport = async \(statsUrl\?: string\)/);
  assert.match(editorSource, /if \(existingStatsShare\) \{\s*void handleExport\(shareUrlFor\(existingStatsShare\)\);/);
  assert.match(editorSource, /setLinkedExportPending\(true\)/);
  assert.match(editorSource, /buildHypeCardSvg\(project, 'fg', ns, statsUrl\)/);
  assert.match(editorSource, /buildHypeCardSvg\(project, 'all', 'export', statsUrl\)/);
  assert.match(editorSource, /data-testid="text-stats-link-export-warning"/);
  assert.match(editorSource, /data-testid="button-copy-success-destination"/);
  assert.match(editorSource, /data-testid="button-share-success-destination"/);
  assert.match(editorSource, /revoking it makes this destination unavailable/);
});

test('stats URL markup stays optional and readable inside every SVG output format', () => {
  const svgSource = readFileSync(new URL('./hype-card-svg.ts', import.meta.url), 'utf8');

  assert.match(svgSource, /export function getStatsUrlLayout\(/);
  assert.match(svgSource, /const bottomInset = Math\.max\(150, height \* 0\.11\)/);
  assert.match(svgSource, /textLength="\$\{urlMaxWidth\}" lengthAdjust="spacingAndGlyphs"/);
  assert.match(svgSource, /function buildStatsUrlMarkup\(/);
  assert.match(svgSource, /if \(!statsUrl\) return ''/);
  assert.match(svgSource, /aria-label="Finalized stats link"/);
  assert.match(svgSource, /aria-label="QR code for finalized stats"/);
  assert.match(svgSource, /const qrSize = Math\.max\(180/);
  assert.match(svgSource, /VIEW FINAL STATS/);
  assert.match(svgSource, /SCAN THE QR CODE/);
  assert.match(svgSource, /buildStatsUrlMarkup\(statsUrl, 1000, 1400, palette\)/);
  assert.match(svgSource, /buildStatsUrlMarkup\(statsUrl, width, height, palette\)/);
});