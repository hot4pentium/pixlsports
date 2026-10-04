import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { DevToolsConnection, monitorProcess, waitFor, waitForUrl, type BrowserPage } from './browser-test-diagnostics';
import { defaultCardAppearance } from './hype-card-appearance';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const token = 'owner-boundary-test-token';
const publicShoutoutId = '123e4567-e89b-42d3-a456-426614174000';

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

function commandExists(command: string) {
  return spawnSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' }).status === 0;
}

async function webDriverCommand<T>(
  origin: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json() as { value?: T & { error?: string; message?: string } };
  if (!response.ok || payload.value?.error) {
    throw new Error(`WebDriver ${method} ${path} failed: ${payload.value?.message || response.statusText}`);
  }
  return payload.value as T;
}

async function waitForWebDriverValue<T>(
  evaluate: () => Promise<T>,
  isReady: (value: T) => boolean,
  description: string,
) {
  const deadline = Date.now() + 15_000;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await evaluate();
    if (isReady(lastValue)) return lastValue;
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${JSON.stringify(lastValue)}`);
}

test('player-page owner tools remain private across account changes and pause', async () => {
  let paused = false;
  let profileNameUpdateResponseSent = false;
  const requests: Array<{ viewer: string; method: string; path: string }> = [];
  const publicShoutouts = [{
    id: publicShoutoutId,
    reaction: '🔥',
    message: 'Amazing hustle, Jordan!',
    createdAt: new Date().toISOString(),
  }];
  const ownerShoutouts = [
    {
      ...publicShoutouts[0],
      senderName: null,
      publiclyVisible: true,
    },
    {
      id: '123e4567-e89b-42d3-a456-426614174001',
      reaction: '👏',
      senderName: 'Private sender',
      message: 'A private note for Jordan.',
      publiclyVisible: false,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    },
  ];
  const liveTapAccesses: Array<{ id: string; createdAt: string; accessToken: string }> = [];
  const testLiveTapAccessId = '123e4567-e89b-42d3-a456-426614174002';
  const testLiveTapAccessToken = 'family-live-tap-qr-test-access-token-0123456789';
  const owned = {
    inviteToken: token, athleteName: 'Randal', teamName: 'City Hoops',
    seasonName: 'Fall 2026', seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    sport: 'basketball', trackerProjectId: null, scheduleProjectId: null,
    showHypeCard: true, showStats: true, showSchedule: false, hypesEnabled: true,
    timezone: 'America/New_York', paused: false,
    liveTrackerShareToken: null,
  };
  const stats = {
    athleteName: 'Randal',
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
  const fanCard = {
    inviteToken: token,
    hypesEnabled: true,
    athleteName: 'Jordan',
    teamName: 'City Hoops',
    seasonName: 'Fall 2026',
    seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    timezone: 'America/New_York',
    sport: 'basketball',
    photoUrl: null,
    hypeCard: null,
    videos: [],
    stats: null,
    scheduleEvents: [],
    showEvents: false,
    events: [],
    replies: [],
    liveScoreboard: null,
    cardAppearance: defaultCardAppearance('classic'),
    liveTaps: {
      active: false,
      gameId: null,
      cheers: [
        { key: 'bucket', label: 'Bucket', emoji: '🏀', count: 0 },
        { key: 'three', label: 'Three!', emoji: '🎯', count: 0 },
        { key: 'and-one', label: 'And one', emoji: '💥', count: 0 },
        { key: 'big-stop', label: 'Big stop', emoji: '🛡️', count: 0 },
        { key: 'lets-go', label: "Let's go", emoji: '💙', count: 0 },
      ],
    },
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
    } else if (path === `/api/athlete-invites/${token}/fan` && method === 'GET') {
      json(paused ? 404 : 200, paused ? { error: 'Athlete invite not found' } : fanCard);
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
      const changes = JSON.parse(raw) as Partial<typeof owned>;
      Object.assign(owned, changes);
      fanCard.athleteName = owned.athleteName;
      paused = Boolean(owned.paused);
      json(200, { ...owned, paused });
      if (changes.athleteName === 'Kimberly') profileNameUpdateResponseSent = true;
    } else if (path === `/api/athlete-invites/${token}/public-shoutouts` && method === 'GET') {
      json(200, publicShoutouts);
    } else if (path === `/api/athlete-invites/${token}/hypes` && method === 'GET' && viewer === 'owner') {
      json(200, ownerShoutouts);
    } else if (path === `/api/athlete-invites/${token}/live-taps/access-links` && method === 'GET' && viewer === 'owner') {
      json(200, liveTapAccesses.map(({ id, createdAt }) => ({ id, createdAt })));
    } else if (path === `/api/athlete-invites/${token}/live-taps/access-links` && method === 'POST' && viewer === 'owner') {
      const access = { id: testLiveTapAccessId, createdAt: new Date().toISOString() };
      liveTapAccesses.push({ ...access, accessToken: testLiveTapAccessToken });
      json(201, { ...access, accessToken: testLiveTapAccessToken });
    } else if (path === `/api/athlete-invites/${token}/live-taps/access-links/${testLiveTapAccessId}` && method === 'DELETE' && viewer === 'owner') {
      liveTapAccesses.splice(0, liveTapAccesses.length);
      response.writeHead(204).end();
    } else if (path === `/api/athlete-invites/${token}/live-taps` && method === 'POST') {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw) as { cheerKey?: string; accessToken?: string };
      if (!liveTapAccesses.some((access) => access.accessToken === body.accessToken)) {
        json(403, { error: 'A valid family Live Taps link is required to cheer.' });
      } else if (!fanCard.liveTaps.active) {
        json(409, { error: 'Live Taps are available only while Game Day Live is active.' });
      } else {
        const cheer = fanCard.liveTaps.cheers.find((item) => item.key === body.cheerKey);
        if (!cheer) {
          json(400, { error: 'Choose one of the available cheers.' });
        } else {
          cheer.count += 1;
          json(201, fanCard.liveTaps);
        }
      }
    } else if (path.startsWith(`/api/athlete-invites/${token}/hypes/`) && method === 'DELETE' && viewer === 'owner') {
      const hypeId = path.split('/').at(-1);
      const index = ownerShoutouts.findIndex((item) => item.id === hypeId);
      if (index < 0) {
        response.writeHead(404).end();
        return;
      }
      ownerShoutouts.splice(index, 1);
      for (let publicIndex = publicShoutouts.length - 1; publicIndex >= 0; publicIndex -= 1) {
        if (publicShoutouts[publicIndex]?.id === hypeId) publicShoutouts.splice(publicIndex, 1);
      }
      response.writeHead(204).end();
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
      view: 'public' | 'manage' | 'fan',
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
          if (${JSON.stringify(viewer)} === 'owner') window.confirm = () => true;
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
    const ownerFanCard = await open('owner', 'fan');
    await waitFor(connection, ownerFanCard, element('.living-card-controls'), Boolean, 30_000);
    await waitFor(connection, ownerFanCard, element('[data-testid="link-manage-living-card"]'), Boolean, 30_000);
    await waitFor(connection, ownerFanCard, "document.querySelector('[data-testid=\"text-living-card-athlete-name\"]')?.textContent === 'Kimberly'", Boolean, 12_000);
    await waitForWebDriverValue(async () => owned.athleteName, (name) => name === 'Kimberly', 'the saved card name to match the athlete profile');
    await waitForWebDriverValue(async () => profileNameUpdateResponseSent, Boolean, 'the profile name update response');
    assert.equal(fanCard.athleteName, 'Kimberly', 'the shared card record is updated from the owner profile');
    assert.equal(await connection.evaluate(element('[data-testid="button-open-fan-card-follow"]'), ownerFanCard), false);
    assert.equal(await connection.evaluate(element('[data-testid="button-open-fan-card-hypes"]'), ownerFanCard), false);
    const otherFanCard = await open('other', 'fan');
    await waitFor(connection, otherFanCard, element('[data-testid="button-open-fan-card-follow"]'), Boolean, 30_000);
    await waitFor(connection, otherFanCard, "document.querySelector('[data-testid=\"text-living-card-athlete-name\"]')?.textContent === 'Kimberly'", Boolean, 12_000);
    assert.equal(await connection.evaluate(element('[data-testid="button-open-fan-card-hypes"]'), otherFanCard), true);
    fanCard.liveTaps.active = true;
    fanCard.liveTaps.gameId = 'live-game';
    const visitorFanCard = await open('visitor', 'fan');
    await waitFor(connection, visitorFanCard, element('[data-testid="button-open-fan-card-follow"]'), Boolean, 30_000);
    assert.equal(await connection.evaluate(element('[data-testid="button-open-fan-card-hypes"]'), visitorFanCard), true);
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true }, visitorFanCard);
    await connection.evaluate("document.querySelector('[data-testid=\"button-living-card-responses\"]').click()", visitorFanCard);
    await waitFor(connection, visitorFanCard, element('[data-testid="living-card-responses-side"]'), Boolean, 12_000);
    await waitFor(connection, visitorFanCard, "document.querySelector('[data-testid=\"living-card-responses-side\"]')?.innerText.includes('Amazing hustle, Jordan!')", Boolean, 12_000);
    await waitFor(connection, visitorFanCard, `(() => {
      const inner = document.querySelector('.living-card-flip-inner');
      const m11 = new DOMMatrixReadOnly(getComputedStyle(inner).transform).m11;
      return m11 < 0.9 && m11 > -0.9;
    })()`, Boolean, 12_000);
    await waitFor(connection, visitorFanCard, `(() => {
      const card = document.querySelector('#living-card-display');
      const inner = document.querySelector('.living-card-flip-inner');
      return card?.dataset.side === 'responses'
        && Math.abs(new DOMMatrixReadOnly(getComputedStyle(inner).transform).m11 + 1) < 0.001;
    })()`, Boolean, 12_000);
    const backFaceMotion = await connection.evaluate<{ duration: string; backface: string; backM11: number }>(`(() => {
      const inner = document.querySelector('.living-card-flip-inner');
      const back = document.querySelector('.living-card-flip-back');
      return {
        duration: getComputedStyle(inner).transitionDuration,
        backface: getComputedStyle(back).backfaceVisibility,
        backM11: new DOMMatrixReadOnly(getComputedStyle(back).transform).m11,
      };
    })()`, visitorFanCard);
    assert.equal(backFaceMotion.duration, '0.72s');
    assert.equal(backFaceMotion.backface, 'hidden');
    assert.ok(Math.abs(backFaceMotion.backM11 + 1) < 0.001);
    const visitorResponses = await connection.evaluate<string>(
      "document.querySelector('[data-testid=\"living-card-responses-side\"]')?.innerText || ''",
      visitorFanCard,
    );
    assert.match(visitorResponses, /Amazing hustle, Jordan!/);
    assert.doesNotMatch(visitorResponses, /A private note for Jordan|Private sender/);
    assert.ok(requests.some(({ viewer, method, path }) => (
      viewer === 'visitor' && method === 'GET' && path === `/api/athlete-invites/${token}/public-shoutouts`
    )), 'visitors load the public-shoutouts endpoint');
    for (const side of ['stats', 'live-taps', 'events']) {
      await connection.evaluate(
        `document.querySelector('[data-testid="button-living-card-${side}"]').click()`,
        visitorFanCard,
      );
      await waitFor(
        connection,
        visitorFanCard,
        `document.querySelector('#living-card-display')?.dataset.side === '${side}'`,
        Boolean,
        12_000,
      );
      if (side === 'live-taps') {
        assert.equal(await connection.evaluate(
          "document.querySelector('[data-testid=\"live-taps-family-link-required\"]')?.textContent.includes('private family QR code') && document.querySelector('[data-testid=\"live-taps-family-link-required\"]')?.textContent.includes('public HYPE Card link is view-only')",
          visitorFanCard,
        ), true, 'public card visitors are directed to the private family QR code');
        assert.equal(await connection.evaluate(
          "document.querySelector('[data-testid=\"button-live-tap-bucket\"]')?.disabled",
          visitorFanCard,
        ), true, 'the public card link alone cannot submit a Live Tap');
      }
    }
    await waitFor(connection, visitorFanCard, "document.querySelector('#living-card-display')?.dataset.side === 'events' && Boolean(document.querySelector('[data-testid=\"living-card-events-side\"]'))", Boolean, 12_000);
    assert.equal(await connection.evaluate(
      "document.querySelector('[data-testid=\"button-living-card-front\"]')?.getBoundingClientRect().top > document.querySelector('#living-card-display')?.getBoundingClientRect().bottom",
      visitorFanCard,
    ), true, 'the return-to-front control is below the card');
    await connection.evaluate("document.querySelector('[data-testid=\"button-living-card-front\"]').click()", visitorFanCard);
    await waitFor(connection, visitorFanCard, "document.querySelector('#living-card-display')?.getAttribute('aria-label') === 'Kimberly — card front'", Boolean, 12_000);
    await waitFor(connection, visitorFanCard, `(() => {
      const inner = document.querySelector('.living-card-flip-inner');
      return Math.abs(new DOMMatrixReadOnly(getComputedStyle(inner).transform).m11 - 1) < 0.001;
    })()`, Boolean, 12_000);
    assert.equal(await connection.evaluate(`[...document.querySelectorAll('.living-card-controls button')].every(button => {
      const bounds = button.getBoundingClientRect();
      const content = document.createRange();
      content.selectNodeContents(button);
      const contentBounds = content.getBoundingClientRect();
      return contentBounds.left >= bounds.left - 1 && contentBounds.right <= bounds.right + 1;
    })`, visitorFanCard), true, 'all five card controls fit at narrow phone width');
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    }, visitorFanCard);
    await connection.evaluate('window.scrollTo(0, 0)', visitorFanCard);
    const desktopCardBounds = await connection.evaluate<{
      top: number;
      bottom: number;
      height: number;
      viewportHeight: number;
    }>(`(() => {
      const card = document.querySelector('.living-card-frame-outer');
      if (!(card instanceof HTMLElement)) throw new Error('Hype Card frame is missing');
      const rect = card.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        viewportHeight: window.innerHeight,
      };
    })()`, visitorFanCard);
    assert.ok(
      desktopCardBounds.top >= 0 && desktopCardBounds.bottom <= desktopCardBounds.viewportHeight,
      'the Hype Card should fit in a typical desktop viewport without cropping',
    );
    assert.ok(
      desktopCardBounds.height >= desktopCardBounds.viewportHeight * 0.72,
      'the desktop HYPE Card uses the taller portrait layout',
    );
    assert.ok(
      desktopCardBounds.height <= desktopCardBounds.viewportHeight * 0.75,
      'the desktop card should leave room for the page header and surrounding content',
    );
    await connection.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, visitorFanCard);
    const reducedMotionDuration = await connection.evaluate<string>(
      "getComputedStyle(document.querySelector('.living-card-flip-inner')).transitionDuration",
      visitorFanCard,
    );
    const durationInSeconds = Number.parseFloat(reducedMotionDuration) * (reducedMotionDuration.endsWith('ms') ? 0.001 : 1);
    assert.ok(durationInSeconds < 0.001, 'reduced motion shortens the card turn to an effectively instant transition');
    await connection.evaluate("document.querySelector('[data-testid=\"button-living-card-responses\"]').click()", visitorFanCard);
    await waitFor(connection, visitorFanCard, `(() => {
      const card = document.querySelector('#living-card-display');
      const inner = document.querySelector('.living-card-flip-inner');
      return card?.dataset.side === 'responses'
        && Math.abs(new DOMMatrixReadOnly(getComputedStyle(inner).transform).m11 + 1) < 0.001;
    })()`, Boolean, 12_000);
    await connection.evaluate("document.querySelector('[data-testid=\"button-living-card-responses\"]').click()", ownerFanCard);
    await waitFor(connection, ownerFanCard, element('[data-testid="living-card-responses-side"]'), Boolean, 12_000);
    await waitFor(connection, ownerFanCard, "document.querySelector('[data-testid=\"living-card-responses-side\"]')?.innerText.includes('A private note for Jordan.')", Boolean, 12_000);
    const ownerResponseText = await connection.evaluate<string>(
      "document.querySelector('[data-testid=\"living-card-responses-side\"]')?.innerText || ''",
      ownerFanCard,
    );
    assert.match(ownerResponseText, /Amazing hustle, Jordan!/);
    assert.match(ownerResponseText, /A private note for Jordan/);
    assert.match(ownerResponseText, /Private · Owner only/);
    assert.ok(requests.some(({ viewer, method, path }) => (
      viewer === 'owner' && method === 'GET' && path === `/api/athlete-invites/${token}/hypes`
    )), 'the owner loads the owner-only Hypes endpoint');
    await connection.evaluate(`(() => {
      const response = Array.from(document.querySelectorAll('[data-testid="living-card-response"]'))
        .find((item) => item.innerText.includes('Amazing hustle, Jordan!'));
      response?.querySelector('button[aria-label^="Remove response"]')?.click();
    })()`, ownerFanCard);
    await waitFor(connection, ownerFanCard, "document.querySelector('[data-testid=\"living-card-responses-side\"]')?.innerText.includes('Shoutout removed.')", Boolean, 12_000);
    await waitFor(connection, ownerFanCard, "!document.querySelector('[data-testid=\"living-card-responses-side\"]')?.innerText.includes('Amazing hustle, Jordan!')", Boolean, 12_000);
    const remainingOwnerResponses = await connection.evaluate<string>(
      "document.querySelector('[data-testid=\"living-card-responses-side\"]')?.innerText || ''",
      ownerFanCard,
    );
    assert.doesNotMatch(remainingOwnerResponses, /Amazing hustle, Jordan!/);
    assert.match(remainingOwnerResponses, /A private note for Jordan/);
    assert.ok(requests.some(({ viewer, method, path }) => (
      viewer === 'owner' && method === 'DELETE' && path === `/api/athlete-invites/${token}/hypes/${publicShoutoutId}`
    )), 'the owner can remove a public shoutout by hype ID');
    assert.equal(publicShoutouts.length, 0, 'the public shoutout fixture is mutated by the owner delete');
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
      /Randal’s game stats/,
    );
    assert.equal(
      await connection.evaluate<string>(
        "document.querySelector('[data-testid=\"athlete-game-stats-monogram\"]')?.textContent?.trim() || ''",
        visitor,
      ),
      'R',
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
      /No individual stats were recorded for Randal/,
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
    const taskOrder = await connection.evaluate<string[]>(
      "Array.from(document.querySelectorAll('[data-testid^=\"button-hype-manager-\"]')).map(button => button.querySelector('.hype-manager-task-title')?.textContent?.trim() || '')",
      ownerManage,
    );
    assert.deepEqual(taskOrder.slice(0, 4), ['Share Hype Card', 'Card Design', 'Family Live Taps', 'Upload Photo']);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, ownerManage);
    await waitFor(connection, ownerManage, 'window.innerWidth === 390', Boolean, 12_000);
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-design\"]').click()", ownerManage);
    await waitFor(connection, ownerManage, "document.querySelector('#hype-manager-panel-design')?.hidden === false", Boolean, 12_000);
    const mobileTaskLayout = await connection.evaluate<{ columns: number; panelTop: number; rowBottom: number; panelBottom: number; nextRowTop: number }>(`(() => {
      const grid = document.querySelector('.hype-manager-task-grid');
      const rect = (id) => document.querySelector('[data-testid="button-hype-manager-' + id + '"]').getBoundingClientRect();
      const panel = document.querySelector('#hype-manager-panel-design').getBoundingClientRect();
      const firstRow = Math.max(rect('share').bottom, rect('design').bottom);
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length,
        panelTop: panel.top,
        rowBottom: firstRow,
        panelBottom: panel.bottom,
        nextRowTop: Math.min(rect('live-taps').top, rect('photo').top),
      };
    })()`, ownerManage);
    assert.equal(mobileTaskLayout.columns, 2, 'phone manager cards use two columns');
    assert.ok(mobileTaskLayout.panelTop >= mobileTaskLayout.rowBottom, 'the phone editor opens beneath its card row');
    assert.ok(mobileTaskLayout.nextRowTop > mobileTaskLayout.panelBottom, 'the next phone card row follows the full-width editor');
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    }, ownerManage);
    await waitFor(connection, ownerManage, 'window.innerWidth === 1280', Boolean, 12_000);
    const desktopTaskLayout = await connection.evaluate<{ columns: number; panelTop: number; rowBottom: number; panelBottom: number; nextRowTop: number }>(`(() => {
      const grid = document.querySelector('.hype-manager-task-grid');
      const rect = (id) => document.querySelector('[data-testid="button-hype-manager-' + id + '"]').getBoundingClientRect();
      const panel = document.querySelector('#hype-manager-panel-design').getBoundingClientRect();
      const firstRow = Math.max(rect('share').bottom, rect('design').bottom, rect('live-taps').bottom);
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length,
        panelTop: panel.top,
        rowBottom: firstRow,
        panelBottom: panel.bottom,
        nextRowTop: Math.min(rect('photo').top, rect('sections').top, rect('events').top),
      };
    })()`, ownerManage);
    assert.equal(desktopTaskLayout.columns, 3, 'wide manager layouts use three columns');
    assert.ok(desktopTaskLayout.panelTop >= desktopTaskLayout.rowBottom, 'the desktop editor opens beneath its card row');
    assert.ok(desktopTaskLayout.nextRowTop > desktopTaskLayout.panelBottom, 'the next desktop card row follows the full-width editor');
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-hypes\"]').click()", ownerManage);
    await waitFor(connection, ownerManage, "document.querySelector('#hype-manager-panel-hypes')?.hidden === false && document.querySelector('[data-testid=\"button-hype-manager-hypes\"]')?.getAttribute('aria-expanded') === 'true'", Boolean, 12_000);
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-hypes\"] .hype-manager-task-chevron').click()", ownerManage);
    await waitFor(connection, ownerManage, "document.querySelector('#hype-manager-panel-hypes')?.hidden === true && document.querySelector('[data-testid=\"button-hype-manager-hypes\"]')?.getAttribute('aria-expanded') === 'false'", Boolean, 12_000);
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-hypes\"] .hype-manager-task-chevron').click()", ownerManage);
    await waitFor(connection, ownerManage, "document.querySelector('#hype-manager-panel-hypes')?.hidden === false && document.querySelector('[data-testid=\"button-hype-manager-hypes\"]')?.getAttribute('aria-expanded') === 'true'", Boolean, 12_000);
    for (const label of ['Share Hype Card', 'Upload Photo', 'Visible Sections', 'Fan Shoutouts']) {
      assert.ok((await connection.evaluate<string>("document.body.innerText", ownerManage)).toLowerCase().includes(label.toLowerCase()), label);
    }
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-live-taps\"]').click()", ownerManage);
    await waitFor(connection, ownerManage, "document.querySelector('#hype-manager-panel-live-taps')?.hidden === false", Boolean, 12_000);
    await waitFor(connection, ownerManage, "document.querySelector('[data-testid=\"button-create-live-tap-qr\"]') !== null", Boolean, 12_000);
    await connection.evaluate("document.querySelector('[data-testid=\"button-create-live-tap-qr\"]').click()", ownerManage);
    await waitFor(connection, ownerManage, "document.querySelector('[data-testid=\"img-created-live-tap-qr\"]')?.getAttribute('src')?.startsWith('data:image/png;base64,')", Boolean, 12_000);
    const familyQrImage = await connection.evaluate<{ alt: string; src: string }>(`(() => {
      const image = document.querySelector('[data-testid="img-created-live-tap-qr"]');
      return { alt: image?.getAttribute('alt') || '', src: image?.getAttribute('src') || '' };
    })()`, ownerManage);
    assert.match(familyQrImage.alt, /Private Family Live Taps QR code for Kimberly/);
    assert.ok(familyQrImage.src.length > 1000, 'the owner sees a rendered QR image instead of a copyable family URL');
    const qrPng = PNG.sync.read(Buffer.from(familyQrImage.src.replace(/^data:image\/png;base64,/, ''), 'base64'));
    const decodedFamilyQr = jsQR(Uint8ClampedArray.from(qrPng.data), qrPng.width, qrPng.height);
    assert.ok(decodedFamilyQr, 'the rendered family QR image can be decoded');
    const scannedFamilyUrl = new URL(decodedFamilyQr.data);
    assert.equal(scannedFamilyUrl.origin, `http://127.0.0.1:${vitePort}`);
    assert.equal(scannedFamilyUrl.pathname, `/fan/${token}`, 'the QR opens Kimberly’s HYPE Card');
    assert.equal(scannedFamilyUrl.search, '');
    const scannedAccessToken = new URLSearchParams(scannedFamilyUrl.hash.slice(1)).get('live-taps');
    assert.equal(scannedAccessToken, testLiveTapAccessToken, 'the QR carries its private Live Taps access in the fragment');
    assert.equal(`${scannedFamilyUrl.origin}${scannedFamilyUrl.pathname}${scannedFamilyUrl.search}`.includes(scannedAccessToken), false);
    const scannedFanCard = await open('visitor', 'fan', false, scannedFamilyUrl.hash);
    await waitFor(connection, scannedFanCard, element('.living-card-controls'), Boolean, 30_000);
    await waitFor(connection, scannedFanCard, "window.location.hash === '' && document.title.includes('Kimberly')", Boolean, 12_000);
    assert.ok(requests.some(({ viewer, method, path }) => (
      viewer === 'visitor' && method === 'GET' && path === `/api/athlete-invites/${token}/fan`
    )), 'scanning opens the intended public HYPE Card');
    const scannedCardState = await connection.evaluate<{ title: string; href: string; savedToken: string | null }>(`(() => ({
      title: document.title,
      href: window.location.href,
      savedToken: window.localStorage.getItem('pixlSports:liveTaps:${token}'),
    }))()`, scannedFanCard);
    assert.equal(scannedCardState.title, 'Kimberly · HYPE Card | Pixl Sports');
    assert.equal(scannedCardState.href.includes(testLiveTapAccessToken), false, 'the access token is removed from the address bar after it is read');
    assert.equal(scannedCardState.savedToken, testLiveTapAccessToken, 'the scanned family access is retained for this card');
    await connection.evaluate("document.querySelector('[data-testid=\"button-living-card-live-taps\"]').click()", scannedFanCard);
    await waitFor(connection, scannedFanCard, element('[data-testid="living-card-live-taps-side"]'), Boolean, 12_000);
    assert.equal(await connection.evaluate("document.querySelector('[data-testid=\"button-live-tap-bucket\"]')?.disabled", scannedFanCard), false);
    await connection.evaluate("document.querySelector('[data-testid=\"button-live-tap-bucket\"]').click()", scannedFanCard);
    await waitFor(connection, scannedFanCard, "document.querySelector('[data-testid=\"status-live-tap-feedback\"]')?.textContent?.includes('Bucket counted')", Boolean, 12_000);
    assert.equal(await connection.evaluate("document.querySelector('[data-testid=\"text-live-tap-count-bucket\"]')?.textContent", scannedFanCard), '1');
    assert.equal(await connection.evaluate(
      "Boolean(document.querySelector('[data-testid=\"input-created-live-tap-link\"], [data-testid=\"button-copy-live-tap-link\"]'))",
      ownerManage,
    ), false, 'the private family URL is not displayed or offered for copying');
    await waitFor(connection, ownerManage, `document.querySelector('[data-testid="button-revoke-live-tap-qr-${testLiveTapAccessId}"]') !== null`, Boolean, 12_000);
    await connection.evaluate(`document.querySelector('[data-testid="button-revoke-live-tap-qr-${testLiveTapAccessId}"]').click()`, ownerManage);
    await waitFor(connection, ownerManage, "document.querySelector('[data-testid=\"img-created-live-tap-qr\"]') === null && document.querySelector('[data-testid=\"status-owner-live-taps\"]')?.textContent?.includes('revoked')", Boolean, 12_000);
    await connection.evaluate("document.querySelector('[data-testid=\"button-live-tap-bucket\"]').click()", scannedFanCard);
    await waitFor(connection, scannedFanCard, "document.querySelector('[data-testid=\"status-live-tap-feedback\"]')?.textContent?.includes('invalid or has been revoked')", Boolean, 12_000);
    assert.equal(await connection.evaluate("document.querySelector('[data-testid=\"text-live-tap-count-bucket\"]')?.textContent", scannedFanCard), '1', 'revoked family access cannot add another tap');
    assert.equal(await connection.evaluate("document.querySelector('[data-testid=\"button-live-tap-bucket\"]')?.disabled", scannedFanCard), true);
    assert.equal(await connection.evaluate("window.localStorage.getItem('pixlSports:liveTaps:${token}')", scannedFanCard), null, 'revoked access is removed from this card');
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-live-taps\"]').click()", ownerManage);
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-hypes\"]').click()", ownerManage);
    await waitFor(connection, ownerManage, "document.querySelector('#hype-manager-panel-hypes')?.hidden === false", Boolean, 12_000);
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-sections\"]').click()", ownerManage);
    assert.equal(await connection.evaluate("document.querySelector('#hype-manager-panel-sections')?.hidden", ownerManage), false);
    const originalSetting = await connection.evaluate<string>("document.querySelector('[data-testid=\"section-visible-athlete-page\"] button[aria-label=\"Finalized stats\"]')?.getAttribute('aria-checked') || ''", ownerManage);
    await connection.evaluate("document.querySelector('[data-testid=\"section-visible-athlete-page\"] button[role=\"switch\"]').click()", ownerManage);
    const changedSetting = await connection.evaluate<string>("document.querySelector('[data-testid=\"section-visible-athlete-page\"] button[aria-label=\"Finalized stats\"]')?.getAttribute('aria-checked') || ''", ownerManage);
    assert.notEqual(changedSetting, originalSetting);
    await waitFor(connection, ownerManage, "document.querySelector('[data-testid=\"status-owner-visible-sections\"]')?.textContent?.includes('saved')", Boolean, 12_000);
    assert.equal(owned.showStats, changedSetting === 'true', 'the Finalized stats switch is saved without submitting the form');
    await connection.evaluate("document.querySelector('[data-testid=\"section-visible-athlete-page\"] button[aria-label=\"Fan Shoutouts\"]').click()", ownerManage);
    await waitFor(connection, ownerManage, "document.querySelector('[data-testid=\"status-owner-visible-sections\"]')?.textContent?.includes('saved') && document.querySelector('[data-testid=\"section-visible-athlete-page\"] button[aria-label=\"Fan Shoutouts\"]')?.disabled === false", Boolean, 12_000);
    assert.equal(owned.hypesEnabled, false, 'Fan Shoutouts are disabled immediately on toggle');
    assert.equal(await connection.evaluate(element('[data-testid="button-hype-manager-media"]'), ownerManage), false, 'the media manager remains unavailable');
    assert.equal(await connection.evaluate("document.querySelector('#hype-manager-panel-sections')?.hidden", ownerManage), false);
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-share\"]').click()", ownerManage);
    assert.ok((await connection.evaluate<string>("document.querySelector('#hype-manager-panel-share')?.innerText || ''", ownerManage)).includes('Pause Hype Page'));
    assert.equal(await connection.evaluate(
      "Array.from(document.querySelectorAll('#hype-manager-panel-share button')).some(button => /(?:Start|Stop) Game Day Live/.test(button.textContent || ''))",
      ownerManage,
    ), false, 'Game Day Live is not controlled from the Share Hype Card panel');

    const cardNavigation = [
      { id: 'button-living-card-responses', side: 'responses' },
      { id: 'button-living-card-stats', side: 'stats' },
      { id: 'button-living-card-live-taps', side: 'live-taps' },
      { id: 'button-living-card-events', side: 'events' },
    ] as const;
    const cardViewports = [
      { name: 'phone', width: 390, height: 844, mobile: true },
      { name: 'desktop', width: 1365, height: 1400, mobile: false },
    ] as const;
    const inspectSharedCardLayout = (sessionId: string) => connection!.evaluate<{
      design: string;
      side: string;
      navBelowFrame: boolean;
      navInsideCard: boolean;
      buttons: Array<{
        height: number;
        width: number;
        left: number;
        right: number;
        visible: boolean;
        textFits: boolean;
        pressed: boolean;
      }>;
      returnFrontBelowFrame: boolean;
      returnFrontHeight: number;
    }>(`(() => {
      const stage = document.querySelector('.living-card-stage');
      const outer = document.querySelector('.living-card-frame-outer');
      const card = document.querySelector('#living-card-display');
      const controls = document.querySelector('.living-card-controls');
      const returnFront = document.querySelector('[data-testid="button-living-card-front"]');
      if (!(stage instanceof HTMLElement) || !(outer instanceof HTMLElement)
        || !(card instanceof HTMLElement) || !(controls instanceof HTMLElement)
        || !(returnFront instanceof HTMLElement)) throw new Error('Shared HYPE Card navigation is missing');
      const outerBounds = outer.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      const controlsBounds = controls.getBoundingClientRect();
      const returnBounds = returnFront.getBoundingClientRect();
      const buttons = [...controls.querySelectorAll('button')].map((button) => {
        const bounds = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        const range = document.createRange();
        range.selectNodeContents(button);
        const textBounds = range.getBoundingClientRect();
        return {
          height: bounds.height,
          width: bounds.width,
          left: bounds.left,
          right: bounds.right,
          visible: style.display !== 'none' && style.visibility !== 'hidden'
            && Number(style.opacity) > 0 && bounds.width > 0 && bounds.height > 0,
          textFits: textBounds.left >= bounds.left - 1 && textBounds.right <= bounds.right + 1,
          pressed: button.getAttribute('aria-pressed') === 'true',
        };
      });
      return {
        design: stage.dataset.design || '',
        side: card.dataset.side || '',
        navBelowFrame: controlsBounds.top >= outerBounds.bottom + 8,
        navInsideCard: controlsBounds.top >= cardBounds.top - 1 && controlsBounds.bottom <= cardBounds.bottom + 1,
        buttons,
        returnFrontBelowFrame: returnBounds.top >= outerBounds.bottom - 1,
        returnFrontHeight: returnBounds.height,
      };
    })()`, sessionId);
    const assertSharedCardLayout = async (sessionId: string, design: string, viewport: string, side: string) => {
      const layout = await inspectSharedCardLayout(sessionId);
      assert.equal(layout.design, design, `${design} renders at ${viewport} width`);
      assert.equal(layout.side, side, `${design} reaches the ${side} side at ${viewport} width`);
      assert.equal(layout.buttons.length, 4, `${design} keeps all four section controls`);
      if (design === 'breakout') {
        assert.equal(layout.navBelowFrame, true, `Breakout navigation stays below the artwork at ${viewport} width on ${side}`);
      } else {
        assert.equal(layout.navInsideCard, true, `${design} navigation stays in the card at ${viewport} width on ${side}`);
      }
      assert.equal(layout.returnFrontBelowFrame, true, `the return-to-front action stays below the card at ${viewport} width`);
      assert.ok(layout.returnFrontHeight >= 44, `the return-to-front action remains tappable at ${viewport} width`);
      for (const button of layout.buttons) {
        assert.equal(button.visible, true, `${design} section controls remain visible at ${viewport} width on ${side}`);
        if (design === 'breakout') {
          assert.ok(button.height >= 44, `Breakout controls keep 44px touch targets at ${viewport} width on ${side}`);
        } else {
          assert.ok(button.height > 0, `${design} controls retain their existing in-card size at ${viewport} width on ${side}`);
        }
        assert.ok(button.width > 0 && button.left >= 0 && button.right <= (viewport === 'phone' ? 390 : 1365),
          `${design} section controls fit horizontally at ${viewport} width on ${side}`);
        assert.equal(button.textFits, true, `${design} section labels fit their buttons at ${viewport} width on ${side}`);
      }
      assert.equal(layout.buttons.filter((button) => button.pressed).length, side === 'front' ? 0 : 1,
        `${design} marks only the selected section at ${viewport} width on ${side}`);
    };
    const clickSharedCardControl = async (sessionId: string, testId: string, minimumHeight = 44) => {
      const target = await connection!.evaluate<{ x: number; y: number; height: number; hit: boolean }>(`(() => {
        const button = document.querySelector('[data-testid="${testId}"]');
        if (!(button instanceof HTMLElement)) throw new Error('HYPE Card control is missing: ${testId}');
        button.scrollIntoView({ block: 'center', inline: 'center' });
        const bounds = button.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, height: bounds.height, hit: hit === button || button.contains(hit) };
      })()`, sessionId);
      assert.ok(target.height >= minimumHeight, `${testId} exposes its required touch target`);
      assert.equal(target.hit, true, `${testId} is not covered at its center point`);
      await connection!.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1,
      }, sessionId);
      await connection!.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1,
      }, sessionId);
    };

    for (const design of ['breakout', 'gallery', 'spotlight'] as const) {
      fanCard.cardAppearance = defaultCardAppearance(design);
      const sharedCard = await open('visitor', 'fan');
      for (const viewport of cardViewports) {
        await connection.send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.mobile,
        }, sharedCard);
        await waitFor(
          connection,
          sharedCard,
          `document.querySelector('.living-card-stage')?.dataset.design === '${design}' && document.querySelector('#living-card-display')?.dataset.side === 'front'`,
          Boolean,
          12_000,
        );
        await connection.evaluate('window.scrollTo(0, 0)', sharedCard);
        await assertSharedCardLayout(sharedCard, design, viewport.name, 'front');

        for (const section of cardNavigation) {
          await clickSharedCardControl(sharedCard, section.id, design === 'breakout' ? 44 : 1);
          await waitFor(connection, sharedCard, `(() => {
            const card = document.querySelector('#living-card-display');
            const inner = document.querySelector('.living-card-flip-inner');
            return card?.dataset.side === '${section.side}'
              && card?.getAttribute('aria-label')?.endsWith('${
                section.side === 'responses' ? 'viewer responses'
                  : section.side === 'stats' ? 'finalized stats'
                  : section.side === 'events' ? 'events'
                  : 'Live Taps tally'
              }')
              && document.querySelector('[data-testid="${section.id}"]')?.getAttribute('aria-pressed') === 'true'
              && Math.abs(new DOMMatrixReadOnly(getComputedStyle(inner).transform).m11 + 1) < 0.001;
          })()`, Boolean, 12_000);
          await assertSharedCardLayout(sharedCard, design, viewport.name, section.side);
        }

        await clickSharedCardControl(sharedCard, 'button-living-card-front');
        await waitFor(connection, sharedCard, `(() => {
          const card = document.querySelector('#living-card-display');
          const inner = document.querySelector('.living-card-flip-inner');
          return card?.dataset.side === 'front'
            && card?.getAttribute('aria-label')?.endsWith('card front')
            && document.querySelector('[data-testid="button-living-card-front"]')?.getAttribute('aria-pressed') === 'true'
            && Math.abs(new DOMMatrixReadOnly(getComputedStyle(inner).transform).m11 - 1) < 0.001;
        })()`, Boolean, 12_000);
        await assertSharedCardLayout(sharedCard, design, viewport.name, 'front');
      }
    }

    await connection.evaluate("Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Pause Hype Page')).click()", ownerManage);
    await waitFor(connection, ownerManage, "Boolean(document.body?.innerText.toLowerCase().includes('resume hype page'))", Boolean, 12_000);
    assert.equal(paused, true);
    await connection.evaluate("document.querySelector('[data-testid=\"button-hype-manager-sections\"]').click()", ownerManage);
    assert.equal(await connection.evaluate<string>("document.querySelector('[data-testid=\"section-visible-athlete-page\"] button[aria-label=\"Finalized stats\"]')?.getAttribute('aria-checked') || ''", ownerManage), changedSetting);
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
    const nonOwnerWrites = requests.filter(({ viewer, method }) => viewer !== 'owner' && method !== 'GET' && method !== 'OPTIONS');
    assert.ok(nonOwnerWrites.length > 0, 'a private family QR enables authorized Live Taps');
    assert.ok(
      nonOwnerWrites.every(({ method, path }) => method === 'POST' && path === `/api/athlete-invites/${token}/live-taps`),
      'non-owners can only submit Live Taps through the family endpoint',
    );
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

