import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DevToolsConnection, monitorProcess, openPage, waitFor, waitForUrl } from './browser-test-diagnostics';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const html = resolve(root, 'simple-appearance-fixture.html');
const entry = resolve(root, 'simple-appearance-fixture.tsx');

test('simplified HYPE Card edits, saves, reopens and exports on desktop and phone', { timeout: 100_000 }, async () => {
  await writeFile(html, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/simple-appearance-fixture.tsx"></script></body></html>');
  await writeFile(entry, `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{FanCardAppearanceManager}from'./src/features/fan-card-appearance-manager';
import{LivingAthleteCardFront}from'./src/features/living-athlete-card-front';
import{LivingCardControls}from'./src/features/living-card-controls';
import{defaultCardAppearance}from'./src/features/hype-card-appearance';
import photo from './src/assets/hypecard-player-photo-640.webp';
import './src/index.css';import './src/features/living-athlete-card.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
const initial=JSON.parse(localStorage.getItem('simple-card-settings')||'null')||{...defaultCardAppearance('gallery'),jerseyNumber:'9'};
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,init)=>{
 if(String(url).includes('/api/athlete-invites/fixture/appearance')){
  if(window.failSave)return new Response('{}',{status:500,headers:{'content-type':'application/json'}});
  const saved=JSON.parse(String(init.body));localStorage.setItem('simple-card-settings',JSON.stringify(saved));window.lastSaved=saved;
  return new Response(JSON.stringify({cardAppearance:saved}),{headers:{'content-type':'application/json'}});
 }return nativeFetch(url,init);
};
const NativeImage=window.Image;
window.Image=class extends NativeImage{set src(v){if(v.startsWith('data:image/svg+xml'))window.exportMarkup=decodeURIComponent(v.slice(v.indexOf(',')+1));super.src=v;}get src(){return super.src;}};
const nativeClick=HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click=function(){if(this.download){window.exportDownload=this.download;return;}nativeClick.call(this);};
function App(){const[side,setSide]=useState('front');return <div style={{background:'#07172b',color:'white',minHeight:'100vh',padding:20}}>
 <h1 style={{fontSize:24,marginBottom:20}}>HYPE Card</h1>
 <div style={{maxWidth:960,margin:'auto'}}><FanCardAppearanceManager invite={{inviteToken:'fixture',athleteName:'Older name',teamName:'Eastside Falcons',sport:'football',photoUrl:photo,cardAppearance:initial}} profile={{athleteName:'Jordan Alexander Matthews',jerseyNumber:'9',position:'Quarterback'}}/></div>
 <div style={{maxWidth:360,margin:'24px auto'}} data-testid="flip-harness"><div style={{position:'relative',aspectRatio:'3/4'}}>{side==='front'?<LivingAthleteCardFront athleteName="Jordan Matthews" teamName="Falcons" photoUrl={photo} appearance={initial}/>:<p data-testid="selected-side">{side}</p>}</div>
 <LivingCardControls side={side} onSelectSide={setSide}/><button data-testid="return-front" onClick={()=>setSide('front')}>Flip to card front</button></div>
 </div>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);
`);
  const directory = await mkdtemp(resolve(tmpdir(), 'simple-card-browser-'));
  const port = 9450 + process.pid % 200;
  const browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    `--remote-debugging-port=${port}`, `--user-data-dir=${directory}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const monitor = monitorProcess(browser, 'simple card Chromium');
  let connection: DevToolsConnection | undefined;
  try {
    await waitForUrl(`http://127.0.0.1:${port}/json/version`, 30_000, monitor);
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, monitor.diagnostics);
    const page = await openPage(connection, 'http://localhost:80/simple-appearance-fixture.html', { viewport: { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false } });
    const session = page.sessionId;
    await waitFor(connection, session, '!!document.querySelector("[data-testid=fan-card-appearance-manager]")', Boolean, 30_000);
    assert.equal(await connection.evaluate('document.querySelectorAll("[data-testid=lower-third-picker] button").length', session), 4);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="svg-card-photo"]').getAttribute('preserveAspectRatio')`, session), 'xMidYMid meet');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="svg-card-logo"]').getAttribute('x')`, session), '22');
    const text = await connection.evaluate<string>('document.querySelector("[data-testid=classic-card-preview-surface]").textContent', session);
    assert.match(text, /JORDAN ALEXANDER MATTHEWS/);
    assert.match(text, /EASTSIDE FALCONS/);
    for (const style of ['split', 'angled', 'classic']) {
      await connection.evaluate(`document.querySelector('[data-testid="button-lower-third-${style}"]').click()`, session);
      assert.equal(await connection.evaluate('document.querySelector("[data-testid=classic-card-preview-surface] svg").getAttribute("data-lower-third")', session), style);
    }
    await connection.evaluate(`document.querySelector('[data-testid="button-lower-third-none"]').click()`, session);
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=classic-card-preview-surface] svg").getAttribute("data-lower-third")', session), 'none');
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=svg-card-photo]").getAttribute("height")', session), '800', 'the photo fills the card when the lower-third panel is removed');
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=svg-card-position]")?.textContent', session), 'QUARTERBACK', 'the athlete position stays over the photo');
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=classic-card-preview-surface] svg rect[y=\\"620\\"][height=\\"180\\"]')', session), null, 'no lower-third panel is drawn');
    // Native keyboard input exercises React's actual range control events.
    for (const axis of ['x', 'y']) {
      await connection.evaluate(`document.querySelector('[data-testid="slider-photo-${axis}"]').focus()`, session);
      await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, session);
      await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, session);
    }
    assert.equal(await connection.evaluate(`document.querySelector('[data-photo-placement]').getAttribute('transform')`, session), 'translate(6.00 8.00)');
    await connection.evaluate(`document.querySelector('[data-testid="button-lower-third-angled"]').click();document.querySelector('[data-testid="input-jersey-number"]').focus()`, session);
    await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 }, session);
    await connection.send('Input.insertText', { text: '23' }, session);
    await connection.evaluate(`window.failSave=true;document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
    await waitFor(connection, session, `!!document.querySelector('[data-testid="button-retry-appearance"]')`, Boolean, 10_000);
    await connection.evaluate(`window.failSave=false;document.querySelector('[data-testid="button-retry-appearance"]').click()`, session);
    await waitFor(connection, session, 'window.lastSaved?.lowerThirdStyle', value => value === 'angled', 10_000);
    assert.deepEqual(await connection.evaluate('({x:window.lastSaved.athleteX,y:window.lastSaved.athleteY,number:window.lastSaved.jerseyNumber})', session), { x: .01, y: .01, number: '23' });
    await connection.send('Page.navigate', { url: 'http://localhost:80/simple-appearance-fixture.html' }, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="button-lower-third-angled"]')?.getAttribute('aria-checked')`, value => value === 'true', 20_000);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="input-jersey-number"]').value`, session), '23');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="slider-photo-x"]').value`, session), '0.01');
    const links = await connection.evaluate<string[]>(`[...document.querySelectorAll('[data-testid="appearance-navigation-preview"] a')].map(a=>a.getAttribute('href'))`, session);
    assert.deepEqual(links, ['/fan/fixture?side=responses', '/fan/fixture?side=stats', '/fan/fixture?side=live-taps', '/fan/fixture?side=events']);
    for (const [button, side] of [['responses', 'responses'], ['stats', 'stats'], ['live-taps', 'live-taps'], ['events', 'events']]) {
      await connection.evaluate(`document.querySelector('[data-testid="flip-harness"] [data-testid="button-living-card-${button}"]').click()`, session);
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="selected-side"]').textContent`, session), side);
    }
    await connection.evaluate(`document.querySelector('[data-testid="return-front"]').click();document.querySelector('[data-testid="button-export-appearance-jpeg"]').click()`, session);
    await waitFor(connection, session, 'window.exportDownload', Boolean, 25_000);
    assert.equal(await connection.evaluate(`window.exportMarkup.includes('data-lower-third="angled"')&&window.exportMarkup.includes('data:image/')&&window.exportMarkup.includes('width="1200" height="1600"')`, session), true);
    await connection.evaluate(`document.querySelector('[data-testid="button-lower-third-none"]').click();document.querySelector('[data-testid="button-export-appearance-jpeg"]').click()`, session);
    await waitFor(connection, session, 'window.exportMarkup.includes(`data-lower-third="none"`) && window.exportMarkup.includes(`data-testid="svg-card-position"`) && window.exportMarkup.includes(`height="800"`) ', Boolean, 25_000);
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, session);
    assert.equal(await connection.evaluate('document.documentElement.scrollWidth <= innerWidth', session), true, 'phone has no page overflow');
    assert.equal(await connection.evaluate(`(()=>{const r=document.querySelector('[data-testid="classic-card-preview-surface"]').getBoundingClientRect();return Math.abs(r.width/r.height-.75)<.01})()`, session), true);
  } finally {
    connection?.close();
    browser.kill('SIGKILL');
    await monitor.waitForExit();
    await rm(directory, { recursive: true, force: true });
    if (!process.env.KEEP_HYPE_FIXTURE) await Promise.all([rm(html, { force: true }), rm(entry, { force: true })]);
  }
});
