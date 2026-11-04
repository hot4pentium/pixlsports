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
import {FanCardFollow} from './src/features/fan-card-follow';
import {FanBaseOwnerCard} from './src/features/fan-base-owner-card';
import './src/index.css';
const token='fixture-athlete';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
const root=createRoot(document.getElementById('root'));
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
function render(){root.render(<QueryClientProvider client={client}>{owner?<FanBaseOwnerCard inviteToken={token}/>:<FanCardFollow inviteToken={token} surface="showcase"/>}</QueryClientProvider>);}
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
    assert.equal(await evaluate(`${control('button-follow-fan-card')}.getAttribute('aria-pressed')`), 'false');
    await click('button-follow-fan-card');
    await ready();
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
