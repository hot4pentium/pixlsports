import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { monitorProcess, waitForUrl } from './browser-test-diagnostics';

const elementKey = 'element-6066-11e4-a52e-4f735466cecf';

async function availablePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

/** Linux WebKitGTK engine coverage, not Apple Safari or an iPhone device test. */
export async function checkPairedHubInWebKit(appDirectory: string, fixturePath: string) {
  const processes: Array<{
    child: ReturnType<typeof spawn>;
    monitor: ReturnType<typeof monitorProcess>;
  }> = [];
  // Replit can inherit a different Mesa vendor from its host. Match the Nix
  // project's installed graphics provider instead, without pinning a store hash.
  const mesaLibrary = [...(process.env.NIX_LDFLAGS || '').matchAll(/-L(\S*mesa-\S*\/lib)(?:\s|$)/g)]
    .map(match => match[1])
    .find(path => existsSync(`${path}/../share/glvnd/egl_vendor.d/50_mesa.json`));
  assert.ok(mesaLibrary, 'Install the mesa Nix package before running Hub WebKit checks');
  let sessionPath: string | undefined;
  let origin = '';
  function launch(command: string, args: string[], env = process.env, cwd?: string) {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const monitor = monitorProcess(child, `Hub WebKit ${command}`);
    processes.push({ child, monitor });
    return { child, monitor };
  }
  async function command<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    assert.ok(response.ok && !result.value?.error,
      `WebKit ${path}: ${JSON.stringify(result)}; ${processes.map(p => p.monitor.diagnostics()).join('; ')}`);
    return result.value;
  }
  const evaluate = <T,>(expression: string) => command<T>('POST', `${sessionPath}/execute/sync`, {
    script: `return (${expression});`, args: [],
  });
  async function wait(expression: string) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`WebKit timed out: ${expression}; ${JSON.stringify(await evaluate(`({
      url:location.href, fixtureError:document.body.dataset.testError,
      hypeState:window.__hypePreviewState,
      state:document.querySelector('[data-testid="mobile-saved-hype-card"]')?.textContent
    })`))}`);
  }
  async function click(selector: string) {
    const element = await command<Record<string, string>>('POST', `${sessionPath}/element`, {
      using: 'css selector', value: selector,
    });
    await command('POST', `${sessionPath}/element/${element[elementKey]}/click`, {});
  }
  async function key(selector: string, value: string) {
    const element = await command<Record<string, string>>('POST', `${sessionPath}/element`, {
      using: 'css selector', value: selector,
    });
    await command('POST', `${sessionPath}/element/${element[elementKey]}/value`, { text: value });
  }
  async function enterViewport() {
    const frame = await command<Record<string, string>>('POST', `${sessionPath}/element`, {
      using: 'css selector', value: '#hub-viewport',
    });
    await command('POST', `${sessionPath}/frame`, { id: frame });
  }
  async function viewport(width: number) {
    // GTK's desktop window has a ~450px minimum. An iframe gives the app a
    // genuine CSS viewport at the requested width, without zoom or fake metrics.
    await command('POST', `${sessionPath}/frame`, { id: null });
    await evaluate(`document.querySelector('#hub-viewport').style.width='${width}px'`);
    await enterViewport();
    await wait(`document.documentElement.clientWidth===${width} && Math.abs(innerWidth-${width})<=1`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  async function inspectRow(label: string, design?: string) {
    const layout = await evaluate<Record<string, boolean>>(`(() => {
      const row = document.querySelector('[data-testid="mobile-calendar-hype-row"]');
      const event = row.children[0], slot = row.children[1];
      const a = event.getBoundingClientRect(), b = slot.getBoundingClientRect();
      const surface = slot.querySelector('.supporter-hype-preview__surface');
      const c = surface?.getBoundingClientRect();
      const graphic = event.querySelector('[data-testid="img-upcoming-event-card-mobile"]');
      const graphicRect = graphic?.getBoundingClientRect();
      const text = event.querySelector('[data-testid="upcoming-calendar-event-title"]');
      const title = text?.getBoundingClientRect();
      const svg = surface?.querySelector('svg[data-frame-template]');
      const svgBounds = svg?.getBoundingClientRect();
      const spillover = !surface || getComputedStyle(surface).overflow === 'hidden';
      const name = surface?.querySelector('.living-card-athlete-name');
      return {
        equal: Math.abs(a.width-b.width)<1,
        paired: Math.abs(a.top-b.top)<1 && a.right<=b.left,
        noOverflow: document.documentElement.scrollWidth<=innerWidth+1,
        graphicFits: !graphic || (graphic instanceof HTMLImageElement && graphic.complete && graphic.naturalWidth>0
          && !!graphicRect && graphicRect.left>=a.left && graphicRect.right<=a.right
          && graphicRect.top>=a.top && graphicRect.bottom<=a.bottom
          && Math.abs(graphicRect.width/graphicRect.height-graphic.naturalWidth/graphic.naturalHeight)<.01),
        noEventAction: !event.querySelector('a,button'),
        titleFits: !title || (title.left>=a.left && title.right<=a.right+1 && title.height>0),
        ratio: !c || Math.abs(c.width/c.height-3/4)<.01,
        nativeArt: !surface || (!!svg && Math.abs(svgBounds.width/svgBounds.height-3/4)<.01
          && Math.abs(svg.viewBox.baseVal.width/svg.viewBox.baseVal.height-3/4)<.01),
        spillover,
        typeSupported: CSS.supports('font-size','12cqw'),
        typeScales: !name || (parseFloat(getComputedStyle(name).fontSize)/c.width>.10
          && parseFloat(getComputedStyle(name).fontSize)/c.width<.14),
        noControls: !slot.querySelector('[data-testid="saved-card-navigation"] button'),
        safeState: !!surface || !slot.querySelector('svg image'),
      };
    })()`);
    if (!Object.values(layout).every(Boolean)) {
      console.log(await evaluate(`JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,
        svgParents:(()=>{const out=[];for(let n=document.querySelector('.living-card-simple-art image')?.parentElement;n;n=n.parentElement){
          const s=getComputedStyle(n);out.push([n.tagName,n.getAttribute('class'),s.overflowX,s.overflowY]);}return out;})(),
        type:{font:getComputedStyle(document.querySelector('.living-card-athlete-name')||document.body).fontSize,
          surface:document.querySelector('.supporter-hype-preview__surface')?.getBoundingClientRect().width,
          width:getComputedStyle(document.querySelector('.supporter-hype-preview__surface')||document.body).width,
          container:getComputedStyle(document.querySelector('.supporter-hype-preview__surface')||document.body).containerType},
        nodes:[...document.querySelectorAll('[data-testid="mobile-calendar-hype-row"] *')]
          .filter(n=>n.getBoundingClientRect().right>innerWidth)
          .map(n=>({tag:n.tagName,cls:n.className,text:n.textContent?.slice(0,90),rect:n.getBoundingClientRect().toJSON()})).slice(0,20)})`));
      const screenshot = await command<string>('GET', `${sessionPath}/screenshot`);
      await writeFile('/tmp/supporter-hub-webkit-failure.png', Buffer.from(screenshot, 'base64'));
    }
    assert.ok(Object.values(layout).every(Boolean), `${label}: ${JSON.stringify(layout)}`);
    if (design) assert.equal(await evaluate(`document.querySelector('.supporter-hype-preview__surface')?.dataset.design`), design);
  }
  async function inspectNames(selector: string, label: string) {
    const bounds = await evaluate(`(() => {
      const svg = document.querySelector('${selector}');
      const nameLines = [...svg.querySelectorAll('[data-testid="svg-card-athlete-name"]')];
      if (!nameLines.length) return {text:'',lines:[]};
      return {
        text:nameLines.map(line=>line.textContent || '').join(' '),
        lines:nameLines.map(line=>{
          const b=line.getBBox();
          return {x:b.x,y:b.y,width:b.width,height:b.height,
            fits:b.width>0 && b.height>0 && b.x>=65 && b.x+b.width<=655
              && b.y>=800 && b.y+b.height<=1100};
        }),
      };
    })()`) as { text: string; lines: Array<{ fits: boolean }> };
    assert.equal(bounds.text, 'ALEXANDRIA MONTGOMERY-WILLIAMS', `${label}: full name preserved`);
    assert.ok(bounds.lines.length && bounds.lines.every(line => line.fits), `${label}: ${JSON.stringify(bounds)}`);
  }
  async function inspectRasterExport(label: string) {
    const result = await command<{ fits: boolean; pixels: number; error?: string }>('POST', `${sessionPath}/execute/async`, {
      script: `const done=arguments[arguments.length-1];
        (async () => {
          const svg=document.querySelector('#premium-name-export-check svg');
          const view=svg.viewBox.baseVal;
          const plate={x:65,y:800,width:590,height:310};
          const canvas=document.createElement('canvas');
          canvas.width=1800; canvas.height=Math.round(view.height*2);
          const context=canvas.getContext('2d');
          const raster=async markup=>{
            const image=new Image();
            image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markup);
            await image.decode();
            context.clearRect(0,0,canvas.width,canvas.height);
            context.drawImage(image,0,0,canvas.width,canvas.height);
          };
          // Rasterize the real export first, including independently rendered foregrounds.
          await raster(new XMLSerializer().serializeToString(svg));
          if (!canvas.toDataURL('image/png').startsWith('data:image/png;base64,')) throw Error('PNG unavailable');
          // Isolate its actual name text to measure painted pixels, not font layout boxes.
          const names=svg.cloneNode(false);
          names.removeAttribute('style');
          for(const name of svg.querySelectorAll('[data-testid="svg-card-athlete-name"]')) names.append(name.cloneNode(true));
          await raster(new XMLSerializer().serializeToString(names));
          const data=context.getImageData(0,0,canvas.width,canvas.height).data;
          let pixels=0, fits=true;
          for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
            if(data[(y*canvas.width+x)*4+3]>20){
              pixels++;
              const nx=x/2, ny=y/2+view.y;
              fits=fits && nx>=plate.x && nx<=plate.x+plate.width
                && ny>=plate.y && ny<=plate.y+plate.height;
            }
          }
          return {fits,pixels};
        })().then(done,error=>done({error:String(error)}));`,
      args: [],
    });
    assert.ok(!result.error && result.fits && result.pixels > 100, `${label}: ${JSON.stringify(result)}`);
  }
  try {
    // A fresh virtual display avoids depending on an interactive desktop.
    const display = launch('Xvfb', ['-displayfd', '1', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp']);
    const displayNumber = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(display.monitor.diagnostics())), 10_000);
      display.child.once('error', error => { clearTimeout(timer); reject(error); });
      display.child.stdout!.on('data', chunk => {
        output += String(chunk);
        if (/^\d+\n/.test(output)) { clearTimeout(timer); resolve(output.trim()); }
      });
    });
    const port = await availablePort();
    const viteEnvironment: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), BASE_PATH: '/' };
    delete viteEnvironment.REPL_ID;
    // Only this isolated fixture server uses the existing Clerk test alias.
    // The managed app still uses its real Clerk provider and auth guards.
    const vite = launch('pnpm', ['exec', 'vite', '--config', 'vite.account-lifecycle-browser.config.ts', '--host', '127.0.0.1'],
      viteEnvironment, appDirectory);
    await waitForUrl(`http://127.0.0.1:${port}/`, 30_000, vite.monitor);
    origin = `http://127.0.0.1:${await availablePort()}`;
    const driver = launch('WebKitWebDriver', [`--port=${new URL(origin).port}`, '--host=127.0.0.1'], {
      ...process.env, DISPLAY: `:${displayNumber}`, WEBKIT_DISABLE_DMABUF_RENDERER: '1', LIBGL_ALWAYS_SOFTWARE: '1',
      __EGL_VENDOR_LIBRARY_FILENAMES: `${mesaLibrary}/../share/glvnd/egl_vendor.d/50_mesa.json`,
      LIBGL_DRIVERS_PATH: `${mesaLibrary}/dri`,
    });
    await waitForUrl(`${origin}/status`, 15_000, driver.monitor);
    const session = await command<{ sessionId: string; capabilities: { browserVersion: string } }>('POST', '/session', {
      capabilities: { alwaysMatch: { browserName: 'MiniBrowser' } },
    });
    sessionPath = `/session/${session.sessionId}`;
    console.log(`Linux WebKitGTK ${session.capabilities.browserVersion}; Apple Safari device not available`);
    const url = `http://127.0.0.1:${port}/${fixturePath}`;
    await command('POST', `${sessionPath}/window/rect`, { width: 600, height: 1000 });
    await command('POST', `${sessionPath}/url`, { url });
    await enterViewport();
    await wait(`document.querySelector('[data-testid="mobile-saved-hype-card"] [role="status"]')?.textContent.includes('Loading')`);
    for (const width of [320, 360, 390, 430]) {
      await viewport(width);
      await inspectRow(`loading at ${width}px`);
    }
    await evaluate(`(window.__releaseHypeLoading(), true)`);
    await wait(`!!document.querySelector('[data-testid="link-mobile-hype-preview"]')`);
    await evaluate(`window.__setSupporterDashboardEvents([{
      id:'game-1', type:'game', date:new Date(Date.now()+86400000).toISOString().slice(0,10),
      time:'18:30', opponent:'The Westside Championship Invitational All Stars Montgomery-Williams',
      location:'Northside Community Recreation Center Championship Court Entrance B'
    }])`);
    await wait(`document.querySelector('[data-testid="upcoming-calendar-event-title"]')?.textContent.includes('Westside')`);
    for (const design of ['velocity', 'wave', 'glass', 'varsity', 'spotlight', 'pixel-edge']) {
      await evaluate(`(window.__setHypePreviewState('${design}'), true)`);
      await wait(`document.querySelector('.supporter-hype-preview__surface')?.dataset.design==='${design}'`);
      for (const width of [320, 360, 390, 430]) {
        await viewport(width);
        await inspectRow(`${design} at ${width}px with long event details`, design);
        await inspectNames('.supporter-hype-preview__surface svg', `${design} live ${width}px`);
        for (const layer of ['all', 'fg']) {
          await evaluate(`(() => {
            const output=window.__premiumNameExport('${design}','${layer}');
            const host=document.createElement('div'); host.id='premium-name-export-check';
            host.style.cssText='position:absolute;left:0;top:1700px;width:${width}px';
            host.innerHTML=output.markup;
            host.querySelector('svg').style.cssText='width:100%;height:auto';
            document.body.append(host);
            return true;
          })()`);
          await inspectNames('#premium-name-export-check svg', `${design} ${layer} export ${width}px`);
          if (width === 390) await inspectRasterExport(`${design} ${layer} rasterized PNG`);
          await evaluate(`(document.querySelector('#premium-name-export-check').remove(), true)`);
        }
        if (width === 320 || width === 390) {
          const screenshot = await command<string>('GET', `${sessionPath}/screenshot`);
          await writeFile(`/tmp/supporter-hub-webkit-${design}-${width}.png`, Buffer.from(screenshot, 'base64'));
        }
      }
    }
    for (const state of ['empty', 'mismatch', 'paused', 'hidden', 'error']) {
      await evaluate(`(window.__setHypePreviewState('${state}'), true)`);
      await wait(`!document.querySelector('[data-testid="link-mobile-hype-preview"]')`);
      const copy = state === 'error' ? 'couldn’t load' : state === 'paused' ? 'paused'
        : state === 'hidden' ? 'hidden' : state === 'mismatch' ? 'different athlete details' : 'belongs here';
      await wait(`document.querySelector('[data-testid="mobile-saved-hype-card"]')?.textContent.includes('${copy}')`);
      for (const width of [320, 360, 390, 430]) {
        await viewport(width);
        await inspectRow(`${state} at ${width}px`);
      }
    }
    await evaluate(`(window.__hypePreviewState='velocity', localStorage.setItem('hype-preview-fixture','"velocity"'))`);
    await click('[data-testid="mobile-saved-hype-card"] button');
    await wait(`!!document.querySelector('[data-testid="link-mobile-hype-preview"]')`);
    const previewPath = await evaluate('location.pathname');
    assert.equal(await evaluate(`document.querySelector('[data-testid="link-mobile-hype-preview"]').tabIndex`), -1);
    assert.equal(await evaluate(`document.querySelector('[data-testid="link-mobile-hype-preview"]').getAttribute('href')`), null);
    await click('[data-testid="link-mobile-hype-preview"]');
    assert.equal(await evaluate('location.pathname'), previewPath, 'dashboard artwork does not navigate');
  } finally {
    if (sessionPath) await command('DELETE', sessionPath).catch(() => undefined);
    for (const { child, monitor } of processes.reverse()) {
      if (!monitor.hasExited()) child.kill('SIGTERM');
      await monitor.waitForExit();
    }
  }
}