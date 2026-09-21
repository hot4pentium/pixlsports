import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DevToolsConnection,
  monitorProcess,
  openPage,
  waitFor,
  waitForUrl,
  type BrowserPage,
  type ProcessMonitor,
} from './browser-test-diagnostics';

const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const harnessPath = resolve(appDirectory, 'hype-card-stats-link-test.tsx');
const htmlPath = resolve(appDirectory, 'hype-card-stats-link-test.html');

function listen(server: Server) {
  return new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected a TCP server address'));
        return;
      }
      resolvePort(address.port);
    });
  });
}

function harnessSource() {
  return `
import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { buildHypeCardSvg } from './src/features/hype-card-svg';
import { defaultProject, getDimensions } from './src/features/hype-card-types';

const statsUrl = 'https://pixlsports.com/finalized-stats/eastside-falcons/2026-09-21/game-123456789';
const formats = ['card', 'story', 'square', 'landscape'];
const phoneWidth = 390;

function loadSvg(svg) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not rasterize the linked export SVG'));
    };
    image.src = url;
  });
}

function brightPixelCount(context, box) {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(context.canvas.width, Math.ceil(box.right));
  const bottom = Math.min(context.canvas.height, Math.ceil(box.bottom));
  if (right <= left || bottom <= top) return 0;
  const pixels = context.getImageData(left, top, right - left, bottom - top).data;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] > 185 && pixels[index + 1] > 185 && pixels[index + 2] > 185 && pixels[index + 3] > 0) {
      count += 1;
    }
  }
  return count;
}

async function inspectFormat(format) {
  const project = {
    ...defaultProject(),
    format,
    headline: 'CHAMPIONSHIP',
    playerName: 'Jordan Smith',
    teamName: 'Eastside Falcons',
    position: 'Point guard',
    mediaType: 'image',
  };
  const dimensions = getDimensions(format);
  const svgMarkup = buildHypeCardSvg(project, 'all', 'raster', statsUrl);
  const foregroundMarkup = buildHypeCardSvg(project, 'fg', 'video', statsUrl);
  const ordinaryMarkup = buildHypeCardSvg(project, 'all', 'ordinary');
  if (ordinaryMarkup.includes('Finalized stats link') || ordinaryMarkup.includes(statsUrl)) {
    throw new Error('Ordinary export unexpectedly contains linked stats markup');
  }
  const svgHost = document.createElement('div');
  svgHost.innerHTML = svgMarkup;
  svgHost.style.position = 'absolute';
  svgHost.style.left = '-10000px';
  svgHost.style.width = dimensions.width + 'px';
  document.body.append(svgHost);
  const svg = svgHost.querySelector('svg');
  const statsGroup = svg?.querySelector('[aria-label="Finalized stats link"]');
  const statsBox = statsGroup?.querySelector('rect');
  const statsText = statsGroup?.querySelectorAll('text')[1];
  if (!svg || !statsGroup || !statsBox || !statsText) throw new Error('Linked stats markup was not rendered');

  const box = statsBox.getBBox();
  const text = statsText.getBBox();
  const outsideTextBoxes = [...svg.querySelectorAll('text')]
    .filter((element) => !statsGroup.contains(element))
    .map((element) => element.getBBox())
    .filter((candidate) => candidate.width > 0 && candidate.height > 0);
  const intersects = (first, second) => first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;

  const image = await loadSvg(svgMarkup);
  const outputHeight = Math.round(phoneWidth * dimensions.height / dimensions.width);
  const canvas = document.createElement('canvas');
  canvas.width = phoneWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the phone-sized export canvas');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const scale = phoneWidth / dimensions.width;
  const phoneTextBox = {
    x: text.x * scale,
    y: text.y * scale,
    right: (text.x + text.width) * scale,
    bottom: (text.y + text.height) * scale,
  };

  const foregroundImage = await loadSvg(foregroundMarkup);
  const framePixelCounts = [];
  for (const background of ['#13243b', '#492a26', '#1e4c43']) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(foregroundImage, 0, 0, canvas.width, canvas.height);
    framePixelCounts.push(brightPixelCount(context, phoneTextBox));
  }

  svgHost.remove();
  return {
    format,
    width: dimensions.width,
    height: dimensions.height,
    url: statsText.textContent,
    box: { x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height },
    text: { x: text.x, y: text.y, right: text.x + text.width, bottom: text.y + text.height, fontSize: Number.parseFloat(statsText.getAttribute('font-size') || '0') },
    phoneTextHeight: phoneTextBox.bottom - phoneTextBox.y,
    rasterDataUrl: canvas.toDataURL('image/png').slice(0, 22),
    jpegDataUrl: canvas.toDataURL('image/jpeg', 0.95).slice(0, 23),
    rasterBrightPixels: brightPixelCount(context, phoneTextBox),
    framePixelCounts,
    copyOverlap: outsideTextBoxes.some((candidate) => intersects(box, candidate)),
    ordinaryExportUnchanged: !ordinaryMarkup.includes('Finalized stats link') && !ordinaryMarkup.includes(statsUrl),
  };
}

async function run() {
  const results = [];
  for (const format of formats) results.push(await inspectFormat(format));
  document.body.dataset.results = JSON.stringify(results);
}

function Harness() {
  useEffect(() => { void run(); }, []);
  return createElement('main', null, 'Checking linked exports');
}

createRoot(document.getElementById('root')).render(createElement(Harness));
`;
}

