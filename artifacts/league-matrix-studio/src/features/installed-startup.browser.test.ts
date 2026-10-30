import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  DevToolsConnection,
  monitorProcess,
  openPage,
  waitFor,
  waitForUrl,
  type ProcessMonitor,
} from './browser-test-diagnostics';

const execFileAsync = promisify(execFile);
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const productionDirectory = resolve(appDirectory, 'dist/public');
const artifactBasePath = '/';
const phoneViewport = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };

function listen(server: Server) {
  return new Promise<{ address: string; port: number }>((resolveAddress, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected a TCP server address'));
        return;
      }
      resolveAddress({ address: `http://127.0.0.1:${address.port}`, port: address.port });
    });
  });
}

async function availablePort() {
  const server = createServer();
  const { port } = await listen(server);
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  return port;
}

async function stopProcess(child: ChildProcess | undefined, monitor: ProcessMonitor | undefined) {
  if (!child || !monitor || monitor.hasExited()) return;
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
  try {
    await withinTimeout(monitor.waitForExit(), 2_000, 'waiting for a browser-test process to stop');
  } catch {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGKILL');
    }
    await withinTimeout(monitor.waitForExit(), 3_000, 'waiting for a browser-test process to exit');
  }
}

function contentType(pathname: string) {
  return pathname.endsWith('.js') ? 'text/javascript'
    : pathname.endsWith('.css') ? 'text/css'
      : pathname.endsWith('.json') || pathname.endsWith('.webmanifest') ? 'application/json'
        : pathname.endsWith('.png') ? 'image/png'
          : pathname.endsWith('.svg') ? 'image/svg+xml'
            : 'text/html';
}

