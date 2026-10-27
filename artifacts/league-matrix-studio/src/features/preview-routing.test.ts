import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const artifactDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('the HTML entrypoint loads the app through the artifact base path', async () => {
  const html = await readFile(resolve(artifactDirectory, 'index.html'), 'utf8');

  assert.match(html, /src="\.\/src\/bootstrap\.ts"/);
  assert.doesNotMatch(html, /src="\/src\/bootstrap\.ts"/);
});

test('the offline shell rotates caches for new builds and removes superseded versions', async () => {
  const serviceWorker = await readFile(resolve(artifactDirectory, 'public/sw.js'), 'utf8');

  assert.match(serviceWorker, /const CACHE_NAME = `\$\{CACHE_PREFIX\}-v17`;/);
  assert.match(
    serviceWorker,
    /migrateShellCache\(oldCacheName\)[\s\S]*await caches\.delete\(oldCacheName\)/,
  );
  assert.match(serviceWorker, /api\/schedule-shares\/[\s\S]*api\/__clerk\/npm\//, 'cache rotation must preserve offline schedules and Clerk static code');
  assert.match(serviceWorker, /if \(!isAppRoute\(url\)\) return;/);
  assert.match(serviceWorker, /cache\.match\(getScopePath\(\)\)/);
  assert.doesNotMatch(serviceWorker, /cache\.put\(getScopePath\(\), copy\)/, 'old workers must not overwrite their shell with new HTML before its assets are precached');
  assert.match(serviceWorker, /\/api\/__clerk\/npm\//, 'the installed shell should retain Clerk static code for offline session restoration');
  assert.match(serviceWorker, /if \(url\.pathname\.includes\('\/api\/'\)\) return;/, 'private API responses must stay out of the service-worker cache');
  assert.doesNotMatch(serviceWorker, /\.wasm\$\/i\.test\(url\.pathname\)/, 'the removed background-removal runtime needs no special cache handler');
});