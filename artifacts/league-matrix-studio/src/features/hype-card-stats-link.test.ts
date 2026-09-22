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
  assert.match(editorSource, /Video added to Athlete Hype Page/);
  assert.match(editorSource, /const isStatsOnly = shareMode === 'stats'/);
  assert.match(editorSource, /if \(isStatsOnly\) \{\s*mediaKind = project\.mediaType === 'image' \? 'image' : 'video';\s*setShareProgress\(0\.75\);/);
  assert.match(editorSource, /mediaUploadClaimId: isStatsOnly \? null : claimId/);
  assert.match(editorSource, /data-testid="link-preview-stats-recipient"/);
  assert.match(editorSource, /\{shareMode === 'stats' && shareTrackerProjectId !== 'none' && \(/);
  assert.match(editorSource, /\{shareMode === 'stats' && \(\s*<div className="space-y-2">/);
});

test('stats-only shares have no hosted media object paths and still require a linked tracker', () => {
  assert.match(serverSource, /shareMode === "stats" && !parsed\.data\.trackerProjectId/);
  assert.match(serverSource, /videoObjectPath: mediaClaim\?\.objectPath \?\? null/);
  assert.match(serverSource, /posterObjectPath: posterClaim\?\.objectPath \?\? null/);
  assert.match(serverSource, /share\.shareMode === "stats"/);
  assert.match(serverSource, /const MAX_VIDEO_BYTES = 35 \* 1024 \* 1024/);
  assert.match(serverSource, /video\/mp4.*video\/webm/);
});

test('linked exports create or reuse a stats URL and burn it into still and video renders', () => {
  assert.doesNotMatch(editorSource, /data-testid="button-export-stats-link"/);
  assert.match(editorSource, /const handleExport = async \(statsUrl\?: string\)/);
  assert.match(editorSource, /if \(existingStatsShare\) \{\s*void handleExport\(shareUrlFor\(existingStatsShare\)\);/);
  assert.match(editorSource, /setLinkedExportPending\(true\)/);
  assert.match(editorSource, /buildHypeCardSvg\(project, 'fg', ns, statsUrl\)/);
  assert.match(editorSource, /buildHypeCardSvg\(project, 'all', 'export', statsUrl\)/);
  assert.match(editorSource, /data-testid="text-stats-link-export-warning"/);
  assert.match(editorSource, /data-testid="button-copy-success-destination"/);
  assert.match(editorSource, /data-testid="button-share-success-destination"/);
  assert.match(editorSource, /revoking it makes this destination unavailable/);
  assert.match(editorSource, /data-testid="text-hosted-video-preparation"/);
  assert.match(editorSource, /data-testid="hosted-video-size-retry"/);
  assert.match(editorSource, /Retry at lower quality/);
  assert.match(editorSource, /The lower-quality browser-prepared video is still over 35 MB/);
  assert.match(editorSource, /quality: shareVideoQuality/);
  assert.match(editorSource, /MAX_HOSTED_VIDEO_BYTES/);
  assert.match(editorSource, /prepared\.video\.size > MAX_HOSTED_VIDEO_BYTES/);
  assert.match(editorSource, /uploadHypeCardShareMedia\(/);
  assert.match(editorSource, /totalUploadBytes = prepared\.video\.size \+ prepared\.poster\.size/);
  assert.match(editorSource, /0\.6 \+ \(totalUploadBytes \? transferred \/ totalUploadBytes : 0\) \* 0\.3/);
  assert.match(editorSource, /signal: shareAbortController\.signal/);
  assert.match(editorSource, /aria-label=\{`\$\{shareStage \|\| 'Preparing share link'\}/);
  assert.match(editorSource, /cancelSharePublish/);
});

test('hosted video uploads report byte progress and abort through the shared request', () => {
  const shareSource = readFileSync(new URL('./hype-card-share.tsx', import.meta.url), 'utf8');

  assert.match(shareSource, /export type HypeCardShareQuality = 'standard' \| 'compact'/);
  assert.match(shareSource, /quality === 'compact' \? 640 : 960/);
  assert.match(shareSource, /quality === 'compact' \? 800_000 : 2_000_000/);
  assert.match(shareSource, /new XMLHttpRequest\(\)/);
  assert.match(shareSource, /request\.upload\.addEventListener\('progress'/);
  assert.match(shareSource, /onProgress\(Math\.min\(1, event\.loaded \/ event\.total\)\)/);
  assert.match(shareSource, /signal\?\.addEventListener\('abort', onAbort/);
  assert.match(shareSource, /request\.abort\(\)/);
  assert.match(shareSource, /request\.status >= 200 && request\.status < 300/);
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