import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
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
} from './browser-test-diagnostics';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const ownerId = 'workspace-journey';
const inviteToken = 'browser-live-athlete';
const familyQrToken = 'browserFamilyAccessToken_0123456789abcdefghijklmnop';

type GameSnapshot = {
  id: string;
  sport: string;
  status: string;
  date: string;
  opponent: string;
  period: number;
  score: number;
  opponentScore: number;
  stats: Record<string, number>;
  trackYards: boolean;
  yardStats: Record<string, number>;
  events: unknown[];
};

type TrackerShare = {
  shareToken: string;
  revision: number;
  athleteName: string;
  teamName: string;
  game: GameSnapshot;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  canManage: boolean;
};

type FixtureState = {
  shares: TrackerShare[];
  activeShareToken: string | null;
  taps: Array<{ gameId: string; cheerKey: string }>;
};

type FixtureAccessLink = {
  id: string;
  inviteToken: string;
  accessToken: string;
  createdAt: string;
  revoked: boolean;
};

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type,x-test-user',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any> : {};
}

function makeFixtureServer() {
  const state: FixtureState = { shares: [], activeShareToken: null, taps: [] };
  const historySaves = { beforeSave: async () => {} };
  const accessLinks: FixtureAccessLink[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'content-type,x-test-user',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      });
      response.end();
      return;
    }

    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const path = decodeURIComponent(url.pathname);
      const method = request.method || 'GET';
      const isOwner = request.headers['x-test-user'] === ownerId;

      if (path === '/__fixture/state' && method === 'GET') {
        json(response, 200, state);
        return;
      }
      if (path === '/__fixture/access-links' && method === 'GET') {
        json(response, 200, accessLinks.filter((link) => !link.revoked).map(({ id, createdAt }) => ({ id, createdAt })));
        return;
      }
      if (path === '/api/account/access' && method === 'GET') {
        json(response, 200, {
          accessMode: 'full',
          role: 'fan',
          usage: { hypeCards: 1, scheduleEvents: 1, lineups: 0 },
          remaining: { hypeCards: 4, scheduleEvents: 24, lineups: 3 },
          limits: { hypeCards: 5, scheduleEvents: 25, lineups: 3 },
          paid: false,
          storage: { usedBytes: 0, limitBytes: 104857600 },
        });
        return;
      }
      if (path === '/api/supporter-photo' && method === 'GET') {
        response.writeHead(404, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'content-type,x-test-user',
          'Content-Type': 'application/json',
        });
        response.end(JSON.stringify({ error: 'No supporter photo' }));
        return;
      }
      if (path === '/api/projects' && method === 'GET') {
        json(response, 200, []);
        return;
      }
      if (path === '/api/projects' && method === 'POST') {
        const body = await readJson(request);
        await historySaves.beforeSave();
        json(response, 201, {
          id: 'browser-stat-tracker-project',
          name: body.name || 'Stat Tracker',
          project: body.project,
          revision: 1,
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      if (path === '/api/stat-tracker-shares' && method === 'GET') {
        json(response, 200, isOwner ? state.shares : []);
        return;
      }
      if (path === '/api/stat-tracker-shares' && method === 'POST') {
        if (!isOwner) {
          json(response, 401, { error: 'Sign in required' });
          return;
        }
        const body = await readJson(request);
        const now = new Date().toISOString();
        const share: TrackerShare = {
          ...body,
          shareToken: `00000000-0000-4000-8000-${String(state.shares.length + 1).padStart(12, '0')}`,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          canManage: true,
        };
        state.shares.push(share);
        json(response, 201, share);
        return;
      }
      if (path.startsWith('/api/stat-tracker-shares/') && method === 'PATCH') {
        if (!isOwner) {
          json(response, 401, { error: 'Sign in required' });
          return;
        }
        const shareToken = path.slice('/api/stat-tracker-shares/'.length);
        const share = state.shares.find((candidate) => candidate.shareToken === shareToken);
        if (!share) {
          json(response, 404, { error: 'Share not found' });
          return;
        }
        const body = await readJson(request);
        if (body.expectedRevision !== share.revision) {
          json(response, 409, { error: 'The share has changed', current: share });
          return;
        }
        Object.assign(share, {
          athleteName: body.athleteName,
          teamName: body.teamName,
          game: body.game,
          revision: share.revision + 1,
          updatedAt: new Date().toISOString(),
        });
        if (share.game.status === 'final' && state.activeShareToken === shareToken) {
          state.activeShareToken = null;
        }
        json(response, 200, share);
        return;
      }
      if (path === '/api/athlete-invites' && method === 'GET') {
        json(response, 200, isOwner ? [{
          inviteToken,
          athleteName: 'Alexandria Montgomery-Williams',
          teamName: 'Northside Comets',
          sport: 'basketball',
          paused: false,
        }] : []);
        return;
      }
      const accessLinksMatch = path.match(/^\/api\/athlete-invites\/([^/]+)\/live-taps\/access-links(?:\/([^/]+))?$/);
      if (accessLinksMatch && method === 'GET') {
        json(response, 200, isOwner
          ? accessLinks.filter((link) => link.inviteToken === accessLinksMatch[1] && !link.revoked)
            .map(({ id, createdAt }) => ({ id, createdAt }))
          : []);
        return;
      }
      if (accessLinksMatch && method === 'POST') {
        if (!isOwner) {
          json(response, 401, { error: 'Sign in required' });
          return;
        }
        const created: FixtureAccessLink = {
          id: `00000000-0000-4000-8000-${String(accessLinks.length + 1).padStart(12, '0')}`,
          inviteToken: accessLinksMatch[1]!,
          accessToken: familyQrToken,
          createdAt: new Date().toISOString(),
          revoked: false,
        };
        accessLinks.push(created);
        json(response, 201, { id: created.id, accessToken: created.accessToken, createdAt: created.createdAt });
        return;
      }
      if (accessLinksMatch && method === 'DELETE') {
        if (!isOwner) {
          json(response, 401, { error: 'Sign in required' });
          return;
        }
        const access = accessLinks.find((link) => link.id === accessLinksMatch[2] && link.inviteToken === accessLinksMatch[1]);
        if (!access) {
          json(response, 404, { error: 'Family QR access not found' });
          return;
        }
        access.revoked = true;
        response.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        response.end();
        return;
      }
      const startMatch = path.match(/^\/api\/athlete-invites\/([^/]+)\/live$/);
      if (startMatch && method === 'POST') {
        if (!isOwner) {
          json(response, 401, { error: 'Sign in required' });
          return;
        }
        const body = await readJson(request);
        const share = state.shares.find((candidate) => candidate.shareToken === body.shareToken);
        if (!share || share.game.status !== 'live') {
          json(response, 404, { error: 'No live tracker share' });
          return;
        }
        state.activeShareToken = share.shareToken;
        json(response, 201, {
          shareToken: share.shareToken,
          gameId: share.game.id,
          expiresAt: share.expiresAt,
        });
        return;
      }
      const fanMatch = path.match(/^\/api\/athlete-invites\/([^/]+)\/fan$/);
      if (fanMatch && method === 'GET') {
        const activeShare = state.shares.find((share) => share.shareToken === state.activeShareToken);
        const finalShare = state.shares.find((share) => share.game.status === 'final');
        const finalGame = finalShare?.game;
        const invite = {
          inviteToken,
          hypesEnabled: true,
          athleteName: 'Alexandria Montgomery-Williams',
          teamName: 'Northside Comets',
          seasonName: 'Fall 2026',
          seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
          timezone: 'America/Los_Angeles',
          sport: 'basketball',
          photoUrl: null,
          hypeCard: null,
          videos: [],
          stats: finalGame && finalShare ? {
            athleteName: finalShare.athleteName,
            sport: 'basketball',
            gamesPlayed: 1,
            score: finalGame.score,
            record: {
              wins: Number(finalGame.score > finalGame.opponentScore),
              losses: Number(finalGame.score < finalGame.opponentScore),
              ties: Number(finalGame.score === finalGame.opponentScore),
              gamesPlayed: 1,
            },
            games: [{
              date: finalGame.date,
              opponent: finalGame.opponent,
              score: finalGame.score,
              opponentScore: finalGame.opponentScore,
              scoreRecorded: true,
              stats: finalGame.stats,
              athleteStats: { 'two-point': 1 },
            }],
            stats: finalGame.stats,
            updatedAt: finalShare.updatedAt,
          } : null,
          scheduleEvents: [],
          showEvents: false,
          events: [],
          replies: [],
          liveScoreboard: activeShare ? {
            score: activeShare.game.score,
            opponentScore: activeShare.game.opponentScore,
            opponent: activeShare.game.opponent,
            status: activeShare.game.status,
            period: activeShare.game.period,
            athleteName: activeShare.athleteName,
            teamName: activeShare.teamName,
          } : null,
          liveTaps: {
            active: Boolean(activeShare),
            gameId: activeShare?.game.id ?? null,
            cheers: [{
              key: 'bucket',
              label: 'Let’s go!',
              emoji: '👏',
              count: activeShare
                ? state.taps.filter((tap) => tap.gameId === activeShare.game.id && tap.cheerKey === 'bucket').length
                : 0,
            }],
          },
          updatedAt: new Date().toISOString(),
        };
        json(response, 200, invite);
        return;
      }
      const tapMatch = path.match(/^\/api\/athlete-invites\/([^/]+)\/live-taps$/);
      if (tapMatch && method === 'POST') {
        const body = await readJson(request);
        const activeShare = state.shares.find((share) => share.shareToken === state.activeShareToken);
        if (body.accessToken !== familyQrToken) {
          json(response, 403, { error: 'Family QR access required' });
          return;
        }
        if (!activeShare) {
          json(response, 409, { error: 'Game Day Live is not active' });
          return;
        }
        state.taps.push({ gameId: activeShare.game.id, cheerKey: body.cheerKey });
        json(response, 201, {
          active: true,
          gameId: activeShare.game.id,
          cheers: [{
            key: 'bucket',
            label: 'Let’s go!',
            emoji: '👏',
            count: state.taps.filter((tap) => tap.gameId === activeShare.game.id && tap.cheerKey === 'bucket').length,
          }],
        });
        return;
      }

      json(response, 404, { error: `Fixture route not found: ${method} ${path}` });
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : 'Fixture request failed' });
    }
  });
  return { server, state, historySaves };
}

