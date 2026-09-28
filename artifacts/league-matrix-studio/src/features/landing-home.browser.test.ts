import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  DevToolsConnection, monitorProcess, waitFor, waitForUrl,
  type BrowserPage, type ProcessMonitor,
} from './browser-test-diagnostics';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';

async function freePort() {
  const server: Server = createServer();
  await new Promise<void>((done, reject) => server.once('error', reject).listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP port');
  const port = address.port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

test('landing layout, links, and mobile menu work at phone and desktop widths', async () => {
  const port = await freePort();
  const debugPort = await freePort();
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-landing-browser-'));
  const server = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: { ...process.env, PORT: String(port), BASE_PATH: '/', VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverMonitor = monitorProcess(server, 'Vite');
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  const pages: BrowserPage[] = [];
  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 30_000, serverMonitor);
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(res => res.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    for (const width of [320, 393, 1440]) {
      const target = await connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
      const attached = await connection.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      const page = { targetId: target.targetId, sessionId: attached.sessionId };
      pages.push(page);
      connection.registerTarget(page.targetId, page.sessionId);
      await connection.send('Page.enable', {}, page.sessionId);
      await connection.send('Runtime.enable', {}, page.sessionId);
      await connection.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }, page.sessionId);
      await connection.send('Page.navigate', { url: `http://127.0.0.1:${port}/` }, page.sessionId);
      await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid=text-landing-headline]"))', value => value === true);
      await connection.evaluate('document.fonts.ready', page.sessionId);
      const layout = await connection.evaluate<{
        doc: number; body: number; heroImage: boolean; fanCardImage: boolean; gameOnBadge: boolean; graphicSvg: boolean; sections: number;
        cta: string; help: string; privacy: string; explainer: string; menuVisible: boolean;
      }>(`(() => ({
        doc: document.documentElement.scrollWidth, body: document.body.scrollWidth,
        heroImage: document.querySelector('.hero-image-frame img')?.complete && document.querySelector('.hero-image-frame img')?.naturalWidth > 0,
        fanCardImage: document.querySelector('.landing-athlete-render .living-card-photo')?.complete && document.querySelector('.landing-athlete-render .living-card-photo')?.naturalWidth > 0,
        gameOnBadge: document.querySelector('.event-preview-render img')?.complete && document.querySelector('.event-preview-render img')?.naturalWidth > 0 && document.querySelector('.event-preview-render')?.textContent?.includes('Harbor United'),
        graphicSvg: Boolean(document.querySelector('.graphic-preview svg')) && document.querySelector('.graphic-preview')?.textContent?.includes('MAYA RIVERA'),
        sections: document.querySelectorAll('.step-card').length,
        cta: document.querySelector('[data-testid="link-hero-get-started"]')?.getAttribute('href'),
        help: document.querySelector('[data-testid="link-footer-help"]')?.getAttribute('href'),
        privacy: document.querySelector('[data-testid="link-footer-privacy"]')?.getAttribute('href'),
        explainer: document.querySelector('[data-testid="link-landing-week-path-video"]')?.getAttribute('href'),
        menuVisible: getComputedStyle(document.querySelector('[data-testid="button-landing-mobile-menu"]')).display !== 'none',
      }))()`, page.sessionId);
      assert.ok(layout.doc <= width && layout.body <= width, `horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
      assert.equal(layout.heroImage, true);
      assert.equal(layout.fanCardImage, true);
      assert.equal(layout.gameOnBadge, true);
      assert.equal(layout.graphicSvg, true);
      assert.equal(layout.sections, 4);
      assert.equal(layout.cta, '/sign-up');
      assert.equal(layout.help, '/help');
      assert.equal(layout.privacy, '/privacy');
      assert.match(layout.explainer, /week-path-explainer\.mp4$/);
      assert.equal(layout.menuVisible, width < 700);
       await waitFor(connection, page.sessionId, 'document.querySelector(".plan-face--back img")?.naturalWidth > 0', value => value === true);
       const planBounds = await connection.evaluate<{ left: number; right: number; imageFit: string }>(`(() => {
         const card = document.querySelector('[data-testid="card-landing-step-01"]');
         return { left: card.getBoundingClientRect().left, right: card.getBoundingClientRect().right,
           imageFit: getComputedStyle(card.querySelector('img')).objectFit };
       })()`, page.sessionId);
       assert.ok(planBounds.left >= 0 && planBounds.right <= width, `Plan card escaped ${width}px viewport: ${JSON.stringify(planBounds)}`);
        assert.equal(planBounds.imageFit, 'fill');
       assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-plan-flip]").getAttribute("aria-pressed")', page.sessionId), 'false');
       if (width === 393) {
         await connection.evaluate('document.querySelector("[data-testid=button-landing-plan-flip]").focus()', page.sessionId);
         await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, page.sessionId);
         await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, page.sessionId);
       } else {
         await connection.evaluate('document.querySelector("[data-testid=button-landing-plan-flip]").click()', page.sessionId);
       }
       assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-plan-flip]").getAttribute("aria-pressed")', page.sessionId), 'true');
       assert.equal(await connection.evaluate('document.querySelector(".plan-face--back").getAttribute("aria-hidden")', page.sessionId), 'false');
       assert.equal(await connection.evaluate('document.querySelector(".plan-face--front").getAttribute("aria-hidden")', page.sessionId), 'true');
       if (width === 393) {
         await connection.evaluate('document.querySelector("[data-testid=button-landing-plan-flip]").focus()', page.sessionId);
         await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, page.sessionId);
         await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, page.sessionId);
       } else {
         await connection.evaluate('document.querySelector("[data-testid=button-landing-plan-flip]").click()', page.sessionId);
       }
       assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-plan-flip]").getAttribute("aria-pressed")', page.sessionId), 'false');
       assert.equal(await connection.evaluate('document.querySelector(".plan-face--front").getAttribute("aria-hidden")', page.sessionId), 'false');
        await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=card-landing-step-02] .plan-face--back img")?.naturalWidth', value => value === 1160);
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-prep-flip]").getAttribute("aria-pressed")', page.sessionId), 'false');
        await connection.evaluate('document.querySelector("[data-testid=button-landing-prep-flip]").click()', page.sessionId);
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-prep-flip]").getAttribute("aria-pressed")', page.sessionId), 'true');
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=card-landing-step-02] .plan-face--back").getAttribute("aria-hidden")', page.sessionId), 'false');
        await connection.evaluate('document.querySelector("[data-testid=button-landing-prep-flip]").click()', page.sessionId);
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-prep-flip]").getAttribute("aria-pressed")', page.sessionId), 'false');
        await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=card-landing-step-03] .plan-face--back img")?.naturalWidth', value => value === 1160);
        await connection.evaluate('document.querySelector("[data-testid=button-landing-follow-flip]").click()', page.sessionId);
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-follow-flip]").getAttribute("aria-pressed")', page.sessionId), 'true');
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=card-landing-step-03] .plan-face--back").getAttribute("aria-hidden")', page.sessionId), 'false');
        await connection.evaluate('document.querySelector("[data-testid=button-landing-follow-flip]").click()', page.sessionId);
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-follow-flip]").getAttribute("aria-pressed")', page.sessionId), 'false');
      if (width < 700) {
        await connection.evaluate('document.querySelector("[data-testid=button-landing-mobile-menu]").click()', page.sessionId);
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-mobile-menu]").getAttribute("aria-expanded")', page.sessionId), 'true');
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=link-mobile-landing-tools]").getAttribute("href")', page.sessionId), '#tools');
        await connection.evaluate('document.querySelector("[data-testid=link-mobile-landing-tools]").click()', page.sessionId);
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-mobile-menu]").getAttribute("aria-expanded")', page.sessionId), 'false');
      }
    }
    const page = pages[0];
    await connection.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, page.sessionId);
    assert.equal(await connection.evaluate('getComputedStyle(document.querySelector(".step-card")).transitionDuration', page.sessionId), '1e-05s');
    await connection.evaluate('document.querySelector("[data-testid=button-landing-plan-flip]").click()', page.sessionId);
    assert.equal(await connection.evaluate('getComputedStyle(document.querySelector(".plan-flip-inner")).transform', page.sessionId), 'none');
    assert.equal(await connection.evaluate('getComputedStyle(document.querySelector(".plan-face--back")).display', page.sessionId), 'flex');
    await connection.evaluate('document.querySelector("[data-testid=button-landing-plan-flip]").click()', page.sessionId);
    assert.equal(await connection.evaluate('getComputedStyle(document.querySelector(".plan-face--back")).display', page.sessionId), 'none');
    await connection.evaluate('document.querySelector("[data-testid=button-landing-prep-flip]").click()', page.sessionId);
    assert.equal(await connection.evaluate('getComputedStyle(document.querySelector("[data-testid=card-landing-step-02] .plan-face--back")).display', page.sessionId), 'flex');
    await connection.evaluate('document.querySelector("[data-testid=button-landing-follow-flip]").click()', page.sessionId);
    assert.equal(await connection.evaluate('getComputedStyle(document.querySelector("[data-testid=card-landing-step-03] .plan-face--back")).display', page.sessionId), 'flex');
  } finally {
    if (connection) {
      await Promise.all(pages.map(page => connection?.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined)));
      connection.close();
    }
    if (browser && browserMonitor && !browserMonitor.hasExited()) browser.kill('SIGTERM');
    if (browserMonitor) await browserMonitor.waitForExit();
    if (!serverMonitor.hasExited()) server.kill('SIGTERM');
    await serverMonitor.waitForExit();
    await rm(profile, { recursive: true, force: true });
  }
});