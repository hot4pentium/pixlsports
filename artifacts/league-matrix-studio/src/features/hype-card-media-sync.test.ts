import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editorSource = readFileSync(new URL('./hype-card.tsx', import.meta.url), 'utf8');
const mediaSource = readFileSync(new URL('./hype-card-media.ts', import.meta.url), 'utf8');

test('private video draft sync aggregates preview, download, and poster bytes', () => {
  assert.match(editorSource, /const totalUploadBytes = preview\.size \+ download\.size \+ poster\.size/);
  assert.match(editorSource, /updateUploadProgress\('preview'/);
  assert.match(editorSource, /updateUploadProgress\('download'/);
  assert.match(editorSource, /updateUploadProgress\('poster'/);
  assert.match(editorSource, /data-testid="private-media-sync"/);
  assert.match(editorSource, /role=\{mediaSyncState\.status === 'failed' \? 'alert' : 'status'\}/);
  assert.match(editorSource, /Retry cloud sync/);
});

test('private media upload progress can be cancelled without deleting local media', () => {
  assert.match(mediaSource, /export function uploadMediaBlob\(/);
  assert.match(mediaSource, /request\.upload\.addEventListener\('progress'/);
  assert.match(mediaSource, /options\.onProgress\?\.\(Math\.min\(blob\.size, event\.loaded\), blob\.size\)/);
  assert.match(mediaSource, /options\.signal\?\.addEventListener\('abort', onAbort/);
  assert.match(editorSource, /if \(!cancelled && next !== project\) \{\s*await Promise\.all\(obsoleteLocalIds\.map/);
  assert.match(editorSource, /Your local media is safe; retry cloud sync to continue/);
});

test('interrupted multi-file sync cleans completed media and unfinished upload claims', () => {
  assert.match(editorSource, /const interruptedUploads: ProjectMediaUploadRecord\[\] = \[\]/);
  assert.match(editorSource, /await Promise\.allSettled\(\[/);
  assert.match(editorSource, /cleanupProjectMediaUploads\(interruptedUploads\)/);
  assert.match(editorSource, /abandonProjectMediaUpload\(record\.claimId\)/);
  assert.match(editorSource, /Cloud cleanup also failed/);
});

test('a refreshed pending video draft retains every local rendition for retry', () => {
  assert.match(editorSource, /initialCloudDraft\.syncState === 'pending' \? 'Waiting to sync'/);
  assert.match(editorSource, /saveHypeCardCloudDraft\(cloudProjectId, window\.localStorage, \{\s*project: projectForLocalSave\(project\),\s*syncState: 'pending'/);
  assert.match(editorSource, /const posterId = `\$\{id\}-poster`/);
  assert.match(editorSource, /await saveMediaBlob\(posterId, posterBlob\)/);
  assert.match(editorSource, /const localPoster = next\.posterMediaId\s*\?\s*await loadMediaBlob\(next\.posterMediaId\)/);
  assert.match(editorSource, /if \(next\.posterMediaId && !isCloudMediaId\(next\.posterMediaId\)\) \{\s*obsoleteLocalIds\.push\(next\.posterMediaId\);/);
  assert.match(editorSource, /nextSaveDataRef\.current = project;\s*setSaveStatus\('Waiting to sync'\);\s*void processNextSaveRef\.current\(\)/);
});