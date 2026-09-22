import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DevToolsConnection,
  monitorProcess,
  waitFor,
  waitForUrl,
  type BrowserPage,
  type ProcessMonitor,
} from './browser-test-diagnostics';

const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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

async function openLandingPage(
  connection: DevToolsConnection,
  appUrl: string,
  viewport: { width: number; height: number },
  reducedMotion = false,
): Promise<BrowserPage> {
  const target = await connection.send<{ targetId: string }>('Target.createTarget', {
    url: 'about:blank',
  });
  const attached = await connection.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const { sessionId } = attached;

  await connection.send('Page.enable', {}, sessionId);
  await connection.send('Runtime.enable', {}, sessionId);
  await connection.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width < 600,
  }, sessionId);
  await connection.send('Emulation.setEmulatedMedia', {
    features: [{
      name: 'prefers-reduced-motion',
      value: reducedMotion ? 'reduce' : 'no-preference',
    }],
  }, sessionId);

  const page = { sessionId, targetId: target.targetId };
  connection.registerTarget(page.targetId, page.sessionId);
  await connection.send('Page.navigate', { url: appUrl }, page.sessionId);
  await waitFor(
    connection,
    page.sessionId,
    'document.querySelector("[data-testid=\\"landing-sports-banner\\"]")?.complete',
    (loaded) => loaded === true,
  );
  await connection.evaluate('document.fonts?.ready', page.sessionId);
  await waitFor(
    connection,
    page.sessionId,
    'document.querySelector("[data-testid=\\"landing-sports-banner\\"]")?.naturalWidth',
    (width) => width === 2146,
  );
  return page;
}

type LandingLayout = {
  viewportWidth: number;
  documentScrollWidth: number;
  bodyScrollWidth: number;
  ctaBottom: number;
  showcaseTop: number;
  banner: {
    clientWidth: number;
    scrollWidth: number;
    left: number;
    right: number;
    imageWidth: number;
    imageHeight: number;
  };
  checklistVideo: {
    top: number;
    left: number;
    right: number;
    width: number;
    height: number;
    borderRadius: string;
    overflow: string;
    controls: boolean;
    muted: boolean;
    loop: boolean;
    playsInline: boolean;
    autoplay: boolean;
  };
  texture: {
    sectionCount: number;
    animationName: string;
    animationDuration: string;
    backgroundImage: string;
  };
};

async function readLandingLayout(
  connection: DevToolsConnection,
  page: BrowserPage,
): Promise<LandingLayout> {
  return connection.evaluate<LandingLayout>(`(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
    const banner = rect('.landing-sports-banner-scroll');
    const image = rect('[data-testid="landing-sports-banner"]');
    const cta = rect('[data-testid="link-hero-explore-tools"]');
    const showcase = rect('[data-testid="landing-sport-showcase"]');
    return {
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      ctaBottom: cta?.bottom ?? -1,
      showcaseTop: showcase?.top ?? -1,
      banner: {
        clientWidth: document.querySelector('.landing-sports-banner-scroll')?.clientWidth ?? -1,
        scrollWidth: document.querySelector('.landing-sports-banner-scroll')?.scrollWidth ?? -1,
        left: banner?.left ?? -1,
        right: banner?.right ?? -1,
        imageWidth: image?.width ?? -1,
        imageHeight: image?.height ?? -1,
      },
      checklistVideo: (() => {
        const video = document.querySelector('[data-testid="landing-checklist-video"]');
        const videoRect = video?.getBoundingClientRect();
        return {
          top: videoRect?.top ?? -1,
          left: videoRect?.left ?? -1,
          right: videoRect?.right ?? -1,
          width: videoRect?.width ?? -1,
          height: videoRect?.height ?? -1,
          borderRadius: video instanceof HTMLElement ? getComputedStyle(video).borderRadius : '',
          overflow: video instanceof HTMLElement ? getComputedStyle(video).overflow : '',
          controls: video instanceof HTMLVideoElement ? video.controls : true,
          muted: video instanceof HTMLVideoElement ? video.muted : false,
          loop: video instanceof HTMLVideoElement ? video.loop : false,
          playsInline: video instanceof HTMLVideoElement ? video.playsInline : false,
          autoplay: video instanceof HTMLVideoElement ? video.autoplay : false,
        };
      })(),
      beforeGameDayTitleTop: rect('[data-testid="landing-before-game-day-title"]')?.top ?? -1,
      texture: (() => {
        const sections = [...document.querySelectorAll('section.bg-landing-bg')];
        const texture = sections[0];
        const style = texture ? getComputedStyle(texture, '::before') : null;
        return {
          sectionCount: sections.length,
          animationName: style?.animationName ?? '',
          animationDuration: style?.animationDuration ?? '',
          backgroundImage: style?.backgroundImage ?? '',
        };
      })(),
    };
  })()`, page.sessionId);
}

