import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { DevToolsConnection, monitorProcess, openPage, waitFor, waitForUrl } from './browser-test-diagnostics';

async function port() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}
test('web connection requires review, preserves failures, allows approval withdrawal and disconnect', { timeout: 90000 }, async () => {
  const vitePort = await port();
  const debugPort = await port();
  const directory = await mkdtemp(resolve(tmpdir(), 'pixl-native-link-'));
  const vite = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(vitePort)], {
    cwd: resolve(import.meta.dirname, '../..'),
    env: { ...process.env, PORT: String(vitePort), BASE_PATH: '/' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const viteMonitor = monitorProcess(vite, 'native link fixture Vite');
  let browser: ReturnType<typeof spawn> | undefined;
  let connection: DevToolsConnection | undefined;
  let browserMonitor: ReturnType<typeof monitorProcess> | undefined;
  try {
    const url = `http://127.0.0.1:${vitePort}/native-account-link-browser-test.html?userCode=DO-NOT-PREFILL`;
    await waitForUrl(url, 30000, viteMonitor);
    browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', [
      '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${directory}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'native link fixture Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30000, browserMonitor);
    const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json() as { webSocketDebuggerUrl: string };
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    const page = await openPage(connection, url, { viewport: { width: 390, height: 844, mobile: true } });
    const evaluate = (script: string) => connection!.evaluate(script, page.sessionId);
    const wait = (script: string) => waitFor(connection!, page.sessionId, script, Boolean, 10000);
    const click = (id: string) => evaluate(`document.querySelector('[data-testid="${id}"]')?.click()`);
    const fill = (value: string) => evaluate(`(() => {const el=document.querySelector('[data-testid="input-code"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(`!!document.querySelector('[data-testid="input-code"]')`);
    assert.equal(await evaluate(`document.querySelector('#native-code').value`), '');
    assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
    await fill('ABCD-EFGH');
    await click('button-review');
    await wait(`!!document.querySelector('[data-testid="review-panel"]')`);
    assert.equal(await evaluate(`window.__nativeLinkFixture.requests.some(r=>r.path.endsWith('/decision'))`), false);
    await fill('JKLM-NPQR');
    await wait(`!document.querySelector('[data-testid="review-panel"]')`);
    await click('button-review');
    await wait(`!!document.querySelector('[data-testid="button-deny"]')`);
    await click('button-deny');
    await wait(`document.body.innerText.includes('Request denied')`);
    await fill('ABCD-EFGH'); await click('button-review');
    await wait(`!!document.querySelector('[data-testid="button-approve"]')`);
    await evaluate(`window.__nativeLinkFixture.failDecision=true`);
    await click('button-approve');
    await wait(`document.querySelector('[role="alert"]')?.innerText.includes('Approval could not be saved')`);
    assert.equal(await evaluate(`!!document.querySelector('[data-testid="review-panel"]')`), true);
    await evaluate(`window.__nativeLinkFixture.failDecision=false`);
    await click('button-approve');
    await wait(`document.body.innerText.toLowerCase().includes('withdraw approval')`);
    await click('button-disconnect'); await click('button-confirm-disconnect');
    await wait(`!!document.querySelector('[data-testid="input-code"]')`);
    await evaluate(`window.__nativeLinkFixture.expire=true`);
    await fill('ABCD-EFGH'); await click('button-review');
    await wait(`document.body.innerText.includes('This request has expired')`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="button-approve"]').disabled`), true);
    await evaluate(`window.__nativeLinkFixture.status='linked';window.__nativeLinkFixture.refresh()`);
    await wait(`document.body.innerText.toLowerCase().includes('iphone connected')`);
    await click('button-disconnect');
    await click('button-keep');
    assert.equal(await evaluate(`window.__nativeLinkFixture.status`), 'linked');
    await click('button-disconnect'); await click('button-confirm-disconnect');
    await wait(`!!document.querySelector('[data-testid="input-code"]')`);
    assert.equal(await evaluate(`window.__nativeLinkFixture.requests.filter(r=>r.method!=='GET').every(r=>r.intent==='1')`), true);
    assert.equal(await evaluate(`window.__nativeLinkFixture.requests.find(r=>r.path.endsWith('/decision')).body.decision`), 'deny');
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
  } finally {
    connection?.close(); browser?.kill('SIGTERM'); vite.kill('SIGTERM');
    await Promise.all([browserMonitor?.waitForExit(), viteMonitor.waitForExit()]);
    await rm(directory, { recursive: true, force: true });
  }
});
