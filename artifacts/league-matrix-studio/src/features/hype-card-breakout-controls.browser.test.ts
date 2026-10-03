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
const harnessPath = resolve(appDirectory, 'hype-card-breakout-controls-test.tsx');
const htmlPath = resolve(appDirectory, 'hype-card-breakout-controls-test.html');

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
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HypeCardBreakoutControls } from './src/features/hype-card-breakout-controls';
import { hasUsableTransparency } from './src/features/hype-card-breakout-validation';

function Harness() {
  const [enabled, setEnabled] = useState(false);
  const [borderColor, setBorderColor] = useState('#35A8FF');
  const [cutoutDataUrl, setCutoutDataUrl] = useState(null);
  const [availabilityMessage, setAvailabilityMessage] = useState(null);
  const [video, setVideo] = useState(false);
  const [transform, setTransform] = useState({ zoom: 1, x: 0, y: 0 });

  const handleCutoutSelect = async (file) => {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      setAvailabilityMessage('Transparency could not be checked in this browser.');
      bitmap.close();
      return;
    }
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const usable = hasUsableTransparency(pixels, bitmap.width, bitmap.height);
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
    if (!usable) {
      setAvailabilityMessage('The cutout needs transparent background pixels.');
      return;
    }
    setAvailabilityMessage(null);
    setCutoutDataUrl(URL.createObjectURL(file));
  };

  const state = { enabled, borderColor, hasCutout: Boolean(cutoutDataUrl), transform, video };
  return createElement('main', {
    style: { width: '100%', maxWidth: '520px', margin: '0 auto' },
  },
    createElement('label', null,
      'Video mode',
      createElement('input', {
        type: 'checkbox',
        'data-testid': 'toggle-video-mode',
        checked: video,
        onChange: (event) => setVideo(event.currentTarget.checked),
      }),
    ),
    createElement('output', { 'data-testid': 'breakout-state' }, JSON.stringify(state)),
    createElement(HypeCardBreakoutControls, {
      enabled,
      borderColor,
      cutoutDataUrl,
      availabilityMessage: video
        ? 'Breakout is for still-photo cards. Your video stays unchanged.'
        : availabilityMessage,
      disabled: video,
      transform,
      onEnabledChange: setEnabled,
      onBorderColorChange: setBorderColor,
      onCutoutSelect: handleCutoutSelect,
      onCutoutRemove: () => {
        setCutoutDataUrl(null);
        setAvailabilityMessage(null);
      },
      onTransformChange: setTransform,
      onTransformReset: () => setTransform({ zoom: 1, x: 0, y: 0 }),
    }),
  );
}

