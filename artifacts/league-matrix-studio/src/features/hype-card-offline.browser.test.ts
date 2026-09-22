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

async function serveProductionBuild(options: { serviceWorkerDelayMs?: number } = {}) {
  const server = createServer(async (request, response) => {
    const requestPath = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (requestPath.endsWith('/sw.js') && options.serviceWorkerDelayMs) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, options.serviceWorkerDelayMs));
    }
    const relativePath = decodeURIComponent(requestPath.replace(/^\/+/, ''));
    const requestedFile = resolve(productionDirectory, relativePath || 'index.html');
    const isSafePath = requestedFile === productionDirectory
      || requestedFile.startsWith(`${productionDirectory}/`);
    const filePath = isSafePath ? requestedFile : resolve(productionDirectory, 'index.html');

    try {
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) throw new Error('Not a file');
      response.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      createReadStream(resolve(productionDirectory, 'index.html')).pipe(response);
    }
  });
  const address = await listen(server);
  return { server, address: address.address };
}

async function click(connection: DevToolsConnection, sessionId: string, selector: string) {
  await connection.evaluate(
    `document.querySelector(${JSON.stringify(selector)})?.click()`,
    sessionId,
  );
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
  assert.ok(point && point.width > 0 && point.height > 0, `Expected a visible tap target: ${selector}`);
  await connection.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ id: 1, x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1 }],
  }, sessionId);
  await connection.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  }, sessionId);
}

