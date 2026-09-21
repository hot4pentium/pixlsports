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
const shareToken = '11111111-1111-4111-8111-111111111111';
const schedule = {
  shareToken,
  title: 'Saturday Tigers',
  teamSeason: 'Fall 2026',
  events: [{
    id: 'game-one',
    type: 'game',
    status: 'upcoming',
    date: '2026-09-26',
    time: '10:00 AM',
    location: 'Home field',
    opponent: 'Riverside',
    snacks: 'Fruit',
    drinks: 'Water',
    notes: 'Arrive early',
  }],
  createdAt: '2026-09-20T12:00:00.000Z',
};

function listen(server: Server) {
  return new Promise<{ address: string; port: number }>((resolveAddress, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected a TCP server address'));
        return;
      }
      resolveAddress({ address: `http://127.0.0.1:${address.port}`, port: address.port });
    });
  });
}

async function configureSchedulePage(
  connection: DevToolsConnection,
  options: { userAgent?: string; platform?: string; maxTouchPoints?: number } = {},
) {
  const target = await connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
  const attached = await connection.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const { sessionId } = attached;
  await connection.send('Page.enable', {}, sessionId);
  await connection.send('Runtime.enable', {}, sessionId);
  if (options.userAgent) {
    await connection.send('Emulation.setUserAgentOverride', {
      userAgent: options.userAgent,
      platform: options.platform,
    }, sessionId);
  }
  await connection.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (() => {
        const schedule = ${JSON.stringify(schedule)};
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const requestUrl = typeof input === 'string' ? input : input.url;
          if (!requestUrl.includes('/api/schedule-shares/')) {
            return originalFetch(input, init);
          }
          return Promise.resolve(new Response(JSON.stringify(schedule), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }));
        };
        ${options.platform ? `Object.defineProperty(navigator, 'platform', { configurable: true, value: ${JSON.stringify(options.platform)} });` : ''}
        ${options.maxTouchPoints === undefined ? '' : `Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: ${options.maxTouchPoints} });`}
      })();
    `,
  }, sessionId);
  return { sessionId, targetId: target.targetId };
}

async function openSchedulePage(
  connection: DevToolsConnection,
  page: BrowserPage,
  appUrl: string,
) {
  connection.registerTarget(page.targetId, page.sessionId);
  await connection.send('Page.navigate', { url: appUrl }, page.sessionId);
  await waitFor(
    connection,
    page.sessionId,
    'document.querySelector("[data-testid=\\"schedule-install-prompt\\"]")?.textContent ?? ""',
    (text) => text.includes('Keep this schedule close'),
    30_000,
  );
}

async function dispatchInstallPrompt(connection: DevToolsConnection, page: BrowserPage) {
  await connection.evaluate(`(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(event, {
      prompt: {
        value: () => {
          window.__scheduleInstallPromptCalls = (window.__scheduleInstallPromptCalls || 0) + 1;
        },
      },
      userChoice: {
        value: Promise.resolve({ outcome: 'accepted' }),
      },
    });
    window.dispatchEvent(event);
  })()`, page.sessionId);
}

test('public schedule install guidance works across Android, iPhone, and desktop browsers', async () => {
  const portProbe = createServer();
  const { port } = await listen(portProbe);
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
  const browserProfile = await mkdtemp(resolve(tmpdir(), 'pixl-schedule-install-browser-'));
  const debugProbe = createServer();
  const { port: debugPort } = await listen(debugProbe);
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
    const appUrl = `http://127.0.0.1:${port}/schedule/${shareToken}`;

    const android = await configureSchedulePage(connection, {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    });
    pages.push(android);
    await openSchedulePage(connection, android, appUrl);
    await dispatchInstallPrompt(connection, android);
    await waitFor(
      connection,
      android.sessionId,
      'document.querySelector("[data-testid=\\"button-schedule-install\\"]")?.textContent ?? ""',
      (text) => text.includes('Install on phone'),
    );
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"button-schedule-install\\"]")?.click()',
      android.sessionId,
    );
    await waitFor(
      connection,
      android.sessionId,
      'document.querySelector("[data-testid=\\"schedule-install-installed\\"]")?.textContent ?? ""',
      (text) => text.includes('Available on this phone'),
    );
    assert.equal(
      await connection.evaluate<number>('window.__scheduleInstallPromptCalls || 0', android.sessionId),
      1,
    );

    const ios = await configureSchedulePage(connection, {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    pages.push(ios);
    await openSchedulePage(connection, ios, appUrl);
    assert.equal(
      await connection.evaluate<string>(
        'document.querySelector("[data-testid=\\"button-schedule-install\\"]")?.textContent?.trim()',
        ios.sessionId,
      ),
      'How to add it',
    );
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"button-schedule-install\\"]")?.focus(); document.querySelector("[data-testid=\\"button-schedule-install\\"]")?.click()',
      ios.sessionId,
    );
    await waitFor(
      connection,
      ios.sessionId,
      'document.querySelector("[data-testid=\\"schedule-install-instructions\\"]")?.textContent ?? ""',
      (text) => text.includes('tap Share, choose Add to Home Screen, then tap Add'),
    );
    assert.equal(
      await connection.evaluate<boolean>(
        'document.activeElement?.getAttribute("data-testid") === "button-schedule-install"',
        ios.sessionId,
      ),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>(
        'document.querySelector("[data-testid=\\"button-publish-schedule\\"]") === null',
        ios.sessionId,
      ),
      true,
    );

    const ipadDesktop = await configureSchedulePage(connection, {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    pages.push(ipadDesktop);
    await openSchedulePage(connection, ipadDesktop, appUrl);
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"button-schedule-install\\"]")?.click()',
      ipadDesktop.sessionId,
    );
    await waitFor(
      connection,
      ipadDesktop.sessionId,
      'document.querySelector("[data-testid=\\"schedule-install-instructions\\"]")?.textContent ?? ""',
      (text) => text.includes('tap Share, choose Add to Home Screen, then tap Add'),
    );

    const desktop = await configureSchedulePage(connection);
    pages.push(desktop);
    await openSchedulePage(connection, desktop, appUrl);
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"button-schedule-install\\"]")?.click()',
      desktop.sessionId,
    );
    await waitFor(
      connection,
      desktop.sessionId,
      'document.querySelector("[data-testid=\\"schedule-install-instructions\\"]")?.textContent ?? ""',
      (text) => text.includes('bookmark this link'),
    );
  } finally {
    for (const page of pages) {
      await connection?.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    }
    connection?.close();
    if (browser && browserMonitor && !browserMonitor.hasExited()) browser.kill('SIGTERM');
    if (browserMonitor) await browserMonitor.waitForExit();
    devServer.kill('SIGTERM');
    await devMonitor.waitForExit();
    await rm(browserProfile, { recursive: true, force: true });
  }
});