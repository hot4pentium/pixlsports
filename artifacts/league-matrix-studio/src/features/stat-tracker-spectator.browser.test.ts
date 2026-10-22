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
import { copyStatTrackerShareUrl } from './src/features/stat-tracker-share';
import './src/index.css';

const initial = { shareToken:'token-one', athleteName:'Maya', teamName:'Falcons', revision:1, createdAt:'2026-09-21T18:00:00.000Z', updatedAt:'2026-09-21T18:01:00.000Z', expiresAt:new Date(Date.now() + 60000).toISOString(), canManage:false, publicFanCardPath:null, game:{ id:'game-1', sport:'football', status:'live', date:'2026-09-21', opponent:'Northside', period:2, score:14, opponentScore:7, stats:{touchdown:2,'pass-yard':1,reception:1,tackle:1}, trackYards:true, yardStats:{'pass-yard':20,'receiving-yard':20}, events:[{id:'event-legacy',statId:'tackle',createdAt:'2026-09-21T18:00:00.000Z',period:2,attribution:'athlete',yards:null},{id:'event-pass',statId:'pass-yard',playId:'play-1',createdAt:'2026-09-21T18:01:00.000Z',period:2,attribution:'team',yards:20},{id:'event-reception',statId:'reception',playId:'play-1',createdAt:'2026-09-21T18:01:00.000Z',period:2,attribution:'team',yards:20}] } };
let current = initial;
let revoked = false;
let poll404 = false;
let hypeCardHidden = false;
let hypeCardPaused = false;
class MockEventSource {
  static instances = [];
  onopen = null; onerror = null; listeners = {};
  constructor(url) { this.url = url; this.closed = false; MockEventSource.instances.push(this); setTimeout(() => this.onopen?.(), 20); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, data) { (this.listeners[name] || []).forEach((fn) => fn({ data: JSON.stringify(data) })); }
  close() { this.closed = true; }
}
window.EventSource = MockEventSource;
window.__sendUpdate = (status, publicFanCardPath = status === 'final' ? '/fan/verified-card' : null) => {
  current = { ...current, revision: current.revision + 1, updatedAt:'2026-09-21T18:02:00.000Z', publicFanCardPath, game:{ ...current.game, status, score: status === 'final' ? 21 : 18, events:[...current.game.events,{id:'event-2',statId:'touchdown',createdAt:'2026-09-21T18:02:00.000Z',period:2,yards:null}] } };
  MockEventSource.instances.at(-1)?.emit('stat-tracker', current);
};
window.__setHypeCardState = (hidden, paused) => { hypeCardHidden = hidden; hypeCardPaused = paused; };
window.__sendDuplicate = () => {
  const source = MockEventSource.instances.at(-1);
  source?.emit('stat-tracker', current);
  source?.emit('stat-tracker', current);
};
window.__revoke = () => { revoked = true; MockEventSource.instances.at(-1)?.emit('revoked', { shareToken: current.shareToken }); };
window.__poll404 = () => { poll404 = true; };
window.__pollOk = () => { poll404 = false; };
window.__setShortExpiry = () => { current = { ...current, expiresAt: new Date(Date.now() + 50).toISOString() }; };
window.__setLongExpiry = () => { current = { ...current, expiresAt: new Date(Date.now() + 60000).toISOString() }; };
const queryClient = new QueryClient();
window.__poll = () => queryClient.refetchQueries();
window.fetch = async () => revoked || poll404 ? new Response(JSON.stringify({ error:'not found' }), { status:404 }) : new Response(JSON.stringify({
  ...current,
  publicFanCardPath: current.game.status === 'final' && !hypeCardHidden && !hypeCardPaused ? '/fan/verified-card' : null,
}), { status:200, headers:{'content-type':'application/json'} });
function App() {
  const [owner, setOwner] = useState(false);
  window.__showOwner = () => setOwner(true);
  return createElement('div', null,
    owner && createElement(StatTrackerSharePanel, { share: { ...current, canManage:true }, shareUrl:'https://pixlsports.com/live/token-one', game: current.game, athleteName:'Maya', teamName:'Falcons', busy:false, error:'', notice:'', onCreate:()=>{}, onRevoke:()=>{}, onCopy:()=>{ void copyStatTrackerShareUrl('https://pixlsports.com/live/token-one', document.querySelector('[data-testid="input-stat-tracker-share-url"]')).then((copied) => { window.__copySucceeded = copied; }); } }),
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
  await writeFile(htmlPath, `
<!doctype html>
<html>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stat tracker spectator browser test</title></head>
  <body><div id="root"></div><script>window.__testErrors=[];window.addEventListener("error",(event)=>window.__testErrors.push({message:event.message,filename:event.filename,lineno:event.lineno,colno:event.colno,error:String(event.error)}));window.addEventListener("unhandledrejection",(event)=>window.__testErrors.push({message:String(event.reason)}));</script><script type="module">import('/stat-tracker-spectator-test-harness.tsx?browser-test=' + Date.now()).catch((error) => { document.body.dataset.testError = String(error); });</script></body>
</html>
`, 'utf8');
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
    assert.equal(
      await connection.evaluate<boolean>(`(() => {
        const link = document.querySelector('[data-testid="link-back-public-home"]');
        return link instanceof HTMLAnchorElement
          && link.getAttribute('href') === '/'
          && link.textContent?.replace(/\\s+/g, ' ').trim() === 'Back to Pixl Sports'
          && link.getBoundingClientRect().height >= 44;
      })()`, page.sessionId),
      true,
      'public scoreboard exposes a labeled, touch-sized return link',
    );
    const firstBody = await connection.evaluate<string>('document.body.textContent || ""', page.sessionId);
    assert.match(firstBody, /Loading live scoreboard|Scoreboard Unavailable|Falcons/);
    assert.equal(await connection.evaluate<boolean>('(() => { const link = document.querySelector("[data-testid=\\"link-public-support-email\\"]"); const rect = link?.getBoundingClientRect(); return link?.getAttribute("href") === "/help" && !!rect && rect.width > 0 && rect.height >= 44 && rect.left >= -1 && rect.right <= innerWidth + 1 && getComputedStyle(link).visibility === "visible"; })()', page.sessionId), true);
    assert.equal(await connection.evaluate<boolean>('(() => { const link = document.querySelector("[data-testid=\\"link-public-support-header\\"]"); const rect = link?.getBoundingClientRect(); return link?.getAttribute("href") === "/help" && !!rect && rect.width > 0 && rect.height >= 44 && rect.top >= -1 && rect.bottom <= innerHeight + 1; })()', page.sessionId), true);
    const initial = await connection.evaluate<string>('document.body.textContent || ""',page.sessionId);
    assert.match(initial,/14/); assert.match(initial,/LIVE/); assert.match(initial,/Pass yard/);
    assert.equal(await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"stat-tracker-final-thank-you\\"]") === null', page.sessionId), true);
    assert.match(initial,/Game day \/ live feed/);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"recent-activity-completed-pass-play-1\\"]") !== null', Boolean);
    assert.equal(await connection.evaluate<boolean>('document.querySelectorAll("[data-testid^=\\"recent-activity-\\"]:not([data-testid^=\\"recent-activity-attribution-\\"])").length === 2 && document.querySelector("[data-testid=\\"recent-activity-completed-pass-play-1\\"]")?.textContent.includes("Completed pass") && !document.querySelector("[data-testid=\\"recent-activity-completed-pass-play-1\\"]")?.textContent.includes("20 yds") && !document.body.textContent.includes("20 yds") && document.querySelector("[data-testid=\\"recent-activity-attribution-completed-pass-play-1\\"]")?.textContent.includes("Falcons") && document.querySelector("[data-testid=\\"recent-activity-event-legacy\\"]")?.textContent.includes("Tackle") && document.querySelector("[data-testid=\\"recent-activity-attribution-event-legacy\\"]")?.textContent.includes("Maya")', page.sessionId), true);
    assert.equal(await connection.evaluate<boolean>('document.body.textContent.includes("Receiving") || document.body.textContent.includes("Reception")', page.sessionId), true);
    await connection.evaluate('window.__sendDuplicate()', page.sessionId);
    assert.equal(await connection.evaluate<boolean>('document.querySelectorAll("[data-testid^=\\"recent-activity-\\"]:not([data-testid^=\\"recent-activity-attribution-\\"])").length === 2', page.sessionId), true);
    assert.equal(await connection.evaluate<boolean>('document.querySelector(`[data-testid="scoreboard-hero"]`) !== null && document.querySelector(`[data-testid="stat-tracker-period"]`)?.textContent === "2"',page.sessionId),true);
    await connection.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false},page.sessionId);
    assert.equal(
      await connection.evaluate<boolean>(
        'document.querySelector("main")?.getBoundingClientRect().width > 900 && document.querySelector("[data-testid=\\"stat-tracker-scores\\"]")?.getBoundingClientRect().width > document.querySelector("[data-testid=\\"stat-tracker-recent-activity\\"]")?.getBoundingClientRect().width',
        page.sessionId,
      ),
      true,
    );
    assert.equal(await connection.evaluate<boolean>('(() => { const link = document.querySelector("[data-testid=\\"link-public-support-email\\"]"); const rect = link?.getBoundingClientRect(); return link?.getAttribute("href") === "/help" && !!rect && rect.width > 0 && rect.height >= 44 && rect.left >= -1 && rect.right <= innerWidth + 1 && getComputedStyle(link).visibility === "visible"; })()', page.sessionId), true);
    assert.equal(await connection.evaluate<boolean>('(() => { const link = document.querySelector("[data-testid=\\"link-public-support-header\\"]"); const rect = link?.getBoundingClientRect(); return link?.getAttribute("href") === "/help" && !!rect && rect.width > 0 && rect.height >= 44 && rect.top >= -1 && rect.bottom <= innerHeight + 1; })()', page.sessionId), true);
    await connection.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},page.sessionId);
    assert.equal(await connection.evaluate<boolean>('!document.body.textContent.includes("private note") && !document.body.textContent.includes("Game notes") && !document.body.textContent.includes("Revoke link") && !document.body.textContent.includes("Play-by-play editor")',page.sessionId),true);
    await connection.evaluate('window.__poll404(); window.__poll()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"public-stat-tracker-unavailable\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(`(() => {
        const link = document.querySelector('[data-testid="link-back-public-home"]');
        return link instanceof HTMLAnchorElement
          && link.getAttribute('href') === '/'
          && link.textContent?.replace(/\\s+/g, ' ').trim() === 'Back to Pixl Sports';
      })()`, page.sessionId),
      true,
      'unavailable scoreboard keeps the same public return destination',
    );
    await connection.evaluate('window.__pollOk(); window.__poll()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-scores\\"]") !== null', Boolean);
    await connection.evaluate('window.__setShortExpiry(); window.__poll()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"public-stat-tracker-unavailable\\"]") !== null', Boolean);
    await connection.evaluate('window.__setLongExpiry(); window.__sendUpdate("live")', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-status\\"]")?.textContent.includes("LIVE")', Boolean);
    await connection.evaluate('window.__sendUpdate("paused")', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-status\\"]")?.textContent.includes("PAUSED")', Boolean);
    assert.equal(await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"stat-tracker-final-thank-you\\"]") === null', page.sessionId), true);
    await connection.evaluate('window.__sendUpdate("live")', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-status\\"]")?.textContent.includes("LIVE")', Boolean);
    await connection.evaluate('window.__showOwner()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-copy-stat-tracker-share\\"]") !== null', Boolean);
    assert.equal(await connection.evaluate<boolean>(`(() => {
      const panel = document.querySelector('[data-testid="stat-tracker-share-panel"]');
      const copy = document.querySelector('[data-testid="button-copy-stat-tracker-share"]');
      const open = document.querySelector('[data-testid="link-open-stat-tracker-share"]');
      return !!panel && !!copy && !!open
        && panel.textContent.includes('Read-only live scoreboard')
        && getComputedStyle(copy).color === 'rgb(255, 255, 255)'
        && getComputedStyle(open).color === 'rgb(255, 255, 255)'
        && copy.getBoundingClientRect().height >= 44
        && open.getBoundingClientRect().height >= 44;
    })()`, page.sessionId), true);
    await connection.evaluate(`(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copiedShareUrl = text; } } });
      document.querySelector('[data-testid="button-copy-stat-tracker-share"]').click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'window.__copySucceeded === true', Boolean);
    assert.equal(await connection.evaluate<string>('window.__copiedShareUrl', page.sessionId), 'https://pixlsports.com/live/token-one');
    await connection.evaluate(`(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Clipboard permission denied'); } } });
      document.execCommand = (command) => {
        if (command !== 'copy') return false;
        const input = document.querySelector('[data-testid="input-stat-tracker-share-url"]');
        window.__legacyCopySelected = input?.selectionStart === 0 && input?.selectionEnd === input?.value.length;
        return true;
      };
      window.__copySucceeded = false;
      document.querySelector('[data-testid="button-copy-stat-tracker-share"]').click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'window.__copySucceeded === true', Boolean);
    assert.equal(await connection.evaluate<boolean>('window.__legacyCopySelected', page.sessionId), true, 'blocked clipboard permissions should fall back to the selected link');
    await connection.evaluate('window.__sendUpdate("final")',page.sessionId);
    await waitFor(connection,page.sessionId,'document.querySelector("[data-testid=\\"stat-tracker-status\\"]")?.textContent.includes("FINAL") && document.querySelector("[data-testid=\\"stat-tracker-scores\\"]")?.textContent.includes("21")',Boolean);
    assert.equal(await connection.evaluate<boolean>('(() => { const message = document.querySelector("[data-testid=\\"stat-tracker-final-thank-you\\"]"); const link = document.querySelector("[data-testid=\\"link-final-fan-card\\"]"); return message?.getAttribute("aria-live") === "polite" && message.textContent.includes("Thanks for watching Maya") && link instanceof HTMLAnchorElement && link.getAttribute("href") === "/fan/verified-card"; })()', page.sessionId), true);
    await connection.evaluate('window.__setHypeCardState(false, true); window.__poll()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"link-final-fan-card\\"]") === null', Boolean);
    assert.equal(await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"stat-tracker-status\\"]")?.textContent.includes("FINAL") === true && document.querySelector("[data-testid=\\"score-home\\"]")?.textContent === "21" && document.querySelector("[data-testid=\\"score-away\\"]")?.textContent === "7" && document.querySelector("[data-testid=\\"stat-tracker-final-thank-you\\"]")?.textContent.includes("Thanks for watching Maya") === true', page.sessionId), true, 'pausing the HYPE Card removes its follow link after refresh without removing the final score or thank-you');
    await connection.evaluate('window.__setHypeCardState(false, false); window.__poll()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"link-final-fan-card\\"]")?.getAttribute("href") === "/fan/verified-card"', Boolean);
    await connection.evaluate('window.__setHypeCardState(true, false); window.__poll()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"link-final-fan-card\\"]") === null', Boolean);
    assert.equal(await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"stat-tracker-status\\"]")?.textContent.includes("FINAL") === true && document.querySelector("[data-testid=\\"score-home\\"]")?.textContent === "21" && document.querySelector("[data-testid=\\"score-away\\"]")?.textContent === "7" && document.querySelector("[data-testid=\\"stat-tracker-final-thank-you\\"]")?.textContent.includes("Thanks for watching Maya") === true', page.sessionId), true, 'hiding the HYPE Card also removes its follow link after refresh while preserving the final scoreboard');
    await connection.evaluate('window.__setHypeCardState(false, false); window.__poll()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"link-final-fan-card\\"]")?.getAttribute("href") === "/fan/verified-card"', Boolean);
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