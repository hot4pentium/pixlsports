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

// Renders only the celebration dialog with a long athlete/event name and many cheers.
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CheerCelebrationDialog} from './src/features/cheer-celebration';
import './src/index.css';
const completion={id:'c1',gameId:'g1',eventId:'e1',athleteName:'Marisol Vandenberghe-Okonkwo',eventTitle:'Spring Invitational Semifinal vs Riverside Valley Thunder',sport:'soccer',seasonId:null,endedAt:'2026-05-02T20:00:00Z',
 cheers:Array.from({length:9},(_,i)=>({key:'k'+i,label:'Cheer label number '+i,emoji:'*',count:i+3}))};
function App(){
 const [open,setOpen]=useState(false);
 return <main style={{padding:16}}>
  <button type="button" data-testid="button-open" onClick={()=>setOpen(true)}>Open</button>
  <CheerCelebrationDialog completion={open?completion:null} personal={{confirmed:4,pending:2,unverified:0,contributed:true,eligible:true,reliable:true}} onClose={()=>setOpen(false)}/>
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
`;

test('cheer celebration fits a narrow phone, honors reduced motion, and restores focus on dismiss', { timeout: 120_000 }, async () => {
  const suffix = `cheer-celebration-fixture-${process.pid}`;
  const sourcePath = resolve(appDirectory, `${suffix}.tsx`);
  const htmlPath = resolve(appDirectory, `${suffix}.html`);
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-cheer-celebration-'));
  const port = await availablePort();
  const debugPort = await availablePort();
  let vite: ChildProcess | undefined;
  let chromium: ChildProcess | undefined;
  let connection: DevToolsConnection | undefined;
  try {
    await writeFile(sourcePath, fixture);
    await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./${suffix}.tsx"></script></body></html>`);
    vite = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1'], {
      cwd: appDirectory, env: { ...process.env, PORT: String(port), BASE_PATH: '/cheer-celebration-check/' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForUrl(`http://127.0.0.1:${port}/cheer-celebration-check/`, 30_000, monitorProcess(vite, 'Cheer celebration Vite'));
    chromium = spawn(process.env.CHROMIUM_PATH || 'chromium', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const browserMonitor = monitorProcess(chromium, 'Cheer celebration Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json() as { webSocketDebuggerUrl: string };
    connection = await DevToolsConnection.connect(webSocketDebuggerUrl, browserMonitor.diagnostics);
    const page = await openPage(connection, `http://127.0.0.1:${port}/cheer-celebration-check/${suffix}.html`, { viewport: { width: 320, height: 568, mobile: true } });
    await connection.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, page.sessionId);
    const evaluate = <T,>(expression: string) => connection!.evaluate<T>(expression, page.sessionId);
    const wait = (expression: string) => waitFor(connection!, page.sessionId, `Boolean(${expression})`, Boolean);
    const q = (id: string) => `document.querySelector('[data-testid="${id}"]')`;

    await wait(q('button-open'));
    await evaluate(`${q('button-open')}.focus();${q('button-open')}.click()`);
    await wait(q('dialog-cheer-celebration'));
    assert.match(await evaluate<string>(`${q('text-cheer-celebration-athlete')}.textContent`), /Marisol Vandenberghe-Okonkwo/);
    assert.equal(await evaluate(`${q('text-cheer-celebration-total')}.textContent`), String(Array.from({ length: 9 }, (_, i) => i + 3).reduce((a, b) => a + b, 0)));
    assert.match(await evaluate<string>(`${q('status-cheer-celebration-personal')}.textContent`), /4 confirmed/);
    assert.match(await evaluate<string>(`${q('text-cheer-celebration-pending')}.textContent`), /2 still being checked/);

    const geometry = await evaluate<Record<string, number | string>>(`(()=>{const d=${q('dialog-cheer-celebration')};const r=d.getBoundingClientRect();const cs=getComputedStyle(d);const burst=d.querySelector('.cheer-celebration__burst span');
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight,sw:d.scrollWidth,cw:d.clientWidth,sh:d.scrollHeight,ch:d.clientHeight,ox:cs.overflowX,oy:cs.overflowY,touch:cs.touchAction,anim:getComputedStyle(burst).animationName,dialogAnim:cs.animationName};})()`);
    assert.ok(Number(geometry.left) >= 0 && Number(geometry.right) <= Number(geometry.w), `fits horizontally: ${JSON.stringify(geometry)}`);
    assert.ok(Number(geometry.top) >= 0 && Number(geometry.bottom) <= Number(geometry.h), 'fits vertically');
    assert.ok(Number(geometry.sw) <= Number(geometry.cw) + 1, 'no horizontal overflow');
    assert.equal(geometry.ox, 'hidden');
    assert.equal(geometry.oy, 'auto');
    assert.equal(geometry.touch, 'pan-y');
    assert.equal(geometry.anim, 'none', 'reduced motion removes the celebratory burst animation');
    assert.equal(geometry.dialogAnim, 'none', 'reduced motion removes dialog entrance animation');
    const scrolled = await evaluate<{ top: number; left: number }>(`(()=>{const d=${q('dialog-cheer-celebration')};d.scrollTop=d.scrollHeight;d.scrollLeft=200;return {top:d.scrollTop,left:d.scrollLeft};})()`);
    if (Number(geometry.sh) > Number(geometry.ch)) assert.ok(scrolled.top > 0, 'scrolls vertically');
    assert.equal(scrolled.left, 0, 'never scrolls horizontally');

    if (process.env.CHEER_CELEBRATION_SCREENSHOT) {
      const shot = await connection.send<{ data: string }>('Page.captureScreenshot', { format: 'jpeg', quality: 80 }, page.sessionId);
      await writeFile(process.env.CHEER_CELEBRATION_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    }

    await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId);
    await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId);
    await wait(`!${q('dialog-cheer-celebration')}`);
    await wait(`document.activeElement===${q('button-open')}`);

    await evaluate(`${q('button-open')}.click()`);
    await wait(q('button-close-cheer-celebration'));
    await evaluate(`${q('button-close-cheer-celebration')}.click()`);
    await wait(`!${q('dialog-cheer-celebration')} && document.activeElement===${q('button-open')}`);
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
    await Promise.all([sourcePath, htmlPath].map((path) => rm(path, { force: true })));
    await rm(profile, { recursive: true, force: true });
  }
});
