import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DevToolsConnection, monitorProcess, openPage, waitFor, waitForUrl } from './browser-test-diagnostics';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const html = resolve(root, 'soccer-gear-fixture.html');
const entry = resolve(root, 'soccer-gear-fixture.tsx');
test('soccer closet supports phone/keyboard selection, save recovery, reload and account/athlete switches', { timeout: 100_000 }, async () => {
  await writeFile(html, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/soccer-gear-fixture.tsx"></script></body></html>');
  await writeFile(entry, `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{SoccerGearBuilderPage}from'./src/features/soccer-gear-builder';
import'./src/index.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
const loadout={jerseyStyle:'classic',jerseyColor:'#2878F5',shortsStyle:'classic',shortsColor:'#173758',socksStyle:'plain',socksColor:'#F6F5EA',shinGuards:'slim',shinGuardColor:'#D7EF80',cleatsStyle:'classic',cleatsColor:'#173758',sweatband:'none',background:'field'};
const initial=(id)=>({athleteId:id==='one'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',athleteName:id==='one'?'Jordan':'Casey',canSave:true,showOnHypeCard:false,loadout:{...loadout},progress:{activeWeeks:1,eventCardsCreated:0,hypeCardShared:false},unlockedGear:['speed-cleats']});
let account='one';let states=JSON.parse(localStorage.getItem('gear-fixture-states')||'null')||{one:initial('one'),two:initial('two')};
window.failSave=false;window.delaySave=false;window.puts=0;
window.fetch=async(url,init={})=>{const path=String(url);if(path.includes('/api/athlete-gear/soccer')){
 if(init.method==='PUT'){window.puts++;if(window.delaySave)await new Promise(r=>setTimeout(r,600));if(window.failSave)return new Response('{"error":"offline"}',{status:503,headers:{'content-type':'application/json'}});
 const body=JSON.parse(String(init.body));states[account]={...states[account],loadout:body.loadout,showOnHypeCard:body.showOnHypeCard};localStorage.setItem('gear-fixture-states',JSON.stringify(states));}
 return new Response(JSON.stringify(states[account]),{headers:{'content-type':'application/json'}});
}throw new Error('Unexpected fixture request '+path);};
function App(){const[id,setId]=useState('one');window.switchAccount=()=>{account=account==='one'?'two':'one';setId(account);};
window.changeAthlete=()=>{states[account]={...initial(account),athleteId:'33333333-3333-4333-8333-333333333333',athleteName:'New player'};client.invalidateQueries();};
window.refreshGear=()=>client.invalidateQueries();window.changeServerColor=()=>{states[account].loadout={...states[account].loadout,jerseyColor:'#D7EF80'};client.invalidateQueries();};
return <SoccerGearBuilderPage key={id} accountId={id} athleteName="Fallback"/>;}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);`);
  const directory = await mkdtemp(resolve(tmpdir(), 'soccer-gear-browser-'));
  const port = 9600 + process.pid % 150;
  const browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    `--remote-debugging-port=${port}`, `--user-data-dir=${directory}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const monitor = monitorProcess(browser, 'soccer gear Chromium');
  let connection: DevToolsConnection | undefined;
  try {
    await waitForUrl(`http://127.0.0.1:${port}/json/version`, 30_000, monitor);
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, monitor.diagnostics);
    const page = await openPage(connection, 'http://localhost:80/soccer-gear-fixture.html', {
      viewport: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    });
    const session = page.sessionId;
    const click = (id: string) => connection!.evaluate(`document.querySelector('[data-testid="${id}"]').click()`, session);
    const selected = (id: string) => connection!.evaluate(`document.querySelector('[data-testid="${id}"]').getAttribute('aria-pressed')`, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=panel-gear-controls]")', Boolean, 35_000);
    assert.equal(await connection.evaluate('document.documentElement.scrollWidth <= innerWidth + 1', session), true);
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-gear-option-jerseyStyle-stripes]").disabled', session), true);
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=checkbox-show-on-hype-card]").checked', session), false);
    await connection.evaluate('document.querySelector("[data-testid=button-gear-color-jerseyColor-coral]").focus()', session);
    await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
    await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, session);
    assert.equal(await selected('button-gear-color-jerseyColor-coral'), 'true');
    await click('button-gear-option-shinGuards-shield');
    await click('button-gear-option-cleatsStyle-speed');
    await click('button-background-goal');
    await connection.evaluate('window.failSave=true', session);
    await click('button-save-soccer-gear');
    await waitFor(connection, session, 'document.querySelector("[data-testid=status-gear-save-message]").textContent.includes("didn’t stick")', Boolean, 10_000);
    assert.equal(await selected('button-gear-color-jerseyColor-coral'), 'true', 'failed save retains draft');
    await connection.evaluate('window.failSave=false;window.delaySave=true', session);
    await click('button-save-soccer-gear');
    await waitFor(connection, session, 'document.querySelector("[data-testid=button-gear-color-jerseyColor-coral]").disabled', Boolean, 5000);
    await waitFor(connection, session, 'document.querySelector("[data-testid=status-gear-save-state]").textContent.includes("Look saved")', Boolean, 10000);
    await connection.send('Page.navigate', { url: 'http://localhost:80/soccer-gear-fixture.html' }, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=panel-gear-controls]")', Boolean, 15000);
    assert.equal(await selected('button-gear-color-jerseyColor-coral'), 'true');
    assert.equal(await selected('button-gear-option-shinGuards-shield'), 'true');
    assert.equal(await selected('button-background-goal'), 'true');
    await connection.evaluate('window.switchAccount()', session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=text-preview-athlete-name]")?.textContent === "Casey"', Boolean, 10000);
    assert.equal(await selected('button-gear-color-jerseyColor-pixl-blue'), 'true');
    await connection.evaluate('window.switchAccount()', session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=text-preview-athlete-name]")?.textContent === "Jordan"', Boolean, 10000);
    await connection.evaluate('window.changeServerColor()', session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=button-gear-color-jerseyColor-lime]")?.getAttribute("aria-pressed")==="true"', Boolean, 10000);
    await click('button-gear-color-jerseyColor-violet');
    await connection.evaluate('window.refreshGear()', session);
    assert.equal(await selected('button-gear-color-jerseyColor-violet'), 'true', 'dirty edits survive background refresh');
    await connection.evaluate('window.changeAthlete()', session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=text-preview-athlete-name]")?.textContent==="New player"', Boolean, 10000);
    assert.equal(await selected('button-gear-color-jerseyColor-pixl-blue'), 'true', 'changing athlete resets the old draft');
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, session);
    assert.equal(await connection.evaluate('document.documentElement.scrollWidth <= innerWidth + 1', session), true);
  } finally {
    connection?.close();
    if (!monitor.hasExited()) { browser.kill('SIGTERM'); await new Promise((resolve) => browser.once('exit', resolve)); }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (process.env.PIXL_KEEP_SOCCER_FIXTURE !== '1') {
      await rm(html, { force: true }); await rm(entry, { force: true });
    }
  }
});
