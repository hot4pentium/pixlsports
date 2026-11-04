import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DevToolsConnection, monitorProcess, openPage, waitFor, waitForUrl } from './browser-test-diagnostics';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function availablePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

// Intentionally imports only the follow and owner summary, not Showcase routes.
// The fixture stores server state separately from the component's local follow.
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {FanCardActions} from './src/features/fan-card-follow';
import {FanBaseOwnerCard} from './src/features/fan-base-owner-card';
import {FanCardFollowDialog} from './src/features/fan-card-follow-dialog';
import {Dialog,DialogDescription,DialogHeader,DialogTitle} from './src/components/ui/dialog';
import './src/index.css';
import './src/features/living-athlete-card.css';
const token='fixture-athlete';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
const root=createRoot(document.getElementById('root'));
// Model iOS keyboard behavior: the layout viewport stays tall while the visual
// viewport shrinks and pans. This is not a physical iPhone keyboard test.
const viewport=window.visualViewport;
const nativeHeight=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(viewport),'height').get.bind(viewport);
let keyboardViewport=null;
Object.defineProperties(viewport,{
 height:{configurable:true,get:()=>keyboardViewport?.height??nativeHeight()},
 offsetTop:{configurable:true,get:()=>keyboardViewport?.offsetTop??0},
});
window.__keyboardViewport=(height,offsetTop=0)=>{
 keyboardViewport=height===null?null:{height,offsetTop};
 viewport.dispatchEvent(new Event('resize'));
 viewport.dispatchEvent(new Event('scroll'));
};
let record=JSON.parse(sessionStorage.getItem('fixture-server-follow')||'null');
let owner=false;
window.__requests=[];
window.__failNextSave=false;
window.__followUnavailable=false;
window.__permissionResult='granted';
window.__permissionRequests=0;
Object.defineProperty(window,'Notification',{configurable:true,value:{permission:'default',requestPermission:async()=>{window.__permissionRequests++;return window.__permissionResult;}}});
Object.defineProperty(window,'PushManager',{configurable:true,value:function(){}});
Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:async()=>({active:{},pushManager:{getSubscription:async()=>({toJSON:()=>({endpoint:'https://push.example.com/fan-fixture',keys:{p256dh:'fixture-key',auth:'fixture-auth'}})})}})}});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
window.fetch=async(input,init={})=>{
 const url=typeof input==='string'?input:input.url;
 const method=init.method||'GET';
 const body=init.body?JSON.parse(init.body):null;
 const headers=new Headers(init.headers);
 window.__requests.push({url,method,body,followToken:headers.get('X-Fan-Follow-Token')});
 if(url.endsWith('/notifications/config'))return json({available:true,publicKey:'AQID'});
 if(url.endsWith('/fan-base')){
   if(!owner)return json({error:'Unauthorized'},401);
   return json({totalFollows:record?1:0,anonymousFollows:record&&!record.displayName?1:0,namedFans:record?.displayName?[record.displayName]:[]});
 }
 if(!url.includes('/athlete-invites/'+token+'/follows'))throw new Error('Unexpected fixture request: '+url);
 if(window.__followUnavailable)return json({error:'Offline fixture'},503);
 if(method==='POST'||method==='PATCH'){
   if(window.__failNextSave){window.__failNextSave=false;return json({error:'Offline fixture'},503);}
   if(method==='POST')record={followToken:body.followToken,displayName:null,liveAlerts:false,eventAlerts:false,preEventAlerts:false,active:true};
   else {
     if(!record||headers.get('X-Fan-Follow-Token')!==record.followToken)return json({error:'Not found'},404);
     Object.assign(record,body);
   }
   sessionStorage.setItem('fixture-server-follow',JSON.stringify(record));
 }
 if(!record||method!=='POST'&&headers.get('X-Fan-Follow-Token')!==record.followToken)return json({error:'Not found'},404);
 if(method==='DELETE'){record=null;sessionStorage.removeItem('fixture-server-follow');return new Response(null,{status:204});}
 return json(record);
};
function render(){root.render(<QueryClientProvider client={client}>{owner?<FanBaseOwnerCard inviteToken={token}/>:<Dialog open><FanCardFollowDialog className="living-card-dialog living-card-follow-dialog" data-testid="dialog-follow-fan-card"><DialogHeader className="living-card-dialog-header"><span className="living-card-dialog-kicker">Keep the season close</span><DialogTitle>Follow Tim.</DialogTitle><DialogDescription>Follow this card on this device. No account is needed. Turn on only the alerts you want.</DialogDescription></DialogHeader><div className="living-card-follow-dialog-form"><FanCardActions inviteToken={token}/></div></FanCardFollowDialog></Dialog>}</QueryClientProvider>);}
window.__showOwner=async value=>{owner=value;await client.invalidateQueries();render();};
render();
`;

test('Fan Base follows persist anonymously, names and alerts stay optional, failed saves retry, and unfollow removes the device', { timeout: 120_000 }, async () => {
  const suffix = `fan-follow-fixture-${process.pid}`;
  const sourcePath = resolve(appDirectory, `${suffix}.tsx`);
  const htmlPath = resolve(appDirectory, `${suffix}.html`);
  const configPath = resolve(appDirectory, `${suffix}.config.ts`);
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-fan-follow-'));
  const port = await availablePort();
  const debugPort = await availablePort();
  let vite: ChildProcess | undefined;
  let chromium: ChildProcess | undefined;
  let connection: DevToolsConnection | undefined;
  try {
    await writeFile(sourcePath, fixture);
    await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./${suffix}.tsx"></script></body></html>`);
    await writeFile(configPath, `import {mergeConfig} from 'vite';import original from './vite.config';export default mergeConfig(original,{plugins:[{name:'fixture-owner',enforce:'pre',resolveId(id){if(id==='@clerk/react')return '\\0fixture-owner';},load(id){if(id==='\\0fixture-owner')return 'export function useUser(){return {user:{id:"fixture-owner"},isLoaded:true}}';}}]});`);
    vite = spawn('pnpm', ['exec', 'vite', '--config', configPath, '--host', '127.0.0.1'], {
      cwd: appDirectory, env: { ...process.env, PORT: String(port), BASE_PATH: '/fan-follow-check/' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForUrl(`http://127.0.0.1:${port}/fan-follow-check/`, 30_000, monitorProcess(vite, 'Fan follow Vite'));
    chromium = spawn(process.env.CHROMIUM_PATH || 'chromium', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const browserMonitor = monitorProcess(chromium, 'Fan follow Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json() as { webSocketDebuggerUrl: string };
    connection = await DevToolsConnection.connect(webSocketDebuggerUrl, browserMonitor.diagnostics);
    const page = await openPage(connection, `http://127.0.0.1:${port}/fan-follow-check/${suffix}.html`, { viewport: { width: 390, height: 844, mobile: true } });
    const evaluate = <T,>(expression: string) => connection!.evaluate<T>(expression, page.sessionId);
    const wait = (expression: string) => waitFor(connection!, page.sessionId, `Boolean(${expression})`, Boolean);
    const selector = (id: string) => `[data-testid="${id}"]`;
    const control = (id: string) => `document.querySelector(${JSON.stringify(selector(id))})`;
    const click = async (id: string) => {
      await wait(`${control(id)} && !${control(id)}.disabled`);
      await evaluate(`${control(id)}.click()`);
    };
    const saved = `JSON.parse(localStorage.getItem('pixl-fan-card-follow:fixture-athlete'))`;
    const server = `JSON.parse(sessionStorage.getItem('fixture-server-follow'))`;
    const ready = async () => {
      await wait(`${control('button-follow-fan-card')}?.textContent.includes('Unfollow') && !${control('button-follow-fan-card')}.disabled`);
      await wait(`${control('input-fan-display-name')}`);
    };
    const reload = async () => {
      await connection!.send('Page.reload', { ignoreCache: true }, page.sessionId);
      await ready();
    };
    const ownerSummary = async (name: string | null, total = 1) => {
      await evaluate('window.__showOwner(true)');
      await wait(`${control('fan-base-owner')}?.querySelector('h3')?.textContent === '${total} ${total === 1 ? 'follow' : 'follows'}'`);
      assert.equal(await evaluate(`${control('fan-base-owner')}?.querySelector('[aria-label$="followers without a name"]')?.textContent.trim()`), `${name || !total ? 0 : 1} anonymous`);
      assert.deepEqual(await evaluate(`Array.from(${control('fan-base-owner')}.querySelectorAll('li'),item=>item.textContent)`), name ? [name] : []);
      await evaluate('window.__showOwner(false)');
      if (total) await ready();
      else await wait(`${control('button-follow-fan-card')}`);
    };
    const setName = async (value: string) => {
      await evaluate(`(()=>{const input=${control('input-fan-display-name')};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    };
    const saveName = async (value: string) => {
      await setName(value);
      await click('button-save-fan-display-name');
      await wait(`${control('status-fan-follow')}?.textContent==='Your name choice was saved.'`);
      await reload();
      assert.equal(await evaluate(`${control('input-fan-display-name')}.value`), value.trim());
      await ownerSummary(value.trim() || null);
    };
    await wait(`${control('button-follow-fan-card')}`);
    const layout = await evaluate(`(()=>{const dialog=document.querySelector('[data-testid="dialog-follow-fan-card"]');const body=dialog?.querySelector('.living-card-dialog-body');const option=dialog?.querySelector('.fan-card-follow__option');const copy=option?.querySelector('.fan-card-follow__option-copy');const checkbox=option?.querySelector('input[type="checkbox"]');const rect=dialog?.getBoundingClientRect();return {dialogLeft:rect?.left,dialogRight:rect?.right,viewportWidth:innerWidth,bodyOverflowX:getComputedStyle(body).overflowX,bodyOverflowY:getComputedStyle(body).overflowY,touchAction:getComputedStyle(body).touchAction,bodyWidth:body?.clientWidth,bodyScrollWidth:body?.scrollWidth,optionWidth:option?.clientWidth,copyWidth:copy?.getBoundingClientRect().width,checkboxWidth:checkbox?.getBoundingClientRect().width};})()`);
    assert.ok(layout.dialogLeft >= 0 && layout.dialogRight <= layout.viewportWidth, 'follow dialog stays inside the phone viewport');
    assert.ok(layout.bodyScrollWidth <= layout.bodyWidth + 1, 'follow dialog body has no horizontal overflow');
    assert.equal(layout.bodyOverflowX, 'hidden');
    assert.equal(layout.bodyOverflowY, 'auto');
    assert.equal(layout.touchAction, 'pan-y');
    assert.ok(layout.copyWidth > 150, 'alert names have room to read instead of collapsing beside the toggles');
    assert.ok(layout.checkboxWidth >= 20 && layout.checkboxWidth <= 28, 'alert toggles keep a compact fixed size');
    assert.equal(await evaluate(`${control('button-follow-fan-card')}.getAttribute('aria-pressed')`), 'false');
    await click('button-follow-fan-card');
    await ready();
    const scrollState = await evaluate(`(()=>{const body=document.querySelector('[data-testid="dialog-follow-fan-card"] .living-card-dialog-body');const pageY=scrollY;body.scrollTop=body.scrollHeight;return {scrollTop:body.scrollTop,maxScroll:body.scrollHeight-body.clientHeight,pageY:scrollY};})()`);
    assert.ok(scrollState.maxScroll > 0, 'the dialog body scrolls when the form is taller than the phone screen');
    assert.ok(scrollState.scrollTop > 0, 'the form can be scrolled vertically');
    assert.equal(scrollState.pageY, 0, 'the page behind the follow form does not move');
    // Keep the layout viewport unchanged, unlike ordinary mobile-height tests.
    // Check both resize and pan events, then recovery when the keyboard closes.
    const initialPage = await evaluate<{ x: number; y: number }>('({x:scrollX,y:scrollY})');
    for (const { width, height, visibleHeight, offsetTop } of [
      { width: 390, height: 844, visibleHeight: 350, offsetTop: 0 },
      { width: 320, height: 568, visibleHeight: 250, offsetTop: 68 },
    ]) {
      await connection.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true }, page.sessionId);
      await evaluate(`${control('input-fan-display-name')}.focus();window.__keyboardViewport(${visibleHeight},${offsetTop})`);
      await wait(`document.querySelector('.living-card-follow-dialog').style.getPropertyValue('--follow-viewport-height')==='${visibleHeight}px'`);
      const geometry = await evaluate(`(()=>{
        const dialog=document.querySelector('.living-card-follow-dialog');
        const body=dialog.querySelector('.living-card-dialog-body');
        const rect=dialog.getBoundingClientRect();
        return {top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,width:innerWidth,
          bodyWidth:body.clientWidth,scrollWidth:body.scrollWidth,overflowX:getComputedStyle(body).overflowX,
          overflowY:getComputedStyle(body).overflowY,layoutHeight:innerHeight};
      })()`);
      assert.equal(geometry.layoutHeight, height, 'keyboard simulation does not shrink the layout viewport');
      assert.ok(geometry.top >= offsetTop && geometry.bottom <= offsetTop + visibleHeight, `entire dialog fits above the simulated keyboard: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.left >= 0 && geometry.right <= width, 'keyboard does not push dialog sideways');
      assert.ok(geometry.scrollWidth <= geometry.bodyWidth + 1);
      assert.equal(geometry.overflowX, 'hidden');
      assert.equal(geometry.overflowY, 'auto');
      for (const id of ['input-fan-display-name', 'button-save-fan-display-name']) {
        const reach = await evaluate(`(()=>{
          const target=${control(id)};
          target.scrollIntoView({block:'nearest',inline:'nearest'});
          const rect=target.getBoundingClientRect();
          const body=target.closest('.living-card-dialog-body').getBoundingClientRect();
          return {top:rect.top,bottom:rect.bottom,bodyTop:body.top,bodyBottom:body.bottom,
            hit:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest('[data-testid]')?.dataset.testid};
        })()`);
        assert.ok(reach.top >= reach.bodyTop - 1 && reach.bottom <= reach.bodyBottom + 1, `${id} is reachable by vertical scrolling`);
        assert.equal(reach.hit, id, `${id} is not covered by the dialog header or close control`);
      }
      assert.equal(await evaluate('document.activeElement?.dataset.testid'), 'input-fan-display-name', 'scrolling to Save preserves input focus');
      await setName('Keyboard Fan');
      // Dispatch a real pointer click at the visible Save button, not element.click().
      const point = await evaluate<{ x: number; y: number }>(`(()=>{const r=${control('button-save-fan-display-name')}.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, page.sessionId);
      await connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }, page.sessionId);
      await wait(`${control('status-fan-follow')}?.textContent==='Your name choice was saved.'`);
      assert.equal(await evaluate(`${server}.displayName`), 'Keyboard Fan');
      await evaluate('document.activeElement?.blur();window.__keyboardViewport(null)');
      await wait(`document.querySelector('.living-card-follow-dialog').style.getPropertyValue('--follow-viewport-height')==='${height}px'`);
      assert.deepEqual(await evaluate('({x:scrollX,y:scrollY})'), initialPage, 'keyboard dismissal leaves the background page unshifted');
      const restored = await evaluate(`(()=>{const r=document.querySelector('.living-card-follow-dialog').getBoundingClientRect();return {top:r.top,bottom:r.bottom};})()`);
      assert.ok(restored.top >= 0 && restored.bottom <= height, 'dialog returns inside the restored viewport');
    }
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
    await setName('');
    await click('button-save-fan-display-name');
    await wait(`${server}.displayName===null`);
    const token = await evaluate<string>(`${saved}.followToken`);
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(await evaluate(`${saved}.following`), true);
    assert.equal(await evaluate(`${server}.displayName`), null);
    assert.equal(await evaluate('window.__permissionRequests'), 0, 'anonymous follow does not request alert consent');
    await reload();
    assert.equal(await evaluate(`${saved}.followToken`), token, 'reload restores the same device follow');
    await ownerSummary(null);

    // Preserve independent alert choices and the original permission-denial check.
    await evaluate(`window.__permissionResult='denied'`);
    await click('input-fan-alert-event');
    await wait(`${control('status-fan-follow')}?.textContent.includes('blocked alerts')`);
    assert.equal(await evaluate(`${control('input-fan-alert-event')}.checked`), false);
    await evaluate(`window.__permissionResult='granted'`);
    await click('input-fan-alert-event');
    await wait(`${control('input-fan-alert-event')}.checked && !${control('input-fan-alert-event')}.disabled`);
    await click('input-fan-alert-live');
    await wait(`${control('input-fan-alert-live')}.checked && !${control('input-fan-alert-live')}.disabled`);
    assert.ok(await evaluate(`${server}.pushSubscription.endpoint`));

    await saveName('Alex Fan');
    await saveName('Sam Fan');
    await saveName('   ');
    assert.equal(await evaluate(`${server}.displayName`), null, 'clearing the name returns the follow to anonymous');
    assert.equal(await evaluate(`${server}.liveAlerts && ${server}.preEventAlerts`), true, 'name-only updates preserve both alert choices');
    assert.ok(await evaluate(`window.__requests.filter(r=>r.method==='PATCH'&&Object.hasOwn(r.body,'displayName')).every(r=>Object.keys(r.body).length===1)`));
    await click('input-fan-alert-event');
    await wait(`!${control('input-fan-alert-event')}.checked && !${control('input-fan-alert-event')}.disabled`);
    assert.equal(await evaluate(`${server}.liveAlerts`), true, 'disabling pre-event alerts keeps live alerts');
    await click('input-fan-alert-live');
    await wait(`${control('status-fan-follow')}?.textContent.includes('You are still following')`);
    assert.equal(await evaluate(`${saved}.following`), true);
    assert.equal(await evaluate(`window.__requests.filter(r=>r.method==='DELETE').length`), 0);
    await reload();
    assert.equal(await evaluate(`${control('input-fan-alert-live')}.checked || ${control('input-fan-alert-event')}.checked`), false);
    await ownerSummary(null);

    // A failed name save keeps its draft and does not change the owner summary.
    await setName('Retry Fan');
    await evaluate('window.__failNextSave=true');
    await click('button-save-fan-display-name');
    await wait(`${control('status-fan-follow')}?.textContent.includes('Could not save your name')`);
    assert.equal(await evaluate(`${control('input-fan-display-name')}.value`), 'Retry Fan');
    assert.equal(await evaluate(`${server}.displayName`), null);
    await click('button-save-fan-display-name');
    await wait(`${control('status-fan-follow')}?.textContent==='Your name choice was saved.'`);
    await ownerSummary('Retry Fan');
    await click('button-follow-fan-card');
    await wait(`localStorage.getItem('pixl-fan-card-follow:fixture-athlete')===null`);
    assert.equal(await evaluate(server), null);
    await ownerSummary(null, 0);

    // A failed initial save is explicitly retryable using the same device token.
    await connection.send('Page.reload', { ignoreCache: true }, page.sessionId);
    await wait(`${control('button-follow-fan-card')}?.getAttribute('aria-pressed')==='false'`);
    await evaluate('window.__followUnavailable=true');
    await click('button-follow-fan-card');
    await wait(`${control('button-follow-fan-card')}?.textContent==='Retry saving follow' && !${control('button-follow-fan-card')}.disabled`);
    const retryToken = await evaluate<string>(`${saved}.followToken`);
    assert.equal(await evaluate(server), null);
    await evaluate('window.__followUnavailable=false');
    await click('button-follow-fan-card');
    await ready();
    assert.equal(await evaluate(`${control('input-fan-alert-live')}.disabled`), false, 'live alerts recover immediately after retry, before reload');
    assert.equal(await evaluate(`${control('input-fan-alert-event')}.disabled`), false, 'pre-event alerts recover immediately after retry, before reload');
    assert.equal(await evaluate(`${server}.followToken`), retryToken);
    await reload();
    await ownerSummary(null);
    await click('button-follow-fan-card');
    await wait(`localStorage.getItem('pixl-fan-card-follow:fixture-athlete')===null`);
    await ownerSummary(null, 0);
    await connection.send('Page.reload', { ignoreCache: true }, page.sessionId);
    await wait(`${control('button-follow-fan-card')}?.getAttribute('aria-pressed')==='false'`);
    assert.equal(await evaluate(`${control('input-fan-display-name')}`), null);
  } finally {
    connection?.close();
    for (const child of [chromium, vite]) {
      if (!child || child.exitCode !== null) continue;
      const exited = new Promise<void>((done) => child.once('exit', () => done()));
      child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(kill);
    }
    await Promise.all([sourcePath, htmlPath, configPath].map((path) => rm(path, { force: true })));
    await rm(profile, { recursive: true, force: true });
  }
});
