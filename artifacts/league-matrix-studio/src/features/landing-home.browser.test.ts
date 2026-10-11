import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  DevToolsConnection, monitorProcess, waitFor, waitForUrl,
  type BrowserPage, type ProcessMonitor,
} from './browser-test-diagnostics';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';

async function freePort() {
  const server: Server = createServer();
  await new Promise<void>((done, reject) => server.once('error', reject).listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP port');
  const port = address.port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

test('landing layout, links, and mobile menu work across phone, tablet, and desktop widths', async () => {
  const port = await freePort();
  const debugPort = await freePort();
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-landing-browser-'));
  const server = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: { ...process.env, PORT: String(port), BASE_PATH: '/', VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverMonitor = monitorProcess(server, 'Vite');
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  const pages: BrowserPage[] = [];
  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 30_000, serverMonitor);
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(res => res.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    for (const width of [320, 393, 768, 900, 1440]) {
      const target = await connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
      const attached = await connection.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      const page = { targetId: target.targetId, sessionId: attached.sessionId };
      pages.push(page);
      connection.registerTarget(page.targetId, page.sessionId);
      await connection.send('Page.enable', {}, page.sessionId);
      await connection.send('Runtime.enable', {}, page.sessionId);
       await connection.send('Page.addScriptToEvaluateOnNewDocument', {
         source: `(() => {
           window.__pixlStartupBlockedFrames = [];
           const recordBlockedFrame = () => {
             const accountGate = Boolean(document.querySelector('.account-loading-screen'));
             const routeLoader = document.body?.textContent?.includes('Loading your studio…') ?? false;
             if (accountGate || routeLoader) {
               window.__pixlStartupBlockedFrames.push({ accountGate, routeLoader });
             }
           };
           new MutationObserver(recordBlockedFrame).observe(document, {
             childList: true,
             subtree: true,
             characterData: true,
           });
           document.addEventListener('DOMContentLoaded', recordBlockedFrame, { once: true });
         })();`,
       }, page.sessionId);
      await connection.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }, page.sessionId);
      await connection.send('Page.navigate', { url: `http://127.0.0.1:${port}/` }, page.sessionId);
      await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid=text-landing-headline]"))', value => value === true);
       const startupBlockedFrames = await connection.evaluate<Array<{ accountGate: boolean; routeLoader: boolean }>>(
         'window.__pixlStartupBlockedFrames ?? []',
         page.sessionId,
       );
       assert.deepEqual(startupBlockedFrames, [], `the root route showed an account or route splash at ${width}px`);
      await connection.evaluate('document.fonts.ready', page.sessionId);
       await waitFor(connection, page.sessionId, 'document.querySelector(".landing-athlete-render")?.naturalWidth === 1228', Boolean);
      const heroCopy = await connection.evaluate<{ headline: string; obsoleteLabel: boolean; photoCaption: boolean; heroCardLabel: boolean }>(`(() => ({
        headline: document.querySelector('[data-testid="text-landing-headline"]')?.innerText || '',
        obsoleteLabel: document.body.innerText.includes('For the people in their corner'),
        photoCaption: Boolean(document.querySelector('.photo-caption')),
        heroCardLabel: document.body.innerText.includes('PIXL athlete card / 07'),
      }))()`, page.sessionId);
      assert.equal(heroCopy.headline.replace(/\s+/g, ' ').trim(), 'ALL IN, ALL SEASON.');
      assert.equal(heroCopy.obsoleteLabel, false);
      assert.equal(heroCopy.photoCaption, false);
      assert.equal(heroCopy.heroCardLabel, false);
       const landingVisibleText = await connection.evaluate<string>(
         `document.querySelector('.new-landing')?.innerText || ''`,
         page.sessionId,
       );
       assert.doesNotMatch(landingVisibleText, /\bvideos?\b/i, `landing copy should not mention video at ${width}px`);
      const capabilityHighlightsText = await connection.evaluate<string>(
        `document.querySelector('[data-testid="landing-capability-highlights"]')?.innerText || ''`,
        page.sessionId,
      );
      for (const capability of [
        'One link for the season',
        'Share game details',
        'Get ready together',
        'Opt in to Event Card reminders',
        'manual follower announcements',
      ]) {
        assert.ok(capabilityHighlightsText.toUpperCase().includes(capability.toUpperCase()), `${capability} should be explained at ${width}px`);
      }
      assert.equal(await connection.evaluate('document.querySelectorAll("[data-testid=landing-capability-highlights] li").length', page.sessionId), 4);
      await waitFor(connection, page.sessionId, `document.querySelector('.landing-athlete-render')?.naturalWidth === 1228`, Boolean);
      const layout = await connection.evaluate<{
        doc: number; body: number; heroImage: boolean; fanCardImage: boolean; sections: number; hypeCardBeforeOffline: boolean;
        cardSides: string[];
        cardTabLayout: { text: string; labelFitsTab: boolean; tabInsideCard: boolean }[];
        cta: string; help: string; support: string; privacy: string; explainer: boolean; menuVisible: boolean;
      }>(`(() => ({
        doc: document.documentElement.scrollWidth, body: document.body.scrollWidth,
        heroImage: document.querySelector('.hero-image-frame img')?.complete && document.querySelector('.hero-image-frame img')?.naturalWidth > 0,
        fanCardImage: document.querySelector('.landing-athlete-render')?.complete && document.querySelector('.landing-athlete-render')?.naturalWidth === 1228,
        cardSides: [...document.querySelectorAll('.landing-hype-card-tab > span')].map(label => label.textContent?.replace(/\\s+/g, ' ').trim() || ''),
        cardTabLayout: (() => {
          const card = document.querySelector('.landing-hype-card-art')?.getBoundingClientRect();
          return [...document.querySelectorAll('.landing-hype-card-tabs > .landing-hype-card-tab')].map(tab => {
            const label = tab.querySelector(':scope > span');
            const tabBounds = tab.getBoundingClientRect();
            const labelBounds = label?.getBoundingClientRect();
            return {
              text: label?.textContent?.replace(/\\s+/g, ' ').trim() || '',
              labelFitsTab: Boolean(label && labelBounds
                && label.scrollWidth <= label.clientWidth
                && labelBounds.left >= tabBounds.left - 1
                && labelBounds.right <= tabBounds.right + 1),
              tabInsideCard: Boolean(card
                && tabBounds.left >= card.left - 1
                && tabBounds.right <= card.right + 1
                && tabBounds.top >= card.top - 1
                && tabBounds.bottom <= card.bottom + 1),
            };
          });
        })(),
        sections: document.querySelectorAll('.step-card').length,
        hypeCardBeforeOffline: Boolean(
          document.querySelector('#athlete-cards')
          && document.querySelector('[data-testid="landing-offline-section"]')
          && (document.querySelector('#athlete-cards').compareDocumentPosition(document.querySelector('[data-testid="landing-offline-section"]')) & Node.DOCUMENT_POSITION_FOLLOWING)
        ),
        cta: document.querySelector('[data-testid="link-hero-get-started"]')?.getAttribute('href'),
        help: document.querySelector('[data-testid="link-footer-help"]')?.getAttribute('href'),
        support: document.querySelector('[data-testid="link-footer-support"]')?.getAttribute('href'),
        privacy: document.querySelector('[data-testid="link-footer-privacy"]')?.getAttribute('href'),
        explainer: Boolean(document.querySelector('[data-testid="link-landing-week-path-video"]')),
        menuVisible: getComputedStyle(document.querySelector('[data-testid="button-landing-mobile-menu"]')).display !== 'none',
      }))()`, page.sessionId);
      assert.ok(layout.doc <= width && layout.body <= width, `horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
      assert.equal(layout.heroImage, true);
      assert.equal(layout.fanCardImage, true, `Hype Card artwork should load at ${width}px: ${JSON.stringify(layout)}`);
      assert.deepEqual(layout.cardSides, ['Card front', 'Stats', 'Events']);
      assert.deepEqual(
        layout.cardTabLayout.map(tab => tab.text),
        ['Card front', 'Stats', 'Events'],
        `all Hype Card footer labels should be present at ${width}px`,
      );
      for (const tab of layout.cardTabLayout) {
        assert.equal(tab.labelFitsTab, true, `${tab.text} label should fit inside its tab at ${width}px`);
        assert.equal(tab.tabInsideCard, true, `${tab.text} tab should stay inside the card at ${width}px`);
      }
      assert.equal(layout.sections, 4);
      assert.equal(layout.hypeCardBeforeOffline, true);
      assert.equal(layout.cta, '/sign-up');
      assert.equal(layout.help, '/help');
      assert.equal(layout.support, '/help');
      assert.equal(layout.privacy, '/privacy');
      assert.equal(layout.explainer, false);
      assert.equal(layout.menuVisible, width < 700);
       for (const step of ['plan', 'prep', 'follow', 'celebrate']) {
         const trigger = `[data-testid=button-landing-${step}-try]`;
         await connection.evaluate(`document.querySelector("${trigger}").focus()`, page.sessionId);
         if (width === 393 && step === 'plan') {
           await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, page.sessionId);
           await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, page.sessionId);
         } else {
           await connection.evaluate(`document.querySelector("${trigger}").click()`, page.sessionId);
         }
         await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid=landing-tool-demo]"))', value => value === true);
         assert.equal(await connection.evaluate('document.querySelector("[data-testid=landing-tool-demo]")?.getAttribute("role")', page.sessionId), 'dialog');
          const demoSafety = await connection.evaluate<{ destination: string | null; notice: string }>(`(() => ({
            destination: document.querySelector('[data-testid="link-demo-sign-up"]')?.getAttribute('href') ?? null,
            notice: document.querySelector('[data-testid="landing-tool-demo"] .pixl-demo-footer p')?.textContent ?? '',
          }))()`, page.sessionId);
          assert.equal(demoSafety.destination, '/sign-up');
          assert.ok(demoSafety.notice.includes('Nothing here is saved, sent, or shared; closing starts fresh.'));
         const demoBounds = await connection.evaluate<{ left: number; right: number }>(`(() => {
           const bounds = document.querySelector('[data-testid=landing-tool-demo]').getBoundingClientRect();
           return { left: bounds.left, right: bounds.right };
         })()`, page.sessionId);
         assert.ok(demoBounds.left >= -1 && demoBounds.right <= width + 1, `${step} modal escaped ${width}px viewport: ${JSON.stringify(demoBounds)}`);
          if (step === 'follow') {
            const trackerLayout = await connection.evaluate<{
              stats: string[];
              trackerFits: boolean;
              statGridFits: boolean;
              oldSportSelector: boolean;
            }>(`(() => {
              const tracker = document.querySelector('[data-testid="demo-follow-tracker"]');
              const statGrid = tracker?.querySelector('.game-on-quick-tracker__stat-grid');
              return {
                stats: [...(tracker?.querySelectorAll('.game-on-quick-tracker__stat-label') ?? [])].map(label => label.textContent?.trim() || ''),
                trackerFits: Boolean(tracker && tracker.scrollWidth <= tracker.clientWidth),
                statGridFits: Boolean(statGrid && statGrid.scrollWidth <= statGrid.clientWidth),
                oldSportSelector: Boolean(document.querySelector('[data-testid="select-demo-sport"]')),
              };
            })()`, page.sessionId);
            assert.deepEqual(trackerLayout.stats, ['TD', 'FG', 'XP', '2 PT', 'PASS/REC', 'RUSH', 'INT', 'TACKLE']);
            assert.equal(trackerLayout.trackerFits, true, `Follow tracker should fit at ${width}px`);
            assert.equal(trackerLayout.statGridFits, true, `Follow stat cards should fit at ${width}px`);
            assert.equal(trackerLayout.oldSportSelector, false);
          }
         if (width === 393) {
           if (step === 'plan') {
             await connection.evaluate(`(() => {
               const input = document.querySelector('[data-testid=input-demo-athlete]');
               Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Jordan');
               input.dispatchEvent(new Event('input', { bubbles: true }));
             })()`, page.sessionId);
             await waitFor(connection, page.sessionId, `document.querySelector('[data-testid=card-demo-event-preview]')?.textContent.includes('Jordan')`, Boolean);
           } else if (step === 'prep') {
             await connection.evaluate(`document.querySelector('[data-testid=button-demo-check-1]').click()`, page.sessionId);
             await waitFor(connection, page.sessionId, `document.querySelector('[data-testid=text-demo-prep-count]')?.textContent.includes('1 of 3')`, Boolean);
           } else if (step === 'follow') {
              await connection.evaluate(`document.querySelector('[data-testid=button-demo-follow-opponentScore-increase]').click()`, page.sessionId);
              await connection.evaluate(`document.querySelector('[data-testid=button-demo-follow-advance-quarter]').click()`, page.sessionId);
              await connection.evaluate(`document.querySelector('[data-testid=button-demo-follow-stat-touchdown-team]').click()`, page.sessionId);
              await connection.evaluate(`document.querySelector('[data-testid=button-demo-follow-stat-pass-reception-athlete]').click()`, page.sessionId);
              await waitFor(connection, page.sessionId, `document.querySelector('[data-testid=text-demo-follow-stat-pass-reception]')?.textContent === '6'`, Boolean);
              assert.equal(await connection.evaluate(`document.querySelector('[data-testid=text-demo-follow-quarter]')?.textContent === 'Quarter 2'`, page.sessionId), true);
              assert.equal(await connection.evaluate(`document.querySelector('[data-testid=text-demo-follow-teamScore]')?.textContent === '23' && document.querySelector('[data-testid=text-demo-follow-opponentScore]')?.textContent === '11'`, page.sessionId), true);
              assert.equal(await connection.evaluate(`document.querySelector('[data-testid=text-demo-follow-attribution-touchdown]')?.textContent === 'Team 3 · Athlete 0'`, page.sessionId), true);
              assert.equal(await connection.evaluate(`document.querySelector('[data-testid=text-demo-follow-attribution-pass-reception]')?.textContent === 'Team 4 · Athlete 2'`, page.sessionId), true);
              await connection.evaluate(`document.querySelector('[data-testid=button-demo-follow-undo]').click()`, page.sessionId);
              await waitFor(connection, page.sessionId, `document.querySelector('[data-testid=text-demo-follow-stat-pass-reception]')?.textContent === '5'`, Boolean);
              await connection.evaluate(`document.querySelector('[data-testid=button-demo-follow-undo]').click()`, page.sessionId);
              await waitFor(connection, page.sessionId, `document.querySelector('[data-testid=text-demo-follow-stat-touchdown]')?.textContent === '2'`, Boolean);
              assert.equal(await connection.evaluate(`document.querySelector('[data-testid=text-demo-follow-teamScore]')?.textContent === '17'`, page.sessionId), true);
           } else {
             await waitFor(connection, page.sessionId, `document.querySelector('[data-testid=face-demo-hype-front] img')?.naturalWidth > 0`, Boolean);
              const controlsFit = await connection.evaluate<boolean>(`[...document.querySelectorAll('.pixl-demo-hype-controls button')].every(button => {
                const bounds = button.getBoundingClientRect();
                return [...button.children].every(child => {
                  const content = child.getBoundingClientRect();
                  return content.left >= bounds.left - 1 && content.right <= bounds.right + 1;
                });
              })`, page.sessionId);
              assert.equal(controlsFit, true, 'Hype Card control icons and labels should fit inside their buttons');
              await connection.evaluate(`document.querySelector('[data-testid=button-demo-hype-stats]').focus()`, page.sessionId);
             await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, page.sessionId);
             await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, page.sessionId);
              await waitFor(connection, page.sessionId, `document.querySelector('[data-testid=face-demo-hype-stats]')?.textContent.includes('Finalized games')`, Boolean);
              assert.equal(await connection.evaluate(`document.querySelector('[data-testid=face-demo-hype-stats]')?.textContent.includes('2–0–0') && document.querySelectorAll('.pixl-demo-hype-stat-grid > div').length === 8`, page.sessionId), true);
              for (const side of ['front', 'stats', 'events']) {
                await connection.evaluate(`document.querySelector('[data-testid=button-demo-hype-${side}]').click()`, page.sessionId);
                await waitFor(connection, page.sessionId, `document.querySelector('[data-testid=card-demo-hype-preview]')?.getAttribute('data-side') === '${side}'`, Boolean);
                assert.equal(await connection.evaluate(`document.querySelector('[data-testid=button-demo-hype-${side}]')?.getAttribute('aria-pressed')`, page.sessionId), 'true');
                assert.equal(await connection.evaluate(`Boolean(document.querySelector('[data-testid=face-demo-hype-${side}]'))`, page.sessionId), true);
                if (side === 'events') {
                  assert.equal(await connection.evaluate(`document.querySelectorAll('.pixl-demo-hype-event-list > li').length === 2 && document.querySelector('[data-testid=face-demo-hype-events]')?.textContent.includes('vs Falcons') && document.querySelectorAll('.pixl-demo-hype-event-list time[datetime]').length === 2`, page.sessionId), true);
                }
              }
               assert.equal(await connection.evaluate(
                 `!(document.querySelector('[data-testid=landing-tool-demo]')?.innerText || '').toLowerCase().includes('video')`,
                 page.sessionId,
               ), true);
              await connection.evaluate(`document.querySelector('[data-testid=button-demo-hype-events]').click()`, page.sessionId);
              await waitFor(connection, page.sessionId, `document.querySelector('[data-testid=face-demo-hype-events]')?.textContent.includes('vs Tigers')`, Boolean);
             await connection.evaluate(`document.querySelector('[data-testid=button-demo-hype-front]').click()`, page.sessionId);
             await waitFor(connection, page.sessionId, `document.querySelector('[data-testid=button-demo-hype-front]')?.getAttribute('aria-pressed') === 'true'`, Boolean);
              await connection.evaluate(`document.querySelector('[data-testid=button-demo-hype-stats]').click()`, page.sessionId);
           }
         }
         await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId);
         await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId);
         await waitFor(connection, page.sessionId, '!document.querySelector("[data-testid=landing-tool-demo]")', value => value === true);
         await waitFor(connection, page.sessionId, `document.activeElement === document.querySelector("${trigger}")`, Boolean);
         if (width === 393) {
           await connection.evaluate(`document.querySelector("${trigger}").click()`, page.sessionId);
           await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid=landing-tool-demo]"))', Boolean);
           const reset = await connection.evaluate<boolean>(step === 'plan'
             ? `document.querySelector('[data-testid=input-demo-athlete]')?.value === 'Maya'`
             : step === 'prep'
               ? `document.querySelector('[data-testid=text-demo-prep-count]')?.textContent.includes('0 of 3')`
               : step === 'follow'
                  ? `document.querySelector('[data-testid=text-demo-follow-quarter]')?.textContent === 'Quarter 1'
                    && document.querySelector('[data-testid=text-demo-follow-teamScore]')?.textContent === '17'
                    && document.querySelector('[data-testid=text-demo-follow-opponentScore]')?.textContent === '10'
                    && document.querySelector('[data-testid=text-demo-follow-stat-touchdown]')?.textContent === '2'
                    && document.querySelector('[data-testid=text-demo-follow-stat-pass-reception]')?.textContent === '5'
                    && document.querySelector('[data-testid=text-demo-follow-summary]')?.textContent === '25 plays · 17 pts'`
                 : `document.querySelector('[data-testid=card-demo-hype-preview]')?.getAttribute('data-side') === 'front' && document.querySelector('[data-testid=input-demo-hype-athlete]')?.value === 'Player 24'`, page.sessionId);
           assert.equal(reset, true, `${step} changes should reset when reopened`);
           await connection.evaluate(`document.querySelector('.pixl-demo-close').click()`, page.sessionId);
           await waitFor(connection, page.sessionId, '!document.querySelector("[data-testid=landing-tool-demo]")', Boolean);
           if (step === 'plan') {
             await connection.evaluate(`document.querySelector("${trigger}").click()`, page.sessionId);
             await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid=landing-tool-demo]"))', Boolean);
             await connection.evaluate(`document.querySelector('.pixl-demo-overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`, page.sessionId);
             await waitFor(connection, page.sessionId, '!document.querySelector("[data-testid=landing-tool-demo]")', Boolean);
           }
         }
       }
      if (width < 700) {
        await connection.evaluate('document.querySelector("[data-testid=button-landing-mobile-menu]").click()', page.sessionId);
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-mobile-menu]").getAttribute("aria-expanded")', page.sessionId), 'true');
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=link-mobile-landing-tools]").getAttribute("href")', page.sessionId), '#tools');
        await connection.evaluate('document.querySelector("[data-testid=link-mobile-landing-tools]").click()', page.sessionId);
        assert.equal(await connection.evaluate('document.querySelector("[data-testid=button-landing-mobile-menu]").getAttribute("aria-expanded")', page.sessionId), 'false');
      }
    }
    const page = pages[0];
    await connection.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, page.sessionId);
    assert.equal(await connection.evaluate('getComputedStyle(document.querySelector(".step-card")).transitionDuration', page.sessionId), '1e-05s');
  } finally {
    if (connection) {
      await Promise.all(pages.map(page => connection?.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined)));
      connection.close();
    }
    if (browser && browserMonitor && !browserMonitor.hasExited()) browser.kill('SIGTERM');
    if (browserMonitor) await browserMonitor.waitForExit();
    if (!serverMonitor.hasExited()) server.kill('SIGTERM');
    await serverMonitor.waitForExit();
    await rm(profile, { recursive: true, force: true });
  }
});


