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
import{QueryClient,QueryClientProvider,useQuery}from'@tanstack/react-query';
import{getGetAthleteInviteQueryKey}from'@workspace/api-client-react';
import{FanCardAppearanceManager}from'./src/features/fan-card-appearance-manager';
import{LivingAthleteCardFront}from'./src/features/living-athlete-card-front';
import{LivingCardControls}from'./src/features/living-card-controls';
import{defaultCardAppearance,normalizeCardAppearance}from'./src/features/hype-card-appearance';
import photo from './src/assets/hypecard-player-photo-640.webp';
import './src/index.css';import './src/features/living-athlete-card.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
const initial=JSON.parse(localStorage.getItem('simple-card-settings')||'null')||{...defaultCardAppearance('glass'),jerseyNumber:'9'};
const inviteKey=getGetAthleteInviteQueryKey('fixture');
const secondInitial=normalizeCardAppearance({...defaultCardAppearance('spotlight'),lowerThirdTemplate:'wave',athleteX:-.09,athleteY:.08,athleteScale:1.4,jerseyNumber:'44',position:'Forward'});
const secondPhoto=photo+'#second-athlete';
window.secondSavedAppearance=secondInitial;
window.appearanceRequests=[];
window.savedCardAppearance=initial;
window.refreshSavedCard=async(appearance)=>{
 window.savedCardAppearance=appearance;
 await client.refetchQueries({queryKey:inviteKey,exact:true});
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
};
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,init)=>{
  const match=String(url).match(/\\/api\\/athlete-invites\\/(fixture|second-athlete)\\/appearance(?:\\?|$)/);
  if(match){
   const token=match[1],saved=JSON.parse(String(init.body));
   window.appearanceRequests.push({token,method:init.method,appearance:saved});
  if(window.failSave)return new Response('{}',{status:500,headers:{'content-type':'application/json'}});
   localStorage.setItem(token==='fixture'?'simple-card-settings':'second-card-settings',JSON.stringify(saved));window.lastSaved=saved;
   if(token==='fixture')window.savedCardAppearance=saved;else window.secondSavedAppearance=saved;
  return new Response(JSON.stringify({cardAppearance:saved}),{headers:{'content-type':'application/json'}});
 }return nativeFetch(url,init);
};
const NativeImage=window.Image;
window.Image=class extends NativeImage{set src(v){if(v.startsWith('data:image/svg+xml'))window.exportMarkup=decodeURIComponent(v.slice(v.indexOf(',')+1));super.src=v;}get src(){return super.src;}};
const nativeClick=HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click=function(){if(this.download){window.exportDownload=this.download;return;}nativeClick.call(this);};
function App(){const[side,setSide]=useState('front');const[token,setToken]=useState('fixture');
 const getInvite=()=>token==='fixture'
  ?{inviteToken:token,athleteName:'Older name',teamName:'Eastside Falcons',sport:'football',photoUrl:photo,cardAppearance:window.savedCardAppearance}
  :{inviteToken:token,athleteName:'Older second name',teamName:'Westside Comets',sport:'soccer',photoUrl:secondPhoto,cardAppearance:window.secondSavedAppearance};
 const{data:invite}=useQuery({queryKey:getGetAthleteInviteQueryKey(token),queryFn:async()=>getInvite(),initialData:getInvite,staleTime:Infinity});
 const profile=token==='fixture'?{athleteName:'Jordan Alexander Matthews',jerseyNumber:'23',position:'Quarterback'}:{athleteName:'Casey Rivera',jerseyNumber:'44',position:'Forward'};
 return <div style={{background:'#07172b',color:'white',minHeight:'100vh',padding:20}}>
 <h1 style={{fontSize:24,marginBottom:20}}>HYPE Card</h1>
 <button data-testid="select-first-athlete" onClick={()=>setToken('fixture')}>Edit Jordan</button>
 <button data-testid="select-second-athlete" onClick={()=>setToken('second-athlete')}>Edit Casey</button>
 <output hidden data-testid="saved-card-query-value">{JSON.stringify(invite.cardAppearance)}</output>
 <div style={{maxWidth:960,margin:'auto'}}><FanCardAppearanceManager invite={invite} profile={profile}/></div>
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
    assert.equal(await connection.evaluate('document.querySelectorAll("[data-testid=card-design-picker-cards] button").length', session), 5);
    assert.equal(await connection.evaluate('document.querySelectorAll("[data-testid=lower-third-template-picker] button").length', session), 5);
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
    assert.deepEqual(await connection.evaluate(`(() => {
      const svg = document.querySelector('[data-testid="classic-card-preview-surface"] svg');
      const logo = svg?.querySelector('[data-testid="svg-card-logo"]');
      const watermark = svg?.querySelector('[data-testid="text-hype-card-watermark"]');
      return {
        logoVisible: Boolean(logo),
        logoWidth: logo?.getAttribute('width'),
        watermarkText: watermark?.textContent,
        watermarkOpacity: watermark?.getAttribute('opacity'),
      };
    })()`, session), {
      logoVisible: true,
      logoWidth: '142',
      watermarkText: 'HYPE Card',
      watermarkOpacity: '.5',
    });
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
       assert.equal(await connection.evaluate(`Boolean(document.querySelector('[data-testid="button-design-${replacement}"]'))`, session), replacement !== 'pixel-edge', `${legacy} replacement remains renderable, but retired Pixel Edge is not offered`);
       if (replacement !== 'pixel-edge') {
         assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-design-${replacement}"]').getAttribute('aria-pressed')`, session), 'true', `${legacy} selects its ${replacement} replacement in the appearance manager`);
       }
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="slider-photo-x"]').value`, session), '0.07', `${legacy} horizontal photo placement is restored`);
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="slider-photo-y"]').value`, session), '-0.04', `${legacy} vertical photo placement is restored`);
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="slider-photo-zoom"]').value`, session), '1.13', `${legacy} photo zoom is restored`);
      assert.equal(await connection.evaluate(`document.querySelector('[data-testid="classic-card-preview-surface"] svg [data-photo-placement]')?.getAttribute('transform')`, session), 'translate(63 -48)', `${legacy} photo transform is visible in the owner preview`);

      await connection.evaluate(`document.querySelector('[data-testid="button-lower-third-template-wave"]').click()`, session);
      await waitFor(connection, session, `document.querySelector('[data-testid="button-save-appearance"]')?.disabled`, value => value === false, 5_000);
      await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
      await waitFor(connection, session, 'window.lastSaved?.design', value => value === replacement, 10_000);
      await connection.send('Page.navigate', { url: 'http://localhost:80/simple-appearance-fixture.html' }, session);
       await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-frame-template')`, value => value === replacement, 20_000);
       if (replacement !== 'pixel-edge') {
         assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-design-${replacement}"]')?.getAttribute('aria-pressed')`, session), 'true');
       } else {
         assert.equal(await connection.evaluate(`Boolean(document.querySelector('[data-testid="button-design-pixel-edge"]'))`, session), false);
       }
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
     assert.equal(await connection.evaluate(`Boolean(document.querySelector('[data-testid="button-design-pixel-edge"]'))`, session), false);
    await connection.evaluate(`document.querySelector('[data-testid="button-lower-third-template-varsity"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-lower-third-template')`,
      value => value === 'varsity', 5_000);
     assert.deepEqual(await connection.evaluate(`(()=>{const s=document.querySelector('[data-testid="classic-card-preview-surface"] svg');return [s.getAttribute('data-frame-template'),s.getAttribute('data-lower-third-template')]})()`, session), ['varsity', 'varsity']);
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
     await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-frame-template')`, value => value === 'varsity', 20_000);
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
     assert.equal(await connection.evaluate(`window.exportMarkup.includes('data-frame-template="varsity"')&&window.exportMarkup.includes('data-lower-third-template="varsity"')&&window.exportMarkup.includes('data:image/')&&window.exportMarkup.includes('width="1800" height="2400"')`, session), true);
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
       frameName: 'Varsity',
      lowerThirdName: 'Spotlight',
    });
    const previewRatio = await connection.evaluate<number>(`(()=>{const r=document.querySelector('[data-testid="classic-card-preview-surface"]').getBoundingClientRect();return r.width/r.height})()`, session);
    assert.ok(Math.abs(previewRatio - 3 / 4) < .01, `phone preview uses the 3:4 portrait ratio, received ${previewRatio}`);
    const templates = [
      ['velocity', 'Velocity'], ['wave', 'Wave'], ['glass', 'Glass'],
       ['varsity', 'Varsity'], ['spotlight', 'Spotlight'],
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
     await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-frame-template')`, value => value === 'spotlight', 5_000);
    await connection.evaluate(`document.querySelector('[data-testid="lower-third-template-cycler-next"]').click()`, session);
     await waitFor(connection, session, `document.querySelector('[data-testid="classic-card-preview-surface"] svg')?.getAttribute('data-lower-third-template')`, value => value === 'velocity', 5_000);
    await connection.evaluate(`document.querySelector('[data-testid="hype-card-template-cyclers"]').scrollIntoView({block:'center'})`, session);
    const phoneCapture = await connection.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }, session);
    await writeFile(resolve(tmpdir(), 'pixl-phone-template-cyclers.jpg'), Buffer.from(phoneCapture.data, 'base64'));
    await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
     await waitFor(connection, session, `window.lastSaved?.design==='spotlight' && window.lastSaved?.lowerThirdTemplate==='velocity'`, Boolean, 10_000);
    await connection.send('Page.navigate', { url: 'http://localhost:80/simple-appearance-fixture.html' }, session);
     await waitFor(connection, session, `document.querySelector('[data-testid="frame-template-cycler-selected"]')?.textContent`, value => value === 'Spotlight', 20_000);
     assert.equal(await connection.evaluate(`document.querySelector('[data-testid="lower-third-template-cycler-selected"]').textContent`, session), 'Velocity', 'phone selections survive Save design and reload');

    const editorSnapshot = `(() => {
      const manager=document.querySelector('[data-testid="fan-card-appearance-manager"]');
      const preview=manager.querySelector('[data-testid="classic-card-preview-surface"] svg');
      return {
        preview:preview.outerHTML,
        frame:preview.getAttribute('data-frame-template'),
        lowerThird:preview.getAttribute('data-lower-third-template'),
        frameName:manager.querySelector('[data-testid="frame-template-cycler-selected"]').textContent,
        lowerThirdName:manager.querySelector('[data-testid="lower-third-template-cycler-selected"]').textContent,
        placement:preview.querySelector('[data-photo-placement]').getAttribute('transform'),
        photoX:manager.querySelector('[data-testid="slider-photo-x"]').value,
        photoY:manager.querySelector('[data-testid="slider-photo-y"]').value,
        photoZoom:manager.querySelector('[data-testid="slider-photo-zoom"]').value,
        saveDisabled:manager.querySelector('[data-testid="button-save-appearance"]').matches(':disabled'),
      };
    })()`;
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').matches(':disabled')`, session), true, 'reopened phone editor starts clean');
    await connection.evaluate(`document.querySelector('[data-testid="frame-template-cycler-next"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="frame-template-cycler-selected"]')?.textContent`, value => value === 'Velocity', 5_000);
    await connection.evaluate(`document.querySelector('[data-testid="lower-third-template-cycler-next"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="lower-third-template-cycler-selected"]')?.textContent`, value => value === 'Wave', 5_000);
    for (const axis of ['x', 'y', 'zoom']) {
      await connection.evaluate(`document.querySelector('[data-testid="slider-photo-${axis}"]').focus()`, session);
      await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, session);
      await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, session);
    }
    const draftBeforeRefresh = await connection.evaluate<{ saveDisabled: boolean }>(editorSnapshot, session);
    assert.equal(draftBeforeRefresh.saveDisabled, false, 'phone style and placement changes enable Save design');
    const refreshedSaved = await connection.evaluate(`({...JSON.parse(localStorage.getItem('simple-card-settings')),design:'varsity',lowerThirdTemplate:'glass',athleteX:.17,athleteY:-.12,athleteScale:1.25})`, session);
    const persistedBeforeRefresh = await connection.evaluate(`localStorage.getItem('simple-card-settings')`, session);
    await connection.evaluate(`window.refreshSavedCard(${JSON.stringify(refreshedSaved)})`, session);
    assert.deepEqual(await connection.evaluate(`JSON.parse(document.querySelector('[data-testid="saved-card-query-value"]').textContent)`, session), refreshedSaved, 'the parent receives changed saved values through the query');
    assert.deepEqual(await connection.evaluate(editorSnapshot, session), draftBeforeRefresh, 'saved-card query refresh preserves the complete draft preview, selected phone names, photo placement and enabled Save design');
    assert.equal(await connection.evaluate(`localStorage.getItem('simple-card-settings')`, session), persistedBeforeRefresh, 'query refresh does not save the draft');

    await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
    await waitFor(connection, session, `window.lastSaved?.design==='velocity' && window.lastSaved?.lowerThirdTemplate==='wave' && document.querySelector('[data-testid="button-save-appearance"]').matches(':disabled')`, Boolean, 10_000);
    const savedDraft = await connection.evaluate<{ athleteX: number; athleteY: number; athleteScale: number }>('window.lastSaved', session);
    assert.deepEqual(await connection.evaluate(editorSnapshot, session), { ...draftBeforeRefresh, saveDisabled: true }, 'saving after refresh uses the preserved phone draft');

    await connection.evaluate(`window.refreshSavedCard(${JSON.stringify(refreshedSaved)})`, session);
    const cleanAfterRefresh = await connection.evaluate<Record<string, unknown>>(editorSnapshot, session);
    const { preview: refreshedPreview, ...cleanValues } = cleanAfterRefresh;
    assert.notEqual(refreshedPreview, (draftBeforeRefresh as Record<string, unknown>).preview, 'a clean preview adopts the refreshed saved artwork');
    assert.deepEqual(cleanValues, {
      frame: 'varsity', lowerThird: 'glass', frameName: 'Varsity', lowerThirdName: 'Glass',
      placement: 'translate(153 -144)', photoX: '0.17', photoY: '-0.12', photoZoom: '1.25',
      saveDisabled: true,
    }, 'a clean phone editor accepts refreshed styles and photo placement without becoming dirty');
    assert.notDeepEqual([savedDraft.athleteX, savedDraft.athleteY, savedDraft.athleteScale], [.17, -.12, 1.25], 'the refresh fixture has different photo placement from the draft');

    // Keep this exact manager mounted: a keyed remount would hide token-reset regressions.
    await connection.evaluate(`window.managerBeforeSwitch=document.querySelector('[data-testid="fan-card-appearance-manager"]');
      document.querySelector('[data-testid="frame-template-cycler-previous"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="frame-template-cycler-selected"]')?.textContent`, value => value === 'Glass', 5_000);
    await connection.evaluate(`document.querySelector('[data-testid="lower-third-template-cycler-next"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="lower-third-template-cycler-selected"]')?.textContent`, value => value === 'Varsity', 5_000);
    for (const axis of ['x', 'y', 'zoom']) {
      await connection.evaluate(`document.querySelector('[data-testid="slider-photo-${axis}"]').focus()`, session);
      await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, session);
      await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, session);
    }
    const abandonedDraft = await connection.evaluate<Record<string, unknown>>(editorSnapshot, session);
    assert.equal(abandonedDraft.saveDisabled, false, 'the first athlete has an unsaved phone draft before switching');
    assert.notDeepEqual(
      [abandonedDraft.photoX, abandonedDraft.photoY, abandonedDraft.photoZoom],
      [cleanValues.photoX, cleanValues.photoY, cleanValues.photoZoom],
      'the abandoned draft includes unsaved photo placement',
    );
    const firstPersistedBeforeSwitch = await connection.evaluate(`localStorage.getItem('simple-card-settings')`, session);
    const firstSavedBeforeSwitch = await connection.evaluate('window.savedCardAppearance', session);
    const requestsBeforeSwitch = await connection.evaluate<number>('window.appearanceRequests.length', session);
    await connection.evaluate(`document.querySelector('[data-testid="select-second-athlete"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="lower-third-template-cycler-selected"]')?.textContent==='Wave' && document.querySelector('[data-testid="button-save-appearance"]').matches(':disabled')`, Boolean, 5_000);
    assert.equal(await connection.evaluate(`window.managerBeforeSwitch===document.querySelector('[data-testid="fan-card-appearance-manager"]')`, session), true, 'invite selection updates the mounted manager without navigation or remounting');
    const { preview: secondPreview, ...secondValues } = await connection.evaluate<Record<string, unknown>>(editorSnapshot, session);
    assert.notEqual(secondPreview, abandonedDraft.preview, 'the second athlete does not inherit the abandoned preview');
    assert.deepEqual(secondValues, {
      frame: 'spotlight', lowerThird: 'wave', frameName: 'Spotlight', lowerThirdName: 'Wave',
      placement: 'translate(-81 96)', photoX: '-0.09', photoY: '0.08', photoZoom: '1.4',
      saveDisabled: true,
    }, 'the newly selected athlete restores their saved frame, lower third and all photo controls cleanly');
    const identitySnapshot = `(() => {
      const manager=document.querySelector('[data-testid="fan-card-appearance-manager"]');
      return {
        name:manager.querySelector('[data-testid="svg-card-athlete-name"]').textContent,
        label:manager.querySelector('[data-testid="classic-card-preview-surface"]').getAttribute('aria-label'),
        number:manager.querySelector('[data-testid="text-living-card-jersey-number"]').textContent,
        position:manager.querySelector('[data-testid="svg-card-position"]').textContent,
        photo:manager.querySelector('[data-testid="svg-card-photo"]').getAttribute('href'),
        photoWidth:manager.querySelector('[data-testid="svg-card-photo"]').getAttribute('width'),
        links:[...manager.querySelectorAll('[data-testid="appearance-navigation-preview"] a')].map(a=>a.getAttribute('href')),
      };
    })()`;
    const secondIdentity = await connection.evaluate<Record<string, unknown>>(identitySnapshot, session);
    assert.deepEqual(secondIdentity, {
      name: 'CASEY RIVERA', label: 'HYPE Card preview for Casey Rivera', number: 'Number 44', position: 'FORWARD',
      photo: await connection.evaluate(`document.querySelector('[data-testid="flip-harness"] [data-testid="svg-card-photo"]').getAttribute('href')+'#second-athlete'`, session),
      photoWidth: '1260.00',
      links: ['/fan/second-athlete?side=responses', '/fan/second-athlete?side=stats', '/fan/second-athlete?side=live-taps', '/fan/second-athlete?side=events'],
    }, 'the rendered identity, photo, zoom and card links belong only to the newly selected athlete');
    assert.equal(await connection.evaluate('window.appearanceRequests.length', session), requestsBeforeSwitch, 'switching athletes does not auto-save either design');

    const expectedSecondSaved = await connection.evaluate(`({...window.secondSavedAppearance,lowerThirdTemplate:'glass'})`, session);
    await connection.evaluate(`document.querySelector('[data-testid="lower-third-template-cycler-next"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="lower-third-template-cycler-selected"]')?.textContent`, value => value === 'Glass', 5_000);
    const secondDraft = await connection.evaluate<Record<string, unknown>>(editorSnapshot, session);
    await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
    await waitFor(connection, session, `window.appearanceRequests.length===${requestsBeforeSwitch + 1} && document.querySelector('[data-testid="button-save-appearance"]').matches(':disabled')`, Boolean, 10_000);
    assert.deepEqual(await connection.evaluate(`window.appearanceRequests.slice(${requestsBeforeSwitch})`, session), [
      { token: 'second-athlete', method: 'PATCH', appearance: expectedSecondSaved },
    ], 'Save design sends exactly one update to the newly selected invite');
    assert.deepEqual(await connection.evaluate(editorSnapshot, session), { ...secondDraft, saveDisabled: true }, 'saving keeps the second athlete preview intact and marks it clean');
    assert.deepEqual(await connection.evaluate(identitySnapshot, session), secondIdentity, 'saving does not restore the first athlete identity or photo');
    assert.deepEqual(await connection.evaluate(`JSON.parse(localStorage.getItem('second-card-settings'))`, session), expectedSecondSaved, 'only the second athlete receives the newly saved design');
    assert.equal(await connection.evaluate(`localStorage.getItem('simple-card-settings')`, session), firstPersistedBeforeSwitch, 'the first athlete persisted design remains untouched');
    assert.deepEqual(await connection.evaluate('window.savedCardAppearance', session), firstSavedBeforeSwitch, 'the first athlete server fixture remains untouched');

    await connection.evaluate(`document.querySelector('[data-testid="select-first-athlete"]').click()`, session);
    await waitFor(connection, session, `document.querySelector('[data-testid="frame-template-cycler-selected"]')?.textContent==='Varsity' && document.querySelector('[data-testid="button-save-appearance"]').matches(':disabled')`, Boolean, 5_000);
    assert.deepEqual(await connection.evaluate(editorSnapshot, session), cleanAfterRefresh, 'returning to the first athlete restores their saved design, not either unsaved or second-athlete design');
  } finally {
    connection?.close();
    browser.kill('SIGKILL');
    await monitor.waitForExit();
    await rm(directory, { recursive: true, force: true });
    if (!process.env.KEEP_HYPE_FIXTURE) await Promise.all([rm(html, { force: true }), rm(entry, { force: true })]);
  }
});
