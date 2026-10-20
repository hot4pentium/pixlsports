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

test('HYPE Card templates and independent lower thirds save, reopen and export on desktop and phone', { timeout: 100_000 }, async () => {
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
const initial=JSON.parse(localStorage.getItem('simple-card-settings')||'null')||{...defaultCardAppearance('glass'),jerseyNumber:'9'};
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
 <div style={{maxWidth:960,margin:'auto'}}><FanCardAppearanceManager invite={{inviteToken:'fixture',athleteName:'Older name',teamName:'Eastside Falcons',sport:'football',photoUrl:photo,cardAppearance:initial}} profile={{athleteName:'Jordan Alexander Matthews',jerseyNumber:'23',position:'Quarterback'}}/></div>
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
    assert.equal(await connection.evaluate('document.querySelectorAll("[data-testid=card-design-picker-cards] button").length', session), 6);
    assert.equal(await connection.evaluate('document.querySelectorAll("[data-testid=lower-third-template-picker] button").length', session), 6);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="fan-card-appearance-manager"] [data-testid="input-jersey-number"]')`, session), null, 'jersey number is not editable in card design');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="appearance-preview"] [data-testid="text-living-card-jersey-number"]')?.textContent`, session), 'Number 23', 'the current athlete profile number replaces an older saved card number');
    assert.deepEqual(await connection.evaluate(`(() => {
      const frame=document.querySelector('[data-testid="frame-template-cycler"]');
      const lower=document.querySelector('[data-testid="lower-third-template-cycler"]');
      const frameButtons=[...frame.querySelectorAll('button')], lowerButtons=[...lower.querySelectorAll('button')];
      const aligned=(a,b)=>Math.abs(a.getBoundingClientRect().top-b.getBoundingClientRect().top)<1;
      return {
        groupsShareLine:aligned(frame,lower),
        frameArrowsShareLine:aligned(frameButtons[0],frameButtons[1]),
        lowerArrowsShareLine:aligned(lowerButtons[0],lowerButtons[1]),
        cyclersHidden:frame.getBoundingClientRect().height===0 && lower.getBoundingClientRect().height===0,
        desktopPickersVisible:getComputedStyle(document.querySelector('[data-testid="appearance-desktop-template-pickers"]')).display!=='none',
      };
    })()`, session), {
      groupsShareLine: true,
      frameArrowsShareLine: true,
      lowerArrowsShareLine: true,
      cyclersHidden: true,
      desktopPickersVisible: true,
    });
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="svg-card-photo"]').getAttribute('preserveAspectRatio')`, session), 'xMidYMid slice');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="classic-card-preview-surface"] svg').getAttribute('viewBox')`, session), '0 0 900 1200');
    const text = await connection.evaluate<string>('document.querySelector("[data-testid=classic-card-preview-surface]").textContent', session);

    const legacyDesigns = [
      { legacy: 'classic', replacement: 'velocity' },
      { legacy: 'gallery', replacement: 'glass' },
      { legacy: 'spotlight', replacement: 'spotlight' },
      { legacy: 'breakout', replacement: 'pixel-edge' },
    ] as const;
    assert.match(text, /JORDAN ALEXANDER MATTHEWS/);
    assert.equal(await connection.evaluate('Number(document.querySelector("[data-testid=svg-card-photo]").getAttribute("height"))', session), 1200);
    for (const { legacy, replacement } of legacyDesigns) {
      const savedLegacyCard = {
        design: legacy, athleteX: .07, athleteY: -.04, athleteScale: 1.13,
        jerseyNumber: '9', position: 'Quarterback',
      };
      await connection.evaluate(`localStorage.setItem('simple-card-settings',${JSON.stringify(JSON.stringify(savedLegacyCard))})`, session);
      await connection.send('Page.navigate', { url: 'http://localhost:80/simple-appearance-fixture.html' }, session);
      await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-frame-template')`, value => value === replacement, 20_000);
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-design-${replacement}"]').getAttribute('aria-pressed')`, session), 'true', `${legacy} selects its ${replacement} replacement in the appearance manager`);
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="slider-photo-x"]').value`, session), '0.07', `${legacy} horizontal photo placement is restored`);
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="slider-photo-y"]').value`, session), '-0.04', `${legacy} vertical photo placement is restored`);
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="slider-photo-zoom"]').value`, session), '1.13', `${legacy} photo zoom is restored`);
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="classic-card-preview-surface"] svg [data-photo-placement]')?.getAttribute('transform')`, session), 'translate(63 -48)', `${legacy} photo transform is visible in the owner preview`);

      await connection.evaluate(`document.querySelector('[data-testid="button-lower-third-template-wave"]').click()`, session);
      await waitFor(connection, session, `document.querySelector('[data-testid="button-save-appearance"]')?.disabled`, value => value === false, 5_000);
      await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
      await waitFor(connection, session, 'window.lastSaved?.design', value => value === replacement, 10_000);
      await connection.send('Page.navigate', { url: 'http://localhost:80/simple-appearance-fixture.html' }, session);
      await waitFor(connection, session, `document.querySelector('[data-testid="button-design-${replacement}"]')?.getAttribute('aria-pressed')`, value => value === 'true', 20_000);
      assert.deepEqual(await connection.evaluate(`(()=>{const owner=document.querySelector('[data-testid="classic-card-preview-surface"] svg');const shared=document.querySelector('[data-testid="img-living-card-athlete"] svg');return {owner:owner?.getAttribute('data-frame-template'),shared:shared?.getAttribute('data-frame-template'),publicDesign:document.querySelector('[data-testid="img-living-card-athlete"]')?.parentElement?.getAttribute('data-design'),ownerPhoto:owner?.querySelector('[data-photo-placement]')?.getAttribute('transform'),sharedPhoto:shared?.querySelector('[data-photo-placement]')?.getAttribute('transform')}})()`, session), {
        owner: replacement, shared: replacement, publicDesign: replacement,
        ownerPhoto: 'translate(63 -48)', sharedPhoto: 'translate(63 -48)',
      }, `${legacy} replacement frame and photo placement survive save and public-card reopen`);
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-lower-third-template-wave"]').getAttribute('aria-pressed')`, session), 'true', `${legacy} saved appearance reopens with the lower-third edit`);
    }
    await connection.evaluate(`localStorage.removeItem('simple-card-settings')`, session);
    await connection.send('Page.navigate', { url: 'http://localhost:80/simple-appearance-fixture.html' }, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="button-design-glass"]')?.getAttribute('aria-pressed')`, value => value === 'true', 20_000);
    await connection.evaluate(`document.querySelector('[data-testid="frame-template-cycler-next"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-frame-template')`,
      value => value === 'varsity', 5_000);
    await connection.evaluate(`document.querySelector('[data-testid="lower-third-template-cycler-previous"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-lower-third-template')`,
      value => value === 'wave', 5_000);
    assert.deepEqual(await connection.evaluate(`({
      frame:document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-frame-template'),
      lowerThird:document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-lower-third-template'),
      frameName:document.querySelector('[data-testid="frame-template-cycler-selected"]')?.textContent,
      lowerThirdName:document.querySelector('[data-testid="lower-third-template-cycler-selected"]')?.textContent
    })`, session), { frame: 'varsity', lowerThird: 'wave', frameName: 'Varsity', lowerThirdName: 'Wave' });
    await connection.evaluate(`document.querySelector('[data-testid="button-design-pixel-edge"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-frame-template')`,
      value => value === 'pixel-edge', 5_000);
    await connection.evaluate(`document.querySelector('[data-testid="button-lower-third-template-varsity"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-lower-third-template')`,
      value => value === 'varsity', 5_000);
    assert.deepEqual(await connection.evaluate(`(()=>{const s=document.querySelector('[data-testid="classic-card-preview-surface"] svg');return [s.getAttribute('data-frame-template'),s.getAttribute('data-lower-third-template')]})()`, session), ['pixel-edge', 'varsity']);
    // Native keyboard input exercises React's actual range control events.
    for (const axis of ['x', 'y']) {
      await connection.evaluate(`document.querySelector('[data-testid="slider-photo-${axis}"]').focus()`, session);
      await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, session);
      await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, session);
    }
    assert.equal(await connection.evaluate(`document.querySelector('[data-photo-placement]').getAttribute('transform')`, session), 'translate(9 12)');
    await connection.evaluate(`window.failSave=true;document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
    await waitFor(connection, session, `!!document.querySelector('[data-testid="button-retry-appearance"]')`, Boolean, 10_000);
    await connection.evaluate(`window.failSave=false;document.querySelector('[data-testid="button-retry-appearance"]').click()`, session);
    await waitFor(connection, session, 'window.lastSaved?.lowerThirdTemplate', value => value === 'varsity', 10_000);
    assert.deepEqual(await connection.evaluate('({x:window.lastSaved.athleteX,y:window.lastSaved.athleteY,number:window.lastSaved.jerseyNumber,position:window.lastSaved.position})', session), { x: .01, y: .01, number: '23', position: 'Quarterback' });
    await connection.send('Page.navigate', { url: 'http://localhost:80/simple-appearance-fixture.html' }, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="button-design-pixel-edge"]')?.getAttribute('aria-pressed')`, value => value === 'true', 20_000);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-lower-third-template-varsity"]').getAttribute('aria-pressed')`, session), 'true');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="appearance-preview"] [data-testid="text-living-card-jersey-number"]')?.textContent`, session), 'Number 23');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="slider-photo-x"]').value`, session), '0.01');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="flip-harness"] [data-testid="text-living-card-jersey-number"]')?.textContent`, session), 'Number 23', 'the saved profile number is present on the shared card too');
    const links = await connection.evaluate<string[]>(`[...document.querySelectorAll('[data-testid="appearance-navigation-preview"] a')].map(a=>a.getAttribute('href'))`, session);
    assert.deepEqual(links, ['/fan/fixture?side=responses', '/fan/fixture?side=stats', '/fan/fixture?side=live-taps', '/fan/fixture?side=events']);
    for (const [button, side] of [['responses', 'responses'], ['stats', 'stats'], ['live-taps', 'live-taps'], ['events', 'events']]) {
      await connection.evaluate(`document.querySelector('[data-testid="flip-harness"] [data-testid="button-living-card-${button}"]').click()`, session);
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="selected-side"]').textContent`, session), side);
    }
    await connection.evaluate(`document.querySelector('[data-testid="return-front"]').click();document.querySelector('[data-testid="button-export-appearance-jpeg"]').click()`, session);
    await waitFor(connection, session, 'window.exportDownload', Boolean, 25_000);
    assert.equal(await connection.evaluate(`window.exportMarkup.includes('data-frame-template="pixel-edge"')&&window.exportMarkup.includes('data-lower-third-template="varsity"')&&window.exportMarkup.includes('data:image/')&&window.exportMarkup.includes('width="1800" height="2400"')`, session), true);
    await connection.evaluate(`document.querySelector('[data-testid="button-lower-third-template-spotlight"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-lower-third-template')`, value => value === 'spotlight', 5_000);
    await connection.evaluate(`document.querySelector('[data-testid="button-export-appearance-jpeg"]').click()`, session);
    await waitFor(connection, session, 'window.exportMarkup.includes(`data-lower-third-template="spotlight"`) && window.exportMarkup.includes(`data-testid="svg-card-position"`) && window.exportMarkup.includes(`height="2400"`) ', Boolean, 25_000);
    await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
    await waitFor(connection, session, 'window.lastSaved?.lowerThirdTemplate', value => value === 'spotlight', 10_000);
    await connection.send('Page.navigate', { url: 'http://localhost:80/simple-appearance-fixture.html' }, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="button-lower-third-template-spotlight"]')?.getAttribute('aria-pressed')`, value => value === 'true', 20_000);
    assert.equal(await connection.evaluate('Number(document.querySelector("[data-testid=svg-card-photo]").getAttribute("height"))', session), 1200, 'the photo layer survives reload');
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=svg-card-position]")?.textContent', session), 'QUARTERBACK', 'athlete details survive reload');
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, session);
    assert.equal(await connection.evaluate('document.documentElement.scrollWidth <= innerWidth', session), true, 'phone has no page overflow');
    assert.deepEqual(await connection.evaluate(`(() => {
      const frame=document.querySelector('[data-testid="frame-template-cycler"]');
      const lower=document.querySelector('[data-testid="lower-third-template-cycler"]');
      const grid=document.querySelector('[data-testid="appearance-desktop-template-pickers"]');
      return {
        controlsVisible:frame.getBoundingClientRect().height>0 && lower.getBoundingClientRect().height>0,
        groupsShareLine:Math.abs(frame.getBoundingClientRect().top-lower.getBoundingClientRect().top)<1,
        fullPickersHidden:getComputedStyle(grid).display==='none',
        frameName:document.querySelector('[data-testid="frame-template-cycler-selected"]')?.textContent,
        lowerThirdName:document.querySelector('[data-testid="lower-third-template-cycler-selected"]')?.textContent,
      };
    })()`, session), {
      controlsVisible: true,
      groupsShareLine: true,
      fullPickersHidden: true,
      frameName: 'Pixel Edge',
      lowerThirdName: 'Spotlight',
    });
    const previewRatio = await connection.evaluate<number>(`(()=>{const r=document.querySelector('[data-testid="classic-card-preview-surface"]').getBoundingClientRect();return r.width/r.height})()`, session);
    assert.ok(Math.abs(previewRatio - 3 / 4) < .01, `phone preview uses the 3:4 portrait ratio, received ${previewRatio}`);
    const templates = [
      ['velocity', 'Velocity'], ['wave', 'Wave'], ['glass', 'Glass'],
      ['varsity', 'Varsity'], ['spotlight', 'Spotlight'], ['pixel-edge', 'Pixel Edge'],
    ];
    const savedBeforeCycling = await connection.evaluate(`localStorage.getItem('simple-card-settings')`, session);
    for (const width of [320, 390]) {
      await connection.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }, session);
      assert.equal(await connection.evaluate(`document.documentElement.scrollWidth<=innerWidth`, session), true, `no phone overflow at ${width}px`);
      assert.equal(await connection.evaluate(`(()=>{
        const groups=[...document.querySelectorAll('[data-testid="hype-card-template-cyclers"] fieldset')];
        const buttons=groups.flatMap(group=>[...group.querySelectorAll('button')]);
        return Math.abs(groups[0].getBoundingClientRect().top-groups[1].getBoundingClientRect().top)<1
          && buttons.every(button=>{const r=button.getBoundingClientRect();return r.width>=44&&r.height>=44&&!!button.getAttribute('aria-label')});
      })()`, session), true, `side-by-side accessible touch controls at ${width}px`);
    }
    for (const [group, attribute, otherAttribute] of [
      ['frame', 'data-frame-template', 'data-lower-third-template'],
      ['lower-third', 'data-lower-third-template', 'data-frame-template'],
    ]) {
      const otherBefore = await connection.evaluate(`document.querySelector('[data-testid="classic-card-preview-surface"] svg').getAttribute('${otherAttribute}')`, session);
      const placementBefore = await connection.evaluate(`document.querySelector('[data-photo-placement]').getAttribute('transform')`, session);
      for (const direction of ['next', 'previous']) {
        for (let step = 0; step < templates.length; step++) {
          const current = await connection.evaluate<string>(`document.querySelector('[data-testid="classic-card-preview-surface"] svg').getAttribute('${attribute}')`, session);
          const index = templates.findIndex(([id]) => id === current);
          const expected = templates[(index + (direction === 'next' ? 1 : -1) + templates.length) % templates.length];
          await connection.evaluate(`document.querySelector('[data-testid="${group}-template-cycler-${direction}"]').click()`, session);
          await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('${attribute}')`, value => value === expected[0], 5_000);
          assert.equal(await connection.evaluate(`document.querySelector('[data-testid="${group}-template-cycler-selected"]').textContent`, session), expected[1]);
          assert.equal(await connection.evaluate(`document.querySelector('[data-testid="classic-card-preview-surface"] svg').getAttribute('${otherAttribute}')`, session), otherBefore, 'the other layer remains unchanged');
          assert.equal(await connection.evaluate(`document.querySelector('[data-photo-placement]').getAttribute('transform')`, session), placementBefore, 'photo placement stays intact');
        }
      }
    }
    assert.equal(await connection.evaluate(`localStorage.getItem('simple-card-settings')`, session), savedBeforeCycling, 'arrow taps never save the draft automatically');
    await connection.evaluate(`document.querySelector('[data-testid="frame-template-cycler-next"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-frame-template')`, value => value === 'velocity', 5_000);
    await connection.evaluate(`document.querySelector('[data-testid="lower-third-template-cycler-next"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-lower-third-template')`, value => value === 'pixel-edge', 5_000);
    await connection.evaluate(`document.querySelector('[data-testid="hype-card-template-cyclers"]').scrollIntoView({block:'center'})`, session);
    const phoneCapture = await connection.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }, session);
    await writeFile(resolve(tmpdir(), 'pixl-phone-template-cyclers.jpg'), Buffer.from(phoneCapture.data, 'base64'));
    await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
    await waitFor(connection, session, `window.lastSaved?.design==='velocity' && window.lastSaved?.lowerThirdTemplate==='pixel-edge'`, Boolean, 10_000);
    await connection.send('Page.navigate', { url: 'http://localhost:80/simple-appearance-fixture.html' }, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="frame-template-cycler-selected"]')?.textContent`, value => value === 'Velocity', 20_000);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="lower-third-template-cycler-selected"]').textContent`, session), 'Pixel Edge', 'phone selections survive Save design and reload');
  } finally {
    connection?.close();
    browser.kill('SIGKILL');
    await monitor.waitForExit();
    await rm(directory, { recursive: true, force: true });
    if (!process.env.KEEP_HYPE_FIXTURE) await Promise.all([rm(html, { force: true }), rm(entry, { force: true })]);
  }
});
