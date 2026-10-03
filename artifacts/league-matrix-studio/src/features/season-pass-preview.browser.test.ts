import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DevToolsConnection, monitorProcess, reloadPage, waitFor, waitForUrl } from './browser-test-diagnostics';

test('public Season Pass research preview is responsive and keeps fictional interactions local', { timeout: 120_000 }, async () => {
  const portServer = createServer();
  await new Promise<void>((resolve) => portServer.listen(0, '127.0.0.1', resolve));
  const address = portServer.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve) => portServer.close(() => resolve()));
  const profile = await mkdtemp(join(tmpdir(), 'season-pass-browser-'));
  const browser = spawn(process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const monitor = monitorProcess(browser, 'Season Pass Chromium');
  let connection: DevToolsConnection | undefined;
  try {
    await waitForUrl(`http://127.0.0.1:${port}/json/version`, 20_000, monitor);
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, monitor.diagnostics);
    const { targetId } = await connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await connection.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    connection.registerTarget(targetId, sessionId);
    await connection.send('Page.enable', {}, sessionId);
    await connection.send('Runtime.enable', {}, sessionId);
    const evaluate = <T>(expression: string) => connection!.evaluate<T>(expression, sessionId);
    const ready = () => waitFor(connection!, sessionId, `Boolean(document.querySelector('[data-testid="season-pass-preview-page"]'))`, Boolean, 30_000);
    const click = (id: string) => evaluate(`document.querySelector('[data-testid="${id}"]').click()`);
    const text = (id: string) => evaluate<string>(`document.querySelector('[data-testid="${id}"]').textContent`);
    // Clerk populates its own environment cache asynchronously. Compare only
    // app-owned storage, without logging authentication-library cache contents.
    const appStorage = () => evaluate<string>(`JSON.stringify(Object.fromEntries(Object.entries({...localStorage}).filter(([key]) => !/clerk/i.test(key)).sort(([a], [b]) => a.localeCompare(b))))`);
    const url = `${process.env.SEASON_PASS_TEST_BASE_URL || 'http://127.0.0.1:23652'}/season-pass-preview`;
    for (const width of [320, 393, 768, 1440]) {
      await connection.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }, sessionId);
      await connection.send('Page.navigate', { url }, sessionId);
      await ready();
      assert.equal(await evaluate('document.title'), 'Season Pass Research Preview | Pixl Sports');
      assert.equal(await evaluate('document.querySelector(\'meta[name="robots"]\').content'), 'noindex, nofollow');
      const body = await evaluate<string>('document.body.innerText');
      assert.match(body, /No purchase is available/);
      assert.match(body, /FREE BASELINE/);
      assert.match(body, /previously created cards, public share links, and purchased keepsakes would remain viewable and shareable/);
      assert.match(body, /NOT AVAILABLE TO DOWNLOAD/);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `page overflow at ${width}px`);
      const storage = await appStorage();
      await click('button-athlete-eli');
      await waitFor(connection, sessionId, `document.querySelector('[data-testid="text-season-stat"]').textContent === '11 rebounds'`, Boolean);
      assert.match(await text('preview-keepsake-result'), /Eli Brooks/);
      const designBackgrounds = new Set<string>();
      for (const [look, label] of [['gold-spotlight', 'SPOTLIGHT'], ['cosmic-clash', 'SIGNATURE'], ['neon-prism', 'WALKOUT']]) {
        await click(`button-look-${look}`);
        await waitFor(connection, sessionId, `document.querySelector('[data-testid="text-selected-look"]').textContent.includes('${label}')`, Boolean);
        assert.equal(await evaluate(`document.querySelector('[data-testid="button-look-${look}"]').getAttribute('aria-pressed')`), 'true');
        assert.match(await evaluate<string>('document.querySelector(\'[data-testid="artwork-interactive-card"]\').textContent'), /Eli Brooks/i);
        const background = await evaluate<string>('document.querySelector(\'[data-testid="artwork-interactive-card"] svg image\')?.getAttribute("href") || ""');
        assert.ok(background, 'card should render a real design background');
        designBackgrounds.add(background);
      }
      assert.equal(designBackgrounds.size, 3, 'each proposed design must visibly change the artwork');
      await click('button-moment-eli-0');
      await waitFor(connection, sessionId, `document.querySelector('[data-testid="text-selected-moment-count"]').textContent === '1 selected'`, Boolean);
      assert.doesNotMatch(await text('preview-keepsake-result'), /First three-pointer/);
      await click('button-moment-eli-1');
      await waitFor(connection, sessionId, `document.querySelector('[data-testid="text-selected-moment-count"]').textContent === '0 selected'`, Boolean);
      assert.match(await text('preview-keepsake-result'), /No moments selected/);
      await click('button-moment-eli-2');
      await waitFor(connection, sessionId, `document.querySelector('[data-testid="preview-keepsake-result"]').textContent.includes('Big defensive stop')`, Boolean);
      await click('button-toggle-interview-script');
      await waitFor(connection, sessionId, `Boolean(document.querySelector('[data-testid="list-interview-questions"]'))`, Boolean);
      assert.equal(await evaluate('document.querySelectorAll("#sp-interview-list li").length'), 5);
      assert.match(await text('text-research-decision-signals'), /purchase intent/);
      await click('button-toggle-interview-script');
      await waitFor(connection, sessionId, `!document.querySelector('[data-testid="list-interview-questions"]')`, Boolean);
      assert.equal(await appStorage(), storage, 'preview interactions must not persist');
      assert.equal(await evaluate('document.querySelectorAll(".season-pass-page input, .season-pass-page form").length'), 0);
      await reloadPage(connection, { targetId, sessionId });
      await ready();
      assert.match(await text('preview-keepsake-result'), /Maya Chen/);
      assert.equal(await text('text-selected-moment-count'), '2 selected');
    }
    await connection.send('Target.closeTarget', { targetId });
  } finally {
    connection?.close();
    browser.kill('SIGTERM');
    await monitor.waitForExit();
    await rm(profile, { recursive: true, force: true });
  }
});