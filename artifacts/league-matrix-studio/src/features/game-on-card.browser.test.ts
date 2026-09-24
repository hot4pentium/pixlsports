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
const harnessPath = resolve(appDirectory, 'game-on-card-browser-harness.tsx');
const htmlPath = resolve(appDirectory, 'game-on-card-browser-test.html');
const shareToken = '11111111-1111-4111-8111-111111111111';
const statsToken = '22222222-2222-4222-8222-222222222222';

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
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getGetGameOnCardQueryKey } from '@workspace/api-client-react';
import { PublicGameOnCardPage } from './src/features/game-on-card';
import './src/index.css';

const token = ${JSON.stringify(shareToken)};
const initial = {
  shareToken: token,
  title: 'Tigers game day',
  teamSeason: 'Fall 2026',
  event: { id: 'game-one', type: 'game', status: 'live', date: '2026-10-03', time: '09:30', location: 'North Field', opponent: 'Ravens' },
  stage: 'live',
  prepState: 'private',
  statsState: 'live',
  statsShareToken: ${JSON.stringify(statsToken)},
  statsUpdatedAt: '2026-10-03T15:20:00.000Z',
  athletePageState: 'published',
  athletePageToken: 'alex-tiger-page',
  athleteName: 'Alex Tiger',
};
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
window.__initialGameOnCard = initial;
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('/api/game-on-cards/')) {
    return Promise.resolve(new Response(JSON.stringify(initial), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  }
  return originalFetch(input, init);
};
window.__setGameOnCard = (patch) => {
  const current = queryClient.getQueryData(getGetGameOnCardQueryKey(token));
  queryClient.setQueryData(getGetGameOnCardQueryKey(token), { ...current, ...patch });
};
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <PublicGameOnCardPage params={{ shareToken: token }} />
  </QueryClientProvider>,
);
`;
}

type FaceSnapshot = {
  face: string;
  label: string;
  pressed: string | null;
  controls: string | null;
  front: boolean;
  back: boolean;
  athleteHref: string | null;
  statsHref: string | null;
  statsUpdated: boolean;
  text: string;
  active: boolean;
  viewport: number;
  scrollWidth: number;
  buttonInBounds: boolean;
  faceInBounds: boolean;
  linkInBounds: boolean;
};

async function snapshot(connection: DevToolsConnection, page: BrowserPage) {
  return connection.evaluate<FaceSnapshot>(`(() => {
    const section = document.querySelector('main[data-testid="public-game-on-card"] section');
    const button = document.querySelector('[data-testid="game-on-flip-control"]');
    const face = document.getElementById('game-on-card-face');
    const front = document.querySelector('[data-testid="game-on-front-face"]');
    const back = document.querySelector('[data-testid="game-on-back-face"]');
    const athlete = document.querySelector('[data-testid="game-on-athlete-page-link"]');
    const stats = document.querySelector('[data-testid="game-on-stats-link"]');
    const inside = (element) => {
      if (!element) return true;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1;
    };
    return {
      face: section?.getAttribute('aria-label') || '',
      label: button?.textContent?.trim() || '',
      pressed: button?.getAttribute('aria-pressed') ?? null,
      controls: button?.getAttribute('aria-controls') ?? null,
      front: !!front,
      back: !!back,
      athleteHref: athlete?.getAttribute('href') ?? null,
      statsHref: stats?.getAttribute('href') ?? null,
      statsUpdated: !!document.querySelector('[data-testid="game-on-stats-updated"]'),
      text: face?.textContent || '',
      active: document.activeElement === button,
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      buttonInBounds: inside(button),
      faceInBounds: inside(face),
      linkInBounds: inside(athlete || stats),
    };
  })()`, page.sessionId);
}

async function pressFlip(connection: DevToolsConnection, page: BrowserPage) {
  await connection.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32,
  }, page.sessionId);
  await connection.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32,
  }, page.sessionId);
}

test('public Game On Card flips by keyboard and limits links to the active face at phone and desktop widths', async () => {
  await writeFile(harnessPath, harnessSource(), 'utf8');
  await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import('/game-on-card-browser-harness.tsx?test=' + Date.now()).catch(error => { document.body.dataset.testError = String(error); });</script></body></html>`, 'utf8');
  const portProbe = createServer();
  const port = await listen(portProbe);
  await new Promise<void>((resolveClose, rejectClose) => portProbe.close((error) => error ? rejectClose(error) : resolveClose()));
  const devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: { ...process.env, PORT: String(port), BASE_PATH: '/', VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const devMonitor = monitorProcess(devServer, 'Vite');
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-game-on-card-browser-'));
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: BrowserPage | undefined;

  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 30_000, devMonitor);
    const debugProbe = createServer();
    const debugPort = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${port}/game-on-card-browser-test.html`, {
      viewport: { width: 390, height: 844, mobile: true },
    });
    await waitFor(connection, page.sessionId, '!!document.querySelector("[data-testid=\\"game-on-front-face\\"]")', Boolean, 30_000);
    await connection.evaluate('document.fonts.ready', page.sessionId);

    for (const width of [390, 1280]) {
      await connection.send('Emulation.setDeviceMetricsOverride', {
        width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: width === 390,
      }, page.sessionId);
      let state = await snapshot(connection, page);
      assert.equal(state.face, 'Game On Card, event side');
      assert.equal(state.pressed, 'false');
      assert.equal(state.controls, 'game-on-card-face');
      assert.match(state.label, /Show stats/);
      assert.equal(state.front, true);
      assert.equal(state.back, false);
      assert.equal(state.athleteHref, '/player/alex-tiger-page');
      assert.equal(state.statsHref, null);
      assert.equal(state.scrollWidth <= state.viewport + 1, true, `front overflows at ${width}px`);
      assert.equal(state.buttonInBounds && state.faceInBounds && state.linkInBounds, true);

      await connection.evaluate('document.querySelector("[data-testid=\\"game-on-flip-control\\"]").focus()', page.sessionId);
      assert.equal((await snapshot(connection, page)).active, true);
      await pressFlip(connection, page);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-flip-control\\"]")?.getAttribute("aria-pressed")', (value) => value === 'true');
      state = await snapshot(connection, page);
      assert.equal(state.face, 'Game On Card, stats side');
      assert.match(state.label, /Show event/);
      assert.equal(state.front, false);
      assert.equal(state.back, true);
      assert.equal(state.athleteHref, null);
      assert.equal(state.statsHref, `/live/${statsToken}`);
      assert.equal(state.statsUpdated, true);
      assert.equal(state.active, true);
      assert.equal(state.scrollWidth <= state.viewport + 1, true, `back overflows at ${width}px`);
      assert.equal(state.buttonInBounds && state.faceInBounds && state.linkInBounds, true);

      // The API may move the share from live to final while the visitor has the card open.
      await connection.evaluate('window.__setGameOnCard({ stage: "final", statsState: "final", event: { ...window.__initialGameOnCard.event, status: "final" } })', page.sessionId);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-stats-link\\"]")?.textContent', (text) => typeof text === 'string' && text.includes('View final stats'));
      state = await snapshot(connection, page);
      assert.equal(state.statsHref, `/live/${statsToken}`);
      assert.match(state.text, /Review the completed game stats/);

      await connection.evaluate('window.__setGameOnCard({ stage: "upcoming", statsState: "not-shared", statsShareToken: undefined, statsUpdatedAt: undefined, athletePageState: "unpublished", athletePageToken: undefined })', page.sessionId);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-back-face\\"]")?.textContent', (text) => typeof text === 'string' && text.includes('Stats are not being shared'));
      state = await snapshot(connection, page);
      assert.match(state.text, /Stats are not being shared for this event/);
      assert.doesNotMatch(state.text, /Alex Tiger|Ravens|score|touchdown/i);
      assert.equal(state.statsHref, null);
      assert.equal(state.statsUpdated, false);
      await connection.evaluate('document.querySelector("[data-testid=\\"game-on-flip-control\\"]").focus()', page.sessionId);
      await pressFlip(connection, page);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-flip-control\\"]")?.getAttribute("aria-pressed")', (value) => value === 'false');
      state = await snapshot(connection, page);
      assert.equal(state.athleteHref, null);
      assert.match(state.text, /No Athlete Hype Page is published yet/);
      assert.equal(state.statsHref, null);

      await connection.evaluate('window.__setGameOnCard({ stage: "final", statsState: "expired", athletePageState: "paused" })', page.sessionId);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-front-face\\"]")?.textContent', (text) => typeof text === 'string' && text.includes('currently paused'));
      state = await snapshot(connection, page);
      assert.match(state.text, /The Athlete Hype Page is currently paused/);
      assert.equal(state.athleteHref, null);
      await connection.evaluate('document.querySelector("[data-testid=\\"game-on-flip-control\\"]").focus()', page.sessionId);
      await pressFlip(connection, page);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-flip-control\\"]")?.getAttribute("aria-pressed")', (value) => value === 'true');
      state = await snapshot(connection, page);
      assert.match(state.text, /temporary stats link has expired/);
      assert.doesNotMatch(state.text, /Alex Tiger|Ravens|score|touchdown/i);
      assert.equal(state.statsHref, null);
      assert.equal(state.statsUpdated, false);
      assert.equal(state.scrollWidth <= state.viewport + 1, true, `expired back overflows at ${width}px`);
      assert.equal(state.buttonInBounds && state.faceInBounds, true);

      // Restore the active card before checking the other width.
      await connection.evaluate('window.__setGameOnCard(window.__initialGameOnCard)', page.sessionId);
      await connection.evaluate('document.querySelector("[data-testid=\\"game-on-flip-control\\"]").focus()', page.sessionId);
      await pressFlip(connection, page);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-flip-control\\"]")?.getAttribute("aria-pressed")', (value) => value === 'false');
    }
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor && !browserMonitor.hasExited()) browser.kill('SIGTERM');
    if (browserMonitor) await browserMonitor.waitForExit();
    if (!devMonitor.hasExited()) devServer.kill('SIGTERM');
    await devMonitor.waitForExit();
    await rm(profile, { recursive: true, force: true });
    await rm(harnessPath, { force: true });
    await rm(htmlPath, { force: true });
  }
});