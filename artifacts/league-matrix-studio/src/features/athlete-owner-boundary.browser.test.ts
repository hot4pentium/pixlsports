import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DevToolsConnection, monitorProcess, waitFor, waitForUrl, type BrowserPage } from './browser-test-diagnostics';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const token = 'owner-boundary-test-token';

async function listen(server: Server) {
  return new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('Expected a TCP server'));
      else resolvePort(address.port);
    });
  });
}

async function availablePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

test('player-page owner tools remain private across account changes and pause', async () => {
  let paused = false;
  const requests: Array<{ viewer: string; method: string; path: string }> = [];
  const owned = {
    inviteToken: token, athleteName: 'Jordan', teamName: 'City Hoops',
    seasonName: 'Fall 2026', seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    sport: 'basketball', trackerProjectId: null, scheduleProjectId: null,
    showHypeCard: true, showStats: false, showSchedule: false, paused: false,
    liveTrackerShareToken: null,
  };
  const apiServer = createServer(async (request, response) => {
    const viewer = request.headers['x-test-viewer'] as string || 'visitor';
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    const method = request.method || 'GET';
    requests.push({ viewer, method, path });
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'content-type, x-test-viewer');
    response.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, POST, DELETE, OPTIONS');
    if (method === 'OPTIONS') { response.writeHead(204).end(); return; }
    const json = (status: number, body: unknown) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (path === '/api/athlete-invites' && method === 'GET') {
      json(viewer === 'visitor' ? 401 : 200, viewer === 'owner' ? [{ ...owned, paused }] : []);
    } else if (path === `/api/athlete-invites/${token}` && method === 'GET') {
      json(paused && viewer !== 'owner' ? 404 : 200, paused && viewer !== 'owner'
        ? { error: 'Athlete invite not found' }
        : { ...owned, paused, hypeCard: null, videos: [], stats: null, scheduleEvents: [], replies: [], liveGame: null });
    } else if (path === `/api/athlete-invites/${token}` && method === 'PATCH' && viewer === 'owner') {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      paused = Boolean((JSON.parse(raw) as { paused: boolean }).paused);
      json(200, { ...owned, paused });
    } else if (path === '/api/hype-card-shares' && method === 'GET') {
      json(viewer === 'owner' ? 200 : 401, viewer === 'owner' ? [] : { error: 'Unauthorized' });
    } else {
      json(viewer === 'visitor' ? 401 : 404, { error: 'Not found' });
    }
  });
  const apiPort = await listen(apiServer);
  const vitePort = await availablePort();
  const debugPort = await availablePort();
  const vite = spawn('pnpm', ['exec', 'vite', '--config', 'vite.athlete-owner-boundary.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: { ...process.env, PORT: String(vitePort), BASE_PATH: '/', REPL_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const viteMonitor = monitorProcess(vite, 'Vite');
  let browser: ChildProcess | undefined;
  let browserMonitor: ReturnType<typeof monitorProcess> | undefined;
  let connection: DevToolsConnection | undefined;
  let directory: string | undefined;
  const pages: BrowserPage[] = [];
  try {
    await waitForUrl(`http://127.0.0.1:${vitePort}/athlete-owner-boundary-test.html`, 30_000, viteMonitor);
    directory = await mkdtemp(resolve(tmpdir(), 'pixl-athlete-owner-boundary-'));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${directory}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((result) => result.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);

    const open = async (viewer: 'owner' | 'other' | 'visitor', view: 'public' | 'manage') => {
      const target = await connection!.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await connection!.send<{ sessionId: string }>('Target.attachToTarget', {
        targetId: target.targetId, flatten: true,
      });
      pages.push({ sessionId, targetId: target.targetId });
      await connection!.send('Page.enable', {}, sessionId);
      await connection!.send('Runtime.enable', {}, sessionId);
      await connection!.send('Page.addScriptToEvaluateOnNewDocument', { source: `
        (() => {
          const originalFetch = window.fetch.bind(window);
          window.fetch = (input, init) => {
            const url = typeof input === 'string' ? input : input.url;
            if (!url.startsWith('/api/')) return originalFetch(input, init);
            const headers = new Headers(init?.headers);
            headers.set('x-test-viewer', ${JSON.stringify(viewer)});
            return originalFetch(${JSON.stringify(`http://127.0.0.1:${apiPort}`)} + url, { ...init, headers });
          };
        })();
      ` }, sessionId);
      await connection!.send('Page.navigate', {
        url: `http://127.0.0.1:${vitePort}/athlete-owner-boundary-test.html?viewer=${viewer}&view=${view}`,
      }, sessionId);
      return sessionId;
    };
    const element = (selector: string) => `Boolean(document.querySelector(${JSON.stringify(selector)}))`;
    const owner = await open('owner', 'public');
    await waitFor(connection, owner, element('[data-testid="link-manage-athlete-hype-page"]'), Boolean, 30_000);
    const other = await open('other', 'public');
    await waitFor(connection, other, element('[data-testid="public-athlete-invite"]'), Boolean, 30_000);
    const visitor = await open('visitor', 'public');
    await waitFor(connection, visitor, element('[data-testid="public-athlete-invite"]'), Boolean, 30_000);
    for (const session of [other, visitor]) {
      assert.equal(await connection.evaluate(element('[data-testid="link-manage-athlete-hype-page"]'), session), false);
      assert.equal(await connection.evaluate(element('[data-testid="owner-hype-page-management"]'), session), false);
    }
    const otherManage = await open('other', 'manage');
    await waitFor(connection, otherManage, "Boolean(document.body?.innerText.toLowerCase().includes('management unavailable'))", Boolean, 30_000);
    const visitorManage = await open('visitor', 'manage');
    await waitFor(connection, visitorManage, "Boolean(document.body?.innerText.toLowerCase().includes('sign in to manage'))", Boolean, 30_000);
    for (const session of [otherManage, visitorManage]) {
      assert.equal(await connection.evaluate(element('[data-testid="owner-hype-page-management"]'), session), false);
    }
    const ownerManage = await open('owner', 'manage');
    await waitFor(connection, ownerManage, element('[data-testid="owner-hype-page-management"]'), Boolean, 30_000);
    for (const label of ['Pause Hype Page', 'Start Game Day Live', 'Visible sections', 'Manage posted videos', 'Add a video here']) {
      assert.ok((await connection.evaluate<string>("document.body.innerText", ownerManage)).toLowerCase().includes(label.toLowerCase()), label);
    }
    await connection.evaluate("Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Pause Hype Page')).click()", ownerManage);
    await waitFor(connection, ownerManage, "Boolean(document.body?.innerText.toLowerCase().includes('resume hype page'))", Boolean, 12_000);
    assert.equal(paused, true);
    const pausedOwner = await open('owner', 'public');
    await waitFor(connection, pausedOwner, element('[data-testid="link-manage-athlete-hype-page"]'), Boolean, 30_000);
    const pausedOther = await open('other', 'public');
    await waitFor(connection, pausedOther, "Boolean(document.body?.innerText.toLowerCase().includes('athlete page unavailable'))", Boolean, 30_000);
    const pausedVisitor = await open('visitor', 'public');
    await waitFor(connection, pausedVisitor, "Boolean(document.body?.innerText.toLowerCase().includes('athlete page unavailable'))", Boolean, 30_000);
    for (const session of [pausedOther, pausedVisitor]) {
      assert.equal(await connection.evaluate(element('[data-testid="owner-hype-page-management"]'), session), false);
      assert.equal(await connection.evaluate(element('[data-testid="link-manage-athlete-hype-page"]'), session), false);
    }
    assert.ok(requests.some(({ viewer, path }) => viewer === 'other' && path === '/api/athlete-invites'));
    assert.ok(requests.some(({ viewer, method }) => viewer === 'owner' && method === 'PATCH'));
    assert.equal(requests.some(({ viewer, method }) => viewer !== 'owner' && method !== 'GET' && method !== 'OPTIONS'), false);
  } finally {
    if (connection) for (const page of pages) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor && !browserMonitor.hasExited()) browser.kill('SIGTERM');
    if (browserMonitor) await browserMonitor.waitForExit();
    if (!viteMonitor.hasExited()) vite.kill('SIGTERM');
    await viteMonitor.waitForExit();
    await new Promise<void>((resolveClose, reject) => apiServer.close((error) => error ? reject(error) : resolveClose()));
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});