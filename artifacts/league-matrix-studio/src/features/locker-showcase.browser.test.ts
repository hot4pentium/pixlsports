import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { monitorProcess, waitForUrl } from './browser-test-diagnostics';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = '/locker-check';

async function availablePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  return address.port;
}

class Browser {
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private constructor(private socket: WebSocket) {
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const item of this.pending.values()) item.reject(new Error('Browser closed'));
      this.pending.clear();
    });
  }
  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((done, reject) => {
      socket.addEventListener('open', () => done(), { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not connect to Chromium')), { once: true });
    });
    return new Browser(socket);
  }
  async send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.nextId;
    return new Promise<any>((resolveValue, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolveValue(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression: string) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async wait(expression: string) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`UI did not settle: ${expression}`);
  }
  close() { this.socket.close(); }
}

function harness() {
  return `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Router} from 'wouter';
import {SharedLockerPage} from './src/features/shared-locker';
import {AthleteLocker} from './src/features/athlete-locker';
import {PlayerShowcaseContent} from './src/features/player-showcase';
import './src/index.css';
const loadout = {shinGuards:'basic',shinGuardColor:'#2878F5',jerseyStyle:'classic',jerseyColor:'#2878F5',shortsStyle:'classic',shortsColor:'#173758',socksStyle:'classic',socksColor:'#F6F5EA',cleatsStyle:'classic',cleatsColor:'#173758',sweatband:'none',background:'field'};
const card = {inviteToken:'fixture-athlete',athleteName:'Jordan Lee',teamName:'River FC',seasonName:'Fall Season',sport:'soccer',showHypeCard:true,showEvents:true,paused:false,photoUrl:null,cardAppearance:{jerseyNumber:'17'},soccerGear:loadout,events:[{shareToken:'fixture-event',eventId:'game-1',title:'River FC vs Hawks',type:'game',date:'2026-10-24',time:'10:00',location:'Field 2',opponent:'Hawks',status:'upcoming'}]};
const state = {mode:'shared',showEvents:true,fail:false,denyCopy:false,sport:'soccer',cardStatus:'ready',gearStatus:'ready',paused:false,showHypeCard:true};
const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
const root = createRoot(document.getElementById('root'));
window.__requests = []; window.__copied = '';
const originalFetch = window.fetch.bind(window);
window.fetch = async (input,init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('/api/')) {
    window.__requests.push(url);
    return new Response(JSON.stringify(state.fail ? {error:'Unavailable'} : {...card,showEvents:state.showEvents}),{status:state.fail ? 404 : 200,headers:{'Content-Type':'application/json'}});
  }
  return originalFetch(input,init);
};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{if(state.denyCopy)throw new Error('Denied');window.__copied=value;}}});
function render() {
  const ownerCard = {...card,paused:state.paused,showHypeCard:state.showHypeCard};
  const gear = state.gearStatus==='ready' ? {athleteName:card.athleteName,loadout,unlockedGear:[],progress:{activeWeeks:1,eventCardsCreated:1,trackerGamesCompleted:0,hypeCardShared:false}} : null;
  const profile = {athleteName:card.athleteName,teamName:card.teamName,seasonName:card.seasonName,jerseyNumber:'17',sport:state.sport,displayName:'Parent',position:'',relationship:'parent',accessMode:'full'};
  const props = {card:ownerCard,cardHref:'/fan/'+card.inviteToken,cardStatus:state.cardStatus,gear,gearStatus:state.gearStatus};
  root.render(<QueryClientProvider client={client}><Router base="${base}">
    {state.mode==='shared' ? <SharedLockerPage params={{inviteToken:card.inviteToken}}/> : state.mode==='showcase' ? <PlayerShowcaseContent profile={profile} {...props}/> : <AthleteLocker placement="mobile" athleteName={card.athleteName} teamName={card.teamName} jerseyNumber="17" sport={state.sport} {...props}/>}
  </Router></QueryClientProvider>);
}
window.__update = async patch => {Object.assign(state,patch);render();await client.invalidateQueries();};
render();
`;
}

async function stop(process: ChildProcess | undefined) {
  if (!process || process.exitCode !== null) return;
  process.kill('SIGTERM');
  await new Promise<void>((done) => {
    const timer = setTimeout(() => { process.kill('SIGKILL'); done(); }, 3_000);
    process.once('exit', () => { clearTimeout(timer); done(); });
  });
}