test('Help contact actions remain visible without overflow on phone and desktop widths', async () => {
  const port = await freePort();
  const debugPort = await freePort();
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-help-browser-'));
  const server = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: { ...process.env, PORT: String(port), BASE_PATH: '/', VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverMonitor = monitorProcess(server, 'Vite');
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: BrowserPage | undefined;
  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 30_000, serverMonitor);
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(res => res.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    const target = await connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const attached = await connection.send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    page = { targetId: target.targetId, sessionId: attached.sessionId };
    connection.registerTarget(page.targetId, page.sessionId);
    await connection.send('Page.enable', {}, page.sessionId);
    await connection.send('Runtime.enable', {}, page.sessionId);

    for (const width of [320, 393, 1440]) {
      await connection.send('Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 1, mobile: width < 600,
      }, page.sessionId);
      await connection.send('Page.navigate', { url: `http://127.0.0.1:${port}/help` }, page.sessionId);
      await waitFor(
        connection,
        page.sessionId,
        'Boolean(document.querySelector("[data-testid=link-help-support-email]"))',
        value => value === true,
      );
      await connection.evaluate('document.fonts.ready', page.sessionId);
      const helpPage = await connection.evaluate<{
        docWidth: number;
        bodyWidth: number;
        viewportWidth: number;
        support: {
          href: string | null; visible: boolean; withinViewport: boolean;
          left: number; right: number; top: number; bottom: number; width: number; height: number;
        } | null;
        contactTeam: {
          href: string | null; visible: boolean; withinViewport: boolean;
          left: number; right: number; top: number; bottom: number; width: number; height: number;
        } | null;
        backNavigation: {
          href: string | null; text: string; visible: boolean; height: number;
        } | null;
      }>(`(() => {
        const support = document.querySelector('[data-testid="link-help-support-email"]');
        const contactTeam = document.querySelector('[data-testid="link-help-contact-team"]');
        const backNavigation = document.querySelector('[data-testid="link-back-studio"]');
        support?.scrollIntoView({ block: 'center', inline: 'nearest' });
        const inspectLink = (element) => {
          if (!(element instanceof HTMLAnchorElement)) return null;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            href: element.getAttribute('href'),
            visible: element.getClientRects().length > 0
              && style.display !== 'none'
              && style.visibility === 'visible'
              && rect.width > 0
              && rect.height > 0,
            withinViewport: rect.left >= 0
              && rect.right <= document.documentElement.clientWidth
              && rect.top >= 0
              && rect.bottom <= window.innerHeight,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        };
        return {
          docWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          viewportWidth: window.innerWidth,
          support: inspectLink(support),
          contactTeam: inspectLink(contactTeam),
          backNavigation: backNavigation instanceof HTMLAnchorElement ? {
            href: backNavigation.getAttribute('href'),
            text: backNavigation.textContent?.replace(/\s+/g, ' ').trim() ?? '',
            visible: backNavigation.getClientRects().length > 0
              && getComputedStyle(backNavigation).visibility === 'visible',
            height: backNavigation.getBoundingClientRect().height,
          } : null,
        };
      })()`, page.sessionId);
      assert.ok(
        helpPage.docWidth <= width && helpPage.bodyWidth <= width,
        `Help page has horizontal overflow at ${width}px: ${JSON.stringify(helpPage)}`,
      );
      assert.equal(helpPage.viewportWidth, width);
      assert.ok(helpPage.support, `Support email should be present at ${width}px`);
      assert.ok(helpPage.contactTeam, `Contact Team email should be present at ${width}px`);
      assert.equal(helpPage.support.href, '/help');
      assert.equal(helpPage.support.visible, true);
      assert.equal(helpPage.support.withinViewport, true);
      assert.equal(helpPage.contactTeam.href, 'mailto:hello@pixlsports.com');
      assert.equal(helpPage.contactTeam.visible, true);
      assert.equal(helpPage.contactTeam.withinViewport, true);
      assert.ok(helpPage.backNavigation, `Studio return link should be present at ${width}px`);
      assert.equal(helpPage.backNavigation.href, '/studio');
      assert.equal(helpPage.backNavigation.text, 'Back to Studio');
      assert.equal(helpPage.backNavigation.visible, true);
      assert.ok(
        helpPage.backNavigation.height >= 44,
        `Studio return target is shorter than 44px at ${width}px: ${helpPage.backNavigation.height}`,
      );
      for (const [label, link] of [
        ['Support email', helpPage.support],
        ['Contact Team email', helpPage.contactTeam],
      ] as const) {
        assert.ok(link.width >= 44, `${label} target is narrower than 44px at ${width}px: ${link.width}`);
        assert.ok(link.height >= 44, `${label} target is shorter than 44px at ${width}px: ${link.height}`);
      }
      const horizontalOverlap = Math.min(helpPage.support.right, helpPage.contactTeam.right)
        > Math.max(helpPage.support.left, helpPage.contactTeam.left);
      const verticalOverlap = Math.min(helpPage.support.bottom, helpPage.contactTeam.bottom)
        > Math.max(helpPage.support.top, helpPage.contactTeam.top);
      assert.ok(
        !(horizontalOverlap && verticalOverlap),
        `Help email actions overlap at ${width}px: ${JSON.stringify({ support: helpPage.support, contactTeam: helpPage.contactTeam })}`,
      );
      const horizontalGap = Math.max(
        0,
        helpPage.support.left - helpPage.contactTeam.right,
        helpPage.contactTeam.left - helpPage.support.right,
      );
      const verticalGap = Math.max(
        0,
        helpPage.support.top - helpPage.contactTeam.bottom,
        helpPage.contactTeam.top - helpPage.support.bottom,
      );
      const separation = horizontalOverlap
        ? verticalGap
        : verticalOverlap
          ? horizontalGap
          : Math.hypot(horizontalGap, verticalGap);
      assert.ok(
        separation >= 8,
        `Help email actions are too close at ${width}px: ${separation}px`,
      );
    }

    await connection.send('Page.navigate', { url: `http://127.0.0.1:${port}/sign-in` }, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'Boolean(document.querySelector("[data-testid=link-auth-back]"))',
      value => value === true,
    );
    assert.equal(
      await connection.evaluate<boolean>(`(() => {
        const link = document.querySelector('[data-testid="link-auth-back"]');
        return link instanceof HTMLAnchorElement
          && link.getAttribute('href') === '/'
          && link.textContent?.replace(/\\s+/g, ' ').trim() === 'Back to Pixl Sports';
      })()`, page.sessionId),
      true,
      'sign-in provides a labeled return to public Pixl Sports',
    );
  } finally {
    if (connection) {
      if (page) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
      connection.close();
    }
    if (browser && browserMonitor && !browserMonitor.hasExited()) browser.kill('SIGTERM');
    if (browserMonitor) await browserMonitor.waitForExit();
    if (!serverMonitor.hasExited()) server.kill('SIGTERM');
    await serverMonitor.waitForExit();
    await rm(profile, { recursive: true, force: true });
  }
});