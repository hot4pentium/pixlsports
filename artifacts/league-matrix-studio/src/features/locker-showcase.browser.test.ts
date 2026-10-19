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
  private readonly browserIssues: string[] = [];
  private constructor(private socket: WebSocket) {
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.method && ['Runtime.exceptionThrown','Runtime.consoleAPICalled','Log.entryAdded','Network.loadingFailed'].includes(message.method)) {
        this.browserIssues.push(`${message.method}: ${JSON.stringify(message.params)}`);
        if (this.browserIssues.length > 12) this.browserIssues.shift();
      }
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
    const diagnostic = await this.evaluate(`({href:location.href,readyState:document.readyState,body:document.body?.innerText||'',root:document.querySelector('#root')?.innerHTML.slice(0,500)||'',resources:performance.getEntriesByType('resource').map(entry=>entry.name).slice(-8)})`).catch(() => null);
    throw new Error(`UI did not settle: ${expression}; browser state: ${JSON.stringify(diagnostic)}; browser issues: ${this.browserIssues.join(' | ') || 'none'}`);
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
import {PlayerShowcaseContent,PlayerShowcasePage} from './src/features/player-showcase';
import {PublicPlayerShowcasePage} from './src/features/public-player-showcase';
import {SportGearBuilderPage} from './src/features/sport-gear-builder';
import {sportGearItems} from './src/features/sport-gear-collection';
import './src/index.css';
const loadout = {shinGuards:'basic',shinGuardColor:'#2878F5',jerseyStyle:'classic',jerseyColor:'#2878F5',shortsStyle:'classic',shortsColor:'#173758',socksStyle:'classic',socksColor:'#F6F5EA',cleatsStyle:'classic',cleatsColor:'#173758',sweatband:'none',background:'field'};
const card = {inviteToken:'fixture-athlete',athleteName:'Jordan Lee',teamName:'River FC',seasonName:'Fall Season',sport:'soccer',showHypeCard:true,showEvents:true,paused:false,photoUrl:null,cardAppearance:{jerseyNumber:'17'},soccerGear:loadout,events:[{shareToken:'fixture-event',eventId:'game-1',title:'River FC vs Hawks',type:'game',date:'2026-10-24',time:'10:00',location:'Field 2',opponent:'Hawks',status:'upcoming'}]};
const state = {mode:new URLSearchParams(location.search).get('mode')||'shared',showEvents:true,fail:false,failSave:false,noMatchingCard:false,athleteRestricted:false,accountId:'fixture-account',denyCopy:false,sport:new URLSearchParams(location.search).get('sport')||'soccer',cardSport:null,profileSeason:null,cardStatus:'ready',gearStatus:'ready',paused:false,showHypeCard:true,patch:{},unlocked:[],ownerInvites:[{...card,inviteToken:'unrelated-first',athleteName:'Casey Park',teamName:'Other Team',sport:'basketball',seasonName:'Spring Season'},{...card}]};
const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
const root = createRoot(document.getElementById('root'));
window.__requests = []; window.__copied = '';
window.__gearSaves = [];
function sportState() {
 const stored=JSON.parse(sessionStorage.getItem('gear-fixture:'+state.accountId+':'+state.sport)||'null');
 const stageGear=(state.mode==='showcase'||state.mode==='public-showcase')?[sportGearItems(state.sport)[0].id]:[];
  return {athleteId:state.noMatchingCard?null:'11111111-1111-4111-8111-111111111111',athleteName:card.athleteName,sport:state.sport,canSave:true,loadout:stored?.loadout??{jerseyColor:'#2878F5',equippedGear:stageGear},items:sportGearItems(state.sport).map((item,index)=>({...item,earned:index===0||index===2,requirement:'Complete five tracked games'})),progress:{activeWeeks:1,eventCardsCreated:1,trackerGamesCompleted:0,hypeCardShared:false}};
}
const originalFetch = window.fetch.bind(window);
window.fetch = async (input,init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('/api/')) {
    window.__requests.push(url);
    if(url.endsWith('/api/athlete-invites'))return new Response(JSON.stringify(state.ownerInvites),{status:200,headers:{'Content-Type':'application/json'}});
    if(url.endsWith('/api/projects'))return new Response(JSON.stringify([]),{status:200,headers:{'Content-Type':'application/json'}});
    if(url.includes('/athlete-gear/sports')){
      if(init?.method==='PUT'){
        const body=JSON.parse(init.body);window.__gearSaves.push(body);
        if(state.failSave)return new Response(JSON.stringify({error:'Offline'}),{status:500,headers:{'Content-Type':'application/json'}});
        sessionStorage.setItem('gear-fixture:'+state.accountId+':'+state.sport,JSON.stringify(body));
      }
      return new Response(JSON.stringify(state.fail?{error:'Unavailable'}:sportState()),{status:state.fail?500:200,headers:{'Content-Type':'application/json'}});
    }
    if(url.includes('/jersey-showcase/gear')){
      const sg=sportState();
      return new Response(JSON.stringify(state.fail?{error:'Unavailable'}:{sport:sg.sport,loadout:sg.loadout,earnedGear:sg.items.filter(x=>x.earned).map(x=>x.id)}),{status:state.fail?404:200,headers:{'Content-Type':'application/json'}});
    }
    const requestPathParts=new URL(url,location.origin).pathname.split('/').filter(Boolean);
    const requestedInviteToken=requestPathParts.at(-1)==='fan'?decodeURIComponent(requestPathParts.at(-2)??''):'';
    const requestedCard=state.ownerInvites.find(invite=>invite.inviteToken===requestedInviteToken)??card;
    const responseSport=state.mode==='owner-showcase'?state.cardSport??requestedCard.sport??state.sport:state.cardSport??state.sport;
    return new Response(JSON.stringify(state.fail ? {error:'Unavailable'} : {...card,...requestedCard,showEvents:state.showEvents,sport:responseSport}),{status:state.fail ? 404 : 200,headers:{'Content-Type':'application/json'}});
  }
  return originalFetch(input,init);
};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{if(state.denyCopy)throw new Error('Denied');window.__copied=value;}}});
function render() {
  const ownerCard = {...card,paused:state.paused,showHypeCard:state.showHypeCard};
  const gear = state.gearStatus==='ready' ? {athleteName:card.athleteName,loadout:{...loadout,...state.patch},unlockedGear:state.unlocked,progress:{activeWeeks:1,eventCardsCreated:1,trackerGamesCompleted:0,hypeCardShared:false}} : null;
  const profile = {athleteName:card.athleteName,teamName:card.teamName,seasonName:state.profileSeason??card.seasonName,jerseyNumber:'17',sport:state.sport,displayName:'Parent',position:'',relationship:'parent',accessMode:'full'};
   const props = {card:ownerCard,cardHref:'/fan/'+card.inviteToken,cardStatus:state.cardStatus,gear,gearStatus:state.gearStatus};
   const linkedCard = {...card,inviteToken:card.inviteToken,hypesEnabled:true,timezone:null,seasonEndsAt:'',photoUrl:null,cutoutUrl:null,hypeCard:null,videos:[],stats:null,scheduleEvents:[],replies:[],liveScoreboard:null,liveTaps:{active:false,taps:[]},updatedAt:''};
  root.render(<QueryClientProvider client={client}><Router base="${base}">
      {state.mode==='sport-editor' ? <SportGearBuilderPage key={state.accountId+state.sport+state.athleteRestricted} accountId={state.accountId} sport={state.sport} athleteName={card.athleteName} jerseyNumber="17" athleteRestricted={state.athleteRestricted}/> : state.mode==='shared' ? <SharedLockerPage params={{inviteToken:card.inviteToken}}/> : state.mode==='public-showcase' ? <PublicPlayerShowcasePage params={{inviteToken:card.inviteToken}}/> : state.mode==='showcase' ? <PlayerShowcaseContent profile={profile} gear={gear} gearStatus={state.gearStatus} sportGear={sportState()} sportGearStatus="ready" athleteRestricted={state.athleteRestricted} linkedCard={linkedCard} cardStatus={state.showHypeCard&&!state.paused?state.cardStatus:'not-shared'} hypeHref={'/player/'+card.inviteToken+'/manage#design'} cardEditHref={'/player/'+card.inviteToken+'/manage#design'} cardPublicHref={'/fan/'+card.inviteToken}/> : state.mode==='owner-showcase' ? <PlayerShowcasePage profile={profile} userId={state.accountId}/> : <AthleteLocker placement="mobile" athleteName={card.athleteName} teamName={card.teamName} jerseyNumber="17" sport={state.sport} {...props}/>}
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
  const configPath = resolve(appDirectory, `${suffix}.config.ts`);
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-locker-chromium-'));
  const port = await availablePort();
  const debugPort = await availablePort();
  let vite: ChildProcess | undefined;
  let chromium: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    await writeFile(sourcePath, harness());
    await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./${suffix}.tsx"></script></body></html>`);
    await writeFile(configPath, `import {mergeConfig} from 'vite';import original from './vite.config';export default mergeConfig(original,{plugins:[{name:'fixture-gear-art',configureServer(server){server.middlewares.use('/api/athlete-gear/art',(_request,response)=>{response.statusCode=200;response.setHeader('Content-Type','image/png');response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==','base64'));});}}]});`);
    vite = spawn('pnpm', ['exec', 'vite', '--config', configPath, '--host', '127.0.0.1'], {
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
    await browser.send('Page.enable');
    await browser.send('Runtime.enable');
    await browser.send('Log.enable');
    await browser.send('Network.enable');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const swipe = async (selector: string, direction: 'left' | 'right') => {
      const point = await browser!.evaluate<{ x: number; y: number }>(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLElement)) throw new Error('Missing swipe target: ' + ${JSON.stringify(selector)});
        const rect = element.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()`);
      const fromX = point.x + (direction === 'left' ? 72 : -72);
      const toX = point.x + (direction === 'left' ? -72 : 72);
      await browser!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: point.y }] });
      await new Promise((resolve) => setTimeout(resolve, 40));
      await browser!.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: toX, y: point.y }] });
      await new Promise((resolve) => setTimeout(resolve, 40));
      await browser!.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}${base}/${suffix}.html` });
    await browser.wait(`document.querySelector('[data-testid="page-shared-locker"]')`).catch((error) => {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; ${viteMonitor.diagnostics()}`);
    });
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="text-shared-locker-name"]').textContent`), 'Jordan Lee');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-shared-locker-hype-card"]').getAttribute('href')`), `${base}/fan/fixture-athlete`);
    assert.ok(await browser.evaluate(`Boolean(document.querySelector('.shared-locker .gear-player'))`));
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid^="link-shared-locker-event-"]').length`), 1);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid^="link-shared-locker-event-"]')?.getAttribute('href')`), `${base}/game-on/fixture-event`);
    assert.ok(await browser.evaluate(`window.__requests.every(url => url.includes('/athlete-invites/fixture-athlete/fan'))`));
    assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`));
    const publicCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(resolve(tmpdir(), 'pixl-shared-locker-check.jpg'), Buffer.from(publicCapture.data, 'base64'));
    await browser.evaluate(`window.__update({mode:'public-showcase'})`);
    await browser.wait(`document.querySelector('[data-testid="page-public-player-showcase"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="text-public-showcase-name"]').textContent`), 'Jordan Lee.');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-public-showcase-hype-card"]').getAttribute('href')`), `${base}/fan/fixture-athlete`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="button-public-showcase-slide-jersey"]').getAttribute('aria-pressed')`), 'true');
    await swipe('[data-testid="figure-public-showcase-jersey"]', 'left');
    await browser.wait(`document.querySelector('[data-testid="figure-public-showcase-hype-card"] [data-testid="img-living-card-athlete"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="button-public-showcase-slide-card"]').getAttribute('aria-pressed')`), 'true');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-public-showcase-card-interactive"]').getAttribute('href')`), `${base}/fan/fixture-athlete`);
    await swipe('[data-testid="figure-public-showcase-hype-card"] .public-showcase__card-art', 'right');
    await browser.wait(`document.querySelector('[data-testid="button-public-showcase-slide-jersey"]').getAttribute('aria-pressed')==='true'`);
    await browser.evaluate(`document.querySelector('[data-testid="button-public-showcase-slide-card"]').focus()`);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space' });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' });
    await browser.wait(`document.querySelector('[data-testid="button-public-showcase-slide-card"]').getAttribute('aria-pressed')==='true'`);
    await browser.evaluate(`document.querySelector('[data-testid="button-public-showcase-slide-jersey"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="figure-public-showcase-jersey"]')`);
    assert.ok(await browser.evaluate(`Boolean(document.querySelector('[data-testid="image-showcase-jersey"]'))`), 'Public soccer Showcase uses the photoreal jersey');
    await browser.wait(`document.querySelector('[data-testid="jersey-table-gear-soccer-ball"]')?.naturalWidth>0`);
    assert.ok(await browser.evaluate(`Boolean(document.querySelector('[data-testid="section-public-showcase-gear"]'))`), 'earned gear appears on the public jersey Showcase without a HYPE Card sharing setting');
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid^="link-public-showcase-event-"]').length`), 1);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid^="link-public-showcase-event-"]')?.getAttribute('href')`), `${base}/game-on/fixture-event`);
    assert.ok(await browser.evaluate(`window.__requests.slice(1).every(url => url.includes('/athlete-invites/fixture-athlete/fan') || url.includes('/athlete-invites/fixture-athlete/jersey-showcase/gear'))`), 'public gear uses its dedicated endpoint, separate from HYPE Card data');
    const publicSoccerGearCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(resolve(tmpdir(), 'pixl-public-soccer-gear-table-check.jpg'), Buffer.from(publicSoccerGearCapture.data, 'base64'));
    assert.ok(await browser.evaluate(`Boolean(document.querySelector('[data-testid="jersey-table-gear-soccer-ball"]'))`), 'gear remains on the Showcase without a visibility toggle');
    await browser.evaluate(`window.__update({sport:'football'})`);
    await browser.wait(`document.querySelector('[data-testid="image-showcase-football-jersey"]')`);
    assert.ok(await browser.evaluate(`document.querySelector('[data-testid="image-showcase-football-jersey"]')?.getAttribute('aria-label').includes('football jersey')`), 'Public football Showcase uses the football jersey design');
    await browser.wait(`document.querySelector('[data-testid="photo-football-jersey"]')?.naturalWidth>0`);
    const publicFootballCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(resolve(tmpdir(), 'pixl-public-football-showcase-check.jpg'), Buffer.from(publicFootballCapture.data, 'base64'));
    for (const width of [320, 390, 768, 1440]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `Public Showcase overflows at ${width}px`);
      assert.ok(await browser.evaluate(`Boolean(document.querySelector('[data-testid="link-public-showcase-hype-card"]'))`), `HYPE Card link is missing at ${width}px`);
      await browser.evaluate(`document.querySelector('[data-testid="button-public-showcase-slide-card"]').click()`);
      await browser.wait(`document.querySelector('[data-testid="figure-public-showcase-hype-card"]')`);
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `Public HYPE Card slide overflows at ${width}px`);
      assert.ok(await browser.evaluate(`(()=>{const visual=document.querySelector('.public-showcase__visual').getBoundingClientRect();const card=document.querySelector('[data-testid="link-public-showcase-card-interactive"]').getBoundingClientRect();return card.left>=visual.left&&card.right<=visual.right&&card.bottom<=visual.bottom+1})()`), `HYPE Card action escapes its display at ${width}px`);
      if (width === 390) {
        const cardCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
        await writeFile(resolve(tmpdir(), 'pixl-public-showcase-card-slide-check.jpg'), Buffer.from(cardCapture.data, 'base64'));
      }
      await browser.evaluate(`document.querySelector('[data-testid="button-public-showcase-slide-jersey"]').click()`);
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const showcaseShareCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(resolve(tmpdir(), 'pixl-public-showcase-check.jpg'), Buffer.from(showcaseShareCapture.data, 'base64'));
    await browser.evaluate(`window.__update({mode:'shared',showEvents:false})`);
    await browser.wait(`document.querySelector('[data-testid="text-shared-locker-no-events"]')?.textContent.includes('not shared')`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid^="link-shared-locker-event-"]').length`), 0);
    await browser.evaluate(`window.__update({mode:'public-showcase'})`);
    await browser.wait(`document.querySelector('[data-testid="text-public-showcase-no-events"]')?.textContent.includes('kept event details private')`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid^="link-public-showcase-event-"]').length`), 0);
    await browser.evaluate(`window.__update({fail:true})`);
    await browser.wait(`document.querySelector('[data-testid="status-public-showcase-unavailable"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="text-shared-locker-name"]')`), null);
    await browser.evaluate(`window.__update({mode:'owner',fail:false,sport:'soccer'})`);
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
    await browser.evaluate(`window.__update({mode:'showcase',gearStatus:'ready',patch:{jerseyColor:'#F36E4C',jerseyStyle:'stripes'},unlocked:['stripe-jersey']})`);
    await browser.wait(`document.querySelector('[data-testid="layer-jersey-dye"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="jersey-layer-stage"]').dataset.jerseyColor`), '#F36E4C');
    assert.ok(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid="layer-jersey-dye"]')).backgroundColor === 'rgb(243, 110, 76)'`));
    assert.ok(await browser.evaluate(`Boolean(document.querySelector('[data-testid="layer-jersey-stripes"]'))`));
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="layer-gear-row"]')`), null, 'no gear art yet: clear fallback');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="jersey-layer-stage"]').dataset.gearFallback`), 'clear');
    assert.ok(await browser.evaluate(`Boolean(document.querySelector('[data-testid="jersey-table-gear-soccer-ball"]'))`), 'equipped soccer gear is displayed on the jersey table');
    const coloredCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(resolve(tmpdir(), 'pixl-colored-showcase-check.jpg'), Buffer.from(coloredCapture.data, 'base64'));
    await browser.evaluate(`window.__update({unlocked:[]})`);
    await browser.wait(`!document.querySelector('[data-testid="layer-jersey-stripes"]')`);
    await browser.evaluate(`window.__update({patch:{},unlocked:[]})`);
    await browser.wait(`!document.querySelector('[data-testid="layer-jersey-dye"]')`);
    for (const width of [320, 390]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true });
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `Showcase overflows at ${width}px`);
    }
    await browser.evaluate(`window.__update({mode:'owner',sport:'basketball',gearStatus:'unavailable'})`);
    await browser.wait(`!document.querySelector('[data-testid^="link-locker-cocreate-"]')`);
    for (const width of [320, 390, 1440]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `Owner Locker overflows at ${width}px`);
    }
    await browser.evaluate(`window.__update({mode:'showcase',sport:'soccer',gearStatus:'ready'})`);
    await browser.wait(`document.querySelector('[data-testid="page-player-showcase"]')`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid="section-dynamic-showcase"]').length`), 1);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="button-showcase-slide-jersey"]').getAttribute('aria-pressed')`), 'true');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-hype-card"]').getAttribute('href')`), `${base}/player/fixture-athlete/manage#design`);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const initialRotation = await browser.evaluate(`(() => {
      const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width)}};
      const jersey=document.querySelector('[data-testid="showcase-slide-jersey"]');
      const art=document.querySelector('[data-testid="showcase-card-art"]');
      const jerseyBox=jersey.getBoundingClientRect(), artBox=art.getBoundingClientRect();
      return {
        active:document.querySelector('[data-testid="showcase-rotor"]').dataset.activeSlide,
        cardHidden:document.querySelector('[data-testid="showcase-slide-card"]').getAttribute('aria-hidden'),
        artPeeking:Math.round(artBox.right-jerseyBox.right),
        noOverflow:document.documentElement.scrollWidth<=innerWidth,
        viewport:rect('[data-testid="showcase-rotor-viewport"]'),
        jerseyRect:rect('[data-testid="showcase-slide-jersey"]'),
        cardRect:rect('[data-testid="showcase-slide-card"]'),
        artRect:rect('[data-testid="showcase-card-art"]'),
        cardTransform:getComputedStyle(document.querySelector('[data-testid="showcase-slide-card"]')).transform
      };
    })()`);
    const layeredCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    await writeFile(resolve(tmpdir(), 'pixl-showcase-card-behind-jersey-check.jpg'), Buffer.from(layeredCapture.data, 'base64'));
    assert.equal(initialRotation.active, 'jersey');
    assert.equal(initialRotation.cardHidden, 'true');
    assert.equal(initialRotation.noOverflow, true);
    assert.ok(initialRotation.artPeeking >= 24, `the HYPE Card artwork should visibly peek out from behind the jersey; measured ${JSON.stringify(initialRotation)}`);
    await swipe('[data-testid="showcase-jersey-stage"]', 'left');
    await browser.wait(`document.querySelector('[data-testid="showcase-rotor"]').dataset.activeSlide==='card'`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="showcase-slide-card"]').getAttribute('aria-hidden')`), 'false');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid="showcase-slide-jersey"] .ps__links')).visibility`), 'hidden', 'the HYPE Card slide hides jersey-specific actions');
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid="showcase-slide-card"] .ps__card-caption')).visibility`), 'visible', 'the HYPE Card slide keeps card-specific actions visible');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="collection-sport-gear-soccer"]')`), null, 'the HYPE Card slide hides jersey equipment');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-card-edit"]').getAttribute('href')`), `${base}/player/fixture-athlete/manage#design`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-card-public"]').getAttribute('href')`), `${base}/fan/fixture-athlete`);
    for (const width of [320, 390, 1440]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `Owner HYPE Card slide overflows at ${width}px`);
      if (width === 390) {
        const cardCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
        await writeFile(resolve(tmpdir(), 'pixl-owner-showcase-card-slide-check.jpg'), Buffer.from(cardCapture.data, 'base64'));
      }
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await swipe('[data-testid="showcase-hype-card-preview"] .ps__card-art', 'right');
    await browser.wait(`document.querySelector('[data-testid="showcase-rotor"]').dataset.activeSlide==='jersey'`);
    assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-testid="collection-sport-gear-soccer"]'))`), true, 'returning to the jersey restores jersey equipment');
    await browser.evaluate(`window.__update({paused:true})`);
    await browser.wait(`document.querySelector('[data-testid="button-showcase-slide-card"]')`);
    await browser.evaluate(`document.querySelector('[data-testid="button-showcase-slide-card"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="showcase-rotor"]').dataset.activeSlide==='card'`);
    await browser.wait(`document.querySelector('[data-testid="status-showcase-card-unavailable"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="showcase-hype-card-preview"] [data-testid="img-living-card-athlete"]')`), null, 'paused HYPE Card art is not rendered into the owner Showcase');
    assert.ok(await browser.evaluate(`document.querySelector('[data-testid="status-showcase-card-unavailable"]').textContent.includes('not shared')`), 'the owner gets a clear status when card sharing is paused');
    await browser.evaluate(`window.__update({paused:false})`);
    await browser.wait(`document.querySelector('[data-testid="button-showcase-slide-card"]')`);
    await browser.evaluate(`window.__update({cardStatus:'not-linked'})`);
    await browser.evaluate(`document.querySelector('[data-testid="button-showcase-slide-card"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="status-showcase-card-unavailable"]').textContent.includes('No HYPE Card linked')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="showcase-hype-card-preview"] [data-testid="img-living-card-athlete"]')`), null, 'a missing linked card does not produce a fabricated preview');
    await browser.evaluate(`window.__update({cardStatus:'ready'})`);
    await browser.evaluate(`document.querySelector('[data-testid="button-showcase-slide-jersey"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="showcase-jersey-stage"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-parent-week"]')`), null);
    assert.equal(await browser.evaluate(`document.body.innerText.includes('Plan your week')`), false);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-gear"]').getAttribute('href')`), `${base}/studio/gear`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-shoutouts"]').getAttribute('href')`), `${base}/studio/athlete-page#owner-fan-hypes`);
    assert.ok(await browser.evaluate(`document.querySelector('[data-testid="image-showcase-jersey"]')?.getAttribute('alt').includes('Jordan Lee number 17')`));
    for (const width of [320, 390, 1440]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      assert.ok(await browser.evaluate(`Boolean(document.querySelector('[data-testid="image-showcase-jersey"]'))`), `Photoreal jersey is missing at ${width}px`);
      assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid^="athlete-locker-"]').length`), 0, 'Player Showcase should focus on the jersey, not repeat the Locker');
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `Player Showcase overflows at ${width}px`);
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.wait(`document.querySelector('[data-testid="image-showcase-jersey"]')`);
    const showcaseCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(resolve(tmpdir(), 'pixl-player-showcase-check.jpg'), Buffer.from(showcaseCapture.data, 'base64'));
    await browser.evaluate(`window.__update({sport:'football',gearStatus:'unavailable'})`);
    await browser.wait(`document.querySelector('[data-testid="image-showcase-football-jersey"]')`);
    assert.ok(await browser.evaluate(`document.querySelector('[data-testid="image-showcase-football-jersey"]')?.getAttribute('aria-label').includes('Football jersey')`), 'Private football Showcase uses the football jersey design');
    await browser.wait(`document.querySelector('[data-testid="photo-football-jersey"]')?.naturalWidth>0`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-gear"]').getAttribute('href')`), `${base}/studio/gear`);
    assert.equal(await browser.evaluate(`document.querySelector('.ps__jersey')`), null, 'The generic flat jersey fallback is removed');
    const privateFootballCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(resolve(tmpdir(), 'pixl-private-football-showcase-check.jpg'), Buffer.from(privateFootballCapture.data, 'base64'));
    await browser.evaluate(`window.__update({sport:'soccer',gearStatus:'ready'})`);
    await browser.evaluate(`window.__update({gearStatus:'loading'})`);
    await browser.wait(`document.querySelector('[data-testid="status-showcase-gear-loading"]')`);
    await browser.evaluate(`window.__update({gearStatus:'unavailable'})`);
    await browser.wait(`document.querySelector('[data-testid="status-showcase-gear-empty"]')`);
    await browser.evaluate(`window.__update({gearStatus:'error'})`);
    await browser.wait(`document.querySelector('[data-testid="status-showcase-error"]')`);
    await browser.evaluate(`window.__update({sport:'basketball',gearStatus:'unavailable'})`);
    await browser.wait(`document.querySelector('[data-testid="link-showcase-gear"]')`);
    assert.ok(await browser.evaluate(`document.querySelector('[data-testid="image-showcase-jersey"]')?.getAttribute('alt').includes('Basketball jersey')`));
    await browser.evaluate(`window.__update({mode:'sport-editor',sport:'football',athleteRestricted:false,noMatchingCard:true})`);
    await browser.wait(`document.querySelector('[data-testid="page-sport-gear-football"]')`);
    await browser.wait(`document.querySelector('[data-testid="button-equip-football-helmet"] img')?.naturalWidth>0`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="button-equip-football-cleats"]').disabled`), true);
    assert.ok(await browser.evaluate(`document.querySelector('[data-testid="button-equip-football-cleats"] img').src.endsWith('football-cleats-outline.webp')`));
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="button-equip-football-helmet"] img').dataset.earned`), 'true');
    await browser.evaluate(`document.querySelector('[data-testid="button-equip-football-helmet"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="button-equip-football-helmet"]').getAttribute('aria-pressed')==='true'`);
    await browser.evaluate(`document.querySelector('[data-testid="button-sport-color-coral"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="status-sport-gear-save"]').textContent==='Unsaved changes'`);
    await browser.evaluate(`window.__update({failSave:true})`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="button-sport-color-coral"]').getAttribute('aria-pressed')`), 'true', 'polling preserves the unsaved color draft');
    await browser.evaluate(`document.querySelector('[data-testid="button-save-sport-gear"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="status-sport-gear-save"]').textContent.includes('didn’t stick')`);
    await browser.evaluate(`window.__update({failSave:false})`);
    await browser.evaluate(`document.querySelector('[data-testid="button-retry-sport-gear-save"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="status-sport-gear-save"]').textContent==='Saved'`);
    assert.deepEqual(await browser.evaluate(`window.__gearSaves.at(-1).loadout`), {jerseyColor:'#F36E4C',equippedGear:['football-helmet']});
    assert.equal(await browser.evaluate(`window.__gearSaves.at(-1).athleteName`), 'Jordan Lee');
    assert.equal(await browser.evaluate(`'athleteId' in window.__gearSaves.at(-1) || 'showOnHypeCard' in window.__gearSaves.at(-1)`), false, 'saving uses the account and sport, not a HYPE Card ID or visibility flag');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="text-sport-gear-cannot-save"]')`), null, 'a missing HYPE Card does not block saving');
    await browser.evaluate(`document.querySelector('[data-testid="button-sport-color-lime"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="status-sport-gear-save"]').textContent==='Unsaved changes'`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="button-save-sport-gear"]').disabled`), false, 'Save gear remains actionable without a matching HYPE Card');
    await browser.evaluate(`document.querySelector('[data-testid="button-save-sport-gear"]').scrollIntoView({block:'center'})`);
    const savePoint = await browser.evaluate(`(()=>{const r=document.querySelector('[data-testid="button-save-sport-gear"]').getBoundingClientRect();return {x:Math.floor(r.x+r.width/2),y:Math.floor(r.y+r.height/2),id:2,force:1}})()`);
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [savePoint] });
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await browser.wait(`document.querySelector('[data-testid="status-sport-gear-save"]').textContent==='Saved'`);
    assert.equal(await browser.evaluate(`window.__gearSaves.length`), 3, 'the save succeeds even though no matching HYPE Card exists');
    await browser.evaluate(`window.scrollTo(0,document.documentElement.scrollHeight)`);
    await browser.wait(`Array.from(document.querySelectorAll('[data-testid^="button-equip-"] img')).every(img=>img.complete&&img.naturalWidth>0)`);
    await browser.evaluate(`window.scrollTo(0,0)`);
    const gearHeight = await browser.evaluate(`document.documentElement.scrollHeight`);
    const gearCapture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 85, captureBeyondViewport: true, clip: {x:0,y:0,width:390,height:gearHeight,scale:1} });
    await writeFile(resolve(tmpdir(), 'pixl-football-gear-check.jpg'), Buffer.from(gearCapture.data, 'base64'));
    for (const width of [320,390,768,1440]) {
      await browser.send('Emulation.setDeviceMetricsOverride', {width,height:1100,deviceScaleFactor:1,mobile:width<600});
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth`), `Gear editor overflows at ${width}px`);
    }
    await browser.send('Page.navigate',{url:`http://127.0.0.1:${port}${base}/${suffix}.html?mode=sport-editor&sport=football`});
    await browser.wait(`document.querySelector('[data-testid="button-equip-football-helmet"]')?.getAttribute('aria-pressed')==='true'`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="button-sport-color-lime"]').getAttribute('aria-pressed')`), 'true', 'saved jersey color survives reload');
    await browser.evaluate(`window.__update({mode:'showcase'})`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="image-showcase-football-jersey"]').style.getPropertyValue('--football-jersey-accent')`), '#D7EF80');
    assert.ok(await browser.evaluate(`Boolean(document.querySelector('[data-testid="jersey-table-gear-football-helmet"]'))`), 'the owner showcase displays equipped football gear on its table');
     await browser.evaluate(`window.__update({mode:'public-showcase'})`);
    await browser.wait(`document.querySelector('[data-testid="section-public-showcase-gear"]')`);
    assert.ok(await browser.evaluate(`Boolean(document.querySelector('[data-testid="jersey-table-gear-football-helmet"]'))`), 'publicly shared equipped gear sits on the football jersey table');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="gear-art-football-cleats"]').dataset.earned`), 'false');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="gear-art-football-helmet"]').dataset.earned`), 'true');
    assert.ok(await browser.evaluate(`Boolean(document.querySelector('[data-testid="section-public-showcase-gear"]'))`), 'public Showcase gear is not controlled by HYPE Card visibility');
    await browser.evaluate(`window.__update({mode:'owner-showcase',sport:'soccer',gearStatus:'ready'})`);
    await browser.wait(`document.querySelector('[data-testid="link-public-showcase-url"]')`);
    assert.ok(await browser.evaluate(`document.querySelector('[data-testid="link-public-showcase-url"]').getAttribute('href').endsWith('/showcase/fixture-athlete')`), 'the share link resolves the invite matching the selected athlete rather than the first saved invite');
    await browser.evaluate(`window.__update({profileSeason:'Spring 2027'})`);
    await browser.evaluate(`document.querySelector('[data-testid="button-showcase-slide-card"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="showcase-hype-card-preview"] [data-testid="img-living-card-athlete"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-card-public"]').getAttribute('href')`), `${base}/fan/fixture-athlete`, 'a single athlete card remains linked when the profile season label changes');
    await browser.evaluate(`window.__update({ownerInvites:[{inviteToken:'fixture-athlete',athleteName:'Jordan Lee',teamName:'River FC',seasonName:'Fall Season',sport:'baseball',showHypeCard:true,showEvents:true,paused:false}],cardSport:'baseball',sport:'soccer'})`);
    await browser.wait(`document.querySelector('[data-testid="showcase-hype-card-preview"] [data-testid="img-living-card-athlete"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="status-showcase-card-unavailable"]')`), null, 'a unique baseball HYPE Card remains connected when the athlete profile is set to soccer');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-card-public"]').getAttribute('href')`), `${base}/fan/fixture-athlete`);
    const fallCard={inviteToken:'fall-card',athleteName:'Jordan Lee',teamName:'River FC',seasonName:'Fall 2025',sport:'soccer',showHypeCard:true,showEvents:true,paused:false};
    const springCard={inviteToken:'spring-card',athleteName:'Jordan Lee',teamName:'River FC',seasonName:'Spring 2026',sport:'soccer',showHypeCard:true,showEvents:true,paused:false};
    const unrelatedCard={inviteToken:'casey-card',athleteName:'Casey Park',teamName:'Other Team',seasonName:'Spring 2026',sport:'basketball',showHypeCard:true,showEvents:true,paused:false};
    await browser.evaluate(`window.__update({ownerInvites:${JSON.stringify([unrelatedCard,fallCard,springCard])},profileSeason:'Summer 2026',cardSport:null,sport:'soccer'})`);
    await browser.wait(`document.querySelector('[data-testid="select-showcase-card"]')`);
    assert.deepEqual(await browser.evaluate(`Array.from(document.querySelectorAll('[data-testid="select-showcase-card"] option')).map(option=>option.textContent.trim())`), ['Select a HYPE Card','Soccer · Fall 2025','Soccer · Spring 2026'], 'only cards for the selected athlete and team are offered with sport and season details');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-public-showcase-url"]')`), null, 'an unresolved card does not publish a misleading showcase URL');
    await browser.evaluate(`(()=>{const select=document.querySelector('[data-testid="select-showcase-card"]');select.value='spring-card';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await browser.wait(`document.querySelector('[data-testid="img-living-card-athlete"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="select-showcase-card"]').value`), 'spring-card', 'the selected card remains available for comparison');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-card-edit"]').getAttribute('href')`), `${base}/player/spring-card/manage#design`, 'the design link uses the chosen card');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-showcase-card-public"]').getAttribute('href')`), `${base}/fan/spring-card`, 'the public card link uses the chosen card');
    assert.ok(await browser.evaluate(`window.__requests.some(url=>url.includes('/athlete-invites/spring-card/fan'))`), 'the preview loads the selected card rather than the first matching invite');
    await browser.evaluate(`document.querySelector('[data-testid="button-showcase-slide-jersey"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="panel-share-public-showcase"]')`);
    assert.ok(await browser.evaluate(`document.querySelector('[data-testid="link-public-showcase-url"]').getAttribute('href').endsWith('/showcase/spring-card')`), 'the Showcase link uses the chosen card token');
    await browser.evaluate(`document.querySelector('[data-testid="button-showcase-slide-card"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="showcase-rotor"]').dataset.activeSlide==='card'`);
    await browser.evaluate(`window.__update({ownerInvites:[${JSON.stringify(unrelatedCard)}]})`);
    await browser.wait(`document.querySelector('[data-testid="status-showcase-card-unavailable"]').textContent.includes('No HYPE Card linked')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="select-showcase-card"]')`), null, 'a truly missing card is distinct and does not offer another athlete’s card');
    await browser.evaluate(`window.__update({ownerInvites:[${JSON.stringify(fallCard)}]})`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="collection-sport-gear-soccer"]')`), null, 'the owner HYPE Card view omits the jersey gear collection');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="panel-share-public-showcase"]')`), null, 'the owner HYPE Card view omits the general Showcase-sharing panel');
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="athlete-editor-invitation"]')`), null, 'the owner HYPE Card view omits the athlete-editor invitation panel');
    await browser.evaluate(`document.querySelector('[data-testid="button-showcase-slide-jersey"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="showcase-rotor"]').dataset.activeSlide==='jersey'`);
    await browser.wait(`document.querySelector('[data-testid="collection-sport-gear-soccer"]')`);
    assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-testid="panel-share-public-showcase"]'))`), true, 'the Jersey slide restores Showcase-level sharing');
    assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-testid="athlete-editor-invitation"]'))`), true, 'the Jersey slide restores athlete-editor access');
    await browser.evaluate(`window.__update({mode:'sport-editor',sport:'football',athleteRestricted:true,noMatchingCard:false})`);
    await browser.wait(`document.querySelector('[data-testid="page-sport-gear-football"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="toggle-sport-gear-public"]')`), null);
    await browser.evaluate(`document.querySelector('[data-testid="button-sport-color-coral"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="button-sport-color-coral"]').getAttribute('aria-pressed')==='true'`);
    await browser.evaluate(`document.querySelector('[data-testid="button-save-sport-gear"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="status-sport-gear-save"]').textContent==='Saved'`);
    assert.equal(await browser.evaluate(`'showOnHypeCard' in window.__gearSaves.at(-1)`), false, 'athlete saves do not include a HYPE Card visibility setting');
    await browser.evaluate(`window.__update({accountId:'second-account',athleteRestricted:false})`);
    await browser.wait(`document.querySelector('[data-testid="button-sport-color-pixl-blue"]')?.getAttribute('aria-pressed')==='true'`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="button-equip-football-helmet"]').getAttribute('aria-pressed')`), 'false', 'another account does not inherit equipped gear');
    for (const sport of ['baseball','basketball','soccer','softball','volleyball']) {
      await browser.evaluate(`window.__update({sport:'${sport}'})`);
      await browser.wait(`document.querySelector('[data-testid="page-sport-gear-${sport}"]')`);
      assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid^="button-equip-"]').length`), 4);
      await browser.wait(`Array.from(document.querySelectorAll('[data-testid^="button-equip-"] img')).every(img=>img.complete&&img.naturalWidth>0)`);
    }
  } finally {
    browser?.close();
    await stop(chromium);
    await stop(vite);
    await rm(sourcePath, { force: true });
    await rm(htmlPath, { force: true });
    await rm(configPath, { force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
