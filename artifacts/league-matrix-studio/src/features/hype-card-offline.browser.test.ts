import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

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

function waitForExit(process: ChildProcess) {
  return new Promise<void>((resolveExit) => process.once('exit', () => resolveExit()));
}

async function waitForUrl(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function contentType(pathname: string) {
  return pathname.endsWith('.js') ? 'text/javascript'
    : pathname.endsWith('.css') ? 'text/css'
      : pathname.endsWith('.json') || pathname.endsWith('.webmanifest') ? 'application/json'
        : pathname.endsWith('.png') ? 'image/png'
          : pathname.endsWith('.svg') ? 'image/svg+xml'
            : 'text/html';
}

async function serveProductionBuild() {
  const server = createServer(async (request, response) => {
    const requestPath = new URL(request.url || '/', 'http://127.0.0.1').pathname;
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

class DevToolsConnection {
  private readonly socket: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (reason: unknown) => void;
  }>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'DevTools command failed'));
      else pending.resolve(message.result);
    });
  }

  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolveOpen, reject) => {
      socket.addEventListener('open', () => resolveOpen());
      socket.addEventListener('error', () => reject(new Error('Could not connect to Chromium DevTools')));
    });
    return new DevToolsConnection(socket);
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const id = ++this.nextId;
    return new Promise<T>((resolveResult, rejectResult) => {
      this.pending.set(id, { resolve: resolveResult, reject: rejectResult });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async evaluate<T>(expression: string, sessionId: string): Promise<T> {
    const result = await this.send<{
      result?: { value?: T };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'Browser evaluation failed',
      );
    }
    return result.result?.value as T;
  }

  close() {
    this.socket.close();
  }
}

async function openPage(connection: DevToolsConnection, url: string, offline = false) {
  const target = await connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
  const attached = await connection.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const { sessionId } = attached;
  await connection.send('Page.enable', {}, sessionId);
  await connection.send('Runtime.enable', {}, sessionId);
  await connection.send('Network.enable', {}, sessionId);
  if (offline) {
    await connection.send('Page.addScriptToEvaluateOnNewDocument', {
      source: "Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });",
    }, sessionId);
    await connection.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    }, sessionId);
  }
  await connection.send('Page.navigate', { url }, sessionId);
  return { sessionId, targetId: target.targetId };
}

async function waitFor<T>(
  page: DevToolsConnection,
  sessionId: string,
  expression: string,
  predicate: (value: T) => boolean,
  timeoutMs = 15_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await page.evaluate<T>(expression, sessionId);
    if (predicate(value)) return value;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  const diagnostic = await page.evaluate<{ href: string; body: string }>(
    '({ href: location.href, body: document.body?.innerText ?? "" })',
    sessionId,
  ).catch(() => ({ href: 'unavailable', body: 'unavailable' }));
  throw new Error(`Timed out waiting for browser condition (${diagnostic.href}; ${diagnostic.body.slice(0, 300)})`);
}

async function click(connection: DevToolsConnection, sessionId: string, selector: string) {
  await connection.evaluate(
    `document.querySelector(${JSON.stringify(selector)})?.click()`,
    sessionId,
  );
}

test('installed Hype Card editor restores and exports a local design offline', async () => {
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

  const { server, address } = await serveProductionBuild();
  const tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-hype-card-offline-'));
  const downloadDirectory = resolve(tempDirectory, 'downloads');
  const browserProfile = resolve(tempDirectory, 'browser');
  const debugProbe = createServer();
  const { port: debugPort } = await listen(debugProbe);
  await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));

  let browser: ChildProcess | undefined;
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
    ], { stdio: 'ignore' });
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl);
    await connection.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDirectory,
    });

    const firstPage = await openPage(connection, editorUrl);
    pages.push(firstPage);
    await waitFor(connection, firstPage.sessionId, 'document.body?.innerText ?? ""', (body) => body.toLowerCase().includes('hype cards'), 30_000);
    await waitFor(
      connection,
      firstPage.sessionId,
      'navigator.serviceWorker?.ready.then((registration) => Boolean(registration.active))',
      Boolean,
      30_000,
    );

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
    const offlinePage = await openPage(connection, editorUrl, true);
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
    await click(connection, offlinePage.sessionId, 'button[aria-label="Publish Hype Card player page"]');
    await waitFor(
      connection,
      offlinePage.sessionId,
      'document.body?.innerText ?? ""',
      (body) => body.toLowerCase().includes('reconnect to publish a player page.'),
    );

    await connection.evaluate(
      `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Export')?.click()`,
      offlinePage.sessionId,
    );
    await waitFor(
      connection,
      offlinePage.sessionId,
      'document.body?.innerText ?? ""',
      (body) => !body.toLowerCase().includes('could not generate the card for download.'),
      20_000,
    );
    const downloadDeadline = Date.now() + 20_000;
    let downloads: string[] = [];
    while (Date.now() < downloadDeadline) {
      downloads = await readdir(downloadDirectory).catch(() => []);
      if (downloads.some((file) => extname(file) === '.png')) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    assert.ok(downloads.some((file) => extname(file) === '.png'), 'Expected an offline PNG export');
  } finally {
    for (const page of pages) {
      await connection?.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    }
    connection?.close();
    browser?.kill('SIGTERM');
    if (browser) await waitForExit(browser);
    await rm(tempDirectory, { recursive: true, force: true });
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
});