test('linked stats URLs survive phone-sized image rasterization and video frame composition', async () => {
  await writeFile(harnessPath, harnessSource(), 'utf8');
  await writeFile(htmlPath, '<!doctype html><html><body><div id="root"></div><script type="module" src="/hype-card-stats-link-test.tsx"></script></body></html>', 'utf8');

  const portProbe = createServer();
  const port = await listen(portProbe);
  await new Promise<void>((resolveClose, rejectClose) => portProbe.close((error) => error ? rejectClose(error) : resolveClose()));
  const devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      BASE_PATH: '/',
      VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const devMonitor = monitorProcess(devServer, 'Vite');
  const browserProfile = await mkdtemp(resolve(tmpdir(), 'pixl-hype-card-stats-link-browser-'));
  const debugProbe = createServer();
  const debugPort = await listen(debugProbe);
  await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));

  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: BrowserPage | undefined;

  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 30_000, devMonitor);
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${browserProfile}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${port}/hype-card-stats-link-test.html`);
    await waitFor(connection, page.sessionId, 'document.body?.dataset.results || ""', (value) => Boolean(value), 30_000);
    const results = await connection.evaluate<Array<{
      format: string;
      width: number;
      height: number;
      url: string;
      box: { x: number; y: number; right: number; bottom: number };
      text: { x: number; y: number; right: number; bottom: number; fontSize: number };
      phoneTextHeight: number;
      rasterDataUrl: string;
      jpegDataUrl: string;
      rasterBrightPixels: number;
      framePixelCounts: number[];
      copyOverlap: boolean;
      ordinaryExportUnchanged: boolean;
    }>>('JSON.parse(document.body.dataset.results)', page.sessionId);

    assert.deepEqual(results.map((result) => result.format), ['card', 'story', 'square', 'landscape']);
    for (const result of results) {
      assert.equal(result.url, 'https://pixlsports.com/finalized-stats/eastside-falcons/2026-09-21/game-123456789');
      assert.ok(result.box.x >= 0 && result.box.right <= result.width, `${result.format} stats panel leaves the output`);
      assert.ok(result.box.y >= 0 && result.box.bottom <= result.height, `${result.format} stats panel leaves the output vertically`);
      assert.ok(result.text.x >= result.box.x && result.text.right <= result.box.right, `${result.format} URL text leaves its panel`);
      assert.ok(result.text.y >= result.box.y && result.text.bottom <= result.box.bottom, `${result.format} URL text leaves its panel vertically`);
      assert.ok(result.phoneTextHeight >= 5, `${result.format} URL is too small at a 390px preview`);
      assert.equal(result.copyOverlap, false, `${result.format} stats panel covers key copy`);
      assert.equal(result.ordinaryExportUnchanged, true, `${result.format} ordinary export contains linked stats markup`);
      assert.equal(result.rasterDataUrl, 'data:image/png;base64,');
      assert.equal(result.jpegDataUrl, 'data:image/jpeg;base64,');
      assert.ok(result.rasterBrightPixels > 0, `${result.format} raster does not contain visible URL pixels`);
      assert.ok(result.framePixelCounts.every((count) => count > 0), `${result.format} video foreground loses the URL on a frame`);
    }
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor && !browserMonitor.hasExited()) browser.kill('SIGTERM');
    if (browserMonitor) await browserMonitor.waitForExit();
    if (!devMonitor.hasExited()) devServer.kill('SIGTERM');
    await devMonitor.waitForExit();
    await rm(browserProfile, { recursive: true, force: true });
    await rm(harnessPath, { force: true });
    await rm(htmlPath, { force: true });
  }
});