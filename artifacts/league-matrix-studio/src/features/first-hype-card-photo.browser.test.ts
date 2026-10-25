import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { DevToolsConnection, monitorProcess, waitFor, waitForUrl } from './browser-test-diagnostics';

const directory = resolve(import.meta.dirname, '../..');
async function listen(server: Server) {
  return new Promise<number>(resolvePort => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    resolvePort(address.port);
  }));
}
async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  return port;
}

test('first-card creation directs photo uploads to Manage HYPE Card and does not depend on a profile photo', async () => {
  let card: Record<string, unknown> | null = null;
  let creates = 0;
  const api = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    const path = new URL(req.url!, 'http://test').pathname;
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    };
    if (path === '/api/athlete-invites' && req.method === 'POST') {
      creates++;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      card = { ...JSON.parse(Buffer.concat(chunks).toString()), inviteToken: 'owner-boundary-test-token',
        photoUrl: null, photoRevision: null, cutoutUrl: null, events: [], stats: null,
        latestHypeCard: null, latestVideo: null, videos: [], liveGame: null,
        hypeCard: null, replies: [], scheduleEvents: [], liveScoreboard: null,
        updatedAt: new Date().toISOString(),
        liveTrackerShareToken: null, liveTaps: { active: false, gameId: null, cheers: [], seasonCheers: [] }, };
      json(201, card);
    } else if (path === '/api/athlete-invites') json(200, card ? [card] : []);
    else if (path.endsWith('/fan')) json(200, card);
    else if (path === '/api/projects' || path === '/api/hype-card-shares' || path.endsWith('/public-shoutouts')) json(200, []);
    else json(404, { error: 'Fixture route not found' });
  });
  const apiPort = await listen(api);
  const vitePort = await freePort();
  const debugPort = await freePort();
  const vite = spawn('pnpm', ['exec', 'vite', '--config', 'vite.athlete-owner-boundary.config.ts', '--host', '127.0.0.1'], {
    cwd: directory, env: { ...process.env, PORT: String(vitePort), BASE_PATH: '/', REPL_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const viteMonitor = monitorProcess(vite, 'Vite first-card test');
  let browser: ReturnType<typeof spawn> | undefined;
  let browserMonitor: ReturnType<typeof monitorProcess> | undefined;
  let connection: DevToolsConnection | undefined;
  let profile: string | undefined;
  try {
    const origin = `http://127.0.0.1:${vitePort}`;
    await waitForUrl(`${origin}/athlete-owner-boundary-test.html`, 30000, viteMonitor);
    profile = await mkdtemp(resolve(tmpdir(), 'first-card-photo-'));
    browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium first-card test');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30000, browserMonitor);
    const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json() as { webSocketDebuggerUrl: string };
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    const target = await connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await connection.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await connection.send('Runtime.enable', {}, sessionId);
    const navigate = (view: string, viewer = 'owner') => connection!.send('Page.navigate', {
      url: `${origin}/athlete-owner-boundary-test.html?view=${view}&viewer=${viewer}&testApiOrigin=${encodeURIComponent(`http://127.0.0.1:${apiPort}`)}`,
    }, sessionId);
    await navigate('create');
    await waitFor(connection, sessionId, "Boolean(document.querySelector('[data-testid=\"first-card-photo-guidance\"]'))", Boolean, 30000);
    const photoGuidance = await connection.evaluate<{ text: string; profileUploadLink: boolean }>(`(() => {
      const guidance = document.querySelector('[data-testid="first-card-photo-guidance"]');
      return {
        text: guidance?.textContent?.trim() || '',
        profileUploadLink: Boolean(document.querySelector('[data-testid="link-first-card-athlete-photo"]')),
      };
    })()`, sessionId);
    assert.match(photoGuidance.text, /Manage HYPE Card to upload the athlete’s photo/);
    assert.equal(photoGuidance.profileUploadLink, false);
    await connection.evaluate("document.querySelector('button[type=\"submit\"]').click()", sessionId);
    await waitFor(connection, sessionId, "Boolean(document.querySelector('[data-testid=\"link-manage-athlete-card\"]'))", Boolean);
    assert.equal(creates, 1);
    assert.equal(card?.photoUrl, null);
    assert.equal(card?.photoRevision, null);
  } finally {
    connection?.close();
    browser?.kill('SIGTERM');
    if (browserMonitor) await browserMonitor.waitForExit();
    vite.kill('SIGTERM');
    await viteMonitor.waitForExit();
    await new Promise<void>(resolveClose => api.close(() => resolveClose()));
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});