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
import{buildPremiumHypeCardArtwork,preparePremiumCardPngExport}from'./src/features/premium-hype-card-artwork';
import photo from './src/assets/hypecard-player-photo-640.webp';
import cutout from './src/assets/youth-football-player-cutout.png';
import './src/index.css';
import './src/features/living-athlete-card.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
let saved=JSON.parse(localStorage.getItem('premium-test-settings')||'null')||defaultCardAppearance(new URLSearchParams(location.search).has('classic-preview')?'classic':new URLSearchParams(location.search).has('spotlight-preview')?'spotlight':'gallery');
if(new URLSearchParams(location.search).has('nameplate-overlap'))saved={...saved,athleteY:.12,athleteScale:1.2};
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
window.fixturePhotoUrl=photo;window.fixtureCutoutUrl=cutout;
window.verifyGalleryPlate=async()=>{
 const appearance={...defaultCardAppearance('gallery'),athleteY:.12};
 const blue='data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="760" height="900"><rect width="760" height="900" fill="blue"/></svg>');
 const samples=[];
 for(const layer of ['all','fg']){
  const svg=buildPremiumHypeCardArtwork({athleteName:'Kimberly',teamName:'Falcons',cutoutUrl:blue,appearance},layer);
  const png=preparePremiumCardPngExport(svg,appearance,{width:760,height:900});
  const image=new Image();const loaded=new Promise((ok,bad)=>{image.onload=ok;image.onerror=bad});
  image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(png.markup);await loaded;
  const canvas=document.createElement('canvas');canvas.width=png.width;canvas.height=png.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,canvas.width,canvas.height);
  samples.push({layer,pixel:[...ctx.getImageData(1000,2136,1,1).data],avatarPixel:[...ctx.getImageData(1000,1800,1,1).data]});
 }
 return samples;
};
 function Card({design}){const a={...defaultCardAppearance(design),jerseyNumber:'9',position:'Quarterback'};const below=true;const controls=<div className="living-card-controls">{['Replies','Stats','Taps','Events'].map(s=><button className="living-card-control" key={s}>{s}</button>)}</div>;
 if(new URLSearchParams(location.search).has('spillover')){a.athleteScale=1.45;a.athleteY=-.08;}
  return <div className="living-card-stage" data-design={design}><div className="living-card-frame-outer"><section className="living-card-frame" data-design={design} data-side="front" style={{position:'relative',width:'100%',aspectRatio:'1000/1400'}}><div className="living-card-flip-inner"><div className="living-card-flip-face living-card-flip-front"><LivingAthleteCardFront athleteName={invite.athleteName} teamName={invite.teamName} sport={invite.sport} appearance={a} photoUrl={photo} cutoutUrl={cutout}/></div></div>{!below&&controls}</section></div>{below&&controls}</div>}
   function App(){return <div style={{background:'#07172b',color:'white',minHeight:'100vh',padding:20,paddingTop:new URLSearchParams(location.search).has('spillover')?240:20}}><h1 style={{fontSize:24,marginBottom:16}}>HYPE Card design verification</h1><div style={{display:new URLSearchParams(location.search).has('classic-preview')||new URLSearchParams(location.search).has('gallery-preview')||new URLSearchParams(location.search).has('spotlight-preview')?'none':'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',maxWidth:1000,margin:'auto',gap:24,justifyContent:'center'}}><Card design="classic"/><Card design="gallery"/><Card design="spotlight"/><Card design="breakout"/></div><div style={{maxWidth:960,margin:'32px auto'}}><FanCardAppearanceManager invite={invite} profile={profile}/></div></div>}
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
    const assertClassicPreview = async () => {
      const layout = await connection!.evaluate<{ fills: boolean; lowerThird: boolean; navBelow: boolean; name: string; labels: string[] }>(`(()=>{
        const card=document.querySelector('[data-testid="classic-card-preview-surface"]'),photo=card?.querySelector('img'),name=card?.querySelector('.living-card-athlete-name'),nav=document.querySelector('[data-testid="classic-card-preview-stack"] [data-testid="appearance-navigation-preview"]');
        if(!card||!photo||!name||!nav)throw new Error('Classic preview is incomplete');
        const c=card.getBoundingClientRect(),p=photo.getBoundingClientRect(),n=name.getBoundingClientRect();
        return {fills:Math.abs(c.left-p.left)<=2&&Math.abs(c.right-p.right)<=2&&Math.abs(c.top-p.top)<=2&&Math.abs(c.bottom-p.bottom)<=2&&getComputedStyle(photo).objectFit==='cover',
          lowerThird:n.top>=c.top+c.height*.6&&n.bottom<=c.bottom,navBelow:nav.getBoundingClientRect().top>=c.bottom,name:name.textContent,labels:[...nav.querySelectorAll('span')].map(s=>s.textContent)};
      })()`, session);
      assert.ok(layout.fills, 'the original Classic photo fills the card edge-to-edge');
      assert.ok(layout.lowerThird, 'the Classic athlete name sits in the lower third');
      assert.ok(layout.navBelow, 'Classic preview navigation sits beneath the card');
      assert.equal(layout.name, 'Jordan Alexander Matthews');
      assert.deepEqual(layout.labels, ['Replies', 'Stats', 'Taps', 'Events']);
    };
    await waitFor(connection, session, '!!document.querySelector("[data-testid=fan-card-appearance-manager]")', Boolean, 45_000);
    const desktopStageRatios = await connection.evaluate(`Array.from(document.querySelectorAll('.living-card-stage[data-design]')).map(stage=>{const track=parseFloat(getComputedStyle(stage.parentElement).gridTemplateColumns.split(' ')[0]);return stage.getBoundingClientRect().width/track})`, session) as number[];
    assert.equal(desktopStageRatios.length, 4, 'all four HYPE Card designs are present in the width check');
    assert.ok(desktopStageRatios.every(ratio => ratio >= 0.90 && ratio <= 0.94), `desktop cards are about 8% narrower: ${desktopStageRatios.join(', ')}`);
    assert.equal(await connection.evaluate(`getComputedStyle(document.querySelector('[data-testid="card-design-picker-cards"]')).display`, session), 'block', 'desktop keeps the full design picker');
    assert.equal(await connection.evaluate(`getComputedStyle(document.querySelector('[data-testid="mobile-card-design-controls"]')).display`, session), 'none', 'the compact picker is reserved for phones');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="appearance-preview-surface"] svg')?.contains(document.querySelector('[data-testid="appearance-preview-surface"] #export-nav') || document.createElement('span'))`, session), false, 'designer navigation dressing is no longer painted inside the card');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="appearance-preview"] > [data-testid="premium-card-preview-stack"] [data-testid="appearance-navigation-preview"] svg')?.textContent.includes('EVENTS')`, session), true, 'the separately displayed nav strip retains the designer styling and labels');
    const assertGalleryFrame = async () => {
      const bounds = await connection!.evaluate<Array<{ taller: boolean; feetClear: boolean; textClear: boolean }>>(`[
        document.querySelector('.living-card-frame[data-design="gallery"] .living-card-premium-art'),
        document.querySelector('[data-testid="appearance-preview-surface"]')
      ].map(root=>{
        const f=root.querySelector('[data-gallery-photo-frame]').getBoundingClientRect(),a=root.querySelector('[data-photo-placement="cutout"] image').getBoundingClientRect();
        const texts=[...root.querySelectorAll('text[x="500"]')].map(t=>t.getBoundingClientRect());
        return {taller:f.height/f.width>1.06,feetClear:a.bottom<=f.bottom-f.width*.08,textClear:texts.every(t=>t.top>f.bottom&&t.width>0)};
      })`, session);
      for (const layout of bounds) {
        assert.ok(layout.taller, 'Gallery has a taller portrait frame in both preview and live artwork');
        assert.ok(layout.feetClear, 'Gallery leaves space below the avatar feet and shadow');
        assert.ok(layout.textClear, 'Gallery identity text sits below the extended photo frame');
      }
    };
    await assertGalleryFrame();
    const platePixels = await connection.evaluate<Array<{ layer: string; pixel: number[]; avatarPixel: number[] }>>('window.verifyGalleryPlate()', session);
    for (const sample of platePixels) {
      assert.deepEqual(sample.pixel, [246, 239, 226, 255], `${sample.layer} PNG name panel hides the avatar beneath its solid ivory fill`);
      assert.deepEqual(sample.avatarPixel, [0, 0, 255, 255], `${sample.layer} test avatar renders visibly above the name panel`);
    }
    assert.equal(await connection.evaluate(`(()=>{const card=document.querySelector('[data-testid="appearance-preview-surface"]').getBoundingClientRect(),nav=document.querySelector('[data-testid="appearance-navigation-preview"]').getBoundingClientRect();return nav.top>=card.bottom})()`, session), true, 'the designer nav strip is fully below, not overlaid on, the card');
    const breakoutFrame = await connection.evaluate<{ radius: string; padding: string; border: string; background: string; shadow: string }>(`(()=>{const frame=document.querySelector('.living-card-frame-outer:has(.living-card-frame[data-design="breakout"])'),style=getComputedStyle(frame);return {radius:style.borderTopLeftRadius,padding:style.paddingTop,border:style.borderTopWidth,background:style.backgroundImage,shadow:style.boxShadow}})()`, session);
    assert.equal(breakoutFrame.radius, '0px', 'the outer wrapper does not add a second frame');
    assert.equal(breakoutFrame.padding, '0px', 'the outer wrapper adds no blue spacing around the metal');
    assert.equal(breakoutFrame.border, '0px', 'the outer wrapper has no visible border');
    assert.equal(breakoutFrame.background, 'none', 'the light-blue wrapper is removed');
    assert.equal(breakoutFrame.shadow, 'none', 'the wrapper adds no frame shadow');
    const flipBackdrop = await connection.evaluate<{ image: string; color: string }>(`(()=>{const style=getComputedStyle(document.querySelector('.living-card-frame[data-design="breakout"] .living-card-flip-front'));return {image:style.backgroundImage,color:style.backgroundColor}})()`, session);
    assert.equal(flipBackdrop.image, 'none', 'the real flip-front container adds no rectangular blue backdrop');
    assert.equal(flipBackdrop.color, 'rgba(0, 0, 0, 0)', 'the area outside the silver outline stays transparent');
    const savedAvatarContainers = await connection.evaluate(`(()=>{const svg=document.querySelector('.living-card-frame[data-design="breakout"] .living-card-premium-art > svg');const containers=[];for(let node=svg;node && !node.classList.contains('living-card-frame-outer');node=node.parentElement){const style=getComputedStyle(node);containers.push({element:node.tagName+':'+node.classList.toString(),x:style.overflowX,y:style.overflowY});}return containers;})()`, session) as Array<{ element: string; x: string; y: string }>;
    for (const container of savedAvatarContainers) {
      assert.equal(container.x, 'visible', `${container.element} must not crop the saved avatar horizontally`);
      assert.equal(container.y, 'visible', `${container.element} must not crop the saved avatar vertically`);
    }
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="input-card-jersey"]').value`, session), '9', 'the profile jersey number fills a blank appearance');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="input-card-position"]').value`, session), 'Quarterback', 'the profile position fills a blank appearance');
    assert.match(await connection.evaluate(`document.querySelector('[data-testid="appearance-preview-surface"]').getAttribute('aria-label')`, session), /Jordan Alexander Matthews/, 'the card preview uses the profile-derived athlete name');
    await connection.evaluate(`document.querySelector('[data-testid="button-design-classic"]').click()`, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=appearance-preview] img")', Boolean, 5_000);
    const classicPreviewSources = await connection.evaluate<{ rendered: string | null; live: string | null; photo: string; cutout: string }>(`(()=>({rendered:document.querySelector('[data-testid="appearance-preview"] img')?.getAttribute('src')??null,live:document.querySelector('.living-card-frame[data-design="classic"] .living-card-photo')?.getAttribute('src')??null,photo:window.fixturePhotoUrl,cutout:window.fixtureCutoutUrl}))()`, session);
    assert.equal(classicPreviewSources.rendered, classicPreviewSources.photo, 'Classic uses the full original photo');
    assert.equal(classicPreviewSources.live, classicPreviewSources.photo, 'the live Classic card uses the full original photo');
    assert.notEqual(classicPreviewSources.rendered, classicPreviewSources.cutout, 'Classic does not use the background-removed cutout');
    await assertClassicPreview();
    await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').click()`, session);
    await waitFor(connection, session, 'JSON.parse(localStorage.getItem("premium-test-settings")||"{}").design', value => value === 'classic', 5_000);
    await connection.send('Page.navigate', { url: 'http://localhost:80/premium-appearance-fixture.html' }, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=classic-card-preview-surface] img")', Boolean, 10_000);
    await assertClassicPreview();
    await connection.evaluate(`document.querySelector('[data-testid="button-design-breakout"]').click()`, session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=appearance-preview-surface] svg")?.getAttribute("data-design")', value => value === 'breakout', 5_000);
    assert.equal(await connection.evaluate(`getComputedStyle(document.querySelector('[data-testid="appearance-preview-surface"] > svg')).overflow`, session), 'visible', 'the editor does not crop the avatar at its SVG viewport when resizing');
    assert.deepEqual(await connection.evaluate(`Array.from(document.querySelector('[data-testid="appearance-preview-surface"] svg > g[id$="breakout-fg"]').children).map(g=>g.getAttribute('data-card-layer'))`, session), ['frame', 'avatar', 'name-plate'], 'the editor paints the avatar over the frame while preserving the nameplate');
    assert.equal(await connection.evaluate(`getComputedStyle(document.querySelector('.living-card-frame[data-design="breakout"] .living-card-premium-art > svg')).overflow`, session), 'visible', 'the live card also permits avatar spillover');
    await connection.evaluate(`document.querySelector('[data-testid="button-design-spotlight"]').click()`, session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=appearance-preview-surface] svg")?.getAttribute("data-design")', value => value === 'spotlight', 5_000);
    const assertSpotlightNumber = async () => {
      const number = await connection!.evaluate<{ loaded: number; styles: Array<{ font: string; weight: string; stroke: string; width: string; behind: boolean }> }>(`(async()=>{
        const fonts=await document.fonts.load('400 72px Anton','09');
        const roots=[document.querySelector('.living-card-frame[data-design="spotlight"] .living-card-premium-art'),document.querySelector('[data-testid="appearance-preview-surface"]')];
        return {loaded:fonts.length,styles:roots.map(root=>{const n=root.querySelector('[data-jersey-number]'),s=getComputedStyle(n),avatar=root.querySelector('[data-photo-placement]');
          return {font:s.fontFamily,weight:s.fontWeight,stroke:s.stroke,width:s.strokeWidth,behind:!!(n.compareDocumentPosition(avatar)&Node.DOCUMENT_POSITION_FOLLOWING)};})};
      })()`, session);
      assert.ok(number.loaded > 0, 'the bundled Anton font loads, not just a fallback');
      for (const style of number.styles) {
        assert.match(style.font, /^Anton/);
        assert.equal(style.weight, '400');
        assert.equal(style.stroke, 'rgb(246, 239, 226)');
        assert.equal(style.width, '8px');
        assert.ok(style.behind, 'the outlined number stays behind the avatar');
      }
    };
    await assertSpotlightNumber();
    await connection.evaluate(`(()=>{
      window.spotlightExportBlob=null;window.spotlightExportMarkup=null;
      window.originalSpotlightImage=window.Image;window.originalSpotlightUrl=URL.createObjectURL;window.originalSpotlightClick=HTMLAnchorElement.prototype.click;
      window.Image=class extends window.originalSpotlightImage {set src(v){if(v.startsWith('data:image/svg+xml'))window.spotlightExportMarkup=decodeURIComponent(v.slice(v.indexOf(',')+1));super.src=v;}get src(){return super.src;}};
      URL.createObjectURL=b=>{if(b.type==='image/png')window.spotlightExportBlob=b;return window.originalSpotlightUrl.call(URL,b);};
      HTMLAnchorElement.prototype.click=function(){};
      document.querySelector('[data-testid="button-export-appearance-png"]').click();
    })()`, session);
    await waitFor(connection, session, '!!window.spotlightExportBlob', Boolean, 30_000);
    const spotlightExport = await connection.evaluate<{ embedsAnton: boolean; width: number; height: number }>(`(async()=>{
      const image=await createImageBitmap(window.spotlightExportBlob),markup=window.spotlightExportMarkup;
      const result={embedsAnton:markup.includes("@font-face{font-family:'Anton';src:url(\\"data:")&&markup.includes("format('truetype')")&&markup.includes('data-jersey-number'),width:image.width,height:image.height};
      image.close();window.Image=window.originalSpotlightImage;URL.createObjectURL=window.originalSpotlightUrl;HTMLAnchorElement.prototype.click=window.originalSpotlightClick;return result;
    })()`, session);
    assert.deepEqual(spotlightExport, { embedsAnton: true, width: 2000, height: 2800 }, 'Spotlight PNG export embeds Anton and renders successfully');
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
    await assertSpotlightNumber();
    const mobile = await connection.evaluate<{ contained: boolean; tap: boolean; compactPickerVisible: boolean; fullPickerHidden: boolean; inline: boolean; designChoices: number; stageRatios: number[] }>(`(()=>{const card=document.querySelector('[data-testid="appearance-preview"]').getBoundingClientRect(),picker=document.querySelector('[data-testid="mobile-card-design-controls"]'),pickerBox=picker.getBoundingClientRect(),stageRatios=Array.from(document.querySelectorAll('.living-card-stage[data-design]')).map(stage=>{const track=parseFloat(getComputedStyle(stage.parentElement).gridTemplateColumns.split(' ')[0]);return stage.getBoundingClientRect().width/track});return {contained:document.documentElement.scrollWidth<=390,tap:[...document.querySelectorAll('.living-card-controls button')].every(b=>b.getBoundingClientRect().height>=44),compactPickerVisible:getComputedStyle(picker).display!=='none',fullPickerHidden:getComputedStyle(document.querySelector('[data-testid="card-design-picker-cards"]')).display==='none',inline:card.right<=pickerBox.left+2&&Math.min(card.bottom,pickerBox.bottom)>Math.max(card.top,pickerBox.top),designChoices:picker.querySelectorAll('button').length,stageRatios}})()`, session);
    assert.ok(mobile.contained, 'phone content must not horizontally overflow');
    assert.ok(mobile.tap, 'navigation retains 44px touch targets');
    assert.ok(mobile.compactPickerVisible && mobile.fullPickerHidden, 'phones show the compact picker instead of the full design cards');
    assert.ok(mobile.inline, 'the compact design buttons sit beside the HYPE Card preview');
    assert.equal(mobile.designChoices, 4, 'all card designs remain available on phones');
    assert.ok(mobile.stageRatios.length === 4 && mobile.stageRatios.every(ratio => ratio >= 0.90 && ratio <= 0.94), `all four mobile HYPE Card designs are about 8% narrower: ${mobile.stageRatios.join(', ')}`);
    await connection.evaluate(`document.querySelector('[data-testid="button-design-compact-classic"]').click()`, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=classic-card-preview-surface] img")', Boolean, 5_000);
    await assertClassicPreview();
    await connection.evaluate(`document.querySelector('[data-testid="button-design-compact-gallery"]').click()`, session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=appearance-preview-surface] svg")?.getAttribute("data-design")', value => value === 'gallery', 5_000);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-design-compact-gallery"]').getAttribute('aria-pressed')`, session), 'true', 'the selected mobile button tracks the preview');
    await assertGalleryFrame();
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-save-appearance"]').disabled`, session), false, 'the existing Save design action persists the selected draft');
      const framing = await connection.evaluate(`Array.from(document.querySelectorAll('section.living-card-frame')).filter(card=>card.dataset.design!=='classic').every(card => {
       const box=card.getBoundingClientRect(), nav=card.closest('.living-card-stage').querySelector('.living-card-controls').getBoundingClientRect(), below=card.dataset.design==='gallery'||card.dataset.design==='spotlight'||card.dataset.design==='breakout';
      const details=Array.from(card.querySelectorAll('svg text')).filter(t=>t.textContent.includes('QUARTERBACK'));
      return Math.abs(box.height/box.width-1.4)<.02 && (below?nav.top>=box.bottom:nav.bottom<=box.bottom) && details.every(t=>t.getBoundingClientRect().bottom<=nav.top);
    })`, session);
     assert.ok(framing, 'Gallery, Spotlight, and Breakout navigation sit below the card without covering identity text');
    const breakoutCutoutOverhang = await connection.evaluate(`(()=>{const athlete=document.querySelector('[data-design="breakout"] [data-photo-placement] image');return !!athlete&&athlete.y.baseVal.value<92})()`, session);
    assert.ok(breakoutCutoutOverhang, 'Breakout cutout begins above its smaller stadium frame');
     await connection.send('Page.navigate', { url: 'http://localhost:80/premium-appearance-fixture.html?spillover=1' }, session);
      await waitFor(connection, session, 'document.querySelectorAll("section.living-card-frame").length', value => value === 4, 10_000);
      const fullPortraitSpillover = await connection.evaluate(`Array.from(document.querySelectorAll('section.living-card-frame:not([data-design="classic"])')).map(card=>{const svg=card.querySelector('.living-card-premium-art > svg'),image=card.querySelector('[data-photo-placement] image');if(!svg||!image)return{design:card.dataset.design,valid:false,reason:'missing svg/image'};const svgTop=svg.getBoundingClientRect().top,imageTop=image.getBoundingClientRect().top,overflow=getComputedStyle(svg).overflow;let parent=svg.parentElement,clip=null;while(parent&&!parent.classList.contains('living-card-stage')){const style=getComputedStyle(parent);if(style.overflowX!=='visible'||style.overflowY!=='visible'){clip={element:parent.tagName+':'+parent.classList.toString(),x:style.overflowX,y:style.overflowY};break;}parent=parent.parentElement;}return{design:card.dataset.design,valid:overflow==='visible'&&!clip&&imageTop<svgTop-1,overflow,svgTop,imageTop,clip};})`, session);
     assert.ok(fullPortraitSpillover.every((card: { valid: boolean }) => card.valid), `every premium avatar should extend above its SVG without clipping: ${JSON.stringify(fullPortraitSpillover)}`);
     await connection.send('Page.navigate', { url: 'http://localhost:80/premium-appearance-fixture.html' }, session);
      await waitFor(connection, session, 'document.querySelectorAll("section.living-card-frame").length', value => value === 4, 10_000);
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
    await connection.evaluate(`document.querySelector('[data-testid="button-layer-name-plate"]').click()`, session);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-reposition-mode"]').getAttribute('aria-pressed')`, session), 'true', 'selecting the name plate immediately activates the move tool');
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
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-reposition-mode"]').getAttribute('aria-pressed')`, session), 'false', 'selecting the locked frame turns the move tool off');
    await connection.evaluate(`document.querySelector('[data-testid="button-layer-avatar"]').click()`, session);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-reposition-mode"]').getAttribute('aria-pressed')`, session), 'true', 'selecting the avatar immediately activates the move tool');
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="appearance-preview-surface"]').tabIndex`, session), 0, 'the selected movable layer enables keyboard positioning');
    await connection.evaluate(`document.querySelector('[data-testid="button-layer-name-plate"]').click()`, session);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-reposition-mode"]').getAttribute('aria-pressed')`, session), 'true', 'switching between movable layers keeps the move tool active');
    await connection.evaluate(`document.querySelector('[data-testid="button-reposition-mode"]').click()`, session);
    assert.equal(await connection.evaluate(`document.querySelector('[data-testid="button-reposition-mode"]').getAttribute('aria-pressed')`, session), 'false', 'Done positioning still exits move mode');
    await connection.send('Page.navigate', { url: 'http://localhost:80/premium-appearance-fixture.html?fallback=1' }, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=button-remove-card-background]")', Boolean, 10_000);
    if (await connection.evaluate(`${backgroundToggle}.checked`, session)) await connection.evaluate(`${backgroundToggle}.click()`, session);
    await connection.evaluate(`${backgroundToggle}.click()`, session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=background-removal-status]")?.textContent?.includes("Preparing a transparent athlete cutout") ?? false', Boolean, 5_000);
    await connection.send('Page.navigate', { url: 'http://localhost:80/premium-appearance-fixture.html' }, session);
    await waitFor(connection, session, '!!document.querySelector("[data-testid=button-layer-name-plate]")', Boolean, 10_000);
    await connection.evaluate(`document.querySelector('[data-testid="button-design-compact-breakout"]').click()`, session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=appearance-preview-surface] svg")?.getAttribute("data-design")', value => value === 'breakout', 5_000);
    await connection.evaluate(`window.exportBlob=null;const create=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{if(b.type==='image/png')window.exportBlob=b;return create(b)};HTMLAnchorElement.prototype.click=function(){};document.querySelector('[data-testid="button-export-appearance-png"]').click()`, session);
    await waitFor(connection, session, '!!window.exportBlob', Boolean, 30_000);
    const exportInfo = await connection.evaluate(`(async()=>{const image=await createImageBitmap(window.exportBlob);return {width:image.width,height:image.height}})()`, session);
    assert.deepEqual(exportInfo, { width: 2000, height: 2800 }, 'the square fixture avatar fits its existing card viewport');
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