async function availablePort() {
  const server = createServer();
  const port = await new Promise<number>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('Expected a TCP port'));
      else done(address.port);
    });
  });
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

test('both owner Start game actions publish updated HYPE Card score; family taps remain private and close at final', { concurrency: false }, async () => {
  const apiPort = await availablePort();
  const vitePort = await availablePort();
  const debugPort = await availablePort();
  const { server: apiServer, historySaves } = makeFixtureServer();
  let releaseHistorySave = () => {};
  await new Promise<void>((done, reject) => {
    apiServer.once('error', reject);
    apiServer.listen(apiPort, '127.0.0.1', () => done());
  });
  let vite: ChildProcess | undefined;
  let browser: ChildProcess | undefined;
  let connection: DevToolsConnection | undefined;
  let tempDirectory: string | undefined;
  const pages: BrowserPage[] = [];
  let viteMonitor: ReturnType<typeof monitorProcess> | undefined;
  let browserMonitor: ReturnType<typeof monitorProcess> | undefined;

  try {
    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    const viteOrigin = `http://127.0.0.1:${vitePort}`;
    vite = spawn('pnpm', ['exec', 'vite', '--config', 'vite.account-lifecycle-browser.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: { ...process.env, PORT: String(vitePort), BASE_PATH: '/', REPL_ID: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    viteMonitor = monitorProcess(vite, 'Game Day Live Vite');
    await waitForUrl(`${viteOrigin}/athlete-live-start-browser-test.html`, 30_000, viteMonitor);

    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-athlete-live-start-'));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${tempDirectory}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(webSocketDebuggerUrl, browserMonitor.diagnostics);

    const appUrl = (page: 'tracker' | 'inline' | 'fan' | 'live-taps', options: { owner?: boolean; family?: boolean } = {}) => {
      const params = new URLSearchParams({ api: apiOrigin, page });
      if (options.owner) params.set('viewer', ownerId);
      return `${viteOrigin}/athlete-live-start-browser-test.html?${params}${options.family ? `#live-taps=${familyQrToken}` : ''}`;
    };
    const open = async (
      page: 'tracker' | 'inline' | 'fan' | 'live-taps',
      options: { owner?: boolean; family?: boolean } = {},
    ) => {
      const browserPage = await openPage(connection!, appUrl(page, options), { viewport: { width: 1365, height: 940 } });
      pages.push(browserPage);
      return browserPage.sessionId;
    };
    const fixtureState = () => fetch(`${apiOrigin}/__fixture/state`).then((response) => (
      response.json() as Promise<FixtureState>
    ));
    const click = (session: string, testId: string) => connection!.evaluate(
      `document.querySelector('[data-testid="${testId}"]')?.click()`,
      session,
    );
    const waitUi = (session: string, expression: string) => waitFor(
      connection!,
      session,
      expression,
      Boolean,
      20_000,
    );
    const close = async (session: string) => {
      const page = pages.find((candidate) => candidate.sessionId === session);
      if (page) {
        await connection!.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
      }
    };

    const tracker = await open('tracker', { owner: true });
    await waitUi(tracker, `Boolean(document.querySelector('[data-testid="button-use-upcoming-game"]'))`);
    assert.deepEqual(await fixtureState(), { shares: [], activeShareToken: null, taps: [] },
      'opening a scheduled game must not create a public Game Day Live session');
    await click(tracker, 'button-use-upcoming-game');
    await waitUi(tracker, `Boolean(document.querySelector('[data-testid="button-confirm-start-game"]'))`);
    await click(tracker, 'button-confirm-start-game');
    await waitUi(tracker, `Boolean(document.querySelector('[data-testid="live-tracker-scoreboard"]'))`);
    await waitUi(tracker, `document.querySelector('[role="status"]')?.textContent?.includes('Game Day Live is active')`);
    const publicCard = await open('fan');
    await waitUi(publicCard, `Boolean(document.querySelector('[data-testid="button-living-card-stats"]'))`);
    await waitUi(publicCard, `document.querySelector('[data-testid="button-living-card-stats"]')?.classList.contains('living-card-control-live') && document.querySelector('[data-testid="button-living-card-live-taps"]')?.classList.contains('living-card-control-live')`);
    assert.equal(await connection.evaluate(
      `document.querySelector('[data-testid="button-living-card-stats"]')?.getAttribute('aria-label')`,
      publicCard,
    ), 'Stats, Live scoreboard available');
    assert.equal(await connection.evaluate(
      `document.querySelector('[data-testid="button-living-card-live-taps"]')?.getAttribute('aria-label')`,
      publicCard,
    ), 'Live Taps, Game Day Live is active');
    await click(publicCard, 'button-living-card-stats');
    await waitUi(publicCard, `document.querySelector('[data-testid="fan-card-live-scoreboard"]')?.textContent?.includes('0–0')`);
    await click(tracker, 'live-stat-two-point');
    await waitUi(tracker, `document.querySelector('[data-testid="live-tracker-score-card-athlete"]')?.textContent?.includes('2')`);
    const fullGameState = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 20_000) {
        const current = await fixtureState();
        if (current.activeShareToken && current.shares[0]?.game.score === 2
          && current.shares[0]?.game.stats['two-point'] === 1) return current;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
      }
      return fixtureState();
    })();
    assert.equal(fullGameState.shares.length, 1);
    assert.equal(fullGameState.shares[0]?.game.stats['two-point'], 1);
    assert.equal(fullGameState.activeShareToken, fullGameState.shares[0]?.shareToken);
    await waitUi(publicCard, `document.querySelector('[data-testid="fan-card-live-scoreboard"]')?.textContent?.includes('2–0')`);
    assert.equal(await connection.evaluate(
      `document.querySelector('[data-testid="fan-card-live-scoreboard"]')?.textContent?.includes('View only')`,
      publicCard,
    ), true);
    await click(publicCard, 'button-living-card-live-taps');
    await waitUi(publicCard, `Boolean(document.querySelector('[data-testid="live-taps-family-link-required"]'))`);
    assert.equal(await connection.evaluate(
      `document.querySelector('[data-testid="button-live-tap-bucket"]')?.disabled`,
      publicCard,
    ), true, 'the public card must not enable family cheers');
    const publicTapAttempt = await fetch(`${apiOrigin}/api/athlete-invites/${inviteToken}/live-taps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cheerKey: 'bucket' }),
    });
    assert.equal(publicTapAttempt.status, 403, 'the public HYPE Card link cannot send a cheer');
    await close(publicCard);

    const familyCard = await open('fan', { family: true });
    await waitUi(familyCard, `Boolean(document.querySelector('[data-testid="button-living-card-live-taps"]'))`);
    await click(familyCard, 'button-living-card-live-taps');
    await waitUi(familyCard, `document.querySelector('[data-testid="button-live-tap-bucket"]')?.disabled === false`);
    await click(familyCard, 'button-live-tap-bucket');
    await waitUi(familyCard, `document.querySelector('[data-testid="text-live-tap-total"]')?.textContent === '1'`);
    assert.equal((await fixtureState()).taps.length, 1, 'a valid family QR link can send a cheer');

    const pendingHistorySave = new Promise<void>((resolve) => { releaseHistorySave = resolve; });
    historySaves.beforeSave = () => pendingHistorySave;
    await click(tracker, 'button-end-live-game');
    await waitUi(tracker, `Boolean(document.querySelector('[data-testid="button-confirm-end-live-game"]'))`);
    await click(tracker, 'button-confirm-end-live-game');
    const closedFullGame = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 20_000) {
        const current = await fixtureState();
        if (current.activeShareToken === null && current.shares[0]?.game.status === 'final') return current;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
      }
      return fixtureState();
    })();
    assert.equal(closedFullGame.activeShareToken, null, 'finalizing closes Game Day Live');
    assert.equal(closedFullGame.shares[0]?.game.status, 'final', 'recipients receive the final state while the separate cloud-history save is still pending');
    releaseHistorySave();
    historySaves.beforeSave = async () => {};
    assert.equal(closedFullGame.taps.length, 1, 'finalizing keeps earlier family taps');
    await close(familyCard);
    const finalCard = await open('fan');
    await waitUi(finalCard, `Boolean(document.querySelector('[data-testid="button-living-card-stats"]'))`);
    await waitUi(finalCard, `!document.querySelector('[data-testid="button-living-card-stats"]')?.classList.contains('living-card-control-live') && !document.querySelector('[data-testid="button-living-card-live-taps"]')?.classList.contains('living-card-control-live')`);
    await click(finalCard, 'button-living-card-stats');
    await waitUi(finalCard, `document.querySelector('[data-testid="fan-card-live-scoreboard"]') === null`);
    await waitUi(finalCard, `document.querySelector('[data-testid="living-card-selected-game"]')?.textContent?.includes('FINAL')`);
    const finalRecapText = await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"living-card-selected-game\\"]")?.textContent || ""',
      finalCard,
    );
    assert.match(finalRecapText, /FINAL/);
    assert.match(finalRecapText, /Combined team stats/);
    assert.match(finalRecapText, /individual stats/);
    await click(finalCard, 'button-living-card-live-taps');
    await waitUi(finalCard, `Boolean(document.querySelector('[data-testid="live-taps-not-active"]'))`);
    await close(finalCard);
    await close(tracker);

    const inline = await open('inline', { owner: true });
    await waitUi(inline, `Boolean(document.querySelector('[data-testid="inline-tracker-ready"]'))`);
    const beforeInlineStart = await fixtureState();
    assert.equal(beforeInlineStart.shares.length, 1);
    assert.equal(beforeInlineStart.activeShareToken, null);
    assert.equal(beforeInlineStart.taps.length, 1,
      'opening the inline scheduled tracker must not start another public session or remove earlier taps');
    await click(inline, 'button-inline-start-game');
    await waitUi(inline, `Boolean(document.querySelector('[data-testid="game-on-inline-scoreboard"]'))`);
    await waitUi(inline, `document.querySelector('[role="status"]')?.textContent?.includes('Game Day Live is active')`);
    const inlinePublicCard = await open('fan');
    await waitUi(inlinePublicCard, `Boolean(document.querySelector('[data-testid="button-living-card-stats"]'))`);
    await click(inlinePublicCard, 'button-living-card-stats');
    await waitUi(inlinePublicCard, `document.querySelector('[data-testid="fan-card-live-scoreboard"]')?.textContent?.includes('0–0')`);
    await click(inline, 'button-inline-score-athlete-increase');
    await click(inline, 'button-tap-stat-scheduled-inline-game-two-point-athlete');
    await waitUi(inline, `document.querySelector('[data-testid="game-on-inline-score-value-athlete"]')?.textContent === '3'`);
    const inlineState = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 20_000) {
        const current = await fixtureState();
        const activeShare = current.shares.find((share) => share.shareToken === current.activeShareToken);
        if (activeShare?.game.score === 3 && activeShare.game.stats['two-point'] === 1) return current;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
      }
      return fixtureState();
    })();
    assert.equal(inlineState.shares.length, 2);
    const activeInlineShare = inlineState.shares.find((share) => share.shareToken === inlineState.activeShareToken);
    assert.equal(activeInlineShare?.game.score, 3);
    assert.equal(activeInlineShare?.game.stats['two-point'], 1);
    await waitUi(inlinePublicCard, `document.querySelector('[data-testid="fan-card-live-scoreboard"]')?.textContent?.includes('3–0')`);
    assert.equal(await connection.evaluate(
      `document.querySelector('[data-testid="fan-card-live-scoreboard"]')?.textContent?.includes('View only')`,
      inlinePublicCard,
    ), true);
    await close(inlinePublicCard);

    const inlineFamilyCard = await open('fan', { family: true });
    await waitUi(inlineFamilyCard, `Boolean(document.querySelector('[data-testid="button-living-card-live-taps"]'))`);
    await click(inlineFamilyCard, 'button-living-card-live-taps');
    await waitUi(inlineFamilyCard, `document.querySelector('[data-testid="button-live-tap-bucket"]')?.disabled === false`);
    await click(inlineFamilyCard, 'button-live-tap-bucket');
    await waitUi(inlineFamilyCard, `document.querySelector('[data-testid="text-live-tap-total"]')?.textContent === '1'`);
    const inlineTapState = await fixtureState();
    assert.equal(inlineTapState.taps.length, 2);

    await click(inline, 'button-inline-end-game');
    await waitUi(inline, `Boolean(document.querySelector('[data-testid="button-inline-confirm-end-game"]'))`);
    await click(inline, 'button-inline-confirm-end-game');
    const closedInlineGame = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 20_000) {
        const current = await fixtureState();
        const inlineShare = current.shares.find((share) => share.shareToken === activeInlineShare?.shareToken);
        if (current.activeShareToken === null && inlineShare?.game.status === 'final') return current;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
      }
      return fixtureState();
    })();
    assert.equal(closedInlineGame.activeShareToken, null);
    assert.equal(closedInlineGame.taps.length, 2, 'finalizing the inline game preserves taps from both games');
    await close(inlineFamilyCard);
    const inlineFinalCard = await open('fan');
    await waitUi(inlineFinalCard, `Boolean(document.querySelector('[data-testid="button-living-card-stats"]'))`);
    await click(inlineFinalCard, 'button-living-card-stats');
    await waitUi(inlineFinalCard, `document.querySelector('[data-testid="fan-card-live-scoreboard"]') === null`);
    await click(inlineFinalCard, 'button-living-card-live-taps');
    await waitUi(inlineFinalCard, `Boolean(document.querySelector('[data-testid="live-taps-not-active"]'))`);
    await close(inlineFinalCard);

    const liveTapsOnly = await open('live-taps', { owner: true });
    await waitUi(liveTapsOnly, `Boolean(document.querySelector('[data-testid="button-start-live-taps-only"]'))`);
    assert.equal(await connection.evaluate(
      `document.querySelector('[data-testid="event-card-live-taps"]')?.querySelector('[data-testid^="button-tap-stat-"]') === null`,
      liveTapsOnly,
    ), true, 'the Live Taps-only card must not render stat-entry controls');
    await click(liveTapsOnly, 'button-start-live-taps-only');
    await waitUi(liveTapsOnly, `document.querySelector('[data-testid="status-live-taps-only"]')?.textContent?.includes('Game Day Live is on')`);
    let liveTapsOnlyState = await fixtureState();
    assert.equal(liveTapsOnlyState.shares.length, 3);
    const liveTapsOnlyShare = liveTapsOnlyState.shares.find((share) => share.shareToken === liveTapsOnlyState.activeShareToken);
    assert.ok(liveTapsOnlyShare, 'Live Taps-only creates and activates a Game Day Live share');
    assert.equal(liveTapsOnlyShare.game.score, 0);
    assert.equal(liveTapsOnlyShare.game.opponentScore, 0);
    assert.ok(Object.values(liveTapsOnlyShare.game.stats).every((value) => value === 0));
    assert.equal(liveTapsOnlyShare.game.events.length, 0);
    assert.equal(await connection.evaluate(
      `localStorage.getItem('leaguematrix-stat-tracker-active-game:workspace-journey')`,
      liveTapsOnly,
    ), null, 'Live Taps-only must not create a Stat Tracker game in local storage');
    await click(liveTapsOnly, 'button-create-event-card-live-tap-qr');
    await waitUi(liveTapsOnly, `Boolean(document.querySelector('[data-testid="img-event-card-live-taps-qr"]')?.src.startsWith('data:image/png;base64,'))`);
    const activeAccessLinks = await fetch(`${apiOrigin}/__fixture/access-links`)
      .then((response) => response.json() as Promise<Array<{ id: string; createdAt: string }>>);
    assert.equal(activeAccessLinks.length, 1, 'the Event Card creates private, revocable family QR access');
    const liveTapsStorage = await connection.evaluate<string>('JSON.stringify(Object.entries(localStorage))', liveTapsOnly);
    assert.doesNotMatch(liveTapsStorage, new RegExp(familyQrToken), 'raw family QR tokens are not persisted in local storage');

    const liveTapsFamilyCard = await open('fan', { family: true });
    await waitUi(liveTapsFamilyCard, `Boolean(document.querySelector('[data-testid="button-living-card-live-taps"]'))`);
    await click(liveTapsFamilyCard, 'button-living-card-live-taps');
    await waitUi(liveTapsFamilyCard, `document.querySelector('[data-testid="button-live-tap-bucket"]')?.disabled === false`);
    await click(liveTapsFamilyCard, 'button-live-tap-bucket');
    await waitUi(liveTapsFamilyCard, `document.querySelector('[data-testid="text-live-tap-total"]')?.textContent === '1'`);
    assert.equal((await fixtureState()).taps.length, 3, 'a family QR can send a cheer during the Live Taps-only session');
    await close(liveTapsFamilyCard);

    await click(liveTapsOnly, `button-revoke-event-card-live-tap-qr-${activeAccessLinks[0]!.id}`);
    await waitUi(liveTapsOnly, `document.querySelector('[data-testid="notice-event-card-live-taps"]')?.textContent?.includes('revoked')`);
    assert.equal((await fetch(`${apiOrigin}/__fixture/access-links`).then((response) => response.json() as Promise<unknown[]>)).length, 0,
      'the Event Card can revoke family QR access');
    await click(liveTapsOnly, 'button-end-live-taps-only');
    await waitUi(liveTapsOnly, `document.querySelector('[data-testid="notice-event-card-live-taps"]')?.textContent?.includes('Game Day Live ended')`);
    liveTapsOnlyState = await fixtureState();
    assert.equal(liveTapsOnlyState.activeShareToken, null, 'ending Live Taps-only closes the live family cheer session');
    const endedLiveTapsOnlyShare = liveTapsOnlyState.shares.find((share) => share.shareToken === liveTapsOnlyShare?.shareToken);
    assert.equal(endedLiveTapsOnlyShare?.game.status, 'final');
    assert.equal(endedLiveTapsOnlyShare?.game.score, 0);
    assert.equal(endedLiveTapsOnlyShare?.game.events.length, 0);
    assert.equal(await connection.evaluate(
      `localStorage.getItem('leaguematrix-stat-tracker-active-game:workspace-journey')`,
      liveTapsOnly,
    ), null, 'ending Live Taps-only leaves no Stat Tracker game behind');
    await close(liveTapsOnly);
  } finally {
    releaseHistorySave();
    if (connection) {
      for (const page of pages) {
        await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
      }
      connection.close();
    }
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (vite && viteMonitor) {
      if (!viteMonitor.hasExited()) vite.kill('SIGTERM');
      await viteMonitor.waitForExit();
    }
    await new Promise<void>((done) => apiServer.close(() => done()));
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});