function withinTimeout<T>(promise: Promise<T>, timeoutMs: number, description: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms while ${description}`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function serveProductionBuild(options: { serviceWorkerDelayMs: number }) {
  let studioHtmlRequests = 0;
  let studioHtmlResponses = 0;
  const heldStudioResponses = new Set<() => void>();
  const server = createServer(async (request, response) => {
    const requestPath = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const isStudioHtmlRequest = requestPath === '/studio';
    if (requestPath.endsWith('/sw.js')) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, options.serviceWorkerDelayMs));
    }
    if (isStudioHtmlRequest) {
      studioHtmlRequests += 1;
      await new Promise<void>((resolveResponse) => {
        let timer: ReturnType<typeof setTimeout>;
        const release = () => {
          clearTimeout(timer);
          heldStudioResponses.delete(release);
          resolveResponse();
        };
        timer = setTimeout(release, 3_000);
        heldStudioResponses.add(release);
      });
    }

    const relativePath = decodeURIComponent(requestPath.replace(/^\/+/, ''));
    const requestedFile = resolve(productionDirectory, relativePath || 'index.html');
    const isSafePath = requestedFile === productionDirectory
      || requestedFile.startsWith(`${productionDirectory}/`);
    const filePath = isSafePath ? requestedFile : resolve(productionDirectory, 'index.html');
    try {
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) throw new Error('Not a file');
      if (isStudioHtmlRequest) studioHtmlResponses += 1;
      response.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' });
      createReadStream(filePath).pipe(response);
    } catch {
      if (isStudioHtmlRequest) studioHtmlResponses += 1;
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      createReadStream(resolve(productionDirectory, 'index.html')).pipe(response);
    }
  });
  const address = await listen(server);
  return {
    server,
    address: address.address,
    get studioHtmlRequests() { return studioHtmlRequests; },
    get studioHtmlResponses() { return studioHtmlResponses; },
    releaseSlowStudioResponses() {
      for (const release of heldStudioResponses) release();
      heldStudioResponses.clear();
    },
  };
}

test('installed production shell starts, navigates warm, and reopens offline on a phone', async () => {
  await execFileAsync('pnpm', ['run', 'build'], {
    cwd: appDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: process.env.PORT || '23652',
      BASE_PATH: artifactBasePath,
      VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
    },
    maxBuffer: 10 * 1024 * 1024,
  });

  const productionServer = await serveProductionBuild({ serviceWorkerDelayMs: 1_500 });
  const tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-installed-startup-'));
  const browserProfile = resolve(tempDirectory, 'browser');
  const debugProbe = createServer();
  const { port: debugPort } = await listen(debugProbe);
  await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));

  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  const pages: Array<{ sessionId: string; targetId: string }> = [];
  const timingDiagnostics: Record<string, unknown> = {};
  const coldStartUrl = `${productionServer.address}/studio`;
  const studioUrl = `${productionServer.address}/studio`;

  try {
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${browserProfile}`,
      'about:blank',
    ], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);

    // Exercise the production landing before installation can prefetch Studio.
    for (const viewport of [phoneViewport, { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }]) {
      const landingPage = await openPage(connection, 'about:blank', { viewport });
      pages.push(landingPage);
      await connection.send('Network.enable', {}, landingPage.sessionId);
      await connection.send('Network.setBlockedURLs', { urls: ['*/sw.js'] }, landingPage.sessionId);
      await connection.send('Network.emulateNetworkConditions', {
        offline: false, latency: 100, downloadThroughput: 200_000, uploadThroughput: 100_000,
      }, landingPage.sessionId);
      await connection.send('Emulation.setCPUThrottlingRate', { rate: 4 }, landingPage.sessionId);
      await connection.send('Page.navigate', { url: `${productionServer.address}/` }, landingPage.sessionId);
      await waitFor(connection, landingPage.sessionId,
        'Boolean(document.querySelector("[data-testid=text-landing-headline]"))', Boolean, 30_000);
      if (viewport.mobile) {
        await connection.evaluate('document.querySelector("[data-testid=button-landing-mobile-menu]").click()', landingPage.sessionId);
        await waitFor(connection, landingPage.sessionId,
          'Boolean(document.querySelector("#landing-mobile-menu"))', Boolean);
      } else {
        await connection.evaluate('document.querySelector("[data-testid=link-landing-how-it-works]").click()', landingPage.sessionId);
        await waitFor(connection, landingPage.sessionId, 'location.hash', value => value === '#how-it-works');
      }
      const startup = await connection.evaluate<{ elapsedMs: number; scripts: string[] }>(`({
        elapsedMs: Math.round(performance.now()),
        scripts: performance.getEntriesByType('resource')
          .map(resource => new URL(resource.name).pathname).filter(path => path.endsWith('.js'))
      })`, landingPage.sessionId);
      assert.ok(!startup.scripts.some(path => /\/(?:App|landing-tool-demo|hype-card|stat-tracker-page)-/.test(path)),
        `Landing must handle its first interaction without Studio/demo scripts: ${JSON.stringify(startup)}`);
      console.log('Throttled production landing startup', JSON.stringify({ viewport, ...startup }));
      await connection.send('Target.closeTarget', { targetId: landingPage.targetId });
      pages.pop();
    }

    const coldPage = await openPage(connection, coldStartUrl, { viewport: phoneViewport });
    pages.push(coldPage);
    const firstShell = await waitFor<{
      visible: boolean;
      text: string;
      elapsedMs: number;
      viewport: { width: number; height: number };
    }>(
      connection,
      coldPage.sessionId,
      `(() => {
        const root = document.querySelector('#root');
        const rect = root?.getBoundingClientRect();
        return {
          visible: Boolean(root && rect && rect.width > 0 && rect.height > 0),
          text: root?.textContent?.trim() || '',
          elapsedMs: performance.now(),
          viewport: { width: innerWidth, height: innerHeight },
        };
      })()`,
      (result) => result.visible && result.text.length > 0,
      20_000,
    );
    assert.deepEqual(firstShell.viewport, { width: 390, height: 844 });
    assert.ok(firstShell.text.length > 0, 'Expected the active studio route to render app-shell content');
    assert.ok(firstShell.elapsedMs < 8_000, `First app-shell content took ${Math.round(firstShell.elapsedMs)}ms`);
    timingDiagnostics.firstShellContentMs = Math.round(firstShell.elapsedMs);

    await waitFor(
      connection,
      coldPage.sessionId,
      'navigator.serviceWorker?.getRegistrations().then(registrations => registrations.some(registration => Boolean(registration.active)))',
      Boolean,
      30_000,
    );
    const serviceWorkerReadyMs = await connection.evaluate<number>('performance.now()', coldPage.sessionId);
    timingDiagnostics.serviceWorkerReadyMs = Math.round(serviceWorkerReadyMs);
    const workerControlledColdPage = await connection.evaluate<boolean>(
      'Boolean(navigator.serviceWorker?.controller)',
      coldPage.sessionId,
    );
    assert.ok(firstShell.elapsedMs < serviceWorkerReadyMs, 'The active route should render before service-worker readiness');

    const startupResources = await connection.evaluate<Array<{
      name: string;
      initiatorType: string;
      durationMs: number;
      bytes: number;
    }>>(
      `performance.getEntriesByType('resource')
        .filter((entry) => entry.startTime <= ${firstShell.elapsedMs})
        .map((resource) => ({
          name: new URL(resource.name).pathname,
          initiatorType: resource.initiatorType,
          durationMs: Math.round(resource.duration),
          bytes: resource.transferSize || resource.encodedBodySize || resource.decodedBodySize || 0,
        }))
        .sort((left, right) => right.bytes - left.bytes || right.durationMs - left.durationMs)
        .slice(0, 8)`,
      coldPage.sessionId,
    );
    assert.ok(startupResources.length > 0, 'Expected cold startup resource timing entries');

    await connection.send('Page.reload', { ignoreCache: false }, coldPage.sessionId);
    await waitFor(
      connection,
      coldPage.sessionId,
      'Boolean(navigator.serviceWorker?.controller)',
      Boolean,
      20_000,
    );
    const controlledScope = await connection.evaluate<string>(
      'navigator.serviceWorker.controller.scriptURL',
      coldPage.sessionId,
    );
    assert.ok(controlledScope.endsWith('/sw.js'), `Expected the production service worker to control the warm page: ${controlledScope}`);
    const studioHtmlRequestsBeforeWarmNavigation = productionServer.studioHtmlRequests;
    const studioHtmlResponsesBeforeWarmNavigation = productionServer.studioHtmlResponses;

    const warmStudioPage = await openPage(connection, 'about:blank', { viewport: phoneViewport });
    pages.push(warmStudioPage);
    await connection.send('Network.enable', {}, warmStudioPage.sessionId);
    await connection.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 1_200,
      downloadThroughput: 350 * 1024 / 8,
      uploadThroughput: 120 * 1024 / 8,
      connectionType: 'cellular3g',
    }, warmStudioPage.sessionId);
    const warmNavigationStartedAt = Date.now();
    timingDiagnostics.warmNavigationStartedAt = warmNavigationStartedAt;
    await connection.send('Page.navigate', { url: studioUrl }, warmStudioPage.sessionId);
    let warmStudioShell: { pathname: string; text: string };
    try {
      warmStudioShell = await waitFor<{ pathname: string; text: string }>(
        connection,
        warmStudioPage.sessionId,
        `({ pathname: location.pathname, text: document.querySelector('#root')?.textContent?.trim() || '' })`,
        (result) => result.text.length > 0
          && (result.pathname === '/studio' || result.pathname.startsWith('/sign-in')),
        2_500,
      );
    } catch (error) {
      timingDiagnostics.warmNavigationToContentMs = Date.now() - warmNavigationStartedAt;
      timingDiagnostics.warmStudioHtmlRequestsAtFailure = productionServer.studioHtmlRequests;
      timingDiagnostics.warmStudioHtmlResponsesAtFailure = productionServer.studioHtmlResponses;
      throw error;
    }
    const warmNavigationToContentMs = Date.now() - warmNavigationStartedAt;
    timingDiagnostics.warmNavigationToContentMs = warmNavigationToContentMs;
    const warmStudioHtmlRequestsBeforeContent = productionServer.studioHtmlRequests;
    const warmStudioHtmlResponsesBeforeContent = productionServer.studioHtmlResponses;
    assert.equal(
      warmStudioHtmlResponsesBeforeContent,
      studioHtmlResponsesBeforeWarmNavigation,
      'The warmed /studio shell must render before the deliberately delayed HTML response',
    );
    assert.equal(
      warmStudioHtmlRequestsBeforeContent,
      studioHtmlRequestsBeforeWarmNavigation,
      'The ideal cached navigation serves the warmed /studio shell without making an HTML request',
    );
    assert.ok(
      warmNavigationToContentMs < 3_000,
      `Warm direct /studio navigation took ${warmNavigationToContentMs}ms to render content`,
    );
    const warmNavigationResources = await connection.evaluate<Array<{ name: string; durationMs: number; bytes: number }>>(
      `performance.getEntriesByType('resource')
        .map((resource) => ({
          name: new URL(resource.name).pathname,
          durationMs: Math.round(resource.duration),
          bytes: resource.transferSize || resource.encodedBodySize || resource.decodedBodySize || 0,
        }))
        .slice(-12)`,
      warmStudioPage.sessionId,
    );
    const warmStudioWorkerControl = await connection.evaluate<boolean>(
      'Boolean(navigator.serviceWorker?.controller)',
      warmStudioPage.sessionId,
    );
    assert.equal(warmStudioWorkerControl, true, 'The direct warm /studio navigation should be controlled by the installed service worker');

    await connection.send('Target.closeTarget', { targetId: coldPage.targetId });
    await connection.send('Target.closeTarget', { targetId: warmStudioPage.targetId });
    pages.splice(0, pages.length);
    const offlinePage = await openPage(connection, studioUrl, { offline: true, viewport: phoneViewport });
    pages.push(offlinePage);
    const offlineShell = await waitFor<{ pathname: string; text: string }>(
      connection,
      offlinePage.sessionId,
      `({ pathname: location.pathname, text: document.querySelector('#root')?.textContent?.trim() || '' })`,
      (result) => result.text.length > 0
        && (result.pathname === '/studio' || result.pathname.startsWith('/sign-in')),
      20_000,
    );
    assert.ok(offlineShell.text.length > 0, 'Expected the warmed production app shell to reopen offline');
    const offlineWorkerControl = await waitFor(
      connection,
      offlinePage.sessionId,
      'Boolean(navigator.serviceWorker?.controller)',
      Boolean,
      15_000,
    );
    assert.equal(offlineWorkerControl, true, 'The offline shell should be served within the installed worker scope');
    const manifest = JSON.parse(await readFile(resolve(productionDirectory, '.vite/manifest.json'), 'utf8')) as Record<string, { name?: string; file: string }>;
    const routeEntry = Object.values(manifest).find(entry => entry.name === 'App');
    assert.ok(routeEntry, 'Expected the lazy application route entry in the production manifest');
    const routeAvailableOffline = await withinTimeout(
      connection.evaluate<boolean>(
        // Shared chunks expose Rollup-renamed exports rather than a literal default.
        `import(${JSON.stringify(`${productionServer.address}/${routeEntry.file}`)}).then(module => Object.keys(module).length > 0)`,
        offlinePage.sessionId,
      ),
      15_000,
      'loading the lazy application route shell and its dependencies offline',
    );
    assert.equal(routeAvailableOffline, true, 'Lazy application routes must remain importable offline');

    console.log('Installed app startup timing', JSON.stringify({
      viewport: firstShell.viewport,
      firstShellContentMs: Math.round(firstShell.elapsedMs),
      serviceWorkerReadyMs: Math.round(serviceWorkerReadyMs),
      coldPageControlledBeforeReload: workerControlledColdPage,
      coldStartupResources: startupResources,
      throttledWarmStudioPath: warmStudioShell.pathname,
      warmStudioNavigationToContentMs: warmNavigationToContentMs,
      warmStudioHtmlRequestsBeforeContent,
      warmStudioHtmlResponsesBeforeContent,
      warmNavigationResources,
      offlineReopenPath: offlineShell.pathname,
      authLimitation: 'No Clerk credentials are assumed; authenticated dashboard data was not tested.',
    }));
  } catch (error) {
    console.error('Installed startup browser failure', JSON.stringify({
      error: error instanceof Error ? error.stack || error.message : String(error),
      timings: timingDiagnostics,
      studioHtmlRequests: productionServer.studioHtmlRequests,
      studioHtmlResponses: productionServer.studioHtmlResponses,
      browser: browserMonitor?.diagnostics(),
      devtools: connection?.diagnostics(),
    }));
    throw error;
  } finally {
    productionServer.releaseSlowStudioResponses();
    for (const page of pages) {
      await connection?.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    }
    connection?.close();
    if (browser && browserMonitor) {
      if (browser.pid !== undefined) {
        try {
          process.kill(-browser.pid, 'SIGTERM');
        } catch {
          if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
        }
      }
      try {
        await withinTimeout(browserMonitor.waitForExit(), 2_000, 'waiting for Chromium after SIGTERM');
      } catch {
        console.error('Chromium did not exit after SIGTERM; escalating to SIGKILL', browserMonitor.diagnostics());
      }
      if (browser.pid !== undefined) {
        try {
          process.kill(-browser.pid, 'SIGKILL');
        } catch {
          if (!browserMonitor.hasExited()) browser.kill('SIGKILL');
        }
      }
      try {
        await withinTimeout(browserMonitor.waitForExit(), 3_000, 'waiting for Chromium after SIGKILL');
      } catch (error) {
        console.error('Chromium remained alive after SIGKILL', error instanceof Error ? error.message : String(error));
      }
    }
    try {
      await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.error('Could not remove the temporary Chromium profile', error instanceof Error ? error.message : String(error));
    }
    const serverClose = new Promise<void>((resolveClose, rejectClose) => {
      productionServer.server.close((error) => error ? rejectClose(error) : resolveClose());
    });
    const serverWithForceClose = productionServer.server as Server & { closeAllConnections?: () => void };
    serverWithForceClose.closeAllConnections?.();
    try {
      await withinTimeout(serverClose, 2_000, 'closing the production fixture server');
    } catch (error) {
      console.error('Production fixture server required forced cleanup', error instanceof Error ? error.message : String(error));
      serverWithForceClose.closeAllConnections?.();
    }
  }
});

