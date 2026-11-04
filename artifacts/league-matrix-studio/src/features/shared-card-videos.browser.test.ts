import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseHttpByteRange } from '../../../api-server/src/lib/httpByteRange';
import { DevToolsConnection, monitorProcess, openPage, waitForUrl } from './browser-test-diagnostics';
import { sharedCardVideosFixture } from './shared-card-videos-browser-fixture';
import { freeVideoTestPort, videoWebKitBrowser, type VideoBrowser } from './shared-card-videos-webkit';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputDirectory = resolve(appDirectory, '../../generated-artifacts/shared-card-videos');
const select = (id: string) => `[data-testid="${id}"]`;
const player = `document.querySelector('video')`;

async function wait(browser: VideoBrowser, expression: string, label = expression) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (await browser.evaluate(expression)) return;
    await new Promise(done => setTimeout(done, 100));
  }
  throw Error(`Timed out: ${label}; ${await browser.evaluate(`JSON.stringify({
    text:document.body.innerText.slice(0,1600),url:location.href,
    media:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,paused:v.paused,error:v.error?.code,ready:v.readyState}))
  })`)}; ${browser.diagnostics?.() || ''}`);
}

async function playbackJourney(browser: VideoBrowser, url: string, engine: string) {
  await browser.navigate(`${url}?empty`);
  await wait(browser, `!!document.querySelector('${select('button-living-card-videos')}')`);
  assert.equal(await browser.evaluate('document.documentElement.clientWidth'), 390);
  const tab = async (side: string) => {
    await browser.click(select(`button-living-card-${side}`));
    await wait(browser, `document.querySelector('[data-testid="living-card-flip-container"]')?.dataset.selectedSide==='${side}'`);
    // A pressed tab precedes the end of its 3D animation.
    await new Promise(done => setTimeout(done, 550));
  };
  await tab('videos');
  await wait(browser, `!!document.querySelector('${select('living-card-videos-empty')}')`);
  assert.equal(await browser.evaluate('document.querySelectorAll("video").length'), 0);
  await browser.navigate(url);
  await wait(browser, `!!document.querySelector('${select('button-living-card-videos')}')`);
  await tab('videos');
  const play = async () => {
    await browser.click(select('button-living-card-video-real-clip'));
    await wait(browser, `${player}?.currentTime>0.35 && !${player}.paused`, `${engine}: actual decoded playback`);
    assert.equal(await browser.evaluate(`${player}.playsInline && ${player}.controls && !${player}.muted && !document.fullscreenElement && !${player}.webkitDisplayingFullscreen`), true);
    const state = await browser.evaluate<{ width: number; right: number; audio: boolean }>(`(()=>{
      const v=${player},r=v.getBoundingClientRect();
      window.__oldVideo=v;window.__leftAt=v.currentTime;
      return {width:r.width,right:r.right,audio:v.webkitAudioDecodedByteCount>0 || v.audioTracks?.length>0};
    })()`);
    assert.ok(state.width > 100 && state.right <= 391, `${engine}: inline phone player fits`);
    const before = await browser.evaluate<number>(`${player}.currentTime`);
    await new Promise(done => setTimeout(done, 1100));
    assert.ok(await browser.evaluate<boolean>(`${player}.currentTime>${before + 0.7} && !${player}.paused`), `${engine}: playback advances without stalling`);
    // The fixture contains AAC, not a silent MP4. The time/paused checks below
    // exercise the real media element; audio-track introspection varies by engine.
    return state;
  };
  await play();
  await tab('front');
  await wait(browser, 'window.__oldVideo.paused');
  const stopped = await browser.evaluate<number>('window.__oldVideo.currentTime');
  await new Promise(done => setTimeout(done, 400));
  assert.ok(Math.abs(await browser.evaluate<number>('window.__oldVideo.currentTime') - stopped) < 0.1, 'detached outgoing player stops advancing');
  await tab('videos');
  assert.equal(await browser.evaluate('document.querySelectorAll("video").length'), 0, 'return requires a deliberate selection');
  await play();
  await tab('events');
  await wait(browser, 'window.__oldVideo.paused');
  await tab('videos');
  await play();
  await browser.click(select('button-living-card-video-broken-clip'));
  await wait(browser, 'window.__oldVideo.paused');
  await wait(browser, `document.querySelector('[role="alert"]')?.textContent.includes('could not be loaded')`);
  await browser.click('.lc-native-video-list [role="alert"] button');
  await wait(browser, `document.querySelector('[role="alert"]')?.textContent.includes('could not be loaded')`);
  await browser.click(select('button-living-card-video-real-clip'));
  await wait(browser, `${player}?.currentTime>0.35 && !${player}.paused`, 'valid clip works after failed media');
  await browser.evaluate(`(window.__oldVideo=${player},true)`);
  // Reopening the same public link starts at Front; it must not resume audio.
  await browser.navigate(url);
  await wait(browser, `document.querySelector('[data-testid="living-card-flip-container"]')?.dataset.selectedSide==='front'`);
  assert.equal(await browser.evaluate('document.querySelectorAll("video").length'), 0);
  await tab('videos');
  await play();
  await tab('front');
  await wait(browser, 'window.__oldVideo.paused');
  assert.equal(await browser.evaluate(`window.__requests.every(r=>r.method==='GET' && r.url.includes('/phone-videos/fan'))`), true,
    'playback does not write uploads, follows, consent, or visibility');
  console.log(`${engine}: empty, H.264/AAC playback, inline sizing, Front/Events stop, return, failure/retry/recovery, reopen passed`);
}

