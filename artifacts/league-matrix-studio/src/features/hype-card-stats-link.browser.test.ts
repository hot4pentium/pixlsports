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

function changedPixelCount(context, box, background) {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(context.canvas.width, Math.ceil(box.right));
  const bottom = Math.min(context.canvas.height, Math.ceil(box.bottom));
  if (right <= left || bottom <= top) return 0;
  const red = Number.parseInt(background.slice(1, 3), 16);
  const green = Number.parseInt(background.slice(3, 5), 16);
  const blue = Number.parseInt(background.slice(5, 7), 16);
  const pixels = context.getImageData(left, top, right - left, bottom - top).data;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (Math.abs(pixels[index] - red) + Math.abs(pixels[index + 1] - green) + Math.abs(pixels[index + 2] - blue) > 65) {
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
  const backgroundMarkup = format === 'card' ? buildHypeCardSvg(project, 'bg', 'background', statsUrl) : '';
  const emptyMediaMarkup = format === 'card' ? buildHypeCardSvg({ ...project, mediaType: null, photo: null }, 'fg', 'empty-media') : '';
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
  const qrGroup = svg?.querySelector('[aria-label="QR code for finalized stats"]');
  const qrBox = qrGroup?.querySelector('rect');
  const statsText = statsGroup?.querySelectorAll('text')[1];
  if (!svg || !statsGroup || !statsBox || !qrGroup || !qrBox || !statsText) throw new Error('Linked stats markup was not rendered');
  let watermark = null;
  if (format === 'card') {
    const group = svg.querySelector('[aria-label="Hype Card watermark"]');
    const mark = group?.querySelector('text');
    const matrix = mark?.transform.baseVal.consolidate()?.matrix;
    if (!group || !mark || !matrix) throw new Error('The card photo watermark was not rendered');
    const bounds = mark.getBBox();
    const points = [
      [bounds.x, bounds.y],
      [bounds.x + bounds.width, bounds.y],
      [bounds.x, bounds.y + bounds.height],
      [bounds.x + bounds.width, bounds.y + bounds.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
    watermark = {
      allCount: svg.querySelectorAll('[aria-label="Hype Card watermark"]').length,
      foregroundCount: new DOMParser().parseFromString(foregroundMarkup, 'image/svg+xml').querySelectorAll('[aria-label="Hype Card watermark"]').length,
      backgroundCount: new DOMParser().parseFromString(backgroundMarkup, 'image/svg+xml').querySelectorAll('[aria-label="Hype Card watermark"]').length,
      emptyMediaCount: new DOMParser().parseFromString(emptyMediaMarkup, 'image/svg+xml').querySelectorAll('[aria-label="Hype Card watermark"]').length,
      railCount: group.querySelectorAll('rect').length,
      clipPath: group.getAttribute('clip-path'),
      rotation: mark.getAttribute('transform'),
      opacity: Number(mark.getAttribute('fill-opacity')),
      bounds: {
        x: Math.min(...points.map((point) => point.x)),
        y: Math.min(...points.map((point) => point.y)),
        right: Math.max(...points.map((point) => point.x)),
        bottom: Math.max(...points.map((point) => point.y)),
      },
    };
  }

  const box = statsBox.getBBox();
  const qr = qrBox.getBBox();
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
  const phoneWatermarkBox = watermark && {
    x: watermark.bounds.x * scale,
    y: watermark.bounds.y * scale,
    right: watermark.bounds.right * scale,
    bottom: Math.min(watermark.bounds.bottom, 890) * scale,
  };

  const foregroundImage = await loadSvg(foregroundMarkup);
  const framePixelCounts = [];
  const watermarkPixelCounts = [];
  for (const background of ['#13243b', '#492a26', '#1e4c43']) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(foregroundImage, 0, 0, canvas.width, canvas.height);
    framePixelCounts.push(brightPixelCount(context, phoneTextBox));
    if (phoneWatermarkBox) watermarkPixelCounts.push(changedPixelCount(context, phoneWatermarkBox, background));
  }

  svgHost.remove();
  return {
    format,
    width: dimensions.width,
    height: dimensions.height,
    url: statsText.textContent,
    box: { x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height },
    qr: { x: qr.x, y: qr.y, size: qr.width },
    text: { x: text.x, y: text.y, right: text.x + text.width, bottom: text.y + text.height, fontSize: Number.parseFloat(statsText.getAttribute('font-size') || '0') },
    phoneTextHeight: phoneTextBox.bottom - phoneTextBox.y,
    rasterDataUrl: canvas.toDataURL('image/png').slice(0, 22),
    jpegDataUrl: canvas.toDataURL('image/jpeg', 0.95).slice(0, 23),
    rasterBrightPixels: brightPixelCount(context, phoneTextBox),
    framePixelCounts,
    watermark,
    watermarkPixelCounts,
    copyOverlap: outsideTextBoxes.some((candidate) => intersects(box, candidate)),
    ordinaryExportUnchanged: !ordinaryMarkup.includes('Finalized stats link') && !ordinaryMarkup.includes(statsUrl),
  };
}

async function inspectBreakout() {
  const photoCanvas = document.createElement('canvas');
  photoCanvas.width = 100;
  photoCanvas.height = 200;
  const photoContext = photoCanvas.getContext('2d');
  if (!photoContext) throw new Error('Could not create a source-photo fixture');
  photoContext.fillStyle = '#1765e8';
  photoContext.fillRect(0, 0, photoCanvas.width, photoCanvas.height);
  const sourcePhoto = photoCanvas.toDataURL('image/png');

  const cutoutCanvas = document.createElement('canvas');
  cutoutCanvas.width = 100;
  cutoutCanvas.height = 200;
  const cutoutContext = cutoutCanvas.getContext('2d');
  if (!cutoutContext) throw new Error('Could not create a transparent cutout fixture');
  cutoutContext.fillStyle = '#f52222';
  cutoutContext.fillRect(30, 20, 40, 170);
  const cutout = cutoutCanvas.toDataURL('image/png');
  const project = {
    ...defaultProject(),
    format: 'card',
    mediaType: 'image',
    mediaId: 'fixture-photo',
    photo: sourcePhoto,
    playerName: 'Jordan Lane',
    teamName: 'Eastside Falcons',
    breakoutEnabled: true,
    breakoutBorderColor: '#12AB34',
    breakoutCutout: cutout,
    breakoutCutoutMediaId: 'fixture-cutout',
    breakoutTransform: { zoom: 1.2, x: 24, y: -18 },
  };
  const foreground = buildHypeCardSvg(project, 'fg', 'breakout');
  const all = buildHypeCardSvg(project, 'all', 'breakout');
  const background = buildHypeCardSvg(project, 'bg', 'breakout');
  const standard = buildHypeCardSvg({ ...project, breakoutEnabled: false }, 'all', 'standard');
  const video = buildHypeCardSvg({ ...project, mediaType: 'video' }, 'all', 'video');
  const cutoutIndex = foreground.indexOf('href="' + cutout + '"');
  const nameplateIndex = foreground.indexOf('JORDAN LANE');
  const image = await loadSvg(all);
  const standardImage = await loadSvg(standard);
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1400;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the Breakout render fixture');
  context.drawImage(image, 0, 0);
  const playerPixel = [...context.getImageData(500, 700, 1, 1).data];
  const cutoutClearPhotoPixel = [...context.getImageData(370, 700, 1, 1).data];
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(standardImage, 0, 0);
  const standardPhotoPixel = [...context.getImageData(370, 700, 1, 1).data];

  return {
    sourcePhotoPreserved: all.includes('href="' + sourcePhoto + '"'),
    cutoutIncluded: cutoutIndex >= 0,
    nameplateAboveCutout: nameplateIndex > cutoutIndex,
    customFrameEdge: foreground.includes('stroke="#12AB34" stroke-width="10"'),
    transformIncluded: foreground.includes('translate(24 -18)') && foreground.includes('scale(1.2)'),
    backgroundHasNoCutout: !background.includes(cutout),
    standardHasNoCutout: !standard.includes(cutout),
    videoHasNoCutout: !video.includes(cutout),
    playerPixel,
    cutoutClearPhotoPixel,
    standardPhotoPixel,
  };
}

async function run() {
  const results = [];
  for (const format of formats) results.push(await inspectFormat(format));
  results[0].breakout = await inspectBreakout();
  document.body.dataset.results = JSON.stringify(results);
}

function Harness() {
  useEffect(() => { void run(); }, []);
  return createElement('main', null, 'Checking linked exports');
}

createRoot(document.getElementById('root')).render(createElement(Harness));
`;
}

test('linked stats URLs and the card watermark survive phone-sized image and video rendering', async () => {
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
      qr: { x: number; y: number; size: number };
      text: { x: number; y: number; right: number; bottom: number; fontSize: number };
      phoneTextHeight: number;
      rasterDataUrl: string;
      jpegDataUrl: string;
      rasterBrightPixels: number;
      framePixelCounts: number[];
      watermark: null | {
        allCount: number;
        foregroundCount: number;
        backgroundCount: number;
        emptyMediaCount: number;
        railCount: number;
        clipPath: string | null;
        rotation: string | null;
        opacity: number;
        bounds: { x: number; y: number; right: number; bottom: number };
      };
      watermarkPixelCounts: number[];
      copyOverlap: boolean;
      ordinaryExportUnchanged: boolean;
      breakout?: {
        sourcePhotoPreserved: boolean;
        cutoutIncluded: boolean;
        nameplateAboveCutout: boolean;
        customFrameEdge: boolean;
        transformIncluded: boolean;
        backgroundHasNoCutout: boolean;
        standardHasNoCutout: boolean;
        videoHasNoCutout: boolean;
        playerPixel: number[];
        cutoutClearPhotoPixel: number[];
        standardPhotoPixel: number[];
      };
    }>>('JSON.parse(document.body.dataset.results)', page.sessionId);

    assert.deepEqual(results.map((result) => result.format), ['card', 'story', 'square', 'landscape']);
    for (const result of results) {
      assert.equal(result.url, 'https://pixlsports.com/finalized-stats/eastside-falcons/2026-09-21/game-123456789');
      assert.ok(result.box.x >= 0 && result.box.right <= result.width, `${result.format} stats panel leaves the output`);
      assert.ok(result.box.y >= 0 && result.box.bottom <= result.height, `${result.format} stats panel leaves the output vertically`);
      assert.ok(result.qr.size >= 180, `${result.format} QR code is below the scan-friendly minimum`);
      assert.ok(result.qr.x >= result.box.x && result.qr.x + result.qr.size <= result.box.right, `${result.format} QR code leaves its panel`);
      assert.ok(result.qr.y >= result.box.y && result.qr.y + result.qr.size <= result.box.bottom, `${result.format} QR code leaves its panel vertically`);
      assert.ok(result.text.x >= result.box.x && result.text.right <= result.box.right, `${result.format} URL text leaves its panel`);
      assert.ok(result.text.y >= result.box.y && result.text.bottom <= result.box.bottom, `${result.format} URL text leaves its panel vertically`);
      assert.ok(result.phoneTextHeight >= 5, `${result.format} URL is too small at a 390px preview`);
      assert.equal(result.copyOverlap, false, `${result.format} stats panel covers key copy`);
      assert.equal(result.ordinaryExportUnchanged, true, `${result.format} ordinary export contains linked stats markup`);
      assert.equal(result.rasterDataUrl, 'data:image/png;base64,');
      assert.equal(result.jpegDataUrl, 'data:image/jpeg;base64,');
      assert.ok(result.rasterBrightPixels > 0, `${result.format} raster does not contain visible URL pixels`);
      assert.ok(result.framePixelCounts.every((count) => count > 0), `${result.format} video foreground loses the URL on a frame`);
      if (result.format === 'card') {
        const breakout = result.breakout;
        assert.ok(breakout, 'card output should include a Breakout render check');
        assert.equal(breakout.sourcePhotoPreserved, true);
        assert.equal(breakout.cutoutIncluded, true);
        assert.equal(breakout.nameplateAboveCutout, true);
        assert.equal(breakout.customFrameEdge, true);
        assert.equal(breakout.transformIncluded, true);
        assert.equal(breakout.backgroundHasNoCutout, true);
        assert.equal(breakout.standardHasNoCutout, true);
        assert.equal(breakout.videoHasNoCutout, true);
        assert.ok(breakout.playerPixel[0] > 180 && breakout.playerPixel[1] < 80, 'the cutout should render above the source photo');
        assert.ok(breakout.cutoutClearPhotoPixel[2] > breakout.cutoutClearPhotoPixel[0], 'the source photo should remain visible through transparent cutout pixels');
        assert.ok(
          breakout.cutoutClearPhotoPixel.every((channel, index) => Math.abs(channel - breakout.standardPhotoPixel[index]) <= 16),
          'transparent cutout pixels should keep the original photo visible beneath the frame edge glow',
        );
        const watermark = result.watermark;
        assert.ok(watermark, 'stadium card should include a photo watermark');
        assert.equal(watermark.allCount, 1, 'still artwork should contain one watermark');
        assert.equal(watermark.foregroundCount, 1, 'video foreground should contain one watermark');
        assert.equal(watermark.backgroundCount, 0, 'background should not duplicate the watermark');
        assert.equal(watermark.emptyMediaCount, 1, 'the watermark should remain visible in the empty photo preview');
        assert.equal(watermark.railCount, 0, 'the old separate label rail should be gone');
        assert.equal(watermark.clipPath, 'url(#stadiumPhotoClip-raster)');
        assert.equal(watermark.rotation, 'rotate(45 680 850)');
        assert.ok(watermark.opacity > 0 && watermark.opacity < .6, 'the mark should be translucent');
        assert.ok(
          watermark.bounds.x >= 172 && watermark.bounds.right <= 828,
          `watermark text bounds should stay close to the clipped photo: ${JSON.stringify(watermark.bounds)}`,
        );
        assert.ok(watermark.bounds.y >= 330 && watermark.bounds.bottom <= 1085, 'watermark leaves the photo vertically');
        assert.equal(result.watermarkPixelCounts.length, 3);
        assert.ok(result.watermarkPixelCounts.every((count) => count > 10), 'watermark disappears on a phone-sized video frame');
      } else {
        assert.equal(result.watermark, null, `${result.format} has an unrelated stadium watermark`);
      }
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