test('installed Hype Card editor starts responsively and restores a local design offline', async () => {
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

  const { server, address } = await serveProductionBuild({ serviceWorkerDelayMs: 1_500 });
  const tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-hype-card-offline-'));
  const browserProfile = resolve(tempDirectory, 'browser');
  const debugProbe = createServer();
  const { port: debugPort } = await listen(debugProbe);
  await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));

  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  const pages: Array<{ sessionId: string; targetId: string }> = [];
  const editorUrl = `${address}${artifactBasePath}studio/hype-card`;

  try {
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${browserProfile}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);

    const firstPage = await openPage(connection, editorUrl, {
      viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      },
    });
    pages.push(firstPage);
    const firstVisibleContent = await waitFor<{
      visible: boolean;
      elapsedMs: number;
      viewport: { width: number; height: number };
    }>(
      connection,
      firstPage.sessionId,
      `(() => {
        const element = document.querySelector('.moment-studio');
        const rect = element?.getBoundingClientRect();
        return {
          visible: Boolean(element && rect && rect.width > 0 && rect.height > 0),
          elapsedMs: performance.now(),
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      })()`,
      (result) => result.visible,
      30_000,
    );
    assert.deepEqual(firstVisibleContent.viewport, { width: 390, height: 844 });
    assert.ok(
      firstVisibleContent.elapsedMs < 6_000,
      `First visible Hype Card content took ${Math.round(firstVisibleContent.elapsedMs)}ms`,
    );

    await connection.evaluate(`(() => {
      window.__pixlFirstStartupInteractionMs = null;
      document.addEventListener('click', () => {
        if (window.__pixlFirstStartupInteractionMs === null) {
          window.__pixlFirstStartupInteractionMs = performance.now();
        }
      }, { capture: true, once: true });
    })()`, firstPage.sessionId);
    const serviceWorkerStateBeforeTap = await connection.evaluate<string>(
      `navigator.serviceWorker?.getRegistration().then((registration) =>
        registration?.active?.state || registration?.installing?.state || registration?.waiting?.state || 'none'
      )`,
      firstPage.sessionId,
    );
    assert.notEqual(
      serviceWorkerStateBeforeTap,
      'activated',
      'The startup check must interact before service-worker installation finishes',
    );
    await tap(connection, firstPage.sessionId, 'button[aria-label="Preview"]');
    await waitFor(
      connection,
      firstPage.sessionId,
      'Boolean(document.querySelector(\'[data-testid="mobile-hype-preview-canvas"]\'))',
      Boolean,
      10_000,
    );
    const firstInteractionMs = await connection.evaluate<number | null>(
      'window.__pixlFirstStartupInteractionMs',
      firstPage.sessionId,
    );
    assert.ok(firstInteractionMs !== null, 'Expected the first phone-sized tap to be handled');
    assert.ok(
      firstInteractionMs < 8_000,
      `First Hype Card interaction took ${Math.round(firstInteractionMs)}ms`,
    );

    await waitFor(
      connection,
      firstPage.sessionId,
      'navigator.serviceWorker?.ready.then((registration) => Boolean(registration.active))',
      Boolean,
      30_000,
    );
    const serviceWorkerReadyMs = await connection.evaluate<number>('performance.now()', firstPage.sessionId);
    assert.ok(
      firstInteractionMs < serviceWorkerReadyMs,
      `The first interaction at ${Math.round(firstInteractionMs)}ms must happen before service-worker readiness at ${Math.round(serviceWorkerReadyMs)}ms`,
    );
    const largestStartupResources = await connection.evaluate<Array<{
      name: string;
      initiatorType: string;
      durationMs: number;
      bytes: number;
    }>>(
      `(() => {
        const interactionMs = window.__pixlFirstStartupInteractionMs ?? performance.now();
        return performance.getEntriesByType('resource')
          .filter((entry) => entry.startTime <= interactionMs)
          .map((entry) => {
            const resource = entry;
            const bytes = resource.transferSize || resource.encodedBodySize || resource.decodedBodySize || 0;
            return {
              name: new URL(resource.name).pathname,
              initiatorType: resource.initiatorType,
              durationMs: Math.round(resource.duration),
              bytes,
            };
          })
          .sort((left, right) => right.bytes - left.bytes || right.durationMs - left.durationMs)
          .slice(0, 5);
      })()`,
      firstPage.sessionId,
    );
    assert.ok(largestStartupResources.length > 0, 'Expected startup resource timing entries');
    console.log('Hype Card startup timing', JSON.stringify({
      viewport: firstVisibleContent.viewport,
      firstVisibleContentMs: Math.round(firstVisibleContent.elapsedMs),
      firstInteractionMs: Math.round(firstInteractionMs),
      serviceWorkerReadyMs: Math.round(serviceWorkerReadyMs),
      largestStartupResources,
    }));
    await click(connection, firstPage.sessionId, 'button[aria-label="Close card preview"]');
    await waitFor(
      connection,
      firstPage.sessionId,
      'Boolean(document.querySelector(\'[data-testid="mobile-hype-preview-canvas"]\'))',
      (visible) => !visible,
      10_000,
    );

    await waitFor(connection, firstPage.sessionId, 'document.body?.innerText ?? ""', (body) => body.toLowerCase().includes('hype cards'), 30_000);

    await connection.evaluate(`(() => {
      const input = Array.from(document.querySelectorAll('label')).find((label) => label.textContent?.includes('Custom moment'))?.querySelector('input');
      if (!input) throw new Error('Custom moment input not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'OFFLINE CHAMPIONSHIP');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, firstPage.sessionId);
    await connection.evaluate(
      `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Next: Media')?.click()`,
      firstPage.sessionId,
    );
    await waitFor(connection, firstPage.sessionId, 'document.body?.innerText ?? ""', (body) => body.toLowerCase().includes('media'));

    const pngData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await connection.evaluate(`(() => {
      const input = document.querySelector('input[type="file"][accept="image/*,video/*"]');
      if (!input) throw new Error('Media file input not found');
      const bytes = Uint8Array.from(atob(${JSON.stringify(pngData)}), (value) => value.charCodeAt(0));
      const file = new File([bytes], 'offline-photo.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, firstPage.sessionId);
    await waitFor(connection, firstPage.sessionId, 'document.body?.innerText ?? ""', (body) => body.toLowerCase().includes('media added'), 20_000);
    await waitFor(
      connection,
      firstPage.sessionId,
      'document.querySelector("img[src^=\\"data:image/png\\"]") !== null',
      Boolean,
      20_000,
    );
    await connection.evaluate(
      `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Rotate')?.click()`,
      firstPage.sessionId,
    );
    await waitFor(
      connection,
      firstPage.sessionId,
      `JSON.parse(localStorage.getItem('leaguematrix-hype-card-project-v2') || '{}')?.project?.headline`,
      (headline) => headline === 'OFFLINE CHAMPIONSHIP',
      10_000,
    );
    await waitFor(
      connection,
      firstPage.sessionId,
      `JSON.parse(localStorage.getItem('leaguematrix-hype-card-project-v2') || '{}')?.project?.photoTransform?.rotation`,
      (rotation) => rotation === 90,
      10_000,
    );

    await connection.send('Page.reload', { ignoreCache: false }, firstPage.sessionId);
    await waitFor(connection, firstPage.sessionId, 'navigator.serviceWorker?.controller !== null', Boolean, 30_000);
    await waitFor(
      connection,
      firstPage.sessionId,
      'document.querySelector("img[src^=\\"data:image/png\\"]") !== null',
      Boolean,
      20_000,
    );
    assert.equal(
      await connection.evaluate<string>(
        'document.querySelector("img[src^=\\"data:image/png\\"]")?.getAttribute("src")?.slice(0, 22) || ""',
        firstPage.sessionId,
      ),
      'data:image/png;base64,',
    );

    await connection.send('Target.closeTarget', { targetId: firstPage.targetId });
    pages.splice(0, 1);
    const offlinePage = await openPage(connection, editorUrl, { offline: true });
    pages.push(offlinePage);
    await waitFor(connection, offlinePage.sessionId, 'document.body?.innerText ?? ""', (body) => body.toLowerCase().includes('hype cards'), 20_000);
    await waitFor(
      connection,
      offlinePage.sessionId,
      'document.querySelector("img[src^=\\"data:image/png\\"]") !== null',
      Boolean,
      20_000,
    );
    assert.equal(
      await connection.evaluate<string>('location.pathname', offlinePage.sessionId),
      '/studio/hype-card',
    );
    assert.equal(
      await connection.evaluate<boolean>(
        'Boolean(document.querySelector("[data-testid=\\"hype-preview-canvas\\"]"))',
        offlinePage.sessionId,
      ),
      true,
    );
    assert.equal(
      await connection.evaluate<string>(
        `JSON.parse(localStorage.getItem('leaguematrix-hype-card-project-v2') || '{}')?.project?.headline || ''`,
        offlinePage.sessionId,
      ),
      'OFFLINE CHAMPIONSHIP',
    );

    await click(connection, offlinePage.sessionId, 'button[aria-label="Save design to cloud"]');
    await waitFor(
      connection,
      offlinePage.sessionId,
      'document.body?.innerText ?? ""',
      (body) => body.toLowerCase().includes('reconnect when you want to save it to the cloud.'),
    );
  } finally {
    for (const page of pages) {
      await connection?.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    }
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    await rm(tempDirectory, { recursive: true, force: true });
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
});