test('Locker sharing keeps public data filtered and parent controls explicit across phone and desktop', { timeout: 120_000 }, async () => {
  const suffix = `locker-check-${process.pid}`;
  const sourcePath = resolve(appDirectory, `${suffix}.tsx`);
  const htmlPath = resolve(appDirectory, `${suffix}.html`);
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-locker-chromium-'));
  const port = await availablePort();
  const debugPort = await availablePort();
  let vite: ChildProcess | undefined;
  let chromium: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    await writeFile(sourcePath, harness());
    await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./${suffix}.tsx"></script></body></html>`);
    vite = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory, env: { ...process.env, PORT: String(port), BASE_PATH: `${base}/` }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const viteMonitor = monitorProcess(vite, 'Locker fixture Vite');
    await waitForUrl(`http://127.0.0.1:${port}${base}/`, 25_000, viteMonitor);
    chromium = spawn(process.env.CHROMIUM_PATH || 'chromium', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chromeMonitor = monitorProcess(chromium, 'Locker fixture Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 15_000, chromeMonitor);
    const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
    browser = await Browser.connect(tabs.find((tab) => tab.type === 'page')!.webSocketDebuggerUrl);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}${base}/${suffix}.html` });
    await browser.wait(`document.querySelector('[data-testid="page-shared-locker"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="text-shared-locker-name"]').textContent`), 'Jordan Lee');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-shared-locker-hype-card"]').getAttribute('href')`), `${base}/fan/fixture-athlete`);
    assert.ok(await browser.evaluate(`Boolean(document.querySelector('.shared-locker .gear-player'))`));
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid^="link-shared-locker-event-"]').length`), 1);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid^="link-shared-locker-event-"]')?.getAttribute('href')`), `${base}/game-on/fixture-event`);
    assert.ok(await browser.evaluate(`window.__requests.every(url => url.includes('/athlete-invites/fixture-athlete/fan'))`));
    assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`));
    const publicCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(resolve(tmpdir(), 'pixl-shared-locker-check.jpg'), Buffer.from(publicCapture.data, 'base64'));
    await browser.evaluate(`window.__update({showEvents:false})`);
    await browser.wait(`document.querySelector('[data-testid="text-shared-locker-no-events"]')?.textContent.includes('not shared')`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid^="link-shared-locker-event-"]').length`), 0);
    await browser.evaluate(`window.__update({fail:true})`);
    await browser.wait(`document.querySelector('[data-testid="status-shared-locker-unavailable"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="text-shared-locker-name"]')`), null);
    await browser.evaluate(`window.__update({mode:'owner',fail:false})`);
    await browser.wait(`document.querySelector('[data-testid="button-locker-copy-mobile"]')`);
    const ownerCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(resolve(tmpdir(), 'pixl-owner-locker-check.jpg'), Buffer.from(ownerCapture.data, 'base64'));
    await browser.evaluate(`document.querySelector('[data-testid="button-locker-copy-mobile"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="status-locker-copy-mobile"]')?.textContent.includes('copied')`);
    assert.equal(await browser.evaluate(`window.__copied`), `http://127.0.0.1:${port}${base}/locker/fixture-athlete`);
    await browser.evaluate(`window.__update({denyCopy:true})`);
    await browser.evaluate(`document.querySelector('[data-testid="button-locker-copy-mobile"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="status-locker-copy-mobile"]')?.textContent.includes('Could not copy')`);
    await browser.evaluate(`window.__update({paused:true})`);
    await browser.wait(`!document.querySelector('[data-testid="section-locker-share-mobile"]')`);
    await browser.evaluate(`window.__update({paused:false,showHypeCard:false})`);
    await browser.wait(`document.querySelector('[data-testid="status-locker-card-hidden"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="section-locker-share-mobile"]')`), null);
    await browser.evaluate(`window.__update({gearStatus:'unavailable',showHypeCard:true})`);
    await browser.wait(`document.querySelector('[data-testid="link-locker-cocreate-empty-mobile"]')`);
    await browser.evaluate(`window.__update({sport:'basketball'})`);
    await browser.wait(`!document.querySelector('[data-testid^="link-locker-cocreate-"]')`);
    for (const width of [320, 390, 1440]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `Owner Locker overflows at ${width}px`);
    }
    await browser.evaluate(`window.__update({mode:'showcase',sport:'soccer',gearStatus:'ready'})`);
    await browser.wait(`document.querySelector('[data-testid="page-player-showcase"]')`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid="section-dynamic-showcase"]').length`), 1);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-parent-week"]').getAttribute('href')`), `${base}/studio`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-gear"]').getAttribute('href')`), `${base}/studio/soccer-gear`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-shoutouts"]').getAttribute('href')`), `${base}/studio/athlete-page#owner-fan-hypes`);
    for (const width of [320, 390, 1440]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      const placement = width < 861 ? 'mobile' : 'desktop';
      await browser.wait(`document.querySelector('[data-testid="athlete-locker-${placement}"]')`);
      assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid^="athlete-locker-"]').length`), 1);
      assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-locker-events-${placement}"]').getAttribute('href')`), `${base}/studio`);
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `Player Showcase overflows at ${width}px`);
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.wait(`document.querySelector('[data-testid="athlete-locker-mobile"]')`);
    const showcaseCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(resolve(tmpdir(), 'pixl-player-showcase-check.jpg'), Buffer.from(showcaseCapture.data, 'base64'));
    await browser.evaluate(`window.__update({gearStatus:'loading'})`);
    await browser.wait(`document.querySelector('[data-testid="status-showcase-gear-loading"]')`);
    await browser.evaluate(`window.__update({gearStatus:'unavailable'})`);
    await browser.wait(`document.querySelector('[data-testid="status-showcase-gear-empty"]')`);
    await browser.evaluate(`window.__update({gearStatus:'error'})`);
    await browser.wait(`document.querySelector('[data-testid="status-showcase-error"]')`);
    await browser.evaluate(`window.__update({sport:'basketball',gearStatus:'unavailable'})`);
    await browser.wait(`!document.querySelector('[data-testid="link-showcase-gear"]')`);
    assert.ok(await browser.evaluate(`document.querySelector('.ps__jersey').getAttribute('aria-label').includes('Basketball')`));
  } finally {
    browser?.close();
    await stop(chromium);
    await stop(vite);
    await rm(sourcePath, { force: true });
    await rm(htmlPath, { force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
