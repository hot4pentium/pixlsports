import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editorSource = readFileSync(new URL('./hype-card.tsx', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../../../api-server/src/routes/hypeCardShares.ts', import.meta.url), 'utf8');

test('local sharing has a stats-only path that does not prepare or upload the video', () => {
  assert.match(editorSource, /data-testid="button-share-stats-only"/);
  assert.match(editorSource, /Local video \+ stats link/);
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