test('landing sports banner scrolls on phones without overflowing the page', async () => {
  const portProbe = createServer();
  const port = await listen(portProbe);
  await new Promise<void>((resolveClose, rejectClose) => {
    portProbe.close((error) => error ? rejectClose(error) : resolveClose());
  });

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
  const browserProfile = await mkdtemp(resolve(tmpdir(), 'pixl-landing-home-browser-'));
  const debugProbe = createServer();
  const debugPort = await listen(debugProbe);
  await new Promise<void>((resolveClose, rejectClose) => {
    debugProbe.close((error) => error ? rejectClose(error) : resolveClose());
  });

  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  const pages: BrowserPage[] = [];

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

    const phoneWidths = [280, 320, 375, 393];
    for (const width of phoneWidths) {
      const page = await openLandingPage(connection, `http://127.0.0.1:${port}/`, {
        width,
        height: 900,
      });
      pages.push(page);
      const layout = await readLandingLayout(connection, page);

      assert.equal(layout.viewportWidth, width);
      assert.ok(layout.documentScrollWidth <= width, `document overflows at ${width}px`);
      assert.ok(layout.bodyScrollWidth <= width, `body overflows at ${width}px`);
      assert.ok(layout.banner.left >= 0, `banner starts outside the viewport at ${width}px`);
      assert.ok(layout.banner.right <= width, `banner ends outside the viewport at ${width}px`);
      assert.ok(layout.banner.scrollWidth > layout.banner.clientWidth, `banner should scroll within ${width}px`);
      assert.ok(layout.banner.imageWidth >= 900, `banner should remain readable at ${width}px`);
      assert.ok(layout.ctaBottom <= layout.showcaseTop, `hero CTA is not above banner at ${width}px`);
      assert.equal(layout.texture.sectionCount, 2);
      assert.equal(layout.texture.animationName, 'landing-background-drift');
      assert.equal(layout.texture.animationDuration, '38s');
      assert.notEqual(layout.texture.backgroundImage, 'none');
       assert.ok(layout.checklistVideo.width > 0, `checklist video is not rendered at ${width}px`);
       assert.ok(layout.checklistVideo.right <= width, `checklist video overflows at ${width}px`);
        assert.equal(layout.checklistVideo.borderRadius, '24px');
        assert.equal(layout.checklistVideo.overflow, 'hidden');
       assert.equal(layout.checklistVideo.controls, false);
       assert.equal(layout.checklistVideo.muted, true);
       assert.equal(layout.checklistVideo.loop, true);
       assert.equal(layout.checklistVideo.playsInline, true);
    }

    const desktopPage = await openLandingPage(connection, `http://127.0.0.1:${port}/`, {
      width: 1440,
      height: 1000,
    });
    pages.push(desktopPage);
    const desktopLayout = await readLandingLayout(connection, desktopPage);
    assert.ok(desktopLayout.documentScrollWidth <= 1440);
    assert.ok(desktopLayout.bodyScrollWidth <= 1440);
    assert.ok(desktopLayout.banner.right <= 1440);
    assert.ok(desktopLayout.banner.scrollWidth <= desktopLayout.banner.clientWidth);
    assert.ok(desktopLayout.banner.imageWidth > 1000);
    assert.ok(Math.abs(desktopLayout.banner.imageWidth / desktopLayout.banner.imageHeight - 2146 / 733) < 0.01);
    assert.ok(desktopLayout.ctaBottom <= desktopLayout.showcaseTop);
    assert.ok(desktopLayout.checklistVideo.width > 0);
    assert.ok(desktopLayout.checklistVideo.right <= 1440);
    assert.ok(Math.abs(
      desktopLayout.checklistVideo.top - desktopLayout.beforeGameDayTitleTop,
    ) <= 2);
    assert.ok(Math.abs(
      desktopLayout.checklistVideo.width / desktopLayout.checklistVideo.height - 760 / 1080,
    ) < 0.01);

    const reducedMotionPage = await openLandingPage(connection, `http://127.0.0.1:${port}/`, {
      width: 320,
      height: 900,
    }, true);
    pages.push(reducedMotionPage);
    const reducedMotionBefore = await readLandingLayout(connection, reducedMotionPage);
    assert.ok(reducedMotionBefore.banner.imageWidth >= 900);
    assert.equal(reducedMotionBefore.checklistVideo.autoplay, false);
    assert.equal(reducedMotionBefore.texture.animationName, 'none');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    const reducedMotionAfter = await readLandingLayout(connection, reducedMotionPage);
    assert.equal(reducedMotionAfter.banner.imageWidth, reducedMotionBefore.banner.imageWidth);
    assert.equal(reducedMotionAfter.banner.imageHeight, reducedMotionBefore.banner.imageHeight);
  } finally {
    if (connection) {
      await Promise.all(pages.map((page) => connection?.send('Target.closeTarget', {
        targetId: page.targetId,
      }).catch(() => undefined)));
      connection.close();
    }
    if (browser && browserMonitor && !browserMonitor.hasExited()) browser.kill('SIGTERM');
    if (browserMonitor) await browserMonitor.waitForExit();
    if (!devMonitor.hasExited()) devServer.kill('SIGTERM');
    await devMonitor.waitForExit();
    await rm(browserProfile, { recursive: true, force: true });
  }
});
