import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
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

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';

async function availablePort() {
  const server = createServer();
  const port = await new Promise<number>((resolvePort, reject) => {
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
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return port;
}

async function stopProcessGroup(child: ChildProcess | undefined, monitor: ProcessMonitor | undefined) {
  if (!child || !monitor || monitor.hasExited() || !child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const exited = await Promise.race([
    monitor.waitForExit().then(() => true),
    new Promise<boolean>((resolveResult) => setTimeout(() => resolveResult(false), 4_000)),
  ]);
  if (exited) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  await monitor.waitForExit();
}

test('the Hype Card Design step keeps one live preview and supports photo positioning', async () => {
  const port = await availablePort();
  const debugPort = await availablePort();
  const devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.hype-card-breakout-browser.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      BASE_PATH: '/',
      VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      REPL_ID: '',
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const devMonitor = monitorProcess(devServer, 'Vite');
  const browserProfile = await mkdtemp(resolve(tmpdir(), 'pixl-hype-design-preview-chromium-'));
  const browser = spawn(chromiumPath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${browserProfile}`,
    'about:blank',
  ], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const browserMonitor = monitorProcess(browser, 'Chromium');

  let connection: DevToolsConnection | undefined;
  let page: BrowserPage | undefined;
  try {
    const fixtureUrl = `http://127.0.0.1:${port}/hype-card-breakout-browser-test.html?viewer=workspace-journey&statTrackerReturnTest=1&scenario=photo`;
    await waitForUrl(`http://127.0.0.1:${port}/hype-card-breakout-browser-test.html`, 30_000, devMonitor);
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, fixtureUrl, {
      viewport: { width: 1280, height: 900, mobile: false },
    });
    const session = page.sessionId;

    await waitFor(
      connection,
      session,
      `location.pathname === '/studio/hype-card' && document.querySelector('h1')?.textContent?.includes('Hype Cards')`,
      Boolean,
      30_000,
    );
    assert.equal(await connection.evaluate<string>('document.body.dataset.signedInFixture', session), 'true');
    await connection.evaluate(`document.querySelector('[data-testid="button-walkthrough-step-design"]')?.click()`, session);
    await waitFor(connection, session, `Boolean(document.querySelector('[data-testid="frame-template-cycler"]'))`, Boolean);

    assert.equal(await connection.evaluate<number>(
      `document.querySelectorAll('[data-testid="hype-preview-canvas"]').length`,
      session,
    ), 1, 'the Design step shows exactly one full card preview');
    const designOrder = await connection.evaluate<boolean>(
      `(() => {
        const controls = document.querySelector('[data-testid="hype-card-appearance-controls"]');
        const preview = controls?.querySelector('[data-testid="hype-card-main-preview"]');
        const navigation = preview?.querySelector('[data-testid="appearance-navigation-preview"]');
        const canvas = preview?.querySelector('[data-testid="hype-preview-canvas"]');
        const arrows = controls?.querySelector('[data-testid="hype-card-template-cyclers"]');
        const photoControls = controls?.querySelector('[data-testid="hype-card-photo-position-controls"]');
        const sides = Array.from(navigation?.children ?? []).map((item) => item.textContent?.trim());
        return Boolean(
          preview && controls?.firstElementChild === preview
          && navigation?.parentElement === preview
          && navigation.previousElementSibling?.contains(canvas)
          && sides.join('|') === 'Replies|Stats|Taps|Events'
          && preview.nextElementSibling === arrows
          && arrows?.nextElementSibling === photoControls
        );
      })()`,
      session,
    );
    assert.equal(designOrder, true, 'the card, four-side strip, design arrows, and position controls appear in order');
    assert.equal(await connection.evaluate<number>(
      `document.querySelectorAll('[data-testid="slider-card-athleteX"], [data-testid="slider-card-athleteY"], [data-testid="slider-card-athleteScale"]').length`,
      session,
    ), 3, 'the photo controls include horizontal, vertical, and zoom sliders');
    assert.equal(await connection.evaluate<boolean>(
      `document.querySelector('[data-testid="hype-card-main-preview"]')?.getBoundingClientRect().width > 0`,
      session,
    ), true, 'the live preview stays visible in the Design step');
    assert.equal(await connection.evaluate<number>(
      `document.querySelectorAll('[data-testid="hype-preview-canvas"] image[data-testid="svg-card-photo"]').length
        + document.querySelectorAll('[data-testid="hype-preview-canvas"] img').length`,
      session,
    ), 1, 'the full-card template renders the uploaded photo once without an inset duplicate');
    assert.equal(await connection.evaluate<number>(
      `document.querySelectorAll('[data-testid="hype-preview-canvas"] img').length`,
      session,
    ), 0, 'the full-card template does not add the legacy inset image');

    const horizontalBefore = await connection.evaluate<string>(
      `document.querySelector('[data-testid="slider-card-athleteX"]')?.value || ''`,
      session,
    );
    await connection.evaluate(`document.querySelector('[data-testid="slider-card-athleteX"]')?.focus()`, session);
    await connection.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
    }, session);
    await connection.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
    }, session);
    await waitFor(
      connection,
      session,
      `document.querySelector('[data-testid="slider-card-athleteX"]')?.value || ''`,
      (value) => Number(value) !== Number(horizontalBefore),
    );

    const frameBefore = await connection.evaluate<string>(
      `document.querySelector('[data-testid="frame-template-cycler-selected"]')?.textContent?.trim() || ''`,
      session,
    );
    const previewBefore = await connection.evaluate<string>(
      `document.querySelector('[data-testid="hype-preview-canvas"]')?.innerHTML || ''`,
      session,
    );
    await connection.evaluate(`document.querySelector('[data-testid="frame-template-cycler-next"]')?.click()`, session);
    await waitFor(
      connection,
      session,
      `document.querySelector('[data-testid="frame-template-cycler-selected"]')?.textContent?.trim() || ''`,
      (value) => value !== frameBefore,
    );
    await waitFor(
      connection,
      session,
      `document.querySelector('[data-testid="hype-preview-canvas"]')?.innerHTML || ''`,
      (value) => value !== previewBefore,
    );

    await connection.evaluate(`document.querySelector('[data-testid="button-position-photo"]')?.click()`, session);
    await waitFor(connection, session, `Boolean(document.querySelector('[data-testid="hype-card-positioning-preview"]'))`, Boolean);
    const positionBeforeKeyboard = await connection.evaluate<string>(
      `document.querySelector('[data-testid="hype-card-positioning-preview"]')?.getAttribute('data-position-x') || ''`,
      session,
    );
    await connection.evaluate(`document.querySelector('[data-testid="hype-card-positioning-preview"]')?.focus()`, session);
    await connection.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
    }, session);
    await connection.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
    }, session);
    const positionAfterKeyboard = await waitFor(
      connection,
      session,
      `document.querySelector('[data-testid="hype-card-positioning-preview"]')?.getAttribute('data-position-x') || ''`,
      (value) => Number(value) !== Number(positionBeforeKeyboard),
    );

    const bounds = await connection.evaluate<{ x: number; y: number; width: number }>(`(() => {
      const rect = document.querySelector('[data-testid="hype-card-positioning-preview"]').getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width };
    })()`, session);
    await connection.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: bounds.x, y: bounds.y, button: 'none', buttons: 0,
    }, session);
    await connection.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: bounds.x, y: bounds.y, button: 'left', buttons: 1, clickCount: 1,
    }, session);
    await connection.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: bounds.x + Math.min(40, bounds.width / 4), y: bounds.y + 20, button: 'left', buttons: 1,
    }, session);
    await connection.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: bounds.x + Math.min(40, bounds.width / 4), y: bounds.y + 20, button: 'left', buttons: 0, clickCount: 1,
    }, session);
    await waitFor(
      connection,
      session,
      `document.querySelector('[data-testid="hype-card-positioning-preview"]')?.getAttribute('data-position-x') || ''`,
      (value) => Number(value) !== Number(positionAfterKeyboard),
    );

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, session);
    await waitFor(connection, session, 'innerWidth', (width) => width === 390);
    assert.equal(await connection.evaluate<number>(
      `document.querySelectorAll('[data-testid="hype-preview-canvas"]').length`,
      session,
    ), 1, 'the phone layout also keeps a single live card preview');
    assert.equal(await connection.evaluate<boolean>(
      `(() => {
        const controls = document.querySelector('[data-testid="hype-card-appearance-controls"]');
        const preview = controls?.querySelector('[data-testid="hype-card-main-preview"]');
        const navigation = preview?.querySelector('[data-testid="appearance-navigation-preview"]');
        const arrows = controls?.querySelector('[data-testid="hype-card-template-cyclers"]');
        const photoControls = controls?.querySelector('[data-testid="hype-card-photo-position-controls"]');
        return Boolean(preview?.nextElementSibling === arrows && arrows?.nextElementSibling === photoControls
          && navigation?.children.length === 4);
      })()`,
      session,
    ), true, 'the phone layout retains the four controls before the arrows and photo sliders');
    const phoneFit = await connection.evaluate<{ viewport: number; page: number; previewWidth: number }>(`(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      previewWidth: document.querySelector('[data-testid="hype-card-main-preview"]').getBoundingClientRect().width,
    }))()`, session);
    assert.ok(phoneFit.page <= phoneFit.viewport + 2, `the phone layout should not scroll horizontally: ${JSON.stringify(phoneFit)}`);
    assert.ok(phoneFit.previewWidth > 0 && phoneFit.previewWidth <= phoneFit.viewport, 'the main preview should fit the phone viewport');
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    await Promise.all([
      stopProcessGroup(browser, browserMonitor),
      stopProcessGroup(devServer, devMonitor),
    ]);
    await rm(browserProfile, { recursive: true, force: true });
  }
});
