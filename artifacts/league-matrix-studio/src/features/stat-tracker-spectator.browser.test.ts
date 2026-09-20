import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DevToolsConnection, monitorProcess, openPage, waitFor, waitForUrl, type ProcessMonitor } from './browser-test-diagnostics';

const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const harnessPath = resolve(appDirectory, 'stat-tracker-spectator-test-harness.tsx');
const htmlPath = resolve(appDirectory, 'stat-tracker-spectator-test.html');

function listen(server: Server) {
  return new Promise<{ port: number }>((resolveAddress, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Expected TCP address'));
      resolveAddress({ port: address.port });
    });
  });
}

function harnessSource() {
  return `
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route } from 'wouter';
import { PublicStatTrackerPage } from './src/features/stat-tracker-spectator';
import { StatTrackerSharePanel } from './src/features/stat-tracker-page';
import './src/index.css';

const initial = { shareToken:'token-one', athleteName:'Maya', teamName:'Falcons', revision:1, createdAt:'2026-09-21T18:00:00.000Z', updatedAt:'2026-09-21T18:01:00.000Z', expiresAt:'2026-09-22T18:00:00.000Z', canManage:false, game:{ id:'game-1', sport:'football', status:'live', date:'2026-09-21', opponent:'Northside', period:2, score:14, opponentScore:7, stats:{touchdown:2,'pass-yard':1}, trackYards:true, yardStats:{'pass-yard':20}, events:[{id:'event-1',statId:'pass-yard',createdAt:'2026-09-21T18:01:00.000Z',period:2,yards:20}] } };
let current = initial;
let revoked = false;
let poll404 = false;
class MockEventSource {
  static instances = [];
  onopen = null; onerror = null; listeners = {};
  constructor(url) { this.url = url; this.closed = false; MockEventSource.instances.push(this); setTimeout(() => this.onopen?.(), 20); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, data) { (this.listeners[name] || []).forEach((fn) => fn({ data: JSON.stringify(data) })); }
  close() { this.closed = true; }
}
window.EventSource = MockEventSource;
window.__sendUpdate = (status) => {
  current = { ...current, revision: current.revision + 1, updatedAt:'2026-09-21T18:02:00.000Z', game:{ ...current.game, status, score: status === 'final' ? 21 : 18, events:[...current.game.events,{id:'event-2',statId:'touchdown',createdAt:'2026-09-21T18:02:00.000Z',period:2,yards:null}] } };
  MockEventSource.instances.at(-1)?.emit('stat-tracker', current);
};
window.__revoke = () => { revoked = true; MockEventSource.instances.at(-1)?.emit('revoked', { shareToken: current.shareToken }); };
window.__poll404 = () => { poll404 = true; };
window.__pollOk = () => { poll404 = false; };
window.__setShortExpiry = () => { current = { ...current, expiresAt: new Date(Date.now() + 50).toISOString() }; };
window.__setLongExpiry = () => { current = { ...current, expiresAt: new Date(Date.now() + 60000).toISOString() }; };
const queryClient = new QueryClient();
window.__poll = () => queryClient.refetchQueries();
window.fetch = async () => revoked || poll404 ? new Response(JSON.stringify({ error:'not found' }), { status:404 }) : new Response(JSON.stringify(current), { status:200, headers:{'content-type':'application/json'} });
function App() {
  const [owner, setOwner] = useState(false);
  window.__showOwner = () => setOwner(true);
  return createElement('div', null,
    owner && createElement(StatTrackerSharePanel, { share: { ...current, canManage:true }, shareUrl:'https://pixlsports.com/live/token-one', game: current.game, athleteName:'Maya', teamName:'Falcons', busy:false, error:'', notice:'', onCreate:()=>{}, onRevoke:()=>{}, onCopy:()=>{} }),
    createElement(Router,{hook:()=>['/live/token-one',()=>{}]},createElement(Route,{path:'/live/:shareToken',component:PublicStatTrackerPage}))
  );
}
createRoot(document.getElementById('root')).render(createElement(QueryClientProvider,{client:queryClient},createElement(App)));
`;
}

