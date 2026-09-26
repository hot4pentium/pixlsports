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
    showHypeCard: true, showStats: true, showSchedule: false, paused: false,
    liveTrackerShareToken: null,
  };
  const stats = {
    athleteName: 'Jordan',
    sport: 'basketball',
    gamesPlayed: 3,
    score: 40,
    games: [
      {
        date: '2026-09-05',
        opponent: 'Eastside',
        score: 10,
        opponentScore: 6,
        stats: { assist: 1 },
        athleteStats: {},
      },
      {
        date: '2026-09-12',
        opponent: 'Northside',
        score: 12,
        opponentScore: 8,
        stats: { assist: 3, rebound: 4 },
        athleteStats: { assist: 1, rebound: 2 },
      },
      {
        date: '2026-09-19',
        opponent: 'Riverside',
        score: 18,
        opponentScore: 20,
        stats: { assist: 2, rebound: 5 },
        athleteStats: { assist: 2 },
      },
    ],
    stats: { assist: 6, rebound: 9 },
    updatedAt: new Date().toISOString(),
  };
  const apiServer = createServer(async (request, response) => {
    const viewer = request.headers['x-test-viewer'] as string || 'visitor';
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    const method = request.method || 'GET';
    const hasImageHighlight = request.headers['x-test-image'] === 'true';
    requests.push({ viewer, method, path });
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'content-type, x-test-viewer, x-test-image');
    response.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, POST, DELETE, OPTIONS');
    if (method === 'OPTIONS') { response.writeHead(204).end(); return; }
    const json = (status: number, body: unknown) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (path === '/api/athlete-invites' && method === 'GET') {
      json(viewer === 'visitor' ? 401 : 200, viewer === 'owner' ? [{ ...owned, paused }] : []);
    } else if (path === `/api/athlete-invites/${token}` && method === 'GET') {
      json(paused && viewer !== 'owner' ? 404 : 200, paused && viewer !== 'owner'
        ? { error: 'Athlete invite not found' }
        : {
            ...owned,
            paused,
            hypeCard: hasImageHighlight
              ? {
                  shareToken: 'image-highlight-test-token',
                  title: 'Sideline moment',
                  mediaName: 'Sideline moment',
                  mediaType: 'image',
                  posterUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
                  createdAt: new Date().toISOString(),
                }
              : null,
            videos: [],
            stats,
            scheduleEvents: [],
            replies: [],
            liveGame: null,
          });
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

    const open = async (
      viewer: 'owner' | 'other' | 'visitor',
      view: 'public' | 'manage',
      imageHighlight = false,
      hash = '',
    ) => {
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
            if (${JSON.stringify(imageHighlight)}) headers.set('x-test-image', 'true');
            return originalFetch(${JSON.stringify(`http://127.0.0.1:${apiPort}`)} + url, { ...init, headers });
          };
        })();
      ` }, sessionId);
      await connection!.send('Page.navigate', {
        url: `http://127.0.0.1:${vitePort}/athlete-owner-boundary-test.html?viewer=${viewer}&view=${view}${hash}`,
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
    await waitFor(connection, visitor, element('[data-testid="select-athlete-game"]'), Boolean, 30_000);
    await waitFor(connection, visitor, element('[data-testid="athlete-video-empty-state"]'), Boolean, 30_000);
    assert.equal(await connection.evaluate(element('[data-testid="athlete-highlights-heading"]'), visitor), false);
    assert.match(
      await connection.evaluate<string>(
        "document.querySelector('[data-testid=\"athlete-video-empty-state\"]')?.innerText || ''",
        visitor,
      ),
      /Highlights are coming/i,
    );
    assert.equal(
      await connection.evaluate(
        "Boolean(document.querySelector('[data-testid=\"athlete-video-empty-state\"]')?.innerText.includes('Video highlights'))",
        visitor,
      ),
      false,
    );
    assert.equal(await connection.evaluate(
      "Boolean(document.querySelector('[data-testid=\"athlete-game-stats\"]')?.compareDocumentPosition(document.getElementById('athlete-season-stats')) & Node.DOCUMENT_POSITION_FOLLOWING)",
      visitor,
    ), true);
    const latestGame = await connection.evaluate<string>(
      "document.querySelector('[data-testid=\"athlete-game-stat-details\"]')?.innerText || ''",
      visitor,
    );
    assert.match(latestGame, /Riverside/i);
    assert.match(
      await connection.evaluate<string>(
        "document.querySelector('[data-testid=\"athlete-game-stats-title\"]')?.textContent || ''",
        visitor,
      ),
      /Jordan’s game stats/,
    );
    assert.equal(
      await connection.evaluate<string>(
        "document.querySelector('[data-testid=\"athlete-game-stats-monogram\"]')?.textContent?.trim() || ''",
        visitor,
      ),
      'J',
    );
    assert.match(
      await connection.evaluate<string>(
        "document.querySelector('[data-testid=\"athlete-game-stat-assist\"]')?.innerText || ''",
        visitor,
      ),
      /2/,
    );
    assert.equal(await connection.evaluate(
      "Boolean(document.querySelector('[data-testid=\"athlete-game-stat-rebound\"]'))",
      visitor,
    ), false);
    assert.match(
      await connection.evaluate<string>(
        "document.querySelector('[data-testid=\"athlete-stat-source-note\"]')?.innerText || ''",
        visitor,
      ),
      /team- and athlete-attributed entries/,
    );
    const visitorWithImage = await open('visitor', 'public', true);
    await waitFor(connection, visitorWithImage, element('[data-testid="athlete-highlight-image"]'), Boolean, 30_000);
    assert.equal(await connection.evaluate(element('[data-testid="athlete-video-empty-state"]'), visitorWithImage), false);
    assert.match(
      await connection.evaluate<string>(
        "document.querySelector('[data-testid=\"athlete-highlights-heading\"]')?.innerText || ''",
        visitorWithImage,
      ),
      /Highlights/i,
    );
    await connection.evaluate(`(() => {
      const select = document.querySelector('[data-testid="select-athlete-game"]');
      const earlier = Array.from(select.options).find((option) => option.textContent.includes('Northside'));
      select.value = earlier.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, visitor);
    await waitFor(
      connection,
      visitor,
      "document.querySelector('[data-testid=\"athlete-game-stat-details\"]')?.innerText.toLowerCase().includes('northside')",
      Boolean,
      12_000,
    );
    assert.match(
      await connection.evaluate<string>(
        "document.querySelector('[data-testid=\"athlete-game-stat-rebound\"]')?.innerText || ''",
        visitor,
      ),
      /2/,
    );
    await connection.evaluate(`(() => {
      const select = document.querySelector('[data-testid="select-athlete-game"]');
      const earlier = Array.from(select.options).find((option) => option.textContent.includes('Eastside'));
      select.value = earlier.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, visitor);
    await waitFor(
      connection,
      visitor,
      "document.querySelector('[data-testid=\"athlete-game-stat-details\"]')?.innerText.toLowerCase().includes('eastside')",
      Boolean,
      12_000,
    );
    assert.match(
      await connection.evaluate<string>(
        "document.querySelector('[data-testid=\"athlete-game-stats-empty\"]')?.innerText || ''",
        visitor,
      ),
      /No individual stats were recorded for Jordan/,
    );
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
    const signInRedirect = await connection.evaluate<string>(
      "new URL(document.querySelector('a[href*=\"redirect_url\"]')?.href || window.location.href).searchParams.get('redirect_url') || ''",
      visitorManage,
    );
    assert.equal(signInRedirect, `/player/${token}/manage#owner-fan-hypes`);
    const ownerManage = await open('owner', 'manage', false, '#owner-fan-hypes');
    await waitFor(connection, ownerManage, element('[data-testid="owner-hype-page-management"]'), Boolean, 30_000);
    await waitFor(connection, ownerManage, "document.activeElement?.id === 'owner-fan-hypes'", Boolean, 30_000);
    for (const label of ['Share Hype Card', 'Upload Photo', 'Visible Sections', 'Fan Hypes', 'Add Media']) {
      assert.ok((await connection.evaluate<string>("document.body.innerText", ownerManage)).toLowerCase().includes(label.toLowerCase()), label);
    }
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-sections\"]').click()", ownerManage);
    assert.equal(await connection.evaluate("document.querySelector('#hype-manager-panel-sections')?.hidden", ownerManage), false);
    const originalSetting = await connection.evaluate<string>("document.querySelector('[data-testid=\"section-visible-athlete-page\"] button[role=\"switch\"]')?.getAttribute('aria-checked') || ''", ownerManage);
    await connection.evaluate("document.querySelector('[data-testid=\"section-visible-athlete-page\"] button[role=\"switch\"]').click()", ownerManage);
    const changedSetting = await connection.evaluate<string>("document.querySelector('[data-testid=\"section-visible-athlete-page\"] button[role=\"switch\"]')?.getAttribute('aria-checked') || ''", ownerManage);
    assert.notEqual(changedSetting, originalSetting);
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-media\"]').click()", ownerManage);
    assert.equal(await connection.evaluate("document.querySelector('#hype-manager-panel-media')?.hidden", ownerManage), false);
    assert.equal(await connection.evaluate("document.querySelector('#hype-manager-panel-sections')?.hidden", ownerManage), true);
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-sections\"]').click()", ownerManage);
    assert.equal(await connection.evaluate<string>("document.querySelector('[data-testid=\"section-visible-athlete-page\"] button[role=\"switch\"]')?.getAttribute('aria-checked') || ''", ownerManage), changedSetting);
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-share\"]').click()", ownerManage);
    for (const label of ['Pause Hype Page', 'Start Game Day Live']) {
      assert.ok((await connection.evaluate<string>("document.body.innerText", ownerManage)).includes(label), label);
    }
    await connection.evaluate("Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Pause Hype Page')).click()", ownerManage);
    await waitFor(connection, ownerManage, "Boolean(document.body?.innerText.toLowerCase().includes('resume hype page'))", Boolean, 12_000);
    assert.equal(paused, true);
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-sections\"]').click()", ownerManage);
    assert.equal(await connection.evaluate<string>("document.querySelector('[data-testid=\"section-visible-athlete-page\"] button[role=\"switch\"]')?.getAttribute('aria-checked') || ''", ownerManage), changedSetting);
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