test('Hype Card flips stay readable in Firefox and WebKit at phone and desktop widths', async (context) => {
  const missingDrivers = ['geckodriver', 'WebKitWebDriver'].filter((command) => !commandExists(command));
  if (missingDrivers.length > 0) {
    context.skip(`Missing cross-browser test drivers: ${missingDrivers.join(', ')}`);
    return;
  }

  const fanCard = {
    inviteToken: token,
    hypesEnabled: true,
    athleteName: 'Jordan',
    teamName: 'City Hoops',
    seasonName: 'Fall 2026',
    seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    timezone: 'America/New_York',
    sport: 'basketball',
    photoUrl: null,
    hypeCard: null,
    videos: [],
    stats: {
      athleteName: 'Jordan',
      sport: 'basketball',
      gamesPlayed: 1,
      score: 42,
      games: [],
      stats: {},
      record: { wins: 1, losses: 0, ties: 0 },
      updatedAt: new Date().toISOString(),
    },
    scheduleEvents: [],
    showEvents: false,
    events: [],
    replies: [],
    liveScoreboard: null,
    liveTaps: {
      active: false,
      gameId: null,
      cheers: [
        { key: 'bucket', label: 'Bucket', emoji: '🏀', count: 0 },
        { key: 'three', label: 'Three!', emoji: '🎯', count: 0 },
        { key: 'and-one', label: 'And one', emoji: '💥', count: 0 },
        { key: 'big-stop', label: 'Big stop', emoji: '🛡️', count: 0 },
        { key: 'lets-go', label: "Let's go", emoji: '💙', count: 0 },
      ],
    },
    updatedAt: new Date().toISOString(),
  };
  const apiServer = createServer((request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    if (request.method === 'GET' && path === `/api/athlete-invites/${token}/fan`) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(fanCard));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
  });
  const apiPort = await listen(apiServer);
  const vitePort = await availablePort();
  const vite = spawn('pnpm', ['exec', 'vite', '--config', 'vite.athlete-owner-boundary.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: { ...process.env, PORT: String(vitePort), BASE_PATH: '/', REPL_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const viteMonitor = monitorProcess(vite, 'Hype Card cross-browser Vite');
  const drivers: Array<{
    process: ChildProcess;
    monitor: ReturnType<typeof monitorProcess>;
    origin: string;
    sessionId?: string;
  }> = [];

  try {
    await waitForUrl(`http://127.0.0.1:${vitePort}/athlete-owner-boundary-test.html`, 30_000, viteMonitor);
    for (const browser of [
      { name: 'Firefox', command: 'geckodriver', args: (port: number) => ['--host', '127.0.0.1', '--port', String(port)] },
      { name: 'WebKit', command: 'WebKitWebDriver', args: (port: number) => [`--port=${port}`, '--host=127.0.0.1'] },
    ]) {
      const driverPort = await availablePort();
      const origin = `http://127.0.0.1:${driverPort}`;
      const driverProcess = spawn(browser.command, browser.args(driverPort), { stdio: ['ignore', 'pipe', 'pipe'] });
      const monitor = monitorProcess(driverProcess, `${browser.name} WebDriver`);
      const driver = { process: driverProcess, monitor, origin };
      drivers.push(driver);
      await waitForUrl(`${origin}/status`, 30_000, monitor);

      const capabilities = browser.name === 'Firefox'
        ? { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } } }
        : { alwaysMatch: { browserName: 'MiniBrowser' } };
      const session = await webDriverCommand<{ sessionId: string }>(origin, 'POST', '/session', { capabilities });
      driver.sessionId = session.sessionId;

      for (const viewport of [
        { name: 'phone', width: 320, height: 800 },
        { name: 'desktop', width: 1365, height: 1000 },
      ]) {
        const sessionPath = `/session/${session.sessionId}`;
        await webDriverCommand(origin, 'POST', `${sessionPath}/window/rect`, {
          x: 0, y: 0, width: viewport.width, height: viewport.height,
        });
        const pageUrl = new URL(`http://127.0.0.1:${vitePort}/athlete-owner-boundary-test.html`);
        pageUrl.searchParams.set('viewer', 'visitor');
        pageUrl.searchParams.set('view', 'fan');
        pageUrl.searchParams.set('testApiOrigin', `http://127.0.0.1:${apiPort}`);
        await webDriverCommand(origin, 'POST', `${sessionPath}/url`, { url: pageUrl.toString() });

        const inspect = () => webDriverCommand<{
          side: string;
          matrixM11: number;
          fallback: boolean;
          heading: string;
          headingVisible: boolean;
          controlsFit: boolean;
          statsPressed: boolean;
          frontPressed: boolean;
        }>(origin, 'POST', `${sessionPath}/execute/sync`, {
          script: `return (() => {
            const card = document.querySelector('#living-card-display');
            const inner = document.querySelector('.living-card-flip-inner');
            const side = card?.dataset.side || '';
            const heading = side === 'front'
              ? card?.querySelector('.living-card-front-identity .living-card-athlete-name')
              : card?.querySelector('.living-card-flip-back .living-card-alt-title');
            const headingStyle = heading ? getComputedStyle(heading) : null;
            const headingBounds = heading?.getBoundingClientRect();
            const controlsFit = [...document.querySelectorAll('.living-card-controls button')].every((button) => {
              const buttonBounds = button.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(button);
              const textBounds = range.getBoundingClientRect();
              return textBounds.left >= buttonBounds.left - 1 && textBounds.right <= buttonBounds.right + 1;
            });
            return {
              side,
              matrixM11: inner ? new DOMMatrixReadOnly(getComputedStyle(inner).transform).m11 : NaN,
              fallback: !CSS.supports('transform-style', 'preserve-3d'),
              heading: heading?.textContent?.trim() || '',
              headingVisible: Boolean(heading && headingBounds?.width && headingBounds.height
                && headingStyle?.display !== 'none' && headingStyle?.visibility !== 'hidden'
                && headingStyle?.color !== 'rgba(0, 0, 0, 0)'),
              controlsFit,
              statsPressed: document.querySelector('[data-testid="button-living-card-stats"]')?.getAttribute('aria-pressed') === 'true',
              frontPressed: document.querySelector('[data-testid="button-living-card-front"]')?.getAttribute('aria-pressed') === 'true',
            };
          })();`,
          args: [],
        });
        const waitForSide = (side: 'front' | 'stats') => waitForWebDriverValue(
          inspect,
          (state) => state.side === side
            && state.headingVisible
            && (state.fallback || Math.abs(state.matrixM11 - (side === 'front' ? 1 : -1)) < 0.001),
          `${browser.name} ${viewport.name} ${side} face`,
        );

        const front = await waitForSide('front');
        assert.equal(front.heading, 'Jordan');
        assert.equal(front.frontPressed, true);
        assert.equal(front.controlsFit, true, `${browser.name} controls fit at ${viewport.width}px`);

        const statsButton = await webDriverCommand<Record<string, string>>(
          origin,
          'POST',
          `${sessionPath}/element`,
          { using: 'css selector', value: '[data-testid="button-living-card-stats"]' },
        );
        const statsButtonId = statsButton['element-6066-11e4-a52e-4f735466cecf'] || statsButton.ELEMENT;
        assert.ok(statsButtonId, `${browser.name} exposes the Stats control`);
        await webDriverCommand(origin, 'POST', `${sessionPath}/element/${statsButtonId}/click`, {});
        const back = await waitForSide('stats');
        assert.match(back.heading, /Season stats\./);
        assert.equal(back.statsPressed, true);
        assert.equal(back.controlsFit, true);
        if (!back.fallback) assert.ok(Math.abs(back.matrixM11 + 1) < 0.001, `${browser.name} rotates the back toward the viewer`);

        const frontButton = await webDriverCommand<Record<string, string>>(
          origin,
          'POST',
          `${sessionPath}/element`,
          { using: 'css selector', value: '[data-testid="button-living-card-front"]' },
        );
        const frontButtonId = frontButton['element-6066-11e4-a52e-4f735466cecf'] || frontButton.ELEMENT;
        assert.ok(frontButtonId, `${browser.name} exposes the return-to-front control`);
        await webDriverCommand(origin, 'POST', `${sessionPath}/element/${frontButtonId}/click`, {});
        const returnedFront = await waitForSide('front');
        assert.equal(returnedFront.heading, 'Jordan');
        assert.equal(returnedFront.frontPressed, true);
        if (!returnedFront.fallback) assert.ok(Math.abs(returnedFront.matrixM11 - 1) < 0.001, `${browser.name} returns the front toward the viewer`);
      }
    }
  } finally {
    for (const driver of drivers) {
      if (driver.sessionId) {
        await webDriverCommand(driver.origin, 'DELETE', `/session/${driver.sessionId}`).catch(() => undefined);
      }
      if (!driver.monitor.hasExited()) driver.process.kill('SIGTERM');
      await driver.monitor.waitForExit();
    }
    if (!viteMonitor.hasExited()) vite.kill('SIGTERM');
    await viteMonitor.waitForExit();
    await new Promise<void>((resolveClose, reject) => apiServer.close((error) => error ? reject(error) : resolveClose()));
  }
});