import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DevToolsConnection, monitorProcess, openPage, waitFor, waitForUrl } from './browser-test-diagnostics';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const html = resolve(root, 'premium-appearance-fixture.html');
const entry = resolve(root, 'premium-appearance-fixture.tsx');

test('premium controls save and reopen with mobile layout and real local cutout inference', { timeout: 250_000 }, async () => {
  await writeFile(html, '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/premium-appearance-fixture.tsx"></script></body></html>');
  await writeFile(entry, `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
import{FanCardAppearanceManager}from'./src/features/fan-card-appearance-manager';
import{LivingAthleteCardFront}from'./src/features/living-athlete-card-front';
import{defaultCardAppearance}from'./src/features/hype-card-appearance';
import{removeAthleteBackground}from'./src/features/athlete-background-removal';
import photo from './src/assets/hypecard-player-photo-640.webp';
import cutout from './src/assets/youth-football-player-cutout.png';
import './src/index.css';
import './src/features/living-athlete-card.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
let saved=JSON.parse(localStorage.getItem('premium-test-settings')||'null')||defaultCardAppearance('gallery');
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,init)=>{
 if(String(url).includes('/api/athlete-invites/fixture/appearance')){
  saved=JSON.parse(String(init.body));localStorage.setItem('premium-test-settings',JSON.stringify(saved));
  return new Response(JSON.stringify({cardAppearance:saved}),{headers:{'content-type':'application/json'}});
 } return nativeFetch(url,init);
};
window.runRemoval=async()=>{
 try{const blob=await removeAthleteBackground(await(await nativeFetch(photo)).blob(),s=>window.removalStatus=s);
 const image=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
 const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const p=ctx.getImageData(0,0,image.width,image.height).data;
 let transparent=0,opaque=0;for(let i=3;i<p.length;i+=4){if(p[i]<20)transparent++;if(p[i]>240)opaque++;}
 window.removalResult={type:blob.type,size:blob.size,width:image.width,height:image.height,transparent,opaque};image.close();
 }catch(e){window.removalResult={error:String(e)};}
};
const profile={athleteName:'Jordan Alexander Matthews',jerseyNumber:'9',position:'Quarterback'};
const invite={inviteToken:'fixture',athleteName:'Older Invite Name',teamName:'Eastside Falcons',sport:'football',photoUrl:photo,photoRevision:'fixture-revision',cutoutUrl:new URLSearchParams(location.search).has('fallback')?null:cutout,cardAppearance:saved};
function Card({design}){const a={...defaultCardAppearance(design),jerseyNumber:'9',position:'Quarterback'};
 return <div className="living-card-frame-outer"><section className="living-card-frame" data-design={design} data-side="front" style={{position:'relative',width:'100%',aspectRatio:'1000/1400'}}><div className="living-card-flip-inner"><div className="living-card-flip-face living-card-flip-front"><LivingAthleteCardFront athleteName={invite.athleteName} teamName={invite.teamName} sport={invite.sport} appearance={a} photoUrl={photo} cutoutUrl={cutout}/></div></div><div className="living-card-controls">{['Replies','Stats','Taps','Events'].map(s=><button className="living-card-control" key={s}>{s}</button>)}</div></section></div>}
  function App(){return <div style={{background:'#07172b',color:'white',minHeight:'100vh',padding:20}}><h1 style={{fontSize:24,marginBottom:16}}>Premium card design verification</h1><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',maxWidth:1000,margin:'auto',gap:24,justifyContent:'center'}}><Card design="gallery"/><Card design="spotlight"/><Card design="breakout"/></div><div style={{maxWidth:960,margin:'32px auto'}}><FanCardAppearanceManager invite={invite} profile={profile}/></div></div>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);
`);
  const directory = await mkdtemp(resolve(tmpdir(), 'premium-card-browser-'));
  const port = 9450 + process.pid % 200;
  const browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', [
    '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    `--remote-debugging-port=${port}`, `--user-data-dir=${directory}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const monitor = monitorProcess(browser, 'premium Chromium');
  let connection: DevToolsConnection | undefined;
  try {
    await waitForUrl(`http://127.0.0.1:${port}/json/version`, 30_000, monitor);
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, monitor.diagnostics);
    const page = await openPage(connection, 'http://localhost:80/premium-appearance-fixture.html', { viewport: { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false } });
    const session = page.sessionId;
    await waitFor(connection, session, '!!document.querySelector("[data-testid=fan-card-appearance-manager]")', Boolean, 45_000);
    assert.equal(await connection.evaluate(`getComputedStyle(document.querySelector('[data-testid="card-design-picker-cards"]')).display`, session), 'block', 'desktop keeps the full design picker');
    assert.equal(await connection.evaluate(`getComputedStyle(document.querySelector('[data-testid="mobile-card-design-controls"]')).display`, session), 'none', 'the compact picker is reserved for phones');
    const breakoutFrame = await connection.evaluate<{ radius: string; padding: string; border: string; background: string; shadow: string }>(`(()=>{const frame=document.querySelector('.living-card-frame-outer:has(.living-card-frame[data-design="breakout"])'),style=getComputedStyle(frame);return {radius:style.borderTopLeftRadius,padding:style.paddingTop,border:style.borderTopWidth,background:style.backgroundImage,shadow:style.boxShadow}})()`, session);
    assert.equal(breakoutFrame.radius, '0px', 'the outer wrapper does not add a second frame');
    assert.equal(breakoutFrame.padding, '0px', 'the outer wrapper adds no blue spacing around the metal');
    assert.equal(breakoutFrame.border, '0px', 'the outer wrapper has no visible border');
    assert.equal(breakoutFrame.background, 'none', 'the light-blue wrapper is removed');
    assert.equal(breakoutFrame.shadow, 'none', 'the wrapper adds no frame shadow');
    const flipBackdrop = await connection.evaluate<{ image: string; color: string }>(`(()=>{const style=getComputedStyle(document.querySelector('.living-card-frame[data-design="breakout"] .living-card-flip-front'));return {image:style.backgroundImage,color:style.backgroundColor}})()`, session);
    assert.equal(flipBackdrop.image, 'none', 'the real flip-front container adds no rectangular blue backdrop');
    assert.equal(flipBackdrop.color, 'rgba(0, 0, 0, 0)', 'the area outside the silver outline stays transparent');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="input-card-jersey"]').value`, session), '9', 'the profile jersey number fills a blank appearance');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="input-card-position"]').value`, session), 'Quarterback', 'the profile position fills a blank appearance');
    assert.match(await connection.evaluate(`document.querySelector('[data-testid="appearance-preview-surface"]').getAttribute('aria-label')`, session), /Jordan Alexander Matthews/, 'the card preview uses the profile-derived athlete name');
    await connection.evaluate(`document.querySelector('[data-testid="button-design-spotlight"]').click()`, session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=appearance-preview-surface] svg")?.getAttribute("data-design")', value => value === 'spotlight', 5_000);
    assert.equal(await connection.evaluate(`document.querySelectorAll('[data-testid="hype-card-appearance-controls"] input[type="checkbox"]').length`, session), 1, 'only the background-removal checkbox remains');
    assert.equal(await connection.evaluate(`!!document.querySelector('[aria-label="Accent color presets"]')`, session), false, 'the separate accent picker is removed');
    await waitFor(connection, session, '!!document.querySelector("[aria-label=\\"Border color presets\\"]")', Boolean, 5_000);
    await connection.evaluate(`document.querySelector('[aria-label="Border color presets"] [aria-label="Green"]').click()`, session);
    await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
    await waitFor(connection, session, 'localStorage.getItem("premium-test-settings")', value => String(value).includes('"design":"spotlight"'), 5_000);
    const savedColors = await connection.evaluate<{ accentLinked: boolean; borderColor: string; accentColor: string; jerseyNumber: string; position: string }>('JSON.parse(localStorage.getItem("premium-test-settings"))', session);
    assert.equal(savedColors.accentLinked, true);
    assert.equal(savedColors.borderColor, savedColors.accentColor);
    assert.equal(savedColors.jerseyNumber, '9');
    assert.equal(savedColors.position, 'Quarterback');
    await connection.send('Page.navigate', { url: 'http://localhost:80/premium-appearance-fixture.html' }, session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=appearance-preview-surface] svg")?.getAttribute("data-design")', value => value === 'spotlight', 10_000);
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, session);
    const mobile = await connection.evaluate<{ contained: boolean; tap: boolean; compactPickerVisible: boolean; fullPickerHidden: boolean; inline: boolean; designChoices: number }>(`(()=>{const card=document.querySelector('[data-testid="appearance-preview"]').getBoundingClientRect(),picker=document.querySelector('[data-testid="mobile-card-design-controls"]'),pickerBox=picker.getBoundingClientRect();return {contained:document.documentElement.scrollWidth<=390,tap:[...document.querySelectorAll('.living-card-controls button')].every(b=>b.getBoundingClientRect().height>=44),compactPickerVisible:getComputedStyle(picker).display!=='none',fullPickerHidden:getComputedStyle(document.querySelector('[data-testid="card-design-picker-cards"]')).display==='none',inline:card.right<=pickerBox.left+2&&Math.min(card.bottom,pickerBox.bottom)>Math.max(card.top,pickerBox.top),designChoices:picker.querySelectorAll('button').length}})()`, session);
    assert.ok(mobile.contained, 'phone content must not horizontally overflow');
    assert.ok(mobile.tap, 'navigation retains 44px touch targets');
    assert.ok(mobile.compactPickerVisible && mobile.fullPickerHidden, 'phones show the compact picker instead of the full design cards');
    assert.ok(mobile.inline, 'the compact design buttons sit beside the HYPE Card preview');
    assert.equal(mobile.designChoices, 4, 'all card designs remain available on phones');
    await connection.evaluate(`document.querySelector('[data-testid="button-design-compact-gallery"]').click()`, session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=appearance-preview-surface] svg")?.getAttribute("data-design")', value => value === 'gallery', 5_000);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-design-compact-gallery"]').getAttribute('aria-pressed')`, session), 'true', 'the selected mobile button tracks the preview');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').disabled`, session), false, 'the existing Save design action persists the selected draft');
    const framing = await connection.evaluate(`Array.from(document.querySelectorAll('section.living-card-frame')).every(card => {
      const box=card.getBoundingClientRect(), nav=card.querySelector('.living-card-controls').getBoundingClientRect();
      const details=Array.from(card.querySelectorAll('svg text')).filter(t=>t.textContent.includes('QUARTERBACK'));
      return Math.abs(box.height/box.width-1.4)<.02 && nav.bottom<=box.bottom && details.every(t=>t.getBoundingClientRect().bottom<=nav.top);
    })`, session);
    assert.ok(framing, 'phone navigation stays inside the portrait card without covering identity text');
    const breakoutCutoutOverhang = await connection.evaluate(`(()=>{const athlete=document.querySelector('[data-design="breakout"] [data-photo-placement] image');return !!athlete&&athlete.y.baseVal.value<92})()`, session);
    assert.ok(breakoutCutoutOverhang, 'Breakout cutout begins above its smaller stadium frame');
    for (const fallback of [false, true]) {
      await connection.send('Page.navigate', { url: `http://localhost:80/premium-appearance-fixture.html${fallback ? '?fallback=1' : ''}` }, session);
      await waitFor(connection, session, '!!document.querySelector("[data-testid=appearance-preview-surface] [data-photo-placement]")', Boolean, 10_000);
      for (const design of ['gallery', 'spotlight', 'breakout']) {
        await connection.evaluate(`document.querySelector('[data-testid="button-design-compact-${design}"]').click()`, session);
        await connection.evaluate(`document.querySelector('[data-testid="button-reset-placement"]').click()`, session);
        const actorBounds = `(()=>{const r=document.querySelector('[data-testid="appearance-preview-surface"] [data-photo-placement] image').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`;
        await connection.evaluate(`document.querySelector('[data-testid="appearance-preview-surface"]').scrollIntoView({block:'center'});`, session);
        const before = await connection.evaluate<{ x: number; y: number; width: number }>(actorBounds, session);
        await connection.evaluate(`(()=>{const button=document.querySelector('[data-testid="button-reposition-mode"]');if(button.getAttribute('aria-pressed')!=='true')button.click()})()`, session);
        assert.equal(await connection.evaluate(`document.querySelector('[data-testid="appearance-preview-surface"]').style.touchAction`, session), 'none');
        assert.equal(await connection.evaluate(`document.querySelector('[data-testid="appearance-preview-surface"]').classList.contains('ring-2')`, session), false, 'positioning mode does not add a white square frame');
        const point = await connection.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector('[data-testid="appearance-preview-surface"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`, session);
        await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, session);
        await connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 24, y: point.y + 24, button: 'left', buttons: 1 }, session);
        await connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 24, y: point.y + 24, button: 'left', clickCount: 1 }, session);
        const moved = await connection.evaluate<{ x: number; y: number; width: number }>(actorBounds, session);
        assert.ok(moved.x > before.x + 15 && moved.y > before.y + 15, `${design}/${fallback ? 'original' : 'cutout'} must visibly move`);
        await connection.evaluate(`(()=>{const range=document.querySelector('[data-testid="hype-card-appearance-controls"] input[type="range"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(range,'1.3');range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));})()`, session);
        const resized = await connection.evaluate<{ width: number }>(actorBounds, session);
        assert.ok(resized.width > before.width * 1.2, `${design} size must visibly change`);
        await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
        await waitFor(connection, session, 'JSON.parse(localStorage.getItem("premium-test-settings")).athleteScale', value => value === 1.3, 5_000);
        const placementSaved = await connection.evaluate<{ athleteX: number; athleteY: number }>('JSON.parse(localStorage.getItem("premium-test-settings"))', session);
        assert.ok(placementSaved.athleteX > 0 && placementSaved.athleteY > 0);
        const savedTransform = await connection.evaluate(`document.querySelector('[data-testid="appearance-preview-surface"] [data-photo-placement]').getAttribute('transform')`, session);
        await connection.send('Page.navigate', { url: `http://localhost:80/premium-appearance-fixture.html${fallback ? '?fallback=1' : ''}` }, session);
        await waitFor(connection, session, '!!document.querySelector("[data-testid=appearance-preview-surface] [data-photo-placement]")', Boolean, 10_000);
        assert.equal(await connection.evaluate(`document.querySelector('[data-testid="appearance-preview-surface"] [data-photo-placement]').getAttribute('transform')`, session), savedTransform);
        await connection.evaluate(`document.querySelector('[data-testid="button-reset-placement"]').click()`, session);
        const reset = await connection.evaluate<{ width: number }>(actorBounds, session);
        assert.ok(Math.abs(reset.width - before.width) < 1);
        assert.equal(await connection.evaluate(`document.querySelector('[data-testid="appearance-preview-surface"]').style.touchAction`, session), 'auto');
        assert.equal(await connection.evaluate(`document.querySelectorAll('[data-testid="hype-card-appearance-controls"] input[type="range"]').length`, session), 1);
        assert.equal(await connection.evaluate(`!!document.querySelector('[data-testid="button-preview-reset"]')`, session), false);
      }
    }
    await connection.send('Page.navigate', { url: 'http://localhost:80/premium-appearance-fixture.html' }, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=button-layer-name-plate]")', Boolean, 10_000);
    const backgroundToggle = `document.querySelector('[data-testid="toggle-remove-background"] input')`;
    assert.equal(await connection.evaluate(`${backgroundToggle}.checked`, session), true);
    await connection.evaluate(`${backgroundToggle}.click()`, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=appearance-preview-surface] [data-photo-placement=original]")', Boolean, 5_000);
    assert.equal(await connection.evaluate(`!!document.querySelector('[data-testid="appearance-preview-surface"] [data-photo-placement="cutout"]')`, session), false);
    await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
    await waitFor(connection, session, 'JSON.parse(localStorage.getItem("premium-test-settings")).removeBackground', value => value === false, 5_000);
    await connection.send('Page.navigate', { url: 'http://localhost:80/premium-appearance-fixture.html' }, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=appearance-preview-surface] [data-photo-placement=original]")', Boolean, 10_000);
    assert.equal(await connection.evaluate(`${backgroundToggle}.checked`, session), false);
    await connection.evaluate(`${backgroundToggle}.click()`, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=appearance-preview-surface] [data-photo-placement=cutout]")', Boolean, 5_000);
    await connection.evaluate(`document.querySelector('[data-testid="button-layer-name-plate"]').click();document.querySelector('[data-testid="button-reset-placement"]').click()`, session);
    const plateTransform = `document.querySelector('[data-testid="appearance-preview-surface"] [data-card-layer="name-plate"]').getAttribute("transform")`;
    const beforePlate = await connection.evaluate<string>(plateTransform, session);
    await connection.evaluate(`document.querySelector('[data-testid="button-reposition-mode"]').click()`, session);
    await connection.evaluate(`document.querySelector('[data-testid="appearance-preview-surface"]').scrollIntoView({block:'center'})`, session);
    const platePoint = await connection.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector('[data-testid="appearance-preview-surface"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`, session);
    await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...platePoint, button: 'left', clickCount: 1 }, session);
    await connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: platePoint.x + 24, y: platePoint.y + 18, button: 'left', buttons: 1 }, session);
    await connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: platePoint.x + 24, y: platePoint.y + 18, button: 'left', clickCount: 1 }, session);
    const movedPlate = await connection.evaluate<string>(plateTransform, session);
    assert.notEqual(movedPlate, beforePlate, 'name plate layer moves independently from the avatar');
    await connection.evaluate(`document.querySelector('[data-testid="button-reposition-mode"]').click();document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
    await waitFor(connection, session, 'JSON.parse(localStorage.getItem("premium-test-settings")).namePlateX', value => value > 0, 5_000);
    await connection.send('Page.navigate', { url: 'http://localhost:80/premium-appearance-fixture.html' }, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=button-layer-name-plate]")', Boolean, 10_000);
    assert.equal(await connection.evaluate<string>(plateTransform, session), movedPlate, 'saved name plate position survives reopening');
    await connection.evaluate(`document.querySelector('[data-testid="button-layer-frame"]').click()`, session);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-reposition-mode"]').disabled`, session), true, 'the frame is a fixed layer');
    await connection.send('Page.navigate', { url: 'http://localhost:80/premium-appearance-fixture.html?fallback=1' }, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=button-remove-card-background]")', Boolean, 10_000);
    if (await connection.evaluate(`${backgroundToggle}.checked`, session)) await connection.evaluate(`${backgroundToggle}.click()`, session);
    await connection.evaluate(`${backgroundToggle}.click()`, session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=background-removal-status]")?.textContent?.includes("Preparing a transparent athlete cutout") ?? false', Boolean, 5_000);
    await connection.send('Page.navigate', { url: 'http://localhost:80/premium-appearance-fixture.html' }, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=button-layer-name-plate]")', Boolean, 10_000);
    await connection.evaluate(`window.exportBlob=null;const create=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{if(b.type==='image/png')window.exportBlob=b;return create(b)};HTMLAnchorElement.prototype.click=function(){};document.querySelector('[data-testid="button-export-appearance-png"]').click()`, session);
    await waitFor(connection, session, '!!window.exportBlob', Boolean, 30_000);
    const dimensions = await connection.evaluate(`(async()=>{const image=await createImageBitmap(window.exportBlob);return {width:image.width,height:image.height}})()`, session);
    assert.deepEqual(dimensions, { width: 2000, height: 2800 });
    if (process.env.PIXL_TEST_MODEL === '1') {
      await connection.evaluate('window.runRemoval(); true', session);
      await waitFor(connection, session, 'window.removalResult || null', Boolean, 190_000);
      const result = await connection.evaluate<{ error?: string; transparent: number; opaque: number }>('window.removalResult', session);
      assert.equal(result.error, undefined, JSON.stringify(result));
      assert.ok(result.transparent > 100 && result.opaque > 100, 'real inference must produce a visible subject on a transparent background');
    }
  } finally {
    connection?.close();
    if (!monitor.hasExited()) { browser.kill('SIGTERM'); await new Promise(resolve => browser.once('exit', resolve)); }
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    if (process.env.PIXL_KEEP_PREMIUM_FIXTURE !== '1') { await rm(html, { force: true }); await rm(entry, { force: true }); }
  }
});