test('returning verified sessions keep one splash through delayed session and lifecycle restoration', { timeout: 120_000 }, async () => {
  const vitePort = await availablePort();
  const debugPort = await availablePort();
  const browserProfile = await mkdtemp(resolve(tmpdir(), 'pixl-startup-return-'));
  let vite: ChildProcess | undefined;
  let viteMonitor: ProcessMonitor | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    vite = spawn('pnpm', ['exec', 'vite', '--config', 'vite.account-lifecycle-browser.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        REPL_ID: '',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    viteMonitor = monitorProcess(vite, 'Returning-session Vite fixture');
    await waitForUrl(`http://127.0.0.1:${vitePort}/studio`, 30_000, viteMonitor);

    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${browserProfile}`,
      'about:blank',
    ], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium returning-session fixture');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, 'about:blank', { viewport: phoneViewport });
    await connection.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__startupConsoleErrors = [];
        const originalConsoleError = console.error.bind(console);
        console.error = (...args) => {
          window.__startupConsoleErrors.push(args.map((value) => value instanceof Error
            ? { message: value.message, stack: value.stack }
            : String(value)));
          originalConsoleError(...args);
        };
        try {
          localStorage.setItem('pixl:previous-private-session:v1', 'seen');
        } catch {}
        const nativeSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
          const isSignedOutHome = location.pathname === '/'
            && new URLSearchParams(location.search).get('viewer') === 'startup-signed-out';
          if (isSignedOutHome && name === 'data-pixl-private-return-started-at') {
            value = String(performance.now() + 60_000);
          }
          return nativeSetAttribute.call(this, name, value);
        };
        window.__startupSplashMounts = 0;
        window.__startupLifecycleRequests = 0;
        const collectSplashMounts = (nodes) => {
          for (const node of nodes) {
            if (!(node instanceof Element)) continue;
            if (node.matches('[data-testid="private-entry-splash-overlay"]')) window.__startupSplashMounts++;
            window.__startupSplashMounts += node.querySelectorAll('[data-testid="private-entry-splash-overlay"]').length;
          }
        };
        new MutationObserver((records) => {
          for (const record of records) collectSplashMounts(record.addedNodes);
        }).observe(document, { childList: true, subtree: true });
        const nativeFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const pathname = new URL(requestUrl, location.href).pathname;
          if (pathname === '/api/hype-card-shares/reply-inbox') {
            return Promise.resolve(new Response(JSON.stringify({
              unreadCount: 0,
              totalCount: 0,
              groups: [],
            }), { status: 200, headers: { 'content-type': 'application/json' } }));
          }
          if (pathname === '/api/athlete-invites'
            || pathname === '/api/game-on-cards/owned'
            || pathname === '/api/projects') {
            return Promise.resolve(new Response('[]', {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }));
          }
          if (pathname === '/api/supporter/active-game') {
            return Promise.resolve(new Response(JSON.stringify({ gameId: null }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }));
          }
          if (pathname === '/api/account/access') {
            return Promise.resolve(new Response(JSON.stringify({ message: 'Fixture omits account access.' }), {
              status: 401,
              headers: { 'content-type': 'application/json' },
            }));
          }
          if (pathname === '/api/account/lifecycle') {
            window.__startupLifecycleRequests++;
            return new Promise((resolve) => {
            window.__restoreStartupLifecycle = (identityBlocked = false) => resolve(new Response(JSON.stringify({
                status: 'active',
                pauseEndsAt: null,
                planTier: 'free',
                cancelledAt: null,
                lastActivityAt: null,
                deletionEligibleAt: null,
                retentionDays: 90,
                expired: false,
                adminSuspended: false,
                identityBlocked,
              }), { status: 200, headers: { 'content-type': 'application/json' } }));
            });
          }
          return nativeFetch(input, init);
        };
      })();`,
    }, page.sessionId);
    await connection.send('Page.navigate', {
      url: `http://127.0.0.1:${vitePort}/?viewer=startup-return`,
    }, page.sessionId);

    const assertCoveredApp = async (stage: string) => {
      const covered = await connection!.evaluate<{
        hidden: boolean;
        inert: boolean;
        overlayCoversViewport: boolean;
      }>(`(() => {
        const app = document.querySelector('#root > div[aria-hidden="true"][inert]');
        const overlay = document.querySelector('[data-testid="private-entry-splash-overlay"]');
        const box = overlay?.getBoundingClientRect();
        return {
          hidden: Boolean(app && getComputedStyle(app).visibility === 'hidden'),
          inert: Boolean(app?.inert),
          overlayCoversViewport: Boolean(
            overlay && box && getComputedStyle(overlay).position === 'fixed'
            && box.left <= 0 && box.top <= 0 && box.right >= innerWidth && box.bottom >= innerHeight,
          ),
        };
      })()`, page!.sessionId);
      assert.deepEqual(covered, { hidden: true, inert: true, overlayCoversViewport: true },
        `${stage}: the app must be visually hidden, inert, and covered by the startup overlay`);

      const { root } = await connection!.send<{ root: { nodeId: number } }>(
        'DOM.getDocument', { depth: -1 }, page!.sessionId,
      );
      const { nodeId } = await connection!.send<{ nodeId: number }>('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: '#root > div[aria-hidden="true"][inert]',
      }, page!.sessionId);
      assert.ok(nodeId, `${stage}: the covered app tree should remain mounted`);
      const { object } = await connection!.send<{ object: { objectId?: string } }>(
        'DOM.resolveNode', { nodeId }, page!.sessionId,
      );
      assert.ok(object.objectId, `${stage}: the covered app tree should resolve to a DOM object`);
      const { nodes } = await connection!.send<{
        nodes: Array<{ ignored?: boolean; ignoredReasons?: Array<{ name?: string }> }>;
      }>('Accessibility.getPartialAXTree', {
        objectId: object.objectId,
        fetchRelatives: false,
      }, page!.sessionId);
      assert.ok(nodes.some(node => node.ignored
        && node.ignoredReasons?.some(reason => reason.name === 'ariaHiddenElement')),
      `${stage}: the covered app tree must be absent from assistive technology: ${JSON.stringify(nodes)}`);
    };

    await waitFor(connection, page.sessionId,
      'Boolean(document.querySelector("[data-testid=private-entry-splash-overlay]"))', Boolean, 30_000);
    await assertCoveredApp('while Clerk is pending');
    const startup = await connection.evaluate<{
      pathname: string;
      startedAt: number;
      returnShell: boolean;
      previousSessionMarker: boolean;
      splashMounts: number;
      lifecycleRequests: number;
      accountScreens: number;
    }>(`({
      pathname: location.pathname,
      startedAt: Number(document.documentElement.getAttribute('data-pixl-private-return-started-at')),
      returnShell: document.documentElement.getAttribute('data-pixl-private-return') === 'true',
      previousSessionMarker: localStorage.getItem('pixl:previous-private-session:v1') === 'seen',
      splashMounts: window.__startupSplashMounts,
      lifecycleRequests: window.__startupLifecycleRequests,
      accountScreens: document.querySelectorAll('.account-loading-screen').length,
    })`, page.sessionId);
    assert.equal(startup.pathname, '/', 'the returning-session scenario should open the home page');
    assert.equal(startup.previousSessionMarker, true, 'the home page should open with the previous-session marker set');
    assert.equal(startup.returnShell, true, 'the home page should start in its returning-session shell');
    assert.ok(Number.isFinite(startup.startedAt), 'the return splash should record its initial HTML paint time');
    assert.equal(startup.lifecycleRequests, 0, 'lifecycle verification waits for the delayed Clerk session');
    assert.equal(startup.accountScreens, 1, 'the returning shell should show one account-loading screen');

    await connection.evaluate('window.__restoreStartupSession()', page.sessionId);
    await waitFor(connection, page.sessionId, 'window.__startupLifecycleRequests > 0', Boolean, 10_000);
    assert.equal(
      await connection.evaluate('window.__startupSessionVerified === true', page.sessionId),
      true,
      'the restored fixture session should represent a verified sign-in',
    );

    await waitFor(connection, page.sessionId,
      'Boolean(window.__restoreStartupLifecycle)', Boolean, 10_000);
    const waitingOnLifecycle = await connection.evaluate<{
      elapsedMs: number;
      splashMounts: number;
      accountScreens: number;
      hiddenDashboard: boolean;
      inertDashboard: boolean;
      overlayCoversViewport: boolean;
    }>(`(() => {
      const hiddenApp = document.querySelector('#root > div[aria-hidden="true"][inert]');
      const overlay = document.querySelector('[data-testid="private-entry-splash-overlay"]');
      const overlayBox = overlay?.getBoundingClientRect();
      return {
        elapsedMs: performance.now() - Number(document.documentElement.getAttribute('data-pixl-private-return-started-at')),
        splashMounts: window.__startupSplashMounts,
        accountScreens: document.querySelectorAll('.account-loading-screen').length,
        hiddenDashboard: Boolean(hiddenApp && getComputedStyle(hiddenApp).visibility === 'hidden'),
        inertDashboard: Boolean(hiddenApp?.inert),
        overlayCoversViewport: Boolean(
          overlay && overlayBox
          && getComputedStyle(overlay).position === 'fixed'
          && overlayBox.left <= 0 && overlayBox.top <= 0
          && overlayBox.right >= innerWidth && overlayBox.bottom >= innerHeight,
        ),
      };
    })()`, page.sessionId);
    assert.ok(waitingOnLifecycle.elapsedMs < 5_000, 'the delayed lifecycle check should finish before the splash minimum');
    assert.equal(waitingOnLifecycle.splashMounts, 1, 'session restoration must not mount another splash');
    assert.equal(waitingOnLifecycle.accountScreens, 1, 'lifecycle loading must not add a second full-screen account splash');
    assert.equal(waitingOnLifecycle.hiddenDashboard, true, 'the covered dashboard must remain visually hidden during lifecycle verification');
    assert.equal(waitingOnLifecycle.inertDashboard, true, 'the covered dashboard must remain inert during lifecycle verification');
    assert.equal(waitingOnLifecycle.overlayCoversViewport, true, 'the startup splash must cover the full viewport');

    await assertCoveredApp('while account lifecycle is pending');

    await connection.evaluate('window.__restoreStartupLifecycle()', page.sessionId);
    await waitFor(connection, page.sessionId,
      'Boolean(document.querySelector("[data-testid=dashboard-primary-actions-mobile]"))', Boolean, 20_000);
    assert.equal(
      await connection.evaluate(
        'localStorage.getItem("pixl:previous-private-session:v1") === "seen"',
        page.sessionId,
      ),
      true,
      'only active lifecycle verification remembers the private session',
    );

    await waitFor(connection, page.sessionId, `(() => {
      const startedAt = Number(document.documentElement.getAttribute('data-pixl-private-return-started-at'));
      return performance.now() - startedAt >= 5_000
        && !document.querySelector('[data-testid="private-entry-splash-overlay"]')
        && Boolean(document.querySelector('[data-testid="dashboard-primary-actions-mobile"]'));
    })()`, Boolean, 10_000);
    const restoredDashboard = await connection.evaluate<{
      pathname: string;
      elapsedMs: number;
      splashVisible: boolean;
      accountScreens: number;
      dashboardVisible: boolean;
      splashMounts: number;
    }>(`(() => {
      const dashboard = document.querySelector('[data-testid="dashboard-primary-actions-mobile"]');
      const style = dashboard ? getComputedStyle(dashboard) : null;
      return {
        pathname: location.pathname,
        elapsedMs: performance.now() - Number(document.documentElement.getAttribute('data-pixl-private-return-started-at')),
        splashVisible: Boolean(document.querySelector('[data-testid="private-entry-splash-overlay"]')),
        accountScreens: document.querySelectorAll('.account-loading-screen').length,
        dashboardVisible: Boolean(dashboard && style && style.visibility !== 'hidden' && dashboard.getBoundingClientRect().width > 0),
        splashMounts: window.__startupSplashMounts,
      };
    })()`, page.sessionId);
    assert.equal(restoredDashboard.pathname, '/studio', 'the verified returning session should route from home to the dashboard');
    assert.ok(restoredDashboard.elapsedMs >= 5_000, 'the splash must meet the five-second minimum measured from initial HTML paint');
    assert.equal(restoredDashboard.splashVisible, false, 'the original splash should be removed after startup completes');
    assert.equal(restoredDashboard.accountScreens, 0, 'no second account-loading screen should cover the dashboard');
    assert.equal(restoredDashboard.dashboardVisible, true, 'the verified session should reveal the dashboard');
    assert.equal(restoredDashboard.splashMounts, 1, 'the returning startup should mount exactly one full-screen splash');

    await connection.evaluate(
      'localStorage.setItem("pixl:previous-private-session:v1", "seen")',
      page.sessionId,
    );
    await connection.send('Page.navigate', {
      url: `http://127.0.0.1:${vitePort}/?viewer=startup-signed-out`,
    }, page.sessionId);
    await waitFor(connection, page.sessionId,
      'Boolean(document.querySelector("[data-testid=private-entry-splash-overlay]"))', Boolean, 30_000);
    await assertCoveredApp('returning home while Clerk is pending');
    const pendingSignedOutHome = await connection.evaluate<{
      markerPresent: boolean;
      remainingSplashMs: number;
      landingVisible: boolean;
      dashboardVisible: boolean;
    }>(`(() => {
      const startedAt = Number(document.documentElement.getAttribute('data-pixl-private-return-started-at'));
      return {
        markerPresent: localStorage.getItem('pixl:previous-private-session:v1') === 'seen',
        remainingSplashMs: startedAt - performance.now(),
        landingVisible: Boolean(document.querySelector('[data-testid="text-landing-headline"]')),
        dashboardVisible: Boolean(document.querySelector('[data-testid="dashboard-primary-actions-mobile"]')),
      };
    })()`, page.sessionId);
    assert.equal(pendingSignedOutHome.markerPresent, true, 'the previous-session marker should seed the delayed-auth return');
    assert.ok(pendingSignedOutHome.remainingSplashMs > 50_000,
      'the fixture should preserve a substantial private-splash delay when sign-out is confirmed');
    assert.equal(pendingSignedOutHome.landingVisible, false, 'the landing must wait for Clerk to confirm sign-out');
    assert.equal(pendingSignedOutHome.dashboardVisible, false, 'dashboard content must stay hidden while Clerk is pending');

    await connection.evaluate('window.__restoreStartupSession()', page.sessionId);
    await waitFor(connection, page.sessionId, `(
      Boolean(document.querySelector('[data-testid="text-landing-headline"]'))
      && !document.querySelector('[data-testid="private-entry-splash-overlay"]')
      && localStorage.getItem('pixl:previous-private-session:v1') === null
    )`, Boolean, 10_000);
    const signedOutHome = await connection.evaluate<{
      pathname: string;
      markerPresent: boolean;
      splashVisible: boolean;
      landingVisible: boolean;
      dashboardVisible: boolean;
      elapsedSinceSplashStart: number;
    }>(`(() => {
      const startedAt = Number(document.documentElement.getAttribute('data-pixl-private-return-started-at'));
      return {
        pathname: location.pathname,
        markerPresent: localStorage.getItem('pixl:previous-private-session:v1') === 'seen',
        splashVisible: Boolean(document.querySelector('[data-testid="private-entry-splash-overlay"]')),
        landingVisible: Boolean(document.querySelector('[data-testid="text-landing-headline"]')),
        dashboardVisible: Boolean(document.querySelector('[data-testid="dashboard-primary-actions-mobile"]')),
        elapsedSinceSplashStart: performance.now() - startedAt,
      };
    })()`, page.sessionId);
    assert.equal(signedOutHome.pathname, '/', 'confirmed signed-out visitors should remain on the public home page');
    assert.equal(signedOutHome.markerPresent, false, 'confirmed sign-out should clear the previous-session marker');
    assert.equal(signedOutHome.splashVisible, false, 'signed-out visitors must bypass the remaining private splash delay');
    assert.equal(signedOutHome.landingVisible, true, 'confirmed signed-out visitors should reach the public landing');
    assert.equal(signedOutHome.dashboardVisible, false, 'signed-out startup must never expose dashboard content');
    assert.ok(signedOutHome.elapsedSinceSplashStart < -50_000,
      'the landing should appear while the private splash still has more than fifty seconds remaining');

    const navigateStartupCase = async (viewer: 'startup-signed-out' | 'startup-blocked') => {
      await connection!.evaluate(
        'localStorage.setItem("pixl:previous-private-session:v1", "seen")',
        page!.sessionId,
      );
      await connection!.send('Page.navigate', {
        url: `http://127.0.0.1:${vitePort}/studio?viewer=${viewer}&outcome=${viewer === 'startup-blocked' ? 'blocked' : 'signed-out'}`,
      }, page!.sessionId);
      await waitFor(connection!, page!.sessionId,
        'Boolean(document.querySelector("[data-testid=private-entry-splash-overlay]"))', Boolean, 30_000);
      await waitFor(connection!, page!.sessionId,
        'Boolean(document.querySelector("#root > div[aria-hidden=true][inert]"))', Boolean, 10_000);
      await assertCoveredApp(`${viewer} while Clerk is pending`);
      assert.equal(
        await connection!.evaluate('window.__startupLifecycleRequests', page!.sessionId),
        0,
        'account lifecycle verification must wait for Clerk to resolve',
      );
      await connection!.evaluate('window.__restoreStartupSession()', page!.sessionId);
    };

    await navigateStartupCase('startup-signed-out');
    await waitFor(connection, page.sessionId,
      'location.pathname === "/sign-in" && !document.querySelector("[data-testid=private-entry-splash-overlay]")',
      Boolean, 20_000);
    assert.equal(
      await connection.evaluate('Boolean(document.querySelector("[data-testid=identity-blocked-account-page]"))', page.sessionId),
      false,
      'a confirmed signed-out visitor must not be shown the blocked-account outcome',
    );

    await navigateStartupCase('startup-blocked');
    await waitFor(connection, page.sessionId,
      'window.__startupLifecycleRequests > 0 && Boolean(window.__restoreStartupLifecycle)', Boolean, 20_000);
    await assertCoveredApp('while blocked account lifecycle is pending');
    const blockedLifecycleGate = await connection.evaluate<{
      hidden: boolean;
      inert: boolean;
      visible: string;
    }>(`(() => {
      const app = document.querySelector('#root > div[aria-hidden="true"][inert]');
      return {
        hidden: Boolean(app && getComputedStyle(app).visibility === 'hidden'),
        inert: Boolean(app?.inert),
        visible: getComputedStyle(app).visibility,
      };
    })()`, page.sessionId);
    assert.deepEqual(blockedLifecycleGate, { hidden: true, inert: true, visible: 'hidden' },
      'the dashboard must stay hidden and inert until the blocked lifecycle response is received');
    await connection.evaluate('window.__restoreStartupLifecycle(true)', page.sessionId);
    await waitFor(connection, page.sessionId, `(
      Boolean(document.querySelector('[data-testid="identity-blocked-account-page"]'))
      && !document.querySelector('[data-testid="private-entry-splash-overlay"]')
    )`, Boolean, 15_000);
    assert.equal(
      await connection.evaluate('Boolean(document.querySelector("[data-testid=dashboard-primary-actions-mobile]"))', page.sessionId),
      false,
      'a blocked identity must not reach dashboard actions',
    );
    assert.equal(
      await connection.evaluate('Boolean(document.querySelector("#root > div[aria-hidden=true][inert]"))', page.sessionId),
      false,
      'the blocked-account outcome should be exposed after the startup overlay is removed',
    );
  } catch (error) {
    console.error('Returning-session startup browser failure', JSON.stringify({
      error: error instanceof Error ? error.stack || error.message : String(error),
      pageErrors: page && connection
        ? await connection.evaluate('window.__startupConsoleErrors || []', page.sessionId).catch(() => [])
        : [],
      vite: viteMonitor?.diagnostics(),
      browser: browserMonitor?.diagnostics(),
      devtools: connection?.diagnostics(),
    }));
    throw error;
  } finally {
    if (page) await connection?.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    await stopProcess(browser, browserMonitor).catch((error) => {
      console.error('Could not stop returning-session Chromium', error instanceof Error ? error.message : String(error));
    });
    await stopProcess(vite, viteMonitor).catch((error) => {
      console.error('Could not stop returning-session Vite', error instanceof Error ? error.message : String(error));
    });
    await rm(browserProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((error) => {
      console.error('Could not remove the returning-session Chromium profile', error instanceof Error ? error.message : String(error));
    });
  }
});