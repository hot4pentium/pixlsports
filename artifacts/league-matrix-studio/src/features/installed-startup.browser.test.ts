import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
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

async function tap(connection: DevToolsConnection, sessionId: string, selector: string) {
  const point = await connection.evaluate<{ x: number; y: number; width: number; height: number } | null>(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
    })()`,
    sessionId,
  );
  assert.ok(point && point.width > 0 && point.height > 0, `Expected a visible phone tap target: ${selector}`);
  await connection.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ id: 1, x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1 }],
  }, sessionId);
  await connection.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  }, sessionId);
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
  const coldStartUrl = `${productionServer.address}/studio/hype-card`;
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

    const coldPage = await openPage(connection, coldStartUrl, { viewport: phoneViewport });
    pages.push(coldPage);
    const firstShell = await waitFor<{
      visible: boolean;
      elapsedMs: number;
      viewport: { width: number; height: number };
    }>(
      connection,
      coldPage.sessionId,
      `(() => {
        const editor = document.querySelector('.moment-studio');
        const rect = editor?.getBoundingClientRect();
        return {
          visible: Boolean(editor && rect && rect.width > 0 && rect.height > 0),
          elapsedMs: performance.now(),
          viewport: { width: innerWidth, height: innerHeight },
        };
      })()`,
      (result) => result.visible,
      20_000,
    );
    assert.deepEqual(firstShell.viewport, { width: 390, height: 844 });
    assert.ok(firstShell.elapsedMs < 8_000, `First shell content took ${Math.round(firstShell.elapsedMs)}ms`);
    timingDiagnostics.firstShellContentMs = Math.round(firstShell.elapsedMs);

    await connection.evaluate(`(() => {
      window.__pixlStartupFirstInteractionMs = null;
      document.addEventListener('click', () => {
        if (window.__pixlStartupFirstInteractionMs === null) {
          window.__pixlStartupFirstInteractionMs = performance.now();
        }
      }, { capture: true, once: true });
    })()`, coldPage.sessionId);
    await tap(connection, coldPage.sessionId, 'button[aria-label="Preview"]');
    await waitFor(
      connection,
      coldPage.sessionId,
      'Boolean(document.querySelector(\'[data-testid="mobile-hype-preview-canvas"]\'))',
      Boolean,
      10_000,
    );
    const firstInteractionMs = await connection.evaluate<number | null>(
      'window.__pixlStartupFirstInteractionMs',
      coldPage.sessionId,
    );
    assert.ok(firstInteractionMs !== null, 'Expected the first phone-sized interaction to be handled');
    assert.ok(firstInteractionMs < 10_000, `First handled interaction took ${Math.round(firstInteractionMs)}ms`);
    timingDiagnostics.firstHandledInteractionMs = Math.round(firstInteractionMs);

    await waitFor(
      connection,
      coldPage.sessionId,
      'navigator.serviceWorker?.ready.then((registration) => Boolean(registration.active))',
      Boolean,
      30_000,
    );
    const serviceWorkerReadyMs = await connection.evaluate<number>('performance.now()', coldPage.sessionId);
    timingDiagnostics.serviceWorkerReadyMs = Math.round(serviceWorkerReadyMs);
    const workerControlledColdPage = await connection.evaluate<boolean>(
      'Boolean(navigator.serviceWorker?.controller)',
      coldPage.sessionId,
    );
    assert.ok(firstInteractionMs < serviceWorkerReadyMs, 'The first handled interaction should precede service-worker readiness');

    const startupResources = await connection.evaluate<Array<{
      name: string;
      initiatorType: string;
      durationMs: number;
      bytes: number;
    }>>(
      `performance.getEntriesByType('resource')
        .filter((entry) => entry.startTime <= ${firstInteractionMs})
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
      0,
      'The warmed /studio shell must render before the deliberately delayed HTML response',
    );
    assert.equal(
      warmStudioHtmlRequestsBeforeContent,
      0,
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

    console.log('Installed app startup timing', JSON.stringify({
      viewport: firstShell.viewport,
      firstShellContentMs: Math.round(firstShell.elapsedMs),
      firstHandledInteractionMs: Math.round(firstInteractionMs),
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