import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const artifactDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('the HTML entrypoint loads the app through the artifact base path', async () => {
  const html = await readFile(resolve(artifactDirectory, 'index.html'), 'utf8');

  assert.match(html, /src="\.\/src\/main\.tsx"/);
  assert.doesNotMatch(html, /src="\/src\/main\.tsx"/);
});

test('the offline shell rotates caches for new builds and removes superseded versions', async () => {
  const serviceWorker = await readFile(resolve(artifactDirectory, 'public/sw.js'), 'utf8');

  assert.match(serviceWorker, /const CACHE_NAME = `\$\{CACHE_PREFIX\}-v10`;/);
  assert.match(
    serviceWorker,
    /\.filter\(\(key\) => key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME\)[\s\S]*\.map\(\(key\) => caches\.delete\(key\)\)/,
  );
});