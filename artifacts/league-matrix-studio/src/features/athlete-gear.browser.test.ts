import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { monitorProcess, waitForUrl } from './browser-test-diagnostics';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = '/athlete-gear-check';

async function availablePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  return address.port;
}

class Browser {
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private constructor(private socket: WebSocket) {
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const item of this.pending.values()) item.reject(new Error('Browser closed'));
      this.pending.clear();
    });
  }
  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((done, reject) => {
      socket.addEventListener('open', () => done(), { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not connect to Chromium')), { once: true });
    });
    return new Browser(socket);
  }
  async send(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.nextId;
    return new Promise<any>((resolveValue, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolveValue(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression: string) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async wait(expression: string) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await this.evaluate(`Boolean(${expression})`)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`UI did not settle: ${expression}`);
  }
  close() { this.socket.close(); }
}


function harness() {
  return `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Router} from 'wouter';
import {SoccerGearBuilderPage} from './src/features/soccer-gear-builder';
import './src/index.css';
const base = {shinGuards:'slim',shinGuardColor:'#2878F5',jerseyStyle:'classic',jerseyColor:'#2878F5',shortsStyle:'classic',shortsColor:'#173758',socksStyle:'plain',socksColor:'#F6F5EA',cleatsStyle:'classic',cleatsColor:'#173758',sweatband:'none',background:'field'};
const server = {athleteId:'a1',canSave:true,athleteName:'Jordan Lee',showOnHypeCard:true,loadout:base,progress:{activeWeeks:3,eventCardsCreated:10,trackerGamesCompleted:0,hypeCardShared:false},unlockedGear:['stripe-jersey']};
const stored = sessionStorage.getItem('kit-fixture-save');
if (stored) server.loadout = JSON.parse(stored);
window.__puts = [];
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (init && init.method === 'PUT') {
    const body = JSON.parse(init.body);
    window.__puts.push(body);
    server.loadout = body.loadout; // server preserves showOnHypeCard
    sessionStorage.setItem('kit-fixture-save', JSON.stringify(server.loadout));
  }
  return new Response(JSON.stringify(server), {status:200,headers:{'Content-Type':'application/json'}});
};
function mount() {
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  return <QueryClientProvider client={client}><Router base="${base}"><SoccerGearBuilderPage accountId="athlete-1" athleteName="Jordan Lee" jerseyNumber="17" athleteRestricted /></Router></QueryClientProvider>;
}
const root = createRoot(document.getElementById('root'));
root.render(mount());
window.__remount = () => { root.unmount(); createRoot(document.getElementById('root')).render(mount()); };
`;
}

async function stop(process: ChildProcess | undefined) {
  if (!process || process.exitCode !== null) return;
  process.kill('SIGTERM');
  await new Promise<void>((done) => {
    const timer = setTimeout(() => { process.kill('SIGKILL'); done(); }, 3_000);
    process.once('exit', () => { clearTimeout(timer); done(); });
  });
}

test('Athlete kit builder hides parent settings, saves the shared loadout, and shows it after reload', { timeout: 120_000 }, async () => {
  const suffix = `athlete-gear-${process.pid}`;
  const sourcePath = resolve(appDirectory, `${suffix}.tsx`);
  const htmlPath = resolve(appDirectory, `${suffix}.html`);
  const port = await availablePort();
  const debugPort = await availablePort();
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-athlete-gear-'));
  let vite: ChildProcess | undefined;
  let chromium: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    await writeFile(sourcePath, harness());
    await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./${suffix}.tsx"></script></body></html>`);
    vite = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory, env: { ...process.env, PORT: String(port), BASE_PATH: `${base}/` }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForUrl(`http://127.0.0.1:${port}${base}/`, 25_000, monitorProcess(vite, 'Athlete gear Vite'));
    chromium = spawn(process.env.CHROMIUM_PATH || 'chromium', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 15_000, monitorProcess(chromium, 'Athlete gear Chromium'));
    const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
    browser = await Browser.connect(tabs.find((tab) => tab.type === 'page')!.webSocketDebuggerUrl);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 800, deviceScaleFactor: 1, mobile: true });
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}${base}/${suffix}.html` });
    await browser.wait(`document.querySelector('[data-testid="panel-gear-controls"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="group-show-on-hype-card"]')`), null);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="checkbox-show-on-hype-card"]')`), null);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="link-athlete-page"]')`), null);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="panel-soccer-kit-preview"] .gear-player')`), null, 'legacy illustrated player must not overlay the jersey');
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid="panel-soccer-kit-preview"] [data-testid="jersey-layer-stage"]').length`), 1);
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('[data-testid="jersey-layer-stage"]')).position`), 'relative', 'jersey layers must work without visiting Showcase first');
    assert.equal(await browser.evaluate(`document.querySelector('.gear-number').textContent`), '17');
    assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'Builder overflows at 320px');
    await browser.evaluate(`document.querySelector('[data-testid="button-gear-option-jerseyStyle-stripes"]').click()`);
    await browser.evaluate(`document.querySelector('[data-testid="button-gear-color-jerseyColor-coral"]').click()`);
    await browser.wait(`document.querySelector('[data-testid="preview-showcase-jersey"] [data-testid="layer-jersey-stripes"]')`);
    await browser.evaluate(`document.querySelector('[data-testid="button-save-soccer-gear"]').click()`);
    await browser.wait(`window.__puts.length === 1`);
    const put = await browser.evaluate(`window.__puts[0]`);
    assert.equal(put.loadout.jerseyColor, '#F36E4C');
    assert.equal(put.loadout.jerseyStyle, 'stripes');
    assert.equal(put.showOnHypeCard, true, 'athlete sends the existing parent-controlled flag unchanged');
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}${base}/${suffix}.html` });
    await browser.wait(`document.querySelector('[data-testid="preview-showcase-jersey"] [data-testid="layer-jersey-dye"]')`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid="preview-showcase-jersey"] [data-testid="jersey-layer-stage"]').dataset.jerseyColor`), '#F36E4C');
    for (const width of [390, 1440]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), `Builder overflows at ${width}px`);
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true });
    await browser.evaluate(`document.querySelector('[data-testid="panel-soccer-kit-preview"]').scrollIntoView()`);
    const capture = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    await writeFile(resolve(tmpdir(), 'pixl-kit-editor-check.jpg'), Buffer.from(capture.data, 'base64'));
  } finally {
    browser?.close();
    await stop(chromium);
    await stop(vite);
    await rm(sourcePath, { force: true });
    await rm(htmlPath, { force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