createRoot(document.getElementById('root')).render(createElement(Harness));
`;
}

type BreakoutState = {
  enabled: boolean;
  borderColor: string;
  hasCutout: boolean;
  transform: { zoom: number; x: number; y: number };
  video: boolean;
};

test('Breakout controls support cutouts, colors, framing, disabled video state, and responsive layout', async () => {
  await writeFile(harnessPath, harnessSource(), 'utf8');
  await writeFile(
    htmlPath,
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>html,body{margin:0;min-width:0}#root{width:100%;padding:12px;box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/hype-card-breakout-controls-test.tsx"></script></body></html>',
    'utf8',
  );

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
  const browserProfile = await mkdtemp(resolve(tmpdir(), 'pixl-hype-card-breakout-controls-'));
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
    page = await openPage(connection, `http://127.0.0.1:${port}/hype-card-breakout-controls-test.html`, {
      viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    });
    const sessionId = page.sessionId;
    await waitFor(connection, sessionId, 'document.querySelector("[data-testid=breakout-state]")?.textContent || ""', Boolean, 30_000);

    const initial = await connection.evaluate<{
      requirementRole: string | null;
      toggleLabel: string | null;
      overflow: number;
      width: number;
    }>(`(() => {
      const panel = document.querySelector('[data-testid="panel-breakout-controls"]');
      return {
        requirementRole: document.querySelector('[data-testid="text-breakout-requirement"]')?.getAttribute('role') || null,
        toggleLabel: document.querySelector('[data-testid="toggle-breakout"]')?.getAttribute('aria-label') || null,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        width: panel ? panel.getBoundingClientRect().width : 0
      };
    })()`, sessionId);
    assert.equal(initial.requirementRole, 'status', 'the transparent-file requirement should be announced');
    assert.equal(initial.toggleLabel, 'Enable Breakout');
    assert.ok(initial.overflow <= 0, 'the panel should fit a 390px phone viewport');
    assert.ok(initial.width <= 390, 'the panel should not exceed the phone viewport');

    const toggle = await connection.evaluate<boolean>(`(() => {
      document.querySelector('[data-testid="toggle-breakout"]').click();
      return true;
    })()`, sessionId);
    assert.equal(toggle, true);
    await waitFor(
      connection,
      sessionId,
      'JSON.parse(document.querySelector("[data-testid=breakout-state]").textContent).enabled',
      (value) => value === true,
      5_000,
    );

    await connection.evaluate<boolean>(`(async () => {
      const input = document.querySelector('[data-testid="input-breakout-cutout"]');
      const canvas = document.createElement('canvas');
      canvas.width = 20;
      canvas.height = 40;
      const context = canvas.getContext('2d');
      context.fillStyle = '#e53b3b';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'opaque.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`, sessionId);
    await waitFor(
      connection,
      sessionId,
      'document.querySelector("[data-testid=text-breakout-availability]")?.textContent || ""',
      (value) => value.includes('transparent background pixels'),
      10_000,
    );
    const rejectedImage = await connection.evaluate<boolean>(`(() => {
      const status = document.querySelector('[data-testid="text-breakout-availability"]');
      return status?.getAttribute('role') === 'status';
    })()`, sessionId);
    assert.equal(rejectedImage, true, 'opaque-image feedback should be announced to assistive technology');

    await connection.evaluate<boolean>(`(async () => {
      const input = document.querySelector('[data-testid="input-breakout-cutout"]');
      const canvas = document.createElement('canvas');
      canvas.width = 20;
      canvas.height = 40;
      const context = canvas.getContext('2d');
      context.fillStyle = '#e53b3b';
      context.fillRect(5, 2, 10, 36);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'player-cutout.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`, sessionId);
    await waitFor(
      connection,
      sessionId,
      'JSON.parse(document.querySelector("[data-testid=breakout-state]").textContent).hasCutout',
      (value) => value === true,
      10_000,
    );
    const previewLoaded = await connection.evaluate<boolean>(`(() => {
      const image = document.querySelector('[data-testid="img-breakout-cutout-preview"]');
      return Boolean(image && image.getAttribute('alt') === 'Uploaded player cutout preview');
    })()`, sessionId);
    assert.equal(previewLoaded, true, 'the accepted transparent image should appear in the preview');

    await connection.evaluate<boolean>(`(() => {
      document.querySelector('[data-testid="button-breakout-color-red"]').click();
      return true;
    })()`, sessionId);
    await waitFor(
      connection,
      sessionId,
      'JSON.parse(document.querySelector("[data-testid=breakout-state]").textContent).borderColor',
      (value) => value === '#F04444',
      5_000,
    );
    const redSelected = await connection.evaluate<boolean>(`document.querySelector('[data-testid="button-breakout-color-red"]')?.getAttribute('aria-pressed') === 'true'`, sessionId);
    assert.equal(redSelected, true);

    await connection.evaluate<boolean>(`(() => {
      const color = document.querySelector('[data-testid="input-breakout-custom-color"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(color, '#123456');
      color.dispatchEvent(new Event('input', { bubbles: true }));
      color.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`, sessionId);
    await waitFor(
      connection,
      sessionId,
      'JSON.parse(document.querySelector("[data-testid=breakout-state]").textContent).borderColor',
      (value) => value === '#123456',
      5_000,
    );

    await connection.evaluate<boolean>(`(() => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, String(value));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue('[data-testid="input-breakout-zoom"]', 1.4);
      setValue('[data-testid="input-breakout-horizontal"]', 96);
      setValue('[data-testid="input-breakout-vertical"]', -42);
      return true;
    })()`, sessionId);
    await waitFor(
      connection,
      sessionId,
      'JSON.parse(document.querySelector("[data-testid=breakout-state]").textContent).transform.x',
      (value) => value === 96,
      5_000,
    );
    const adjusted = await connection.evaluate<BreakoutState>(
      `JSON.parse(document.querySelector('[data-testid="breakout-state"]').textContent)`,
      sessionId,
    );
    assert.deepEqual(adjusted.transform, { zoom: 1.4, x: 96, y: -42 });

    await connection.evaluate<boolean>(`(() => {
      document.querySelector('[data-testid="button-reset-breakout-position"]').click();
      return true;
    })()`, sessionId);
    await waitFor(
      connection,
      sessionId,
      'JSON.parse(document.querySelector("[data-testid=breakout-state]").textContent).transform.x',
      (value) => value === 0,
      5_000,
    );
    const reset = await connection.evaluate<BreakoutState>(
      `JSON.parse(document.querySelector('[data-testid="breakout-state"]').textContent)`,
      sessionId,
    );
    assert.deepEqual(reset.transform, { zoom: 1, x: 0, y: 0 });

    await connection.evaluate<boolean>(`(() => {
      document.querySelector('[data-testid="button-remove-breakout-cutout"]').click();
      return true;
    })()`, sessionId);
    await waitFor(
      connection,
      sessionId,
      'JSON.parse(document.querySelector("[data-testid=breakout-state]").textContent).hasCutout',
      (value) => value === false,
      5_000,
    );

    await connection.evaluate<boolean>(`(() => {
      document.querySelector('[data-testid="toggle-video-mode"]').click();
      return true;
    })()`, sessionId);
    await waitFor(
      connection,
      sessionId,
      'JSON.parse(document.querySelector("[data-testid=breakout-state]").textContent).video',
      (value) => value === true,
      5_000,
    );
    const videoState = await connection.evaluate<{
      disabledToggle: boolean;
      disabledUpload: boolean;
      disabledSlider: boolean;
      status: string;
    }>(`(() => ({
      disabledToggle: document.querySelector('[data-testid="toggle-breakout"]')?.disabled === true,
      disabledUpload: document.querySelector('[data-testid="button-select-breakout-cutout"]')?.disabled === true,
      disabledSlider: document.querySelector('[data-testid="input-breakout-zoom"]')?.matches(':disabled') === true,
      status: document.querySelector('[data-testid="text-breakout-availability"]')?.textContent || ''
    }))()`, sessionId);
    assert.equal(videoState.disabledToggle, true);
    assert.equal(videoState.disabledUpload, true);
    assert.equal(videoState.disabledSlider, true);
    assert.match(videoState.status, /still-photo cards/i);

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await waitFor(connection, sessionId, 'window.innerWidth', (value) => value === 1280, 5_000);
    const desktopLayout = await connection.evaluate<{ overflow: number; panelWidth: number }>(`(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      panelWidth: document.querySelector('[data-testid="panel-breakout-controls"]')?.getBoundingClientRect().width || 0
    }))()`, sessionId);
    assert.ok(desktopLayout.overflow <= 0, 'the panel should not overflow at desktop width');
    assert.ok(desktopLayout.panelWidth <= 520, 'the panel should respect its desktop max width');
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