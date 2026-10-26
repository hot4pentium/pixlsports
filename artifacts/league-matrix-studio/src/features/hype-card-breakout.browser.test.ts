import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PNG } from 'pngjs';

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

async function writePngFixture(filePath: string, transparent: boolean) {
  const width = 100;
  const height = 200;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (width * y + x) * 4;
      png.data[offset] = 224;
      png.data[offset + 1] = 42;
      png.data[offset + 2] = 58;
      png.data[offset + 3] = !transparent || (x >= 27 && x <= 72 && y >= 8 && y <= 190) ? 255 : 0;
    }
  }
  await writeFile(filePath, PNG.sync.write(png));
}

async function stopProcessGroup(
  child: ChildProcess | undefined,
  monitor: ProcessMonitor | undefined,
) {
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

test('the signed-in Hype Card editor supports Breakout controls across phone and desktop widths', async () => {
  const port = await availablePort();
  const debugPort = await availablePort();
  const tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-hype-breakout-browser-'));
  const opaquePath = resolve(tempDirectory, 'opaque-player.png');
  const transparentPath = resolve(tempDirectory, 'transparent-player.png');
  await Promise.all([
    writePngFixture(opaquePath, false),
    writePngFixture(transparentPath, true),
  ]);

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
  const browserProfile = await mkdtemp(resolve(tmpdir(), 'pixl-hype-breakout-chromium-'));
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
  let editorPage: BrowserPage | undefined;
  let videoPage: BrowserPage | undefined;

  try {
    await waitForUrl(`http://127.0.0.1:${port}/hype-card-breakout-browser-test.html`, 30_000, devMonitor);
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(webSocketDebuggerUrl, browserMonitor.diagnostics);

    const testUrl = (scenario: 'still' | 'video') => (
      `http://127.0.0.1:${port}/hype-card-breakout-browser-test.html`
      + `?viewer=workspace-journey&statTrackerReturnTest=1&scenario=${scenario}`
    );
    editorPage = await openPage(connection, testUrl('still'), {
      viewport: { width: 1280, height: 900, mobile: false },
    });
    const session = editorPage.sessionId;
    await waitFor(
      connection,
      session,
      `location.pathname === '/studio/hype-card' && document.querySelector('h1')?.textContent?.includes('Hype Cards')`,
      Boolean,
      30_000,
    );
    assert.equal(await connection.evaluate<string>('document.body.dataset.signedInFixture', session), 'true');
    assert.equal(await connection.evaluate<number>(
      `document.querySelectorAll('[aria-label="Hype Card walkthrough steps"] [role="tab"]').length`,
      session,
    ), 3, 'the owner walkthrough has Media, Design, and Review steps');
    assert.equal(await connection.evaluate<boolean>(
      `Boolean(document.querySelector('[data-testid="button-walkthrough-step-moment"]'))`,
      session,
    ), false, 'the custom moment step is removed');
    await connection.evaluate(
      `document.querySelector('[data-testid="button-walkthrough-step-design"]')?.click()`,
      session,
    );
    await waitFor(connection, session, `Boolean(document.querySelector('[data-testid="frame-template-cycler"]')) && Boolean(document.querySelector('[data-testid="lower-third-template-cycler"]'))`, Boolean);
    assert.equal(await connection.evaluate<boolean>(
      `Boolean(document.querySelector('[data-testid="hype-card-appearance-controls"] [data-testid="card-design-picker-cards"]'))`,
      session,
    ), false, 'the editor uses arrow controls instead of the tall frame grid');
    assert.equal(await connection.evaluate<boolean>(
      `Boolean(document.querySelector('[data-testid="hype-card-appearance-controls"] [data-testid="lower-third-template-picker"]'))`,
      session,
    ), false, 'the editor uses arrow controls instead of the tall lower-third grid');
    await waitFor(connection, session, `Boolean(document.querySelector('[data-testid="panel-breakout-controls"]'))`, Boolean);

    const panelVisible = await connection.evaluate<boolean>(
      `(() => {
        const panel = document.querySelector('[data-testid="panel-breakout-controls"]');
        const rect = panel?.getBoundingClientRect();
        return Boolean(panel && rect && rect.width > 0 && rect.right <= innerWidth);
      })()`,
      session,
    );
    assert.equal(panelVisible, true, 'Breakout should be visible in the signed-in editor');
    const desktopFit = await connection.evaluate<{ viewport: number; page: number }>(
      '({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth })',
      session,
    );
    assert.ok(desktopFit.page <= desktopFit.viewport + 2, `desktop layout should not scroll horizontally: ${JSON.stringify(desktopFit)}`);

    const checkboxLabel = await connection.evaluate<string>(
      `document.querySelector('[data-testid="toggle-breakout"]')?.getAttribute('aria-label') || ''`,
      session,
    );
    assert.equal(checkboxLabel, 'Enable Breakout');
    await connection.evaluate(`document.querySelector('[data-testid="toggle-breakout"]').focus()`, session);
    await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
    await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
    assert.equal(await connection.evaluate<boolean>(
      `document.querySelector('[data-testid="toggle-breakout"]').checked`,
      session,
    ), true, 'Space should enable Breakout');
    await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
    await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
    assert.equal(await connection.evaluate<boolean>(
      `document.querySelector('[data-testid="toggle-breakout"]').checked`,
      session,
    ), false, 'Space should disable Breakout');

    const selectFile = async (filePath: string) => {
      const documentNode = await connection!.send<{ root: { nodeId: number } }>('DOM.getDocument', {}, session);
      const input = await connection!.send<{ nodeId: number }>('DOM.querySelector', {
        nodeId: documentNode.root.nodeId,
        selector: '[data-testid="input-breakout-cutout"]',
      }, session);
      assert.ok(input.nodeId, 'the cutout file input should be mounted');
      await connection!.send('DOM.setFileInputFiles', { files: [filePath], nodeId: input.nodeId }, session);
    };

    await selectFile(opaquePath);
    const opaqueFeedback = await waitFor(
      connection,
      session,
      `document.querySelector('[data-testid="text-breakout-availability"]')?.textContent || ''`,
      (value) => value.includes('does not have a usable transparent background'),
      10_000,
    );
    assert.match(opaqueFeedback, /background-removed PNG or WebP/);
    assert.equal(await connection.evaluate<boolean>(
      `Boolean(document.querySelector('[role="status"][data-testid="text-breakout-availability"]'))`,
      session,
    ), true, 'opaque-image feedback should be announced as a status message');
    assert.equal(await connection.evaluate<boolean>(
      `Boolean(document.querySelector('[data-testid="img-breakout-cutout-preview"]'))`,
      session,
    ), false, 'an opaque image must not replace the cutout');

    await selectFile(transparentPath);
    await waitFor(connection, session, `Boolean(document.querySelector('[data-testid="img-breakout-cutout-preview"]'))`, Boolean, 10_000);
    assert.equal(await connection.evaluate<boolean>(
      `document.querySelector('[data-testid="toggle-breakout"]').checked`,
      session,
    ), true, 'adding a transparent cutout should enable Breakout');

    await connection.evaluate(`document.querySelector('[data-testid="button-breakout-color-red"]').click()`, session);
    assert.equal(await connection.evaluate<boolean>(
      `document.querySelector('[data-testid="button-breakout-color-red"]').getAttribute('aria-pressed') === 'true'`,
      session,
    ), true, 'preset color selection should update the selected state');
    assert.equal(await connection.evaluate<string>(
      `document.querySelector('[data-testid="input-breakout-hex-color"]').value`,
      session,
    ), '#F04444');

    await connection.evaluate(`(() => {
      const picker = document.querySelector('[data-testid="input-breakout-custom-color"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(picker, '#17BC8A');
      picker.dispatchEvent(new Event('input', { bubbles: true }));
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="input-breakout-hex-color"]')?.value || ''`, (value) => value === '#17BC8A');
    await connection.evaluate(`(() => {
      const hex = document.querySelector('[data-testid="input-breakout-hex-color"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(hex, '#DA44EE');
      hex.dispatchEvent(new Event('input', { bubbles: true }));
      hex.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="input-breakout-custom-color"]')?.value || ''`, (value) => value.toUpperCase() === '#DA44EE');

    const dragRange = async (id: string, value: number) => {
      const position = await connection!.evaluate<{
        startX: number;
        targetX: number;
        y: number;
      }>(`(() => {
        const range = document.querySelector('[data-testid="${id}"]');
        range.scrollIntoView({ block: 'center' });
        const rect = range.getBoundingClientRect();
        const min = Number(range.min);
        const max = Number(range.max);
        const thumbInset = 8;
        const trackWidth = Math.max(1, rect.width - thumbInset * 2);
        const currentRatio = (Number(range.value) - min) / (max - min);
        const targetRatio = (${value} - min) / (max - min);
        return {
          startX: rect.left + thumbInset + currentRatio * trackWidth,
          targetX: rect.left + thumbInset + targetRatio * trackWidth,
          y: rect.top + rect.height / 2,
        };
      })()`, session);
      await connection!.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: position.startX,
        y: position.y,
        button: 'none',
        buttons: 0,
      }, session);
      await connection!.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: position.startX,
        y: position.y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      }, session);
      await connection!.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: position.targetX,
        y: position.y,
        button: 'left',
        buttons: 1,
      }, session);
      await connection!.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: position.targetX,
        y: position.y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      }, session);
    };
    await dragRange('input-breakout-zoom', 1.4);
    await dragRange('input-breakout-horizontal', 72);
    await dragRange('input-breakout-vertical', -36);
    await waitFor(connection, session, `document.querySelector('[data-testid="value-breakout-vertical"]')?.textContent || ''`, (value) => value === '-36px');
    assert.equal(await connection.evaluate<string>(
      `document.querySelector('[data-testid="value-breakout-zoom"]').textContent`,
      session,
    ), '140%');
    assert.equal(await connection.evaluate<string>(
      `document.querySelector('[data-testid="value-breakout-horizontal"]').textContent`,
      session,
    ), '72px');

    await connection.evaluate(`document.querySelector('[data-testid="button-reset-breakout-position"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="value-breakout-zoom"]')?.textContent || ''`, (value) => value === '100%');
    assert.equal(await connection.evaluate<string>(
      `document.querySelector('[data-testid="value-breakout-horizontal"]').textContent`,
      session,
    ), '0px');
    assert.equal(await connection.evaluate<string>(
      `document.querySelector('[data-testid="value-breakout-vertical"]').textContent`,
      session,
    ), '0px');

    await connection.evaluate(`document.querySelector('[data-testid="button-remove-breakout-cutout"]').click()`, session);
    await waitFor(
      connection,
      session,
      `document.querySelector('[data-testid="text-breakout-availability"]')?.textContent || ''`,
      (value) => value.includes('Breakout needs a transparent cutout'),
    );
    assert.equal(await connection.evaluate<boolean>(
      `Boolean(document.querySelector('[data-testid="button-remove-breakout-cutout"]'))`,
      session,
    ), false, 'removing the cutout should clear the loaded state');

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, session);
    await waitFor(connection, session, 'innerWidth', (width) => width === 390);
    const phoneFit = await connection.evaluate<{
      viewport: number;
      page: number;
      panel: { left: number; right: number; width: number };
      bounds: { left: number; right: number }[];
    }>(`(() => {
      const panel = document.querySelector('[data-testid="panel-breakout-controls"]');
      const panelRect = panel.getBoundingClientRect();
      const bounds = [...panel.querySelectorAll('button, input, output')].map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      return {
        viewport: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
        panel: { left: panelRect.left, right: panelRect.right, width: panelRect.width },
        bounds,
      };
    })()`, session);
    assert.ok(phoneFit.page <= phoneFit.viewport + 2, `phone layout should not scroll horizontally: ${JSON.stringify(phoneFit)}`);
    assert.ok(phoneFit.panel.width > 0 && phoneFit.panel.left >= 0 && phoneFit.panel.right <= phoneFit.viewport, 'the panel should fit inside the phone viewport');
    assert.ok(phoneFit.bounds.every((rect) => rect.left >= phoneFit.panel.left - 1 && rect.right <= phoneFit.panel.right + 1), 'Breakout controls should stay within the panel at phone width');
    await connection.evaluate(`document.querySelector('[data-testid="button-breakout-color-blue"]').click()`, session);
    assert.equal(await connection.evaluate<boolean>(
      `document.querySelector('[data-testid="button-breakout-color-blue"]').getAttribute('aria-pressed') === 'true'`,
      session,
    ), true, 'preset colors should remain operable at phone width');

    await connection.send('Target.closeTarget', { targetId: editorPage.targetId });
    editorPage = undefined;

    videoPage = await openPage(connection, testUrl('video'), {
      viewport: { width: 390, height: 844, mobile: true },
    });
    const videoSession = videoPage.sessionId;
    await waitFor(connection, videoSession, `location.pathname === '/studio/hype-card' && document.querySelector('h1')?.textContent?.includes('Hype Cards')`, Boolean, 30_000);
    await connection.evaluate(`document.querySelector('[data-testid="button-walkthrough-step-design"]')?.click()`, videoSession);
    await waitFor(connection, videoSession, `Boolean(document.querySelector('[data-testid="panel-breakout-controls"]'))`, Boolean);
    const videoState = await connection.evaluate<{
      message: string;
      role: string;
      toggleDisabled: boolean;
      fileDisabled: boolean;
      colorDisabled: boolean;
      framingDisabled: boolean;
    }>(`(() => {
      const status = document.querySelector('[data-testid="text-breakout-availability"]');
      return {
        message: status?.textContent?.trim() || '',
        role: status?.getAttribute('role') || '',
        toggleDisabled: Boolean(document.querySelector('[data-testid="toggle-breakout"]')?.disabled),
        fileDisabled: Boolean(document.querySelector('[data-testid="input-breakout-cutout"]')?.disabled),
        colorDisabled: Boolean(document.querySelector('[data-testid="button-breakout-color-red"]')?.matches(':disabled')),
        framingDisabled: Boolean(document.querySelector('[data-testid="input-breakout-zoom"]')?.matches(':disabled')),
      };
    })()`, videoSession);
    assert.match(videoState.message, /Breakout is for still-photo cards\. Your video stays unchanged\./);
    assert.equal(videoState.role, 'status', 'video availability should be announced to assistive technology');
    assert.equal(videoState.toggleDisabled, true);
    assert.equal(videoState.fileDisabled, true);
    assert.equal(videoState.colorDisabled, true);
    assert.equal(videoState.framingDisabled, true);
    const videoFit = await connection.evaluate<{ viewport: number; page: number }>(
      '({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth })',
      videoSession,
    );
    assert.ok(videoFit.page <= videoFit.viewport + 2, `video state should also fit on a phone: ${JSON.stringify(videoFit)}`);
  } finally {
    if (editorPage && connection) await connection.send('Target.closeTarget', { targetId: editorPage.targetId }).catch(() => undefined);
    if (videoPage && connection) await connection.send('Target.closeTarget', { targetId: videoPage.targetId }).catch(() => undefined);
    connection?.close();
    await Promise.all([
      stopProcessGroup(browser, browserMonitor),
      stopProcessGroup(devServer, devMonitor),
    ]);
    await rm(browserProfile, { recursive: true, force: true });
    await rm(tempDirectory, { recursive: true, force: true });
  }
});