test('shared HYPE Card Videos: real phone-sized Chromium and WebKit playback with bounded ranges', { timeout: 240_000 }, async () => {
  const suffix = `shared-videos-fixture-${process.pid}`;
  const files = ['tsx', 'html', 'config.ts'].map(extension => resolve(appDirectory, `${suffix}.${extension}`));
  const framePath = resolve(appDirectory, 'phone-frame.html');
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-video-browser-'));
  const children: ChildProcess[] = [];
  const browsers: VideoBrowser[] = [];
  let connection: DevToolsConnection | undefined;
  let mediaServer: ReturnType<typeof createServer> | undefined;
  try {
    await mkdir(outputDirectory, { recursive: true });
    const clipPath = resolve(outputDirectory, 'hosted-test-clip.mp4');
    const encoded = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=360x240:rate=24',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
      '-t', '12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '4M',
      '-c:a', 'aac', '-movflags', '+faststart', clipPath,
    ], { timeout: 30_000 });
    assert.equal(encoded.status, 0, encoded.stderr?.toString());
    const clip = await readFile(clipPath);
    const maxChunk = 256 * 1024; // Force multiple real browser range fetches on this small fixture.
    const ranges: Array<{ header: string; status: number; bytes: number }> = [];
    mediaServer = createServer((req, res) => {
      if (req.url?.includes('broken-clip')) { res.writeHead(404).end(); return; }
      const header = req.headers.range;
      const range = header ? parseHttpByteRange(header, clip.length, maxChunk) : null;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'no-store');
      if (header && !range) {
        ranges.push({ header, status: 416, bytes: 0 });
        res.writeHead(416, { 'Content-Range': `bytes */${clip.length}` }).end(); return;
      }
      const body = range ? clip.subarray(range.start, range.end + 1) : clip;
      if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${clip.length}`);
      ranges.push({ header: header || '', status: range ? 206 : 200, bytes: body.length });
      res.writeHead(range ? 206 : 200, { 'Content-Length': body.length }).end(body);
    });
    await new Promise<void>(done => mediaServer!.listen(0, '127.0.0.1', done));
    const address = mediaServer.address();
    assert.ok(address && typeof address !== 'string');
    const mediaOrigin = `http://127.0.0.1:${address.port}`;
    await writeFile(files[0], sharedCardVideosFixture);
    await writeFile(files[1], `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./${suffix}.tsx"></script></body></html>`);
    await writeFile(framePath, '<!doctype html><iframe id="phone" style="width:390px;height:844px;border:0" allow="autoplay"></iframe><script>document.querySelector("iframe").src=new URLSearchParams(location.search).get("url")</script>');
    await writeFile(files[2], `import {mergeConfig} from 'vite';import original from './vite.config';
export default mergeConfig(original,{
 server:{proxy:{'/api/hype-card-shares':{target:${JSON.stringify(mediaOrigin)},changeOrigin:true}}},
 plugins:[{name:'signed-out-video-fixture',enforce:'pre',
 resolveId(id){if(id==='@clerk/react')return '\\0video-clerk';},
 load(id){if(id==='\\0video-clerk')return 'export function useUser(){return {user:null,isLoaded:true,isSignedIn:false}}';}}]
});`);
    const port = await freeVideoTestPort();
    const vite = spawn('pnpm', ['exec', 'vite', '--config', files[2], '--host', '127.0.0.1'], {
      cwd: appDirectory, env: { ...process.env, PORT: String(port), BASE_PATH: '/' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(vite);
    const url = `http://127.0.0.1:${port}/${suffix}.html`;
    await waitForUrl(url, 30_000, monitorProcess(vite, 'Shared Videos Vite'));
    const mediaUrl = `http://127.0.0.1:${port}/api/hype-card-shares/real-clip/media/video`;
    for (const header of ['bytes=0-1', 'bytes=0-', `bytes=${clip.length}-`]) {
      const response = await fetch(mediaUrl, { headers: { Range: header } });
      assert.equal(response.headers.get('accept-ranges'), 'bytes');
      assert.equal(response.status, header === `bytes=${clip.length}-` ? 416 : 206);
      const bytes = (await response.arrayBuffer()).byteLength;
      if (header === 'bytes=0-1') { assert.equal(bytes, 2); assert.equal(response.headers.get('content-range'), `bytes 0-1/${clip.length}`); }
      if (header === 'bytes=0-') assert.equal(bytes, Math.min(clip.length, maxChunk));
      if (response.status === 416) assert.equal(response.headers.get('content-range'), `bytes */${clip.length}`);
    }
    const engines = process.env.VIDEO_TEST_ENGINE || 'all';
    assert.ok(['all', 'chromium', 'webkit'].includes(engines), 'VIDEO_TEST_ENGINE must be all, chromium or webkit');
    if (engines !== 'webkit') {
    const beforeBrowserRanges = ranges.length;
    const debugPort = await freeVideoTestPort();
    const chromium = spawn(process.env.CHROMIUM_PATH || 'chromium', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(chromium);
    const monitor = monitorProcess(chromium, 'Shared Videos Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, monitor);
    const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, monitor.diagnostics);
    const page = await openPage(connection, 'about:blank', { viewport: { width: 390, height: 844, mobile: true } });
    const chrome: VideoBrowser = {
      evaluate: expression => connection!.evaluate(expression, page.sessionId),
      navigate: async target => { await connection!.send('Page.navigate', { url: target }, page.sessionId); },
      click: async selector => {
        const point = await connection!.evaluate<{ x: number; y: number }>(`(()=>{
          const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});
          const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
        })()`, page.sessionId);
        await connection!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }, page.sessionId);
        await connection!.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, page.sessionId);
      },
      close: async () => {},
    };
    await playbackJourney(chrome, url, 'Chromium mobile touch');
    assert.ok(ranges.slice(beforeBrowserRanges).some(range => range.status === 206), 'the real Chromium media element requests partial content');
    const screenshot = await connection.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, page.sessionId);
    await writeFile(resolve(outputDirectory, 'chromium-phone.png'), Buffer.from(screenshot.data, 'base64'));
    }
    if (engines !== 'chromium') {
    const webkit = await videoWebKitBrowser();
    browsers.push(webkit);
    await playbackJourney(webkit, url, 'Linux WebKitGTK (not iOS Safari)');
    }
    assert.ok(ranges.some(range => range.status === 206 && range.header !== 'bytes=0-1'));
    assert.ok(ranges.filter(range => range.status === 206).every(range => range.bytes <= maxChunk));
    await writeFile(resolve(outputDirectory, 'range-results.json'), JSON.stringify(ranges, null, 2));
  } finally {
    for (const browser of browsers) await browser.close();
    connection?.close();
    for (const child of children.reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exited = new Promise(done => child.once('exit', done));
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise(done => setTimeout(done, 1500))]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    mediaServer?.closeAllConnections();
    if (mediaServer) await new Promise<void>(done => mediaServer!.close(() => done()));
    await Promise.all([...files, framePath].map(path => rm(path, { force: true })));
    await rm(profile, { recursive: true, force: true });
  }
});