test('public stat tracker viewer stays private, live, final, and revocable on mobile', async () => {
  const probe = createServer();
  const { port } = await listen(probe);
  await new Promise<void>((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()));
  await writeFile(harnessPath, harnessSource(), 'utf8');
  await writeFile(htmlPath, '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">import("/stat-tracker-spectator-test-harness.tsx")</script>', 'utf8');
  const server = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], { cwd: appDirectory, env: { ...process.env, PORT: String(port), BASE_PATH:'/', VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k' }, stdio:['ignore','pipe','pipe'] });
  const temp = await mkdtemp(resolve(tmpdir(), 'pixl-spectator-browser-'));
  let browser: ChildProcess | undefined; let monitor: ProcessMonitor | undefined; const serverMonitor = monitorProcess(server, 'Vite'); let connection: DevToolsConnection | undefined; let page: { sessionId:string; targetId:string } | undefined;
  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 20_000, serverMonitor);
    const debug = createServer(); const { port: debugPort } = await listen(debug); await new Promise<void>((r,e)=>debug.close((x)=>x?e(x):r()));
    browser = spawn(chromiumPath, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${temp}`], { stdio:['ignore','pipe','pipe'] });
    monitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, monitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((r)=>r.json() as Promise<{webSocketDebuggerUrl:string}>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, monitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${port}/stat-tracker-spectator-test.html`);
    await connection.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},page.sessionId);
    await waitFor(connection,page.sessionId,'document.querySelector("[data-testid=\\"stat-tracker-scores\\"]") !== null || document.querySelector("[data-testid=\\"public-stat-tracker-unavailable\\"]") !== null',Boolean);
    await connection.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},page.sessionId);
    const firstBody = await connection.evaluate<string>('document.body.textContent || ""', page.sessionId);
    assert.match(firstBody, /Loading live scoreboard|Scoreboard Unavailable|Falcons/);
    const initial = await connection.evaluate<string>('document.body.textContent || ""',page.sessionId);
    assert.match(initial,/14/); assert.match(initial,/LIVE/); assert.match(initial,/Pass yard/);
    assert.equal(await connection.evaluate<boolean>('!document.body.textContent.includes("private note") && !document.body.textContent.includes("Game notes") && !document.body.textContent.includes("Revoke link") && !document.body.textContent.includes("Play-by-play editor")',page.sessionId),true);
    await connection.evaluate('window.__poll404(); window.__poll()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"public-stat-tracker-unavailable\\"]") !== null', Boolean);
    await connection.evaluate('window.__pollOk(); window.__poll()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-scores\\"]") !== null', Boolean);
    await connection.evaluate('window.__setShortExpiry(); window.__poll()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"public-stat-tracker-unavailable\\"]") !== null', Boolean);
    await connection.evaluate('window.__setLongExpiry(); window.__sendUpdate("live")', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-status\\"]")?.textContent.includes("LIVE")', Boolean);
    await connection.evaluate('window.__sendUpdate("final")',page.sessionId);
    await waitFor(connection,page.sessionId,'document.querySelector("[data-testid=\\"stat-tracker-status\\"]")?.textContent.includes("FINAL") && document.querySelector("[data-testid=\\"stat-tracker-scores\\"]")?.textContent.includes("21")',Boolean);
    assert.match(await connection.evaluate<string>('document.querySelector("[data-testid=\\"connection-status\\"]")?.textContent || ""',page.sessionId),/Live Sync|Reconnecting|Polling/);
    assert.equal(await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"public-stat-tracker-page\\"]")?.scrollWidth <= document.querySelector("[data-testid=\\"public-stat-tracker-page\\"]")?.clientWidth',page.sessionId),true);
    await connection.evaluate('window.__revoke()',page.sessionId);
    await waitFor(connection,page.sessionId,'document.querySelector("[data-testid=\\"public-stat-tracker-unavailable\\"]") !== null',Boolean);
    await connection.evaluate('window.__showOwner()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-share-panel\\"]") !== null', Boolean);
    assert.equal(await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"input-stat-tracker-share-url\\"]")?.value === "https://pixlsports.com/live/token-one" && document.querySelector("[data-testid=\\"button-copy-stat-tracker-share\\"]") !== null && document.querySelector("[data-testid=\\"button-revoke-stat-tracker-share\\"]") !== null', page.sessionId), true);
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && monitor) { if (!monitor.hasExited()) browser.kill('SIGTERM'); await monitor.waitForExit(); }
    if (!serverMonitor.hasExited()) server.kill('SIGTERM');
    await serverMonitor.waitForExit();
    await rm(temp,{recursive:true,force:true}); await rm(harnessPath,{force:true}); await rm(htmlPath,{force:true});
  }
});