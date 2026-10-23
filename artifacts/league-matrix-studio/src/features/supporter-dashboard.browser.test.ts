import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkPairedHubInWebKit } from './supporter-hub-webkit-check';
import { checkSavedHypeCardOwnerApi } from './supporter-hype-card-api-browser-check';
import {
  monitorProcess,
  waitForUrl,
  type ProcessMonitor,
} from './browser-test-diagnostics';

const chromiumPath = process.env.CHROMIUM_PATH || 'chromium';
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let browserTestLock = Promise.resolve();
let browserRunSequence = 0;

function fixturePaths(prefix: string) {
  const suffix = `${process.pid}-${++browserRunSequence}`;
  return {
    harnessPath: resolve(appDirectory, `${prefix}-${suffix}.tsx`),
    htmlPath: resolve(appDirectory, `${prefix}-${suffix}.html`),
  };
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function acquireBrowserTestLock() {
  const previous = browserTestLock;
  let release!: () => void;
  browserTestLock = new Promise<void>((resolveRelease) => {
    release = resolveRelease;
  });
  await previous;
  return release;
}

function listen(server: Server) {
  return new Promise<{ port: number }>((resolveAddress, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected a TCP server address'));
        return;
      }
      resolveAddress({ port: address.port });
    });
  });
}

class DevToolsConnection {
  private readonly socket: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (reason: unknown) => void;
    sessionId?: string;
  }>();
  private readonly sessionErrors = new Map<string, Error>();
  private readonly targetSessions = new Map<string, string>();
  private readonly lifecycleDiagnostics: string[] = [];
  private readonly eventWaiters = new Set<{
    method: string;
    sessionId?: string;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  private constructor(
    socket: WebSocket,
    private readonly processDiagnostics?: () => string,
  ) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      let message: {
        id?: number;
        result?: unknown;
        error?: { message?: string };
        method?: string;
        params?: Record<string, any>;
        sessionId?: string;
      };
      try {
        message = JSON.parse(String(event.data));
      } catch (error) {
        this.recordLifecycleDiagnostic(`Could not parse a Chromium DevTools message: ${String(error)}`);
        return;
      }
      this.handleLifecycleEvent(message);
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'DevTools command failed'));
      else pending.resolve(message.result);
    });
    socket.addEventListener('error', () => {
      this.rejectPending(this.connectionError('Chromium DevTools reported a socket error'));
    });
    socket.addEventListener('close', () => {
      this.rejectPending(this.connectionError('Chromium DevTools connection closed'));
    });
  }

  private connectionError(description: string) {
    return new Error(this.processDiagnostics
      ? `${description}; ${this.processDiagnostics()}`
      : description);
  }

  private recordLifecycleDiagnostic(description: string) {
    this.lifecycleDiagnostics.push(description);
    if (this.lifecycleDiagnostics.length > 8) this.lifecycleDiagnostics.shift();
  }

  private rejectPending(error: Error, sessionId?: string) {
    for (const [id, pending] of this.pending) {
      if (sessionId && pending.sessionId !== sessionId) continue;
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private failSession(sessionId: string | undefined, description: string) {
    if (!sessionId) return;
    const error = new Error(this.processDiagnostics
      ? `${description}; ${this.processDiagnostics()}`
      : description);
    this.sessionErrors.set(sessionId, error);
    this.rejectPending(error, sessionId);
  }

  private handleLifecycleEvent(message: {
    method?: string;
    params?: Record<string, any>;
    sessionId?: string;
  }) {
    if (message.method) {
      for (const waiter of this.eventWaiters) {
        if (waiter.method !== message.method || (waiter.sessionId && waiter.sessionId !== message.sessionId)) continue;
        clearTimeout(waiter.timer);
        this.eventWaiters.delete(waiter);
        waiter.resolve();
      }
    }
    if (message.method === 'Page.crash') {
      const reason = message.params?.reason || 'unknown reason';
      this.recordLifecycleDiagnostic(`Chromium page crashed: ${reason}`);
      this.failSession(message.sessionId, `Chromium page crashed (${reason})`);
    } else if (message.method === 'Target.targetCrashed') {
      const targetId = message.params?.targetId;
      const status = message.params?.status || 'unknown status';
      const errorCode = message.params?.errorCode;
      const sessionId = targetId ? this.targetSessions.get(targetId) : undefined;
      const description = `Chromium target crashed (${status}${errorCode === undefined ? '' : `, error code ${errorCode}`})`;
      this.recordLifecycleDiagnostic(description);
      this.failSession(sessionId, description);
    } else if (message.method === 'Target.detachedFromTarget') {
      const sessionId = message.params?.sessionId;
      const reason = message.params?.reason || 'unknown reason';
      const description = `Chromium detached the inspected target (${reason})`;
      this.recordLifecycleDiagnostic(description);
      this.failSession(sessionId, description);
    } else if (message.method === 'Inspector.detached') {
      const reason = message.params?.reason || 'unknown reason';
      const description = `Chromium inspector detached from the page (${reason})`;
      this.recordLifecycleDiagnostic(description);
      this.failSession(message.sessionId, description);
    }
  }

  static async connect(url: string, processDiagnostics?: () => string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolveOpen, reject) => {
      socket.addEventListener('open', () => resolveOpen());
      socket.addEventListener('error', () => reject(new Error('Could not connect to Chromium DevTools')));
    });
    return new DevToolsConnection(socket, processDiagnostics);
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const sessionError = sessionId ? this.sessionErrors.get(sessionId) : undefined;
    if (sessionError) return Promise.reject(sessionError);
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(this.connectionError('Cannot send a Chromium DevTools command because the socket is closed'));
    }
    const id = ++this.nextId;
    return new Promise<T>((resolveResult, rejectResult) => {
      this.pending.set(id, { resolve: resolveResult, reject: rejectResult, sessionId });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  registerTarget(targetId: string, sessionId: string) {
    this.targetSessions.set(targetId, sessionId);
  }

  waitForEvent(method: string, sessionId?: string, timeoutMs = 10_000) {
    return new Promise<void>((resolve, reject) => {
      let waiter!: {
        method: string;
        sessionId?: string;
        resolve: () => void;
        timer: ReturnType<typeof setTimeout>;
      };
      const timer = setTimeout(() => {
        this.eventWaiters.delete(waiter);
        reject(new Error(this.processDiagnostics
          ? `Timed out waiting for Chromium DevTools event ${method}; ${this.processDiagnostics()}`
          : `Timed out waiting for Chromium DevTools event ${method}`));
      }, timeoutMs);
      waiter = { method, sessionId, resolve, timer };
      this.eventWaiters.add(waiter);
    });
  }

  diagnostics() {
    return this.lifecycleDiagnostics.length > 0
      ? this.lifecycleDiagnostics.join(' | ')
      : 'no Chromium page lifecycle events were captured';
  }

  async evaluate<T>(expression: string, sessionId: string): Promise<T> {
    const result = await this.send<{
      result?: { value?: T; description?: string };
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

async function openPage(connection: DevToolsConnection, url: string) {
  const target = await connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
  const attached = await connection.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const { sessionId } = attached;
  await connection.send('Page.enable', {}, sessionId);
  await connection.send('Runtime.enable', {}, sessionId);
  connection.registerTarget(target.targetId, sessionId);
  await connection.send('Page.bringToFront', {}, sessionId);
  await connection.send('Page.navigate', { url }, sessionId);
  return { sessionId, targetId: target.targetId };
}

async function reloadPage(
  connection: DevToolsConnection,
  page: { sessionId: string; targetId: string },
) {
  const loadEvent = connection.waitForEvent('Page.loadEventFired', page.sessionId);
  await connection.send('Page.reload', { ignoreCache: true }, page.sessionId);
  await loadEvent;
}

async function navigatePage(
  connection: DevToolsConnection,
  page: { sessionId: string; targetId: string },
  url: string,
) {
  const loadEvent = connection.waitForEvent('Page.loadEventFired', page.sessionId);
  await connection.send('Page.navigate', { url }, page.sessionId);
  await loadEvent;
}

async function waitFor<T>(
  page: DevToolsConnection,
  sessionId: string,
  expression: string,
  predicate: (value: T) => boolean,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let value: T;
    try {
      value = await page.evaluate<T>(expression, sessionId);
    } catch (error) {
      throw new Error(`Browser condition failed: ${expression}; ${error instanceof Error ? error.message : String(error)}; ${page.diagnostics()}`);
    }
    if (predicate(value)) return value;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  const diagnostic = await page.evaluate<{ body: string; html: string; readyState: string; url: string; testError?: string; root: string; resources: string[]; consoleErrors: string[] }>(
    '({ body: document.body?.innerText || "", html: document.documentElement?.outerHTML || "", readyState: document.readyState, url: location.href, testError: document.body?.dataset.testError, root: document.querySelector("#test-root")?.innerHTML || "", resources: performance.getEntriesByType("resource").map((entry) => entry.name).slice(-12), consoleErrors: window.__browserTestConsoleErrors || [] })',
    sessionId,
  ).catch((error) => ({
    body: `unavailable: ${error instanceof Error ? error.message : String(error)}`,
    html: '',
    readyState: 'unavailable',
    url: 'unavailable',
    testError: undefined,
    root: '',
    resources: [],
    consoleErrors: [],
  }));
  throw new Error(
    `Timed out waiting for browser condition: ${expression}; testError=${diagnostic.testError || 'none'}; `
    + `url=${diagnostic.url}; readyState=${diagnostic.readyState}; body=${diagnostic.body.slice(0, 400)}; root=${diagnostic.root.slice(0, 600)}; resources=${JSON.stringify(diagnostic.resources)}; consoleErrors=${JSON.stringify(diagnostic.consoleErrors)}; html=${diagnostic.html.slice(0, 700)}; ${page.diagnostics()}`,
  );
}

test('supporter browser assertion failures still clean up Chromium and generated state', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-dashboard-cleanup-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;
  let forcedAssertionError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-supporter-dashboard-cleanup-'));

    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}`);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);

    assert.equal(await pathExists(fixtures.harnessPath), true);
    assert.equal(await pathExists(fixtures.htmlPath), true);
    assert.equal(await pathExists(tempDirectory), true);

    try {
      assert.equal(
        await connection.evaluate<string>('document.title', page.sessionId),
        'This assertion is intentionally wrong',
        'forced supporter browser assertion',
      );
    } catch (error) {
      forcedAssertionError = error;
    }
  } finally {
    try {
      if (page && connection) {
        await connection.send('Target.closeTarget', { targetId: page.targetId });
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      connection?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (browser && browserMonitor) {
        if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
        await browserMonitor.waitForExit();
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (devServer && devServerMonitor) {
        if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
        await devServerMonitor.waitForExit();
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await rm(fixtures.harnessPath, { force: true });
      await rm(fixtures.htmlPath, { force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    releaseBrowserTestLock();
  }

  assert.ok(forcedAssertionError instanceof Error, 'the forced browser assertion must fail');
  assert.match((forcedAssertionError as Error).message, /forced supporter browser assertion/);
  assert.deepEqual(
    cleanupErrors,
    [],
    `browser cleanup must not fail: ${cleanupErrors.map((error) => String(error)).join('; ')}`,
  );
  assert.equal(browserMonitor?.hasExited(), true, 'Chromium must exit after the assertion failure');
  assert.equal(await pathExists(tempDirectory!), false, 'the temporary Chromium profile must be removed');
  assert.equal(await pathExists(fixtures.harnessPath), false, 'the generated harness fixture must be removed');
  assert.equal(await pathExists(fixtures.htmlPath), false, 'the generated HTML fixture must be removed');
});

test('supporter dashboard checklist is self-paced, persistent, and responsive', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-dashboard-checklist-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  const waitForChecklist = async () => {
    if (!connection || !page) throw new Error('Browser page is not ready');
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") !== null',
      Boolean,
    );
  };

  const eventCardActionViewportStatus = async () => {
    if (!connection || !page) throw new Error('Browser page is not ready');
    return connection.evaluate<{
      visible: boolean;
      left: number;
      right: number;
      top: number;
      bottom: number;
      viewportWidth: number;
      viewportHeight: number;
      scrollY: number;
    }>(`(() => {
      const action = document.querySelector('[data-testid="dashboard-checklist-action-event-card"]');
      if (!(action instanceof HTMLElement)) {
        return {
          visible: false, left: -1, right: -1, top: -1, bottom: -1,
          viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, scrollY: window.scrollY,
        };
      }
      const rect = action.getBoundingClientRect();
      const style = getComputedStyle(action);
      return {
        visible: action.getClientRects().length > 0
          && rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.left >= 0
          && rect.right <= window.innerWidth
          && rect.top >= 0
          && rect.bottom <= window.innerHeight
          && window.scrollY === 0,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollY: window.scrollY,
      };
    })()`, page.sessionId);
  };

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-dashboard-checklist-'));
    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);

    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    const fixtureUrl = `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}`;
    page = await openPage(connection, `${fixtureUrl}?dashboard-checklist=eligible`);

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitForChecklist();
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") !== null',
      Boolean,
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"] h2")?.textContent?.trim()',
        page.sessionId,
      ),
      'Get to know your Dashboard',
      'the getting-started checklist should be visible inline',
    );
    const desktopEventCardAction = await eventCardActionViewportStatus();
    assert.equal(
      desktopEventCardAction.visible,
      true,
      `the Event Card checklist action should be visible without scrolling on desktop: ${JSON.stringify(desktopEventCardAction)}`,
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelectorAll("[data-testid^=\\"dashboard-checklist-checkbox-\\"]").length',
        page.sessionId,
      ),
      5,
      'all five checklist items should use manual checkboxes',
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"supporter-dashboard-tour\\"]") === null',
        page.sessionId,
      ),
      true,
      'the old blocking tour should not render',
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"dashboard-checklist-action-profile\\"]")?.getAttribute("href")?.length > 0 && document.querySelector("[data-testid=\\"dashboard-checklist-action-hype-card\\"]")?.getAttribute("href")?.length > 0',
        page.sessionId,
      ),
      true,
      'Profile and Hype Card actions should link to their existing destinations',
    );
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"dashboard-checklist-checkbox-profile\\"]")?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"dashboard-checklist-checkbox-profile\\"]")?.checked === true && window.__dashboardChecklistSaves?.length === 1',
      Boolean,
    );
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"dashboard-checklist-action-shoutouts\\"]")?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'Array.from(document.querySelectorAll("[role=\\"dialog\\"]")).some((dialog) => dialog.textContent?.includes("Shoutouts & Replies"))',
      Boolean,
    );

    await navigatePage(connection, page, `${fixtureUrl}?dashboard-checklist=skip`);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") !== null',
      Boolean,
    );
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"dashboard-checklist-dismiss\\"]")?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") === null && window.__dashboardChecklistDismissals?.length === 1',
      Boolean,
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") === null',
        page.sessionId,
      ),
      true,
      'a dismissed checklist should not return during the same account session',
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"dialog-dashboard-checklist-complete\\"]") === null',
        page.sessionId,
      ),
      true,
      'dismissing the checklist must not show the completion celebration',
    );

    await navigatePage(connection, page, `${fixtureUrl}?dashboard-checklist=install`);
    await waitForChecklist();
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"dashboard-checklist-action-install\\"]")?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"dashboard-checklist-action-install\\"]")?.getAttribute("aria-expanded") === "true"',
      Boolean,
    );

    await navigatePage(connection, page, `${fixtureUrl}?dashboard-checklist=failure`);
    await waitForChecklist();
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"dashboard-checklist-checkbox-install-app\\"]")?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"dashboard-checklist-error\\"]")?.textContent?.trim() === "Your checklist progress could not be saved. Try again."',
      Boolean,
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"dashboard-checklist-checkbox-install-app\\"]")?.checked === false && document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") !== null',
        page.sessionId,
      ),
      true,
      'a failed save should keep the item unchecked and leave the checklist retryable',
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"dialog-dashboard-checklist-complete\\"]") === null',
        page.sessionId,
      ),
      true,
      'a failed checklist save must not show the completion celebration',
    );

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await navigatePage(connection, page, `${fixtureUrl}?dashboard-checklist=create`);
    await waitForChecklist();
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") !== null',
      Boolean,
    );
    assert.equal(
      await connection.evaluate(`(() => {
        const checklist = document.querySelector('[data-testid="supporter-dashboard-checklist"]');
        if (!(checklist instanceof HTMLElement)) return false;
        const rect = checklist.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
      })()`, page.sessionId),
      true,
      'the checklist should fit within a phone viewport',
    );
    const phoneEventCardAction = await eventCardActionViewportStatus();
    assert.equal(
      phoneEventCardAction.visible,
      true,
      `the Event Card checklist action should be visible without scrolling on phone: ${JSON.stringify(phoneEventCardAction)}`,
    );
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"dashboard-checklist-checkbox-profile\\"]")?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"dashboard-checklist-checkbox-profile\\"]")?.checked === true && window.__dashboardChecklistSaves?.length === 1',
      Boolean,
    );
    const checklistProgressBeforeEventCard = await connection.evaluate<{
      checkedItemIds: string[];
      saveCount: number;
    }>(`(() => ({
      checkedItemIds: Array.from(document.querySelectorAll('[data-testid^="dashboard-checklist-checkbox-"]'))
        .filter((checkbox) => checkbox instanceof HTMLInputElement && checkbox.checked)
        .map((checkbox) => checkbox.getAttribute('data-testid')?.replace('dashboard-checklist-checkbox-', '') ?? ''),
      saveCount: window.__dashboardChecklistSaves?.length ?? 0,
    }))()`, page.sessionId);
    assert.deepEqual(checklistProgressBeforeEventCard, {
      checkedItemIds: ['profile'],
      saveCount: 1,
    }, 'the Event Card flow should start with saved checklist progress');
    let eventCardActionFocused = false;
    for (let tabCount = 0; tabCount < 100; tabCount += 1) {
      await connection.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      }, page.sessionId);
      await connection.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Tab',
        code: 'Tab',
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      }, page.sessionId);
      eventCardActionFocused = await connection.evaluate(
        'document.activeElement === document.querySelector("[data-testid=\\"dashboard-checklist-action-event-card\\"]")',
        page.sessionId,
      );
      if (eventCardActionFocused) break;
    }
    assert.equal(
      eventCardActionFocused,
      true,
      'keyboard Tab navigation should focus the Create an Event Card action',
    );
    assert.equal(
      await connection.evaluate<string>(
        `(() => {
          const action = document.activeElement;
          return action instanceof HTMLButtonElement
            ? action.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
            : '';
        })()`,
        page.sessionId,
      ),
      'Create an Event Card',
      'the focused checklist action should expose its expected button label',
    );
    await connection.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    }, page.sessionId);
    await connection.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
    }, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector(".supporter-dashboard-mobile-shell [data-testid^=\\"card-game-on-new-card-\\"]") !== null',
      Boolean,
    );
    await connection.evaluate(`(() => {
      const trigger = Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [data-testid^="button-open-game-on-card-new-card-"]'))
        .find((button) => button.getClientRects().length > 0);
      trigger?.click();
    })()`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid^=\\"dialog-game-on-card-new-card-\\"] [data-testid=\\"panel-game-on-card-draft\\"]") !== null',
      Boolean,
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") !== null',
        page.sessionId,
      ),
      true,
      'the Event Card editor should open without dismissing the checklist',
    );
    assert.deepEqual(
      await connection.evaluate<{
        checkedItemIds: string[];
        saveCount: number;
      }>(`(() => ({
        checkedItemIds: Array.from(document.querySelectorAll('[data-testid^="dashboard-checklist-checkbox-"]'))
          .filter((checkbox) => checkbox instanceof HTMLInputElement && checkbox.checked)
          .map((checkbox) => checkbox.getAttribute('data-testid')?.replace('dashboard-checklist-checkbox-', '') ?? ''),
        saveCount: window.__dashboardChecklistSaves?.length ?? 0,
      }))()`, page.sessionId),
      checklistProgressBeforeEventCard,
      'opening the Event Card editor should leave checklist progress unchanged',
    );
    await connection.evaluate(
      'document.querySelector("[data-testid^=\\"dialog-game-on-card-new-card-\\"] [aria-label=\\"Close Event Card\\"]")?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid^=\\"dialog-game-on-card-new-card-\\"]") === null',
      Boolean,
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") !== null',
        page.sessionId,
      ),
      true,
      'closing the Event Card editor should return supporters to the checklist',
    );
    assert.deepEqual(
      await connection.evaluate<{
        checkedItemIds: string[];
        saveCount: number;
      }>(`(() => ({
        checkedItemIds: Array.from(document.querySelectorAll('[data-testid^="dashboard-checklist-checkbox-"]'))
          .filter((checkbox) => checkbox instanceof HTMLInputElement && checkbox.checked)
          .map((checkbox) => checkbox.getAttribute('data-testid')?.replace('dashboard-checklist-checkbox-', '') ?? ''),
        saveCount: window.__dashboardChecklistSaves?.length ?? 0,
      }))()`, page.sessionId),
      checklistProgressBeforeEventCard,
      'closing the Event Card editor should preserve the same saved checklist progress',
    );
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"dashboard-checklist-checkbox-shoutouts\\"]")?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"dashboard-checklist-checkbox-shoutouts\\"]")?.checked === true && window.__dashboardChecklistSaves?.length === 2',
      Boolean,
    );
    assert.deepEqual(
      await connection.evaluate<{
        checkedItemIds: string[];
        saveCount: number;
      }>(`(() => ({
        checkedItemIds: Array.from(document.querySelectorAll('[data-testid^="dashboard-checklist-checkbox-"]'))
          .filter((checkbox) => checkbox instanceof HTMLInputElement && checkbox.checked)
          .map((checkbox) => checkbox.getAttribute('data-testid')?.replace('dashboard-checklist-checkbox-', '') ?? ''),
        saveCount: window.__dashboardChecklistSaves?.length ?? 0,
      }))()`, page.sessionId),
      {
        checkedItemIds: ['profile', 'shoutouts'],
        saveCount: 2,
      },
      'supporters should be able to continue and save checklist progress after closing the Event Card editor',
    );

    await navigatePage(connection, page, `${fixtureUrl}?dashboard-checklist=complete`);
    await waitForChecklist();
    for (const itemId of ['profile', 'shoutouts', 'hype-card', 'event-card', 'install-app']) {
      await connection.evaluate(
        `document.querySelector("[data-testid=\\"dashboard-checklist-checkbox-${itemId}\\"]")?.click()`,
        page.sessionId,
      );
      await waitFor(
        connection,
        page.sessionId,
        `window.__dashboardChecklistSaves?.some((items) => items.includes("${itemId}"))`,
        Boolean,
      );
    }
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") === null',
      Boolean,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"dialog-dashboard-checklist-complete\\"]") !== null',
      Boolean,
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    const confettiPresentation = await connection.evaluate<{
      pieces: number;
      visiblePieces: number;
      backgrounds: string[];
      animations: string[];
    }>(`(() => {
        const pieces = Array.from(document.querySelectorAll('.tracker-completion-confetti'));
        return {
          pieces: pieces.length,
          visiblePieces: pieces.filter((piece) => Number(getComputedStyle(piece).opacity) > 0.5).length,
          backgrounds: Array.from(new Set(pieces.map((piece) => getComputedStyle(piece).backgroundColor))),
          animations: Array.from(new Set(pieces.map((piece) => getComputedStyle(piece).animationName))),
        };
      })()`, page.sessionId);
    assert.deepEqual(confettiPresentation, {
      pieces: 14,
      visiblePieces: 14,
      backgrounds: ['rgb(231, 243, 255)', 'rgb(113, 201, 255)', 'rgb(248, 215, 114)'],
      animations: ['tracker-confetti-fall'],
    }, 'all confetti pieces should be visible in contrasting colors during the celebration');
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"dialog-dashboard-checklist-complete\\"]")?.getAttribute("aria-modal")',
        page.sessionId,
      ),
      'true',
      'completing the final checklist item should open the accessible celebration dialog',
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"dashboard-checklist-completion-title\\"]")?.textContent?.trim()',
        page.sessionId,
      ),
      'Warm-up complete. You’re game-ready! 🏆',
      'the celebration should use the supplied heading exactly',
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"dashboard-checklist-completion-description\\"]")?.textContent?.trim()',
        page.sessionId,
      ),
      'Your setup is done. Let’s make this season one to remember.',
      'the celebration should use the supplied body exactly',
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"button-dashboard-checklist-completion-done\\"]")?.textContent?.trim()',
        page.sessionId,
      ),
      'Let’s Play',
      'the primary action should use the supplied label',
    );
    await waitFor(
      connection,
      page.sessionId,
      `(() => {
        const dialog = document.querySelector('[data-testid="dialog-dashboard-checklist-complete"]');
        if (!(dialog instanceof HTMLElement)) return false;
        const rect = dialog.getBoundingClientRect();
        return rect.width > 0
          && rect.left >= 0
          && rect.right <= window.innerWidth
          && rect.top >= 0
          && rect.bottom <= window.innerHeight;
      })()`,
      Boolean,
    );
    const completionDialogBounds = await connection.evaluate<{
      left: number;
      right: number;
      top: number;
      bottom: number;
      width: number;
      height: number;
      viewportWidth: number;
      viewportHeight: number;
    }>(`(() => {
        const dialog = document.querySelector('[data-testid="dialog-dashboard-checklist-complete"]');
        if (!(dialog instanceof HTMLElement)) {
          return {
            left: -1, right: -1, top: -1, bottom: -1, width: 0, height: 0,
            viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
          };
        }
        const rect = dialog.getBoundingClientRect();
        return {
          left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: rect.width, height: rect.height,
          viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
        };
      })()`, page.sessionId);
    assert.ok(
      completionDialogBounds.width > 0
        && completionDialogBounds.left >= 0
        && completionDialogBounds.right <= completionDialogBounds.viewportWidth
        && completionDialogBounds.top >= 0
        && completionDialogBounds.bottom <= completionDialogBounds.viewportHeight,
      `the celebration dialog should fit within a phone-sized viewport: ${JSON.stringify(completionDialogBounds)}`,
    );
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"button-dashboard-checklist-completion-done\\"]")?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"dialog-dashboard-checklist-complete\\"]") === null',
      Boolean,
    );
    assert.equal(
      await connection.evaluate('document.activeElement?.id', page.sessionId),
      'game-on-summary-heading-mobile',
      'closing the celebration should return focus to the dashboard heading after the checklist disappears',
    );
    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"section-athlete-fan-card\\"]") !== null',
      Boolean,
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") === null && document.querySelector("[data-testid=\\"dialog-dashboard-checklist-complete\\"]") === null',
        page.sessionId,
      ),
      true,
      'restoring a saved completed checklist after reload must not replay the celebration',
    );

    await navigatePage(connection, page, `${fixtureUrl}?dashboard-checklist=remote`);
    await waitForChecklist();
    await connection.evaluate('window.__applyRemoteDashboardChecklistCompletion?.()', page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") === null',
      Boolean,
    );
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"dialog-dashboard-checklist-complete\\"]") === null',
        page.sessionId,
      ),
      true,
      'a remote completion update must not replay the celebration',
    );

    await navigatePage(connection, page, `${fixtureUrl}?dashboard-checklist=existing`);
    assert.equal(
      await connection.evaluate(
        'document.querySelector("[data-testid=\\"supporter-dashboard-checklist\\"]") === null',
        page.sessionId,
      ),
      true,
      'supporters without explicit new-account eligibility should not see the checklist',
    );
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit().catch(() => undefined);
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit().catch(() => undefined);
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('desktop dashboard shows stat trends while mobile keeps the Event Card graphic', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-add-event-navigation-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-add-event-navigation-'));
    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);

    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}`);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]"))', Boolean);
    await connection.evaluate('window.__setSupporterDashboardEvents([])', page.sessionId);
    await connection.evaluate(`(() => {
      window.__installAnalyticsEvents = [];
      window.__installAnalyticsThrows = false;
      window.umami = {
        track(name, data) {
          window.__installAnalyticsEvents.push({ name, data });
          if (window.__installAnalyticsThrows) throw new Error('analytics unavailable');
        },
      };
    })()`, page.sessionId);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="section-next-game-context"]\')?.textContent || ""', page.sessionId),
      /No upcoming games or practices/,
    );
    await connection.evaluate(`(() => {
      const dateAfterDays = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      window.__setSupporterDashboardEvents([
        { id: 'past-game', type: 'game', date: '2020-01-01', time: '18:30', location: 'Old Gym', opponent: 'Past Team', status: 'final' },
        { id: 'future-meeting', type: 'meeting', date: dateAfterDays(6), time: '18:00', location: 'Clubhouse', status: 'upcoming' },
        { id: 'future-game-1', type: 'game', date: dateAfterDays(7), time: '18:30', location: 'Northside Gym', opponent: 'Visitors', status: 'upcoming' },
        { id: 'future-practice', type: 'practice', date: dateAfterDays(8), time: '17:00', location: 'Field 2', notes: 'Team practice', status: 'upcoming' },
        { id: 'future-game-2', type: 'game', date: dateAfterDays(9), time: '19:00', location: 'Eastside Gym', opponent: 'Rivals', status: 'upcoming' },
      ]);
    })()`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelectorAll(\'[data-testid="section-next-game-context"] [data-testid="upcoming-calendar-event"]\').length === 3',
      Boolean,
    );
    assert.deepEqual(
      await connection.evaluate<Array<[string | null, string | null]>>(
        `Array.from(document.querySelectorAll('[data-testid="section-next-game-context"] [data-testid="upcoming-calendar-event"]'))
          .map((event) => [event.getAttribute('data-event-id'), event.getAttribute('data-event-type')])`,
        page.sessionId,
      ),
      [
        ['future-game-1', 'game'],
        ['future-practice', 'practice'],
        ['future-game-2', 'game'],
      ],
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="section-next-game-context"] [data-testid="upcoming-calendar-events"]\')?.textContent || ""', page.sessionId),
      /Visitors.*Practice.*Rivals/s,
    );
    await waitFor(
      connection,
      page.sessionId,
      'Boolean(document.querySelector(\'[data-testid="supporter-stat-trends"]\'))',
      Boolean,
    );
    const desktopTrend = await connection.evaluate<{
      visible: boolean;
      heading: string;
      desktopBadgeVisible: boolean;
      badgeAlignedWithTrend: boolean;
      alignmentGeometry: string;
      hasTrendContent: boolean;
      eventContextScreenReaderOnly: boolean;
      trendHeight: number;
      eventPanelHeight: number;
      shoutoutsPanelHeight: number;
      recordPanelHeight: number;
    }>(`(() => {
      const trend = document.querySelector('[data-testid="supporter-stat-trends"]');
      const rect = trend?.getBoundingClientRect();
      const summary = document.querySelector('.supporter-game-on-summary--desktop');
      const badge = document.querySelector('[data-testid="img-upcoming-event-card-desktop"]');
      const trendStage = trend?.closest('[data-testid="dashboard-stat-trends-panel"]');
      const trendRect = trend instanceof HTMLElement ? trend.getBoundingClientRect() : null;
      const badgeRect = badge instanceof HTMLElement ? badge.getBoundingClientRect() : null;
      const eventContext = summary?.querySelector('[data-testid="section-next-game-context"]');
      const panelHeight = (selector) => summary?.querySelector(selector)?.getBoundingClientRect().height || 0;
      return {
        visible: trend instanceof HTMLElement && trend.getClientRects().length > 0
          && Boolean(rect && rect.width > 0 && rect.height > 0),
        heading: trend?.querySelector('h2')?.textContent?.trim() || '',
        desktopBadgeVisible: badge instanceof HTMLImageElement && badge.complete && badge.naturalWidth > 0,
        badgeAlignedWithTrend: Boolean(trendStage
          && badge instanceof HTMLElement
          && badge.closest('.supporter-stat-trends-stage') === trendStage
          && trendRect && badgeRect
          && Math.abs(trendRect.top - badgeRect.top) <= 2
          && badgeRect.left >= trendRect.right
          && badgeRect.left - trendRect.right <= 10),
        alignmentGeometry: JSON.stringify({
          sameStage: Boolean(trendStage && badge instanceof HTMLElement && badge.closest('.supporter-stat-trends-stage') === trendStage),
          trend: trendRect && { left: trendRect.left, right: trendRect.right, top: trendRect.top, height: trendRect.height },
          badge: badgeRect && { left: badgeRect.left, right: badgeRect.right, top: badgeRect.top, height: badgeRect.height },
          stage: trendStage instanceof HTMLElement && {
            left: trendStage.getBoundingClientRect().left,
            right: trendStage.getBoundingClientRect().right,
            top: trendStage.getBoundingClientRect().top,
            height: trendStage.getBoundingClientRect().height,
          },
        }),
        hasTrendContent: Boolean(trend?.querySelector('[data-testid="supporter-stat-trends-chart"], [data-testid="supporter-stat-trends-empty"]')),
        eventContextScreenReaderOnly: eventContext?.classList.contains('sr-only') ?? false,
        trendHeight: rect?.height || 0,
        eventPanelHeight: panelHeight('.supporter-game-on-summary__event'),
        shoutoutsPanelHeight: panelHeight('.supporter-game-on-summary__replies'),
        recordPanelHeight: panelHeight('.supporter-game-on-summary__record'),
      };
    })()`, page.sessionId);
    assert.equal(desktopTrend.visible, true, 'the desktop dashboard displays the stat trends panel');
    assert.equal(desktopTrend.heading, 'STAT TRENDS');
    assert.equal(desktopTrend.desktopBadgeVisible, true, 'the generic Event Card artwork remains visible in the desktop event context');
    assert.equal(
      desktopTrend.badgeAlignedWithTrend,
      true,
      `the trend chart and Event Card artwork share one aligned stage: ${desktopTrend.alignmentGeometry}`,
    );
    assert.equal(desktopTrend.hasTrendContent, true, 'the chart or its honest empty state is visible');
    assert.equal(desktopTrend.eventContextScreenReaderOnly, true, 'upcoming Event Card details remain available without an empty visual panel');
    assert.ok([
      desktopTrend.trendHeight,
      desktopTrend.eventPanelHeight,
      desktopTrend.shoutoutsPanelHeight,
      desktopTrend.recordPanelHeight,
    ].every((height) => height > 0 && height <= 220),
    `the desktop trend, Shoutouts, and record remain compact: ${JSON.stringify(desktopTrend)}`);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    assert.equal(
      await connection.evaluate<number>(
        'document.querySelector(\'[data-testid="mobile-hero-banner"] [data-testid="upcoming-calendar-events"]\')?.querySelectorAll(\'[data-testid="upcoming-calendar-event"]\').length || 0',
        page.sessionId,
      ),
      3,
    );
    await waitFor(connection, page.sessionId,
      '(() => { const image = document.querySelector(\'[data-testid="img-upcoming-event-card-mobile"]\'); return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0; })()',
      Boolean);
    const mobileGraphic = await connection.evaluate<{
      visible: boolean;
      source: string;
      naturalRatio: number;
      renderedRatio: number;
      eventFaceRatio: number;
      noInteractiveWrapper: boolean;
      pairedWithHypeCard: boolean;
      badgeCategory: string;
      badgeTitle: string;
      expectedBadgeTitle: string;
      badgeDateTime: string;
      expectedBadgeDateTime: string;
    }>(`(() => {
      const image = document.querySelector('[data-testid="img-upcoming-event-card-mobile"]');
      const rect = image?.getBoundingClientRect();
      const face = document.querySelector('[data-testid="card-mobile-featured-event"]');
      const faceRect = face?.getBoundingClientRect();
      const row = document.querySelector('[data-testid="mobile-calendar-hype-row"]');
      const nextEvent = document.querySelector('[data-testid="mobile-hero-banner"] [data-testid="upcoming-calendar-event"]');
      return {
        visible: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
          && Boolean(rect && rect.width > 0 && rect.height > 0),
        source: image instanceof HTMLImageElement ? image.getAttribute('src') ?? '' : '',
        naturalRatio: image instanceof HTMLImageElement ? image.naturalWidth / image.naturalHeight : 0,
        renderedRatio: rect && rect.height > 0 ? rect.width / rect.height : 0,
        eventFaceRatio: faceRect && faceRect.height > 0 ? faceRect.width / faceRect.height : 0,
        noInteractiveWrapper: image instanceof HTMLImageElement && image.closest('a, button') === null,
        pairedWithHypeCard: row instanceof HTMLElement && row.children.length === 2
          && Boolean(row.querySelector('[data-testid="card-mobile-featured-event"]'))
          && Boolean(row.querySelector('[data-testid="mobile-saved-hype-card"]')),
        badgeCategory: image?.getAttribute('data-event-category') || '',
        badgeTitle: image?.getAttribute('data-event-title') || '',
        expectedBadgeTitle: nextEvent?.querySelector('[data-testid="upcoming-calendar-event-title"]')?.textContent?.trim() || '',
        badgeDateTime: image?.getAttribute('data-event-date-time') || '',
        expectedBadgeDateTime: nextEvent?.querySelector('[data-testid="upcoming-calendar-event-date"]')?.textContent?.trim() || '',
      };
    })()`, page.sessionId);
    assert.equal(mobileGraphic.visible, true, 'the supplied Event Card graphic is visible on mobile');
    assert.ok(
      mobileGraphic.source.startsWith('data:image/png;base64,'),
      'the native image preview receives a complete PNG, not the blank background artwork',
    );
    assert.equal(mobileGraphic.badgeCategory, 'Upcoming game');
    assert.equal(mobileGraphic.badgeTitle, mobileGraphic.expectedBadgeTitle, 'the badge names the next upcoming Event Card');
    assert.equal(mobileGraphic.badgeDateTime, mobileGraphic.expectedBadgeDateTime, 'the badge shows the next event date and time');
    const imagePixels = await connection.evaluate<{ title: number; dateTime: number }>(`(async () => {
      const displayed = document.querySelector('[data-testid="img-upcoming-event-card-mobile"]');
      const load = (src) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      });
      // Load the image source on its own, as a native long-press preview does.
      const standalone = await load(displayed.src);
      const base = await load(displayed.dataset.baseArtwork);
      const pixels = (image) => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const actual = pixels(standalone);
      const original = pixels(base);
      const differences = (top, bottom) => {
        let count = 0;
        for (let y = Math.floor(standalone.height * top); y < standalone.height * bottom; y++) {
          for (let x = Math.floor(standalone.width * 0.134); x < standalone.width * 0.92; x++) {
            const index = (y * standalone.width + x) * 4;
            if (Math.abs(actual[index] - original[index]) > 30
              || Math.abs(actual[index + 1] - original[index + 1]) > 30
              || Math.abs(actual[index + 2] - original[index + 2]) > 30) count++;
          }
        }
        return count;
      };
      return { title: differences(0.313, 0.463), dateTime: differences(0.584, 0.642) };
    })()`, page.sessionId);
    assert.ok(imagePixels.title > 1000, 'the event name is embedded in the standalone image pixels');
    assert.ok(imagePixels.dateTime > 1000, 'the date and time are embedded in the standalone image pixels');
    if (process.env.EVENT_BADGE_TEST_IMAGE_PATH) {
      await writeFile(process.env.EVENT_BADGE_TEST_IMAGE_PATH,
        Buffer.from(mobileGraphic.source.split(',')[1], 'base64'));
    }
    assert.ok(Math.abs(mobileGraphic.naturalRatio - mobileGraphic.renderedRatio) < 0.01,
      `the mobile Event Card graphic keeps its native proportions: ${JSON.stringify(mobileGraphic)}`);
    assert.ok(Math.abs(mobileGraphic.eventFaceRatio - 5 / 7) < 0.01,
      `the mobile Event Card face keeps the matching portrait card footprint: ${JSON.stringify(mobileGraphic)}`);
    assert.equal(mobileGraphic.noInteractiveWrapper, true, 'the mobile graphic is not a link or button');
    assert.equal(mobileGraphic.pairedWithHypeCard, true, 'the mobile Event Card remains paired with the HYPE Card');
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await connection.evaluate('window.__setSupporterDashboardEvents([])', page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'Boolean(document.querySelector(\'[data-testid="section-next-game-context"] [data-testid="upcoming-calendar-events-empty"]\'))',
      Boolean,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="supporter-tool-context"], [data-testid="select-active-supporter-game"]\'))', page.sessionId),
      false,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'.supporter-dashboard-desktop-shell [data-testid="button-create-game-on-card"]\'))', page.sessionId),
      true,
    );
    await waitFor(
      connection,
      page.sessionId,
      'Boolean(document.querySelector(\'[data-testid="dashboard-install-reminder-mobile"]\') && !document.querySelector(\'[data-testid="dashboard-install-reminder-desktop"]\'))',
      Boolean,
    );
    const desktopReminderVisibility = await connection.evaluate<boolean>(
      '!document.querySelector(\'[data-testid="dashboard-install-reminder-desktop"]\') && document.querySelector(\'[data-testid="dashboard-install-reminder-mobile"]\')?.getBoundingClientRect().width === 0',
      page.sessionId,
    );
    assert.equal(desktopReminderVisibility, true, 'desktop omits the install reminder while the mobile shell stays hidden');

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector(\'[data-testid="dashboard-install-reminder-mobile"]\')?.getBoundingClientRect().width > 0 && !document.querySelector(\'[data-testid="dashboard-install-reminder-desktop"]\')',
      Boolean,
    );
    await connection.evaluate(
      'document.querySelector(\'[data-testid="button-dashboard-install-mobile"]\')?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector(\'[data-testid="dashboard-install-instructions-dialog"]\')?.textContent ?? ""',
      (text) => text.includes('Open your browser menu'),
    );
    assert.equal(
      await connection.evaluate<boolean>(`(() => {
        const dialog = document.querySelector('[data-testid="dashboard-install-instructions-dialog"]');
        return dialog instanceof HTMLElement
          && dialog.getAttribute('role') === 'dialog'
          && Boolean(dialog.getAttribute('aria-labelledby'))
          && Boolean(dialog.getAttribute('aria-describedby'));
      })()`, page.sessionId),
      true,
      'installation guidance opens in a labelled and described dialog',
    );
    await connection.evaluate(
      'document.querySelector(\'[data-testid="dashboard-install-instructions-dismiss"]\')?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      '!document.querySelector(\'[data-testid="dashboard-install-instructions-dialog"]\')',
      Boolean,
    );
    const fallbackEvent = await connection.evaluate<boolean>(`window.__installAnalyticsEvents.some(({ name, data }) =>
      name === 'app_install_instructions_viewed'
      && data?.device_class === 'mobile'
      && data?.prompt_type === 'browser_instructions'
      && data?.entry_point === 'fallback'
      && data?.surface === 'dashboard'
    )`, page.sessionId);
    assert.equal(fallbackEvent, true, 'fallback instructions record the visible mobile route');
    await connection.evaluate(
      'document.querySelector(\'[data-testid="button-dashboard-install-mobile"]\')?.click()',
      page.sessionId,
    );
    await connection.evaluate('window.__installAnalyticsThrows = true', page.sessionId);

    const installPromptPrevented = await connection.evaluate<boolean>(`(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperties(event, {
        prompt: { value: () => {
          window.__dashboardInstallPromptCalls = (window.__dashboardInstallPromptCalls || 0) + 1;
          return Promise.resolve();
        } },
        userChoice: { value: Promise.resolve({ outcome: 'dismissed', platform: 'web' }) },
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })()`, page.sessionId);
    assert.equal(installPromptPrevented, true, 'the shared install hook captures the browser prompt');
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector(\'[data-testid="button-dashboard-install-mobile"]\')?.textContent?.includes("Install app")',
      Boolean,
    );
    await connection.evaluate(
      'document.querySelector(\'[data-testid="button-dashboard-install-mobile"]\')?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector(\'[data-testid="button-dashboard-install-mobile"]\')?.textContent ?? ""',
      (text) => text.includes('How to install'),
    );
    const dismissedEvent = await connection.evaluate<boolean>(`window.__installAnalyticsEvents.some(({ name, data }) =>
      name === 'app_install_prompt_outcome'
      && data?.outcome === 'dismissed'
      && data?.device_class === 'mobile'
      && data?.prompt_type === 'native_prompt'
        && data?.surface === 'dashboard'
    )`, page.sessionId);
    assert.equal(dismissedEvent, true, 'native prompt dismissal is recorded');

    await connection.evaluate(`(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperties(event, {
        prompt: { value: () => {
          window.__dashboardInstallPromptCalls = (window.__dashboardInstallPromptCalls || 0) + 1;
          return Promise.resolve();
        } },
        userChoice: { value: Promise.resolve({ outcome: 'accepted', platform: 'web' }) },
      });
      window.dispatchEvent(event);
    })()`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector(\'[data-testid="button-dashboard-install-mobile"]\')?.textContent?.includes("Install app")',
      Boolean,
    );
    await connection.evaluate(
      'document.querySelector(\'[data-testid="button-dashboard-install-mobile"]\')?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      '!document.querySelector(\'[data-testid="dashboard-install-reminder-mobile"]\') && !document.querySelector(\'[data-testid="dashboard-install-reminder-desktop"]\')',
      Boolean,
    );
    await connection.evaluate('window.dispatchEvent(new Event("appinstalled"))', page.sessionId);
    const installAnalytics = await connection.evaluate<Array<{ name: string; data?: Record<string, unknown> }>>(
      'window.__installAnalyticsEvents',
      page.sessionId,
    );
    assert.equal(
      installAnalytics.some(({ name, data }) =>
        name === 'app_install_prompt_shown'
        && data?.device_class === 'mobile'
        && data?.prompt_type === 'native_prompt',
      ),
      true,
      'native prompt display is recorded before opening the browser prompt',
    );
    assert.equal(
      installAnalytics.some(({ name, data }) =>
        name === 'app_install_prompt_outcome'
        && data?.outcome === 'accepted'
        && data?.device_class === 'mobile'
        && data?.prompt_type === 'native_prompt'
        && data?.surface === 'dashboard',
      ),
      true,
      'native prompt acceptance is recorded',
    );
    assert.equal(
      installAnalytics.some(({ name, data }) =>
        name === 'app_install_confirmed'
        && data?.device_class === 'mobile'
        && data?.prompt_type === 'native_prompt',
      ),
      true,
      'the browser installation confirmation is recorded',
    );
    for (const event of installAnalytics) {
      const keys = Object.keys(event.data ?? {});
      assert.ok(
        keys.every((key) => ['device_class', 'entry_point', 'outcome', 'prompt_type', 'surface'].includes(key)),
        `unexpected analytics property: ${keys.join(', ')}`,
      );
      assert.equal('user_id' in (event.data ?? {}), false);
      assert.equal('athlete_name' in (event.data ?? {}), false);
    }
    assert.equal(
      await connection.evaluate<number>('window.__dashboardInstallPromptCalls || 0', page.sessionId),
      2,
      'the install prompt still runs when analytics throws',
    );
    const standaloneCardFixture = await connection.evaluate<{ userId: string }>(`(() => {
      const userId = 'supporter-standalone-event-card';
      const date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const standaloneCard = {
        shareToken: 'standalone-830',
        title: 'Standalone Event Card',
        savedAt: new Date().toISOString(),
        event: {
          id: 'standalone-event-830',
          type: 'game',
          date,
          time: '20:30',
          timezone: 'America/New_York',
          location: 'Northside Gym',
          opponent: 'Night Owls',
          status: 'upcoming',
        },
      };
      localStorage.setItem(\`pixlsports-game-on-cards:\${userId}\`, JSON.stringify([standaloneCard]));
      const finalGames = [2, 1].map((daysAgo, index) => {
        const startedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
        return {
          id: \`trend-game-\${index + 1}\`,
          sport: 'basketball',
          status: 'final',
          date: startedAt.toISOString().slice(0, 10),
          opponent: index === 0 ? 'Falcons' : 'Wolves',
          period: 4,
          score: index === 0 ? 38 : 51,
          opponentScore: index === 0 ? 34 : 48,
          scoreRecorded: true,
          notes: '',
          stats: { 'one-point': index + 2 },
          events: [],
          startedAt: startedAt.toISOString(),
          endedAt: new Date(startedAt.getTime() + 90 * 60 * 1000).toISOString(),
        };
      });
      localStorage.setItem(
        \`leaguematrix-stat-tracker:\${encodeURIComponent(userId)}\`,
        JSON.stringify({ version: 1, games: finalGames }),
      );
      return { userId };
    })()`, page.sessionId);
    await connection.evaluate(
      `window.__setSupporterDashboardTrackerUserId(${JSON.stringify(standaloneCardFixture.userId)})`,
      page.sessionId,
    );
    await connection.evaluate('window.__setSupporterDashboardEvents([])', page.sessionId);
    await waitFor(connection, page.sessionId, `Boolean(
      document.querySelector('[data-testid="upcoming-calendar-event"][data-event-id="standalone-event-830"]')
    )`, Boolean);
    await waitFor(
      connection,
      page.sessionId,
      'Boolean(document.querySelector(\'[data-testid="supporter-stat-trends"]\'))',
      Boolean,
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    const standaloneCardSummary = await connection.evaluate<{
      calendarEventCount: number;
      rowCount: number;
      title: string;
      time: string;
      listLabel: string;
      trendPointCount: number;
      statSelectorOptions: string[];
    }>(`(() => {
      const row = document.querySelector('[data-testid="upcoming-calendar-event"][data-event-id="standalone-event-830"]');
      const trend = document.querySelector('[data-testid="supporter-stat-trends"]');
      return {
        calendarEventCount: window.__getSupporterDashboardEvents().length,
        rowCount: document.querySelectorAll('.supporter-dashboard-desktop-shell [data-testid="upcoming-calendar-event"]').length,
        title: row?.querySelector('[data-testid="upcoming-calendar-event-title"]')?.textContent?.trim() || '',
        time: row?.querySelector('.supporter-game-on-summary__upcoming-date')?.textContent?.split('·').pop()?.trim() || '',
        listLabel: row?.parentElement?.getAttribute('aria-label') || '',
        trendPointCount: trend?.querySelector('[aria-label="Team score trend values"]')?.children.length || 0,
        statSelectorOptions: Array.from(trend?.querySelectorAll('[data-testid="supporter-stat-trends-selector"] option') ?? [])
          .map((option) => option.textContent?.trim() || ''),
      };
    })()`, page.sessionId);
    assert.deepEqual(standaloneCardSummary, {
      calendarEventCount: 0,
      rowCount: 1,
      title: standaloneCardSummary.title,
      time: '8:30 PM',
      listLabel: 'Upcoming Event Cards',
      trendPointCount: 2,
      statSelectorOptions: ['Team score', 'Free throw'],
    });
    assert.match(standaloneCardSummary.title, /Night Owls/);
    const standalonePrepBoard = await connection.evaluate<string>(
      `document.querySelector('[data-testid="upcoming-event-badge"]')?.textContent || ''`,
      page.sessionId,
    );
    assert.match(standalonePrepBoard, /Night Owls/);
    assert.doesNotMatch(standalonePrepBoard, /Game-day prep|Game day is coming up/);
    const standalonePrepBoardAction = await connection.evaluate<boolean>(
      `Boolean(document.querySelector('[data-testid="upcoming-event-badge"] [data-testid="button-guidance-event-card"]'))`,
      page.sessionId,
    );
    assert.equal(standalonePrepBoardAction, true);
    assert.equal(standaloneCardSummary.trendPointCount, 2, 'the graph includes real saved completed games');
    assert.deepEqual(standaloneCardSummary.statSelectorOptions, ['Team score', 'Free throw']);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") !== null',
      Boolean,
    );
    const standaloneGamePrepReminder = await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]")?.textContent || ""',
      page.sessionId,
    );
    assert.match(standaloneGamePrepReminder, /Get ready/i);
    assert.match(standaloneGamePrepReminder, /Night Owls/);
    await connection.evaluate(
      'document.querySelector("[data-testid=\\"stage-reminder-got-it\\"]")?.click()',
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null',
      Boolean,
    );
    await connection.evaluate('window.scrollTo(0, 0)', page.sessionId);
    await waitFor(connection, page.sessionId, `Boolean(
      document.querySelector('.supporter-dashboard-desktop-shell [data-testid="supporter-stat-trends-chart"] svg .recharts-line-curve')
    )`, Boolean);
    const desktopTrendViewport = await connection.evaluate<{
      visible: boolean;
      desktopBadgeVisible: boolean;
      hasTrendContent: boolean;
      trendChartSvg: boolean;
      trendCurveCount: number;
      eventId: string;
      title: string;
      scrollY: number;
    }>(`(() => {
      const section = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="section-next-game-context"]');
      const trend = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="supporter-stat-trends"]');
      const badge = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="img-upcoming-event-card-desktop"]');
      const event = section?.querySelector('[data-testid="upcoming-calendar-event"]');
      return {
        visible: trend instanceof HTMLElement && trend.getClientRects().length > 0
          && trend.getBoundingClientRect().width > 0
          && trend.getBoundingClientRect().right <= innerWidth,
        desktopBadgeVisible: badge instanceof HTMLImageElement && badge.complete && badge.naturalWidth > 0,
        hasTrendContent: Boolean(trend?.querySelector('[data-testid="supporter-stat-trends-chart"], [data-testid="supporter-stat-trends-empty"]')),
        trendChartSvg: Boolean(trend?.querySelector('[data-testid="supporter-stat-trends-chart"] svg')),
        trendCurveCount: trend?.querySelectorAll('.recharts-line-curve').length || 0,
        eventId: event?.getAttribute('data-event-id') || '',
        title: event?.querySelector('[data-testid="upcoming-calendar-event-title"]')?.textContent?.trim() || '',
        scrollY: window.scrollY,
      };
    })()`, page.sessionId);
    assert.equal(
      desktopTrendViewport.visible,
      true,
      `the returning supporter can see the stat trend panel inline on desktop: ${JSON.stringify(desktopTrendViewport)}`,
    );
    assert.equal(desktopTrendViewport.desktopBadgeVisible, true);
    assert.equal(desktopTrendViewport.hasTrendContent, true);
    assert.equal(desktopTrendViewport.trendChartSvg, true);
    assert.equal(desktopTrendViewport.trendCurveCount, 1);
    assert.equal(desktopTrendViewport.eventId, 'standalone-event-830');
    assert.equal(desktopTrendViewport.scrollY, 0);
    assert.match(desktopTrendViewport.title, /Night Owls/);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await connection.evaluate('window.scrollTo(0, 0)', page.sessionId);
    assert.equal(
      await connection.evaluate<number>(
        'document.querySelector(\'[data-testid="mobile-hero-banner"] [data-testid="upcoming-calendar-events"]\')?.querySelectorAll(\'[data-testid="upcoming-calendar-event"]\').length || 0',
        page.sessionId,
      ),
      1,
      'a standalone Event Card appears in the mobile upcoming list without a Calendar event',
    );
    const mobileGraphicViewport = await connection.evaluate<{
      imageVisible: boolean;
      naturalRatio: number;
      renderedRatio: number;
      eventId: string;
      title: string;
      scrollY: number;
      noInteractiveControls: boolean;
      eventAndHypeCardsPaired: boolean;
    }>(`(() => {
      const section = document.querySelector('.supporter-dashboard-mobile-shell [data-testid="mobile-calendar-hype-row"] > .supporter-game-on-summary__event');
      const image = section?.querySelector('[data-testid="img-upcoming-event-card-mobile"]');
      const event = section?.querySelector('[data-testid="upcoming-calendar-event"]');
      const rect = image?.getBoundingClientRect();
      const row = document.querySelector('.supporter-dashboard-mobile-shell [data-testid="mobile-calendar-hype-row"]');
      return {
        imageVisible: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
          && image.getClientRects().length > 0
          && Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth),
        naturalRatio: image instanceof HTMLImageElement ? image.naturalWidth / image.naturalHeight : 0,
        renderedRatio: rect && rect.height > 0 ? rect.width / rect.height : 0,
        eventId: event?.getAttribute('data-event-id') || '',
        title: event?.querySelector('[data-testid="upcoming-calendar-event-title"]')?.textContent?.trim() || '',
        scrollY: window.scrollY,
        noInteractiveControls: section?.querySelector('a, button') === null,
        eventAndHypeCardsPaired: row instanceof HTMLElement
          && row.children.length === 2
          && Boolean(row.querySelector('[data-testid="card-mobile-featured-event"]'))
          && Boolean(row.querySelector('[data-testid="mobile-saved-hype-card"]')),
      };
    })()`, page.sessionId);
    assert.deepEqual(mobileGraphicViewport, {
      imageVisible: true,
      naturalRatio: mobileGraphicViewport.naturalRatio,
      renderedRatio: mobileGraphicViewport.renderedRatio,
      eventId: 'standalone-event-830',
      title: mobileGraphicViewport.title,
      scrollY: 0,
      noInteractiveControls: true,
      eventAndHypeCardsPaired: true,
    }, 'the standalone Event Card graphic remains inline, non-interactive, and paired with the mobile HYPE Card');
    assert.ok(Math.abs(mobileGraphicViewport.naturalRatio - mobileGraphicViewport.renderedRatio) < 0.01,
      `the mobile Event Card graphic keeps its native proportions: ${JSON.stringify(mobileGraphicViewport)}`);
    assert.match(mobileGraphicViewport.title, /Night Owls/);
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('Game On card stays compact and opens cleanly across phone widths', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-compact-game-on-card-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');
    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-compact-game-on-card-'));
    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${tempDirectory}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}`);

    for (const width of [320, 360, 390, 430]) {
      await connection.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
      await waitFor(connection, page.sessionId, `Boolean(document.querySelector('.supporter-dashboard-mobile-shell [data-testid="card-game-on-draft:game-1"]'))`, Boolean);
      assert.equal(await connection.evaluate(`(() => {
        const header = document.querySelector('.supporter-dashboard-mobile-shell .game-on-collection__header');
        const title = header.querySelector('h2').getBoundingClientRect();
        const button = header.querySelector('[data-testid="button-create-game-on-card"]').getBoundingClientRect();
        return button.left >= title.right && Math.abs((button.top + button.height / 2) - (title.top + title.height / 2)) < 2
          && button.height >= 44 && button.right <= innerWidth;
      })()`, page.sessionId), true, `create button beside Event Cards heading at ${width}px`);
      assert.deepEqual(await connection.evaluate<{
        square: boolean; contained: boolean; noOverflow: boolean; statusDraft: boolean;
        dateVisible: boolean; statusVisible: boolean; titleVisible: boolean;
        detailsHidden: boolean; actionsHidden: boolean;
      }>(`(() => {
        const card = document.querySelector('.supporter-dashboard-mobile-shell [data-testid="card-game-on-draft:game-1"]');
        if (!(card instanceof HTMLElement)) throw new Error('Missing collapsed Game On card');
        const rect = card.getBoundingClientRect();
        const status = card.querySelector('.game-on-collection__status');
        const title = card.querySelector('.game-on-collection__kind');
        const statusRect = status?.getBoundingClientRect();
        const titleRect = title?.getBoundingClientRect();
        return {
          square: Math.abs(rect.width / rect.height - 1) < 0.05,
          contained: rect.left >= -1 && rect.right <= innerWidth + 1,
          noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          statusDraft: status?.getAttribute('data-status') === 'draft',
          dateVisible: Boolean(card.querySelector('.game-on-collection__date')?.getClientRects().length),
          statusVisible: Boolean(status?.getClientRects().length && statusRect && statusRect.left >= rect.left - 1
            && statusRect.right <= rect.right + 1 && status.scrollWidth <= status.clientWidth),
          titleVisible: Boolean(title?.getClientRects().length && titleRect && titleRect.left >= rect.left - 1
            && titleRect.right <= rect.right + 1 && title.scrollWidth <= title.clientWidth),
          detailsHidden: card.querySelector('.game-on-collection__card-content')?.hidden === true
            && card.querySelector('.game-on-collection__card-footer')?.hidden === true,
          actionsHidden: card.querySelector('.game-on-collection__actions')?.hidden === true,
        };
      })()`, page.sessionId), {
        square: true, contained: true, noOverflow: true, statusDraft: true,
        dateVisible: true, statusVisible: true, titleVisible: true, detailsHidden: true, actionsHidden: true,
      }, `collapsed Game On card at ${width}px`);
      await connection.evaluate(`document.querySelector('.supporter-dashboard-mobile-shell [data-testid="card-game-on-draft:game-1"] .game-on-collection__summary')?.click()`, page.sessionId);
      await waitFor(connection, page.sessionId, `Boolean(document.querySelector('.supporter-dashboard-mobile-shell [role="dialog"] .game-on-collection__card--selected'))`, Boolean);
      assert.deepEqual(await connection.evaluate<{
        contained: boolean; noOverflow: boolean; detailsVisible: boolean; actionsVisible: boolean; tileStayedCompact: boolean;
      }>(`(() => {
        const shell = document.querySelector('.supporter-dashboard-mobile-shell');
        const dialog = shell?.querySelector('[role="dialog"][data-testid^="dialog-game-on-card-"]');
        const selected = dialog?.querySelector('.game-on-collection__card--selected');
        const tile = shell?.querySelector('[data-testid="card-game-on-draft:game-1"]');
        if (!(dialog instanceof HTMLElement) || !(selected instanceof HTMLElement) || !(tile instanceof HTMLElement)) {
          throw new Error('Missing expanded Game On card');
        }
        const rect = dialog.getBoundingClientRect();
        return {
          contained: rect.left >= -1 && rect.right <= innerWidth + 1 && dialog.scrollWidth <= dialog.clientWidth + 1,
          noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          detailsVisible: Boolean(selected.querySelector('.game-on-collection__card-content:not([hidden])')?.getClientRects().length),
          actionsVisible: Boolean(selected.querySelector('.game-on-collection__actions:not([hidden]) button')?.getClientRects().length),
          tileStayedCompact: tile.querySelector('.game-on-collection__card-content')?.hidden === true
            && tile.querySelector('.game-on-collection__actions')?.hidden === true,
        };
      })()`, page.sessionId), {
        contained: true, noOverflow: true, detailsVisible: true, actionsVisible: true, tileStayedCompact: true,
      }, `expanded Game On card at ${width}px`);
      await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
      await waitFor(connection, page.sessionId, `!document.querySelector('.supporter-dashboard-mobile-shell [role="dialog"][data-testid^="dialog-game-on-card-"]')`, Boolean);
    }
    await connection.evaluate(`document.querySelector('.supporter-dashboard-mobile-shell [data-testid="card-game-on-draft:game-1"] .game-on-collection__summary')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Boolean(document.querySelector('.supporter-dashboard-mobile-shell [role="dialog"] [data-testid="button-open-stat-tracker-draft:game-1"]'))`, Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-mobile-shell [role="dialog"] [data-testid="button-open-stat-tracker-draft:game-1"]').click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'window.location.pathname === "/studio/stat-tracker"', Boolean);
    assert.equal(await connection.evaluate<string>('new URLSearchParams(location.search).get("eventId")', page.sessionId), 'game-1');
    assert.equal(await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"game-on-inline-scoreboard\\"]"))', page.sessionId), false);
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('Event Card sharing sends the selected card link and copies it when sharing is unavailable', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-event-card-share-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');
    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-event-card-share-'));
    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);

    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${tempDirectory}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?game-on-card-save-transition`);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId,
      `Boolean(document.querySelector('.supporter-dashboard-desktop-shell [data-testid="game-on-dashboard-collection"]'))`,
      Boolean);

    await connection.evaluate(`(() => {
      const publishedCard = {
        shareToken: 'share-test-card',
        title: 'Event Card share test',
        savedAt: new Date().toISOString(),
        event: {
          id: 'share-test-event',
          type: 'game',
          date: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          time: '18:30',
          location: 'Northside Gym',
          opponent: 'Share Test Opponent',
          status: 'upcoming',
        },
      };
      const storageKey = 'pixlsports-game-on-cards:supporter-save-transition';
      localStorage.setItem(storageKey, JSON.stringify([publishedCard]));
      window.dispatchEvent(new StorageEvent('storage', { key: storageKey, storageArea: localStorage }));
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId,
      `Boolean(document.querySelector('.supporter-dashboard-desktop-shell [data-testid="card-game-on-share:share-test-card"]'))`,
      Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid="card-game-on-share:share-test-card"] .game-on-collection__summary')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId,
      `Boolean(document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:share-test-card"]'))`,
      Boolean);
    assert.equal(await connection.evaluate<boolean>(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="card-game-on-share:share-test-card"] .game-on-collection__actions')?.hidden === true`,
      page.sessionId,
    ), true, 'Share should be offered on the opened card, not the compact grid tile');
    const trackerStateColors = await connection.evaluate<{ inactive: string; initiallyExpanded: string | null }>(`(() => {
      const tracker = document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card [data-testid^="button-open-stat-tracker-"]');
      if (!(tracker instanceof HTMLButtonElement)) throw new Error('The Stat Tracker action is unavailable');
      const initiallyExpanded = tracker.getAttribute('aria-expanded');
      const inactive = getComputedStyle(tracker).backgroundColor;
      return { inactive, initiallyExpanded };
    })()`, page.sessionId);
    assert.deepEqual(trackerStateColors, {
      inactive: 'rgb(231, 242, 255)',
      initiallyExpanded: 'false',
    }, 'Stat Tracker should be neutral by default');

    await connection.evaluate(`(() => {
      window.__eventCardOriginalNavigatorProps = {
        share: Object.getOwnPropertyDescriptor(navigator, 'share'),
        clipboard: Object.getOwnPropertyDescriptor(navigator, 'clipboard'),
      };
      window.__eventCardShareCalls = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (payload) => window.__eventCardShareCalls.push(payload),
      });
    })()`, page.sessionId);
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:share-test-card"] [data-testid="button-share-game-on-card-share:share-test-card"]')?.click()`,
      page.sessionId,
    );
    await waitFor(connection, page.sessionId, `window.__eventCardShareCalls?.length === 1
      && document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:share-test-card"] [data-testid="status-game-on-share"]')?.textContent === 'Event Card shared.'`, Boolean);
    const sharedCardDetails = await connection.evaluate<{
      sharedUrl: string;
      expectedUrl: string;
      selectedCardActionVisible: boolean;
      editArrowVisible: boolean;
      removedActionTilesAbsent: boolean;
    }>(`(() => {
      const dialog = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:share-test-card"]');
      const cardAction = dialog?.querySelector('[data-testid="button-share-game-on-card-share:share-test-card"]');
      return {
        sharedUrl: window.__eventCardShareCalls[0]?.url ?? '',
        expectedUrl: new URL('/game-on/share-test-card', location.href).href,
        selectedCardActionVisible: Boolean(cardAction?.getClientRects().length),
        editArrowVisible: Boolean(dialog?.querySelector('[data-testid^="button-edit-event-arrow-"]')?.getClientRects().length),
        removedActionTilesAbsent: !dialog?.querySelector('[data-testid^="button-edit-calendar-"], [data-testid^="button-copy-game-on-card-link-"], [data-testid^="link-open-game-on-card-"]'),
      };
    })()`, page.sessionId);
    assert.equal(sharedCardDetails.selectedCardActionVisible, true, 'Share should be visible on the selected Event Card');
    assert.equal(sharedCardDetails.editArrowVisible, true, 'the Event Card arrow should provide the edit entry point');
    assert.equal(sharedCardDetails.removedActionTilesAbsent, true, 'Details, Copy link, and Open card should not appear as action tiles');
    assert.equal(sharedCardDetails.sharedUrl, sharedCardDetails.expectedUrl,
      'the device share sheet should receive this Event Card public link');

    await connection.evaluate(`(() => {
      window.__eventCardCopiedUrl = '';
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (url) => { window.__eventCardCopiedUrl = url; } },
      });
    })()`, page.sessionId);
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:share-test-card"] [data-testid="button-share-game-on-card-share:share-test-card"]')?.click()`,
      page.sessionId,
    );
    await waitFor(connection, page.sessionId, `Boolean(window.__eventCardCopiedUrl)
      && document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:share-test-card"] [data-testid="status-game-on-share"]')?.textContent === 'Event Card link copied.'`, Boolean);
    assert.equal(
      await connection.evaluate<string>('window.__eventCardCopiedUrl', page.sessionId),
      sharedCardDetails.expectedUrl,
      'browsers without Web Share should copy the same Event Card link',
    );
    await connection.evaluate(`(() => {
      window.__eventCardCopiedUrl = '';
      window.__eventCardClipboardCalls = 0;
      window.__eventCardShareCancelled = false;
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => {
          window.__eventCardShareCancelled = true;
          throw new DOMException('Share cancelled', 'AbortError');
        },
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (url) => {
            window.__eventCardClipboardCalls += 1;
            window.__eventCardCopiedUrl = url;
          },
        },
      });
    })()`, page.sessionId);
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:share-test-card"] [data-testid="button-share-game-on-card-share:share-test-card"]')?.click()`,
      page.sessionId,
    );
    await waitFor(connection, page.sessionId, `window.__eventCardShareCancelled === true
      && !document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:share-test-card"] [data-testid="status-game-on-share"]')`, Boolean);
    assert.equal(
      await connection.evaluate<number>('window.__eventCardClipboardCalls', page.sessionId),
      0,
      'cancelling the device share sheet should not copy the link as a surprise fallback',
    );
    await connection.evaluate(`(() => {
      const original = window.__eventCardOriginalNavigatorProps;
      for (const key of ['share', 'clipboard']) {
        if (original?.[key]) Object.defineProperty(navigator, key, original[key]);
        else delete navigator[key];
      }
    })()`, page.sessionId);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card [data-testid^="button-edit-event-arrow-"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Boolean(document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card[data-calendar-open="true"] [data-testid="input-inline-date"]'))`, Boolean);
    assert.match(await connection.evaluate<string>(
      `document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card [data-testid^="button-close-calendar-editor-"]')?.textContent || ''`,
      page.sessionId,
    ), /Back to Event Card/);
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card [data-testid^="button-close-calendar-editor-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.activeElement?.getAttribute('data-testid')?.startsWith('button-edit-event-arrow-') === true`, Boolean);
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('supporter dashboard keeps Game On Card prominent and the mobile menu accessible', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-dashboard-mobile-header-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-supporter-mobile-header-'));

    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?game-on-card-save-transition`);

    for (const width of [320, 375, 390, 430, 560, 639, 640, 768]) {
      const height = width === 768 ? 1024 : 844;
      await connection.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: true,
      }, page.sessionId);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"mobile-header\\"]") !== null', Boolean);
      const supporterTabColors = await connection.evaluate<{ active: string; inactive: string }>(`(() => ({
        active: getComputedStyle(document.querySelector('[data-testid="link-mobile-parent-week"]')).color,
        inactive: getComputedStyle(document.querySelector('[data-testid="link-mobile-player-showcase"]')).color
      }))()`, page.sessionId);
      assert.equal(supporterTabColors.active, 'rgb(255, 255, 255)', 'the active mobile section tab remains readable on the Locker header');
      assert.equal(supporterTabColors.inactive, 'rgb(169, 191, 216)', 'the inactive mobile section tab remains readable on the Locker header');
      const result = await connection.evaluate<{
        dashboardVisible: boolean;
        viewportOverflow: boolean;
        dashboardOverflow: boolean;
        headerPosition: string;
        headerZIndex: string;
        headerTop: number;
        headerTopAfterScroll: number;
        heroClearsHeader: boolean;
        athleteCardRemoved: boolean;
        profileIconVisible: boolean;
        installReminderContained: boolean;
        heroColumnCount: number;
        heroCardsShareRow: boolean;
        heroCornerRadius: string;
        heroCardsContained: boolean;
        collectionVisible: boolean;
        heroAboveCollection: boolean;
        heroDomBeforeCollection: boolean;
        collectionColumnCount: number;
        collectionFits: boolean;
        squareCard: boolean;
        collapsedTileMinimal: boolean;
        collapsedTileChecks: Record<string, boolean>;
        removedPanels: boolean;
        titleAtBottom: boolean;
        titleReadable: boolean;
      }>(`(() => {
        const root = document.querySelector('.supporter-dashboard-mobile-shell');
        const header = document.querySelector('[data-testid="mobile-header"]');
        const hero = document.querySelector('[data-testid="mobile-hero-banner"]');
        const collection = root?.querySelector('[data-testid="game-on-dashboard-collection"]');
        const grid = collection?.querySelector('[data-testid="grid-game-on-cards"]');
        const card = collection?.querySelector('.game-on-collection__card');
        const columns = document.querySelector('.mobile-hero-columns');
        const profileIcon = header.querySelector('[data-testid="btn-mobile-open-profile"]');
        const summaryHeader = hero?.querySelector('[data-testid="mobile-dashboard-summary-header"]');
        const installReminder = summaryHeader?.querySelector('[data-testid="dashboard-install-reminder-mobile"]');
        const installButton = installReminder?.querySelector('button');
        const eventCard = document.querySelector('[data-testid="card-mobile-featured-event"]');
        if (!(root instanceof HTMLElement) || !(header instanceof HTMLElement) || !(hero instanceof HTMLElement)
          || !(collection instanceof HTMLElement) || !(grid instanceof HTMLElement) || !(card instanceof HTMLElement)
          || !(columns instanceof HTMLElement) || !(profileIcon instanceof HTMLElement)
          || !(summaryHeader instanceof HTMLElement) || !(installReminder instanceof HTMLElement)
          || !(installButton instanceof HTMLButtonElement)
          || !(eventCard instanceof HTMLElement)) {
          throw new Error('Mobile dashboard shell is incomplete: ' + JSON.stringify({
            root: root instanceof HTMLElement,
            header: header instanceof HTMLElement,
            hero: hero instanceof HTMLElement,
            collection: collection instanceof HTMLElement,
            grid: grid instanceof HTMLElement,
            card: card instanceof HTMLElement,
            columns: columns instanceof HTMLElement,
            profileIcon: profileIcon instanceof HTMLElement,
            summaryHeader: summaryHeader instanceof HTMLElement,
            installReminder: installReminder instanceof HTMLElement,
            installButton: installButton instanceof HTMLButtonElement,
            eventCard: eventCard instanceof HTMLElement,
          }));
        }
        const scroller = document.scrollingElement;
        if (!(scroller instanceof HTMLElement)) throw new Error('Missing document scroller');
        scroller.scrollTop = 0;
        const initialHeaderRect = header.getBoundingClientRect();
        const heroRect = hero.getBoundingClientRect();
        const collectionRect = collection.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const summaryHeaderRect = summaryHeader.getBoundingClientRect();
        const installReminderRect = installReminder.getBoundingClientRect();
        const installButtonFits = installButton.scrollWidth <= installButton.clientWidth;
        const profileIconVisible = profileIcon.getClientRects().length > 0;
        const kind = card.querySelector('.game-on-collection__kind');
        const date = card.querySelector('.game-on-collection__date');
        const status = card.querySelector('.game-on-collection__status');
        const details = card.querySelector('.game-on-collection__card-content');
        const footer = card.querySelector('.game-on-collection__card-footer');
        const actions = card.querySelector('.game-on-collection__actions');
        const kindRect = kind?.getBoundingClientRect();
        const dateRect = date?.getBoundingClientRect();
        const statusRect = status?.getBoundingClientRect();
        const summary = card.querySelector('.game-on-collection__summary');
        const summaryRect = summary?.getBoundingClientRect();
        const cardActions = Array.from(card.querySelectorAll('.game-on-collection__actions > button'));
        const installReminderContained = installReminderRect.left >= summaryHeaderRect.left - 1
          && installReminderRect.right <= summaryHeaderRect.right + 1;
        const eventRect = eventCard.getBoundingClientRect();
        const repliesRect = hero.querySelector('.supporter-game-on-summary__replies')?.getBoundingClientRect();
      const headerHorn = header.querySelector('[data-testid="reply-inbox-header-horn"]');
        const heroColumns = getComputedStyle(columns).gridTemplateColumns.trim().split(/\\s+/);
        const collectionColumns = getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/);
        scroller.scrollTop = Math.min(240, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
        const scrolledHeaderRect = header.getBoundingClientRect();
        scroller.scrollTop = 0;
        const rootRect = root.getBoundingClientRect();
        const collapsedTileChecks = {
          unselected: !card.classList.contains('game-on-collection__card--selected'),
          kindVisible: Boolean(kind?.getClientRects().length),
          dateVisible: Boolean(date?.getClientRects().length),
          statusVisible: Boolean(status?.getClientRects().length),
          statusNotHidden: status?.hidden === false,
          statusDraft: status?.getAttribute('data-status') === 'draft',
          statusInsideCard: Boolean(statusRect
            && statusRect.left >= cardRect.left - 1
            && statusRect.right <= cardRect.right + 1),
          statusAboveDate: Boolean(statusRect && dateRect && statusRect.bottom <= dateRect.top + 1),
          summaryIncludesStatus: Boolean(summary?.getAttribute('aria-label')?.endsWith(status?.textContent?.trim() || '')),
          kindBelowDate: Boolean(kindRect && dateRect && kindRect.top > dateRect.bottom),
          kindNearSummaryBottom: Boolean(kindRect && summaryRect && kindRect.bottom >= summaryRect.bottom - 18),
          kindReadable: Boolean(kind && Number.parseFloat(getComputedStyle(kind).fontSize) >= 12),
          detailsHidden: details?.hidden === true,
          footerHidden: footer?.hidden === true,
          actionsHidden: actions?.hidden === true,
          actionButtonsHidden: cardActions.every((action) => action.getClientRects().length === 0),
        };
        return {
          dashboardVisible: getComputedStyle(root).display !== 'none',
          viewportOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          dashboardOverflow: root.scrollWidth > root.clientWidth,
          headerPosition: getComputedStyle(header).position,
          headerZIndex: getComputedStyle(header).zIndex,
          headerTop: Math.round(initialHeaderRect.top - rootRect.top),
          headerTopAfterScroll: Math.round(scrolledHeaderRect.top),
          heroClearsHeader: Math.round(heroRect.top) >= Math.round(initialHeaderRect.bottom),
          athleteCardRemoved: hero.querySelector('[data-testid="btn-mobile-athlete-switcher"]') === null,
          profileIconVisible,
          installReminderContained,
          installButtonFits,
          heroColumnCount: heroColumns.length,
          heroCardsShareRow: Boolean(repliesRect && Math.abs(eventRect.top - repliesRect.top) <= 1),
        mobileShoutoutsCardRemoved: !hero.querySelector('.supporter-game-on-summary__replies'),
        headerBullhornVisible: Boolean(headerHorn),
        headerBullhornUnlit: Boolean(headerHorn && !headerHorn.classList.contains('reply-inbox-header-horn--unread')),
          heroCornerRadius: getComputedStyle(hero).borderRadius,
          heroCardsContained: eventRect.left >= heroRect.left
            && eventRect.right <= heroRect.right,
          collectionVisible: getComputedStyle(collection).display !== 'none',
          heroAboveCollection: heroRect.bottom <= collectionRect.top + 1,
          heroDomBeforeCollection: Boolean(hero.compareDocumentPosition(collection) & Node.DOCUMENT_POSITION_FOLLOWING),
          collectionColumnCount: collectionColumns.length,
          collectionFits: collection.getBoundingClientRect().left >= -1
            && collection.getBoundingClientRect().right <= innerWidth + 1,
          squareCard: Math.abs(cardRect.width / cardRect.height - 1) < 0.05,
          collapsedTileMinimal: Object.values(collapsedTileChecks).every(Boolean),
          collapsedTileChecks,
          titleAtBottom: Boolean(kindRect && dateRect && summaryRect && kindRect.top > dateRect.bottom && kindRect.bottom >= summaryRect.bottom - 18),
          titleReadable: Boolean(kind && Number.parseFloat(getComputedStyle(kind).fontSize) >= 12),
          removedPanels: !document.querySelector('[data-testid="section-mobile-workspace"], [data-testid="section-desktop-workspace"], [data-testid="card-mobile-recommendation"], [data-testid="workspace-recommendation"]'),
        };
      })()`, page.sessionId);
      assert.deepEqual(result, {
        dashboardVisible: true,
        viewportOverflow: false,
        dashboardOverflow: false,
        headerPosition: 'sticky',
        headerZIndex: '70',
        headerTop: 0,
        headerTopAfterScroll: 0,
        heroClearsHeader: true,
        athleteCardRemoved: true,
        profileIconVisible: true,
        installReminderContained: true,
        installButtonFits: true,
        heroColumnCount: width < 640 ? 1 : 2,
        heroCardsShareRow: false,
        mobileShoutoutsCardRemoved: true,
        headerBullhornVisible: true,
        headerBullhornUnlit: true,
        heroCornerRadius: '20px',
        heroCardsContained: true,
        collectionVisible: true,
        heroAboveCollection: true,
        heroDomBeforeCollection: true,
        collectionColumnCount: 3,
        collectionFits: true,
        squareCard: true,
        collapsedTileMinimal: true,
        collapsedTileChecks: {
          unselected: true,
          kindVisible: true,
          dateVisible: true,
          statusVisible: true,
          statusNotHidden: true,
          statusDraft: true,
          statusInsideCard: true,
          statusAboveDate: true,
          summaryIncludesStatus: true,
          kindBelowDate: true,
          kindNearSummaryBottom: true,
          kindReadable: true,
          detailsHidden: true,
          footerHidden: true,
          actionsHidden: true,
          actionButtonsHidden: true,
        },
        titleAtBottom: true,
        titleReadable: true,
        removedPanels: true,
      }, `mobile header behavior at ${width}px`);
    }

    assert.equal(await connection.evaluate('window.__setReplyInboxUnreadCount(2)', page.sessionId), true, 'the inbox fixture can publish unread shoutouts');
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"reply-inbox-header-horn\\"]")?.classList.contains("reply-inbox-header-horn--unread")', Boolean);
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=\\"reply-inbox-header-horn\\"]")?.closest("button")?.getAttribute("aria-label")', page.sessionId), 'Open Shoutouts and replies, 2 unread');
    assert.equal(await connection.evaluate('window.__setReplyInboxUnreadCount(0)', page.sessionId), true, 'restore the empty inbox before later dashboard assertions');
    await waitFor(connection, page.sessionId, '!document.querySelector("[data-testid=\\"reply-inbox-header-horn\\"]")?.classList.contains("reply-inbox-header-horn--unread")', Boolean);

    await waitFor(connection, page.sessionId, 'typeof window.__setSupporterDashboardEvents === "function"', Boolean);
    await connection.evaluate(`window.__setSupporterDashboardEvents([
      {
        id: 'compact-complete',
        type: 'game',
        date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        time: '18:30',
        location: 'Northside Gym',
        opponent: 'Falcons',
        status: 'final',
      },
      ...window.__getSupporterDashboardEvents(),
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-mobile-shell [data-testid="grid-game-on-cards"] .game-on-collection__card:first-child .game-on-collection__status')?.getAttribute('data-status') === 'complete'`, Boolean);

    for (const width of [320, 375]) {
        await connection.send('Emulation.setDeviceMetricsOverride', {
          width,
          height: 844,
          deviceScaleFactor: 1,
          mobile: true,
        }, page.sessionId);
        assert.deepEqual(await connection.evaluate<{
          square: boolean;
          contained: boolean;
          noOverflow: boolean;
          statusComplete: boolean;
          dateVisible: boolean;
          statusVisibleAndContained: boolean;
          titleVisibleAndContained: boolean;
          detailsHidden: boolean;
          actionsHidden: boolean;
        }>(`(() => {
          const card = document.querySelector('.supporter-dashboard-mobile-shell [data-testid="card-game-on-draft:compact-complete"]');
          if (!(card instanceof HTMLElement)) throw new Error('The completed card is missing from the mobile grid');
          const rect = card.getBoundingClientRect();
          const status = card.querySelector('.game-on-collection__status');
          const date = card.querySelector('.game-on-collection__date');
          const kind = card.querySelector('.game-on-collection__kind');
          const statusRect = status?.getBoundingClientRect();
          const kindRect = kind?.getBoundingClientRect();
          return {
            square: Math.abs(rect.width / rect.height - 1) < 0.05,
            contained: rect.left >= -1 && rect.right <= innerWidth + 1,
            noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            statusComplete: status?.getAttribute('data-status') === 'complete',
            dateVisible: Boolean(date?.getClientRects().length),
            statusVisibleAndContained: Boolean(status?.getClientRects().length && statusRect
              && statusRect.left >= rect.left - 1 && statusRect.right <= rect.right + 1
              && status.scrollWidth <= status.clientWidth),
            titleVisibleAndContained: Boolean(kind?.getClientRects().length && kindRect
              && kindRect.left >= rect.left - 1 && kindRect.right <= rect.right + 1
              && kind.scrollWidth <= kind.clientWidth
              && Number.parseFloat(getComputedStyle(kind).fontSize) >= 12),
            detailsHidden: card.querySelector('.game-on-collection__card-content')?.hidden === true
              && card.querySelector('.game-on-collection__card-footer')?.hidden === true,
            actionsHidden: card.querySelector('.game-on-collection__actions')?.hidden === true,
          };
        })()`, page.sessionId), {
          square: true,
          contained: true,
          noOverflow: true,
          statusComplete: true,
          dateVisible: true,
          statusVisibleAndContained: true,
          titleVisibleAndContained: true,
          detailsHidden: true,
          actionsHidden: true,
        }, `compact completed card behavior at ${width}px`);
        await connection.evaluate(`document.querySelector('.supporter-dashboard-mobile-shell [data-testid="card-game-on-draft:compact-complete"] .game-on-collection__summary')?.click()`, page.sessionId);
        await waitFor(connection, page.sessionId, `Boolean(document.querySelector('.supporter-dashboard-mobile-shell [role="dialog"] .game-on-collection__dialog-card.game-on-collection__card--selected'))`, Boolean);
        assert.deepEqual(await connection.evaluate<{
          dialogContained: boolean;
          noOverflow: boolean;
          dateVisible: boolean;
          statusVisible: boolean;
          titleVisible: boolean;
          detailsVisible: boolean;
          actionsVisible: boolean;
          tileStayedCompact: boolean;
        }>(`(() => {
          const shell = document.querySelector('.supporter-dashboard-mobile-shell');
          const dialog = shell?.querySelector('[role="dialog"][data-testid^="dialog-game-on-card-"]');
          const content = dialog;
          const card = dialog?.querySelector('.game-on-collection__card--selected');
          const tile = shell?.querySelector('[data-testid="card-game-on-draft:compact-complete"]');
          if (!(content instanceof HTMLElement) || !(card instanceof HTMLElement) || !(tile instanceof HTMLElement)) {
            throw new Error('The completed card did not open in the mobile dialog');
          }
          const bounds = content.getBoundingClientRect();
          const tileBounds = tile.getBoundingClientRect();
          const visible = (selector) => Boolean(card.querySelector(selector)?.getClientRects().length);
          return {
            dialogContained: bounds.left >= -1 && bounds.right <= innerWidth + 1
              && content.scrollWidth <= content.clientWidth + 1,
            noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            dateVisible: visible('.game-on-collection__date'),
            statusVisible: visible('.game-on-collection__status'),
            titleVisible: visible('.game-on-collection__kind'),
            detailsVisible: visible('.game-on-collection__card-content:not([hidden])')
              && visible('.game-on-collection__card-footer:not([hidden])'),
            actionsVisible: visible('.game-on-collection__actions:not([hidden]) button'),
            tileStayedCompact: Math.abs(tileBounds.width / tileBounds.height - 1) < 0.05
              && !tile.classList.contains('game-on-collection__card--selected')
              && tile.querySelector('.game-on-collection__card-content')?.hidden === true
              && tile.querySelector('.game-on-collection__actions')?.hidden === true,
          };
        })()`, page.sessionId), {
          dialogContained: true,
          noOverflow: true,
          dateVisible: true,
          statusVisible: true,
          titleVisible: true,
          detailsVisible: true,
          actionsVisible: true,
          tileStayedCompact: true,
        }, `expanded completed card behavior at ${width}px`);
        await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
        await waitFor(connection, page.sessionId, `!document.querySelector('.supporter-dashboard-mobile-shell [role="dialog"][data-testid^="dialog-game-on-card-"]')`, Boolean);
    }

    await connection.evaluate(`window.__setSupporterDashboardEvents(
      window.__getSupporterDashboardEvents().filter((event) => event.id !== 'compact-complete')
    )`, page.sessionId);
    await waitFor(connection, page.sessionId, `!document.querySelector('.supporter-dashboard-mobile-shell [data-testid="card-game-on-draft:compact-complete"]')`, Boolean);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    const gameTileRectBeforeDialog = await connection.evaluate<{ leftInGrid: number; topInGrid: number; width: number; height: number }>(`(() => {
      const grid = document.querySelector('.supporter-dashboard-mobile-shell [data-testid="grid-game-on-cards"]');
      const card = Array.from(grid?.querySelectorAll('.game-on-collection__card') || [])
        .find((item) => item.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      if (!(grid instanceof HTMLElement) || !(card instanceof HTMLElement)) throw new Error('A game card is required for the mobile card-view check');
      const rect = card.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      return {
        leftInGrid: rect.left - gridRect.left,
        topInGrid: rect.top - gridRect.top,
        width: rect.width,
        height: rect.height,
      };
    })()`, page.sessionId);
    await connection.evaluate(`(() => {
      const grid = document.querySelector('.supporter-dashboard-mobile-shell [data-testid="grid-game-on-cards"]');
      const card = Array.from(grid?.querySelectorAll('.game-on-collection__card') || [])
        .find((item) => item.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      if (!(card instanceof HTMLElement)) throw new Error('A game card is required for the mobile card-view check');
      card.querySelector('.game-on-collection__summary')?.click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Boolean(document.querySelector('.supporter-dashboard-mobile-shell [role="dialog"][data-testid^="dialog-game-on-card-"] .game-on-collection__dialog-card'))
      && Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [data-testid="grid-game-on-cards"] .game-on-collection__card'))
        .every((card) => !card.classList.contains('game-on-collection__card--expanded'))`, Boolean);
    assert.deepEqual(await connection.evaluate<{
      dialogCount: number;
      dialogHasSelectedCard: boolean;
      gridTileSquare: boolean;
      gridTileUnexpanded: boolean;
      tilePositionUnchanged: boolean;
    }>(`(() => {
      const shell = document.querySelector('.supporter-dashboard-mobile-shell');
      const dialog = shell?.querySelector('[role="dialog"][data-testid^="dialog-game-on-card-"]');
      const selected = dialog?.querySelector('.game-on-collection__dialog-card');
      const grid = shell?.querySelector('[data-testid="grid-game-on-cards"]');
      const layoutId = selected?.getAttribute('data-layout-id');
      const tile = Array.from(grid?.querySelectorAll('.game-on-collection__card') || [])
        .find((card) => card.getAttribute('data-layout-id') === layoutId);
      if (!(grid instanceof HTMLElement) || !(tile instanceof HTMLElement)) throw new Error('The selected Game On tile is missing from the grid');
      const rect = tile.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      return {
        dialogCount: shell?.querySelectorAll('[role="dialog"][data-testid^="dialog-game-on-card-"]').length || 0,
        dialogHasSelectedCard: Boolean(selected),
        gridTileSquare: Math.abs(rect.width / rect.height - 1) < 0.05,
        gridTileUnexpanded: !tile.classList.contains('game-on-collection__card--expanded')
          && !tile.classList.contains('game-on-collection__card--selected'),
        tilePositionUnchanged: Math.abs(rect.left - gridRect.left - ${gameTileRectBeforeDialog.leftInGrid}) < 1
          && Math.abs(rect.top - gridRect.top - ${gameTileRectBeforeDialog.topInGrid}) < 1
          && Math.abs(rect.width - ${gameTileRectBeforeDialog.width}) < 1
          && Math.abs(rect.height - ${gameTileRectBeforeDialog.height}) < 1,
      };
    })()`, page.sessionId), {
      dialogCount: 1,
      dialogHasSelectedCard: true,
      gridTileSquare: true,
      gridTileUnexpanded: true,
      tilePositionUnchanged: true,
    }, 'opening a card should leave its grid tile in place and show the expanded controls in one dialog');
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [role="dialog"] .game-on-collection__card'))
      .some((card) => card.classList.contains('game-on-collection__card--expanded')
        && card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'))`, Boolean);
    assert.deepEqual(await connection.evaluate<{
      expanded: boolean;
      detailVisible: boolean;
      factsVisible: boolean;
      editorOnFront: boolean;
      options: string[];
      optionsAreTouchFriendly: boolean;
    }>(`(() => {
      const card = Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
        .find((item) => item.classList.contains('game-on-collection__card--selected')
          && item.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      if (!(card instanceof HTMLElement)) throw new Error('The tapped game card did not expand');
      const options = Array.from(card.querySelectorAll('.game-on-collection__actions > button'));
      return {
        expanded: card.classList.contains('game-on-collection__card--expanded'),
        detailVisible: Boolean(card.querySelector('.game-on-collection__opponent')?.getClientRects().length),
        factsVisible: Boolean(card.querySelector('.game-on-collection__date')?.getClientRects().length)
          && Array.from(card.querySelectorAll('.game-on-collection__detail-value')).map((value) => value.textContent?.trim()).join('|') === '6:30 PM|Northside Gym',
        editorOnFront: Boolean(card.querySelector('.game-on-collection__flip-front [data-testid^="game-on-inline-editor-"]')),
        options: options.filter((option) => option.getClientRects().length > 0)
          .map((option) => {
            const label = option.cloneNode(true);
            label.querySelector('.game-on-collection__suggested-badge')?.remove();
            return label.textContent?.trim() || '';
          }),
        optionsAreTouchFriendly: options.length === 2 && options.every((option) => option.getBoundingClientRect().height >= 44),
      };
    })()`, page.sessionId), {
      expanded: true,
      detailVisible: true,
      factsVisible: true,
      editorOnFront: false,
      options: ['Prep', 'Stat Tracker'],
      optionsAreTouchFriendly: true,
    });
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [data-testid^="button-edit-event-arrow-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
      .some((card) => card.getAttribute('data-details-open') === 'true'
        && card.querySelector('.game-on-collection__flip-back .game-on-inline--calendar [data-testid="input-inline-date"]')?.getClientRects().length)`, Boolean);
    assert.deepEqual(await connection.evaluate<{
      eventFieldCount: number;
      eventHeading: string;
      saveButton: boolean;
      unrelatedControls: boolean;
      editorOnFront: boolean;
    }>(`(() => {
      const card = document.querySelector('.supporter-dashboard-mobile-shell .game-on-collection__card--selected');
      const editor = card?.querySelector('.game-on-collection__flip-back .game-on-inline--calendar');
      return {
        eventFieldCount: editor?.querySelectorAll('.game-on-inline__fields input').length || 0,
        eventHeading: editor?.querySelector('.game-on-inline__section h3')?.textContent?.trim() || '',
        saveButton: Boolean(editor?.querySelector('[data-testid="button-save-inline-event"]')),
        unrelatedControls: Boolean(editor?.querySelector(
          '[data-testid="input-inline-prep-notes"], [data-testid="button-inline-open-prep"], [data-testid="button-inline-open-stat-tracker"], [data-testid="button-publish-inline-card"], .game-on-inline__sharing',
        )),
        editorOnFront: Boolean(card?.querySelector('.game-on-collection__flip-front [data-testid^="game-on-inline-"]')),
      };
    })()`, page.sessionId), {
      eventFieldCount: 4,
      eventHeading: 'Event details',
      saveButton: true,
      unrelatedControls: false,
      editorOnFront: false,
    }, 'Details should only show event fields and save controls on the badge back');
    assert.equal(await connection.evaluate(
      `Boolean(document.querySelector('.supporter-dashboard-mobile-shell .game-on-collection__filters'))`,
      page.sessionId,
    ), false, 'the dashboard no longer shows status-filter tabs');
    assert.equal(await connection.evaluate(`Boolean(document.querySelector('.supporter-dashboard-mobile-shell .game-on-collection__dialog-card[data-calendar-open="true"] [data-testid="input-inline-date"]'))`, page.sessionId),
      true, 'removing status filters should leave the open Details editor mounted in the dialog');
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [data-testid^="button-close-calendar-editor-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
      .some((card) => card.getAttribute('data-details-open') === 'false' && card.classList.contains('game-on-collection__card--selected'))`, Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [data-testid^="button-open-card-prep-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
      .some((card) => card.getAttribute('data-prep-open') === 'true')`, Boolean);
    assert.equal(await connection.evaluate(
      `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__flip-back--prep'))
        .some((panel) => panel.getClientRects().length > 0)`,
      page.sessionId,
    ), true, 'choosing Prep should flip the expanded card to its panel');
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [data-testid^="button-close-card-prep-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
      .some((card) => card.getAttribute('data-prep-open') === 'false')`, Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [data-testid^="button-open-stat-tracker-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
      .some((card) => card.getAttribute('data-tracker-open') === 'true')`, Boolean);
    assert.equal(await connection.evaluate(
      `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-quick-tracker__title'))
        .some((heading) => heading.getClientRects().length > 0)`,
      page.sessionId,
    ), true, 'choosing Stat Tracker should flip the expanded card to its panel');
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [data-testid^="button-close-stat-tracker-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
      .some((card) => card.getAttribute('data-tracker-open') === 'false')`, Boolean);
    await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
    await waitFor(connection, page.sessionId, `!document.querySelector('.supporter-dashboard-mobile-shell .game-on-collection__card--selected')`, Boolean);
    assert.equal(await connection.evaluate(`(() => {
      const active = document.activeElement;
      return Boolean(active instanceof HTMLElement
        && active.dataset.testid?.startsWith('button-open-game-on-card-')
        && active.closest('.game-on-collection__grid'));
    })()`, page.sessionId), true, 'closing the card dialog with Escape should return focus to its grid tile');
    await connection.evaluate('document.activeElement instanceof HTMLButtonElement && document.activeElement.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-mobile-shell [role=\\"dialog\\"][data-testid^=\\"dialog-game-on-card-\\"]") !== null', Boolean);

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [role="dialog"][data-testid^="dialog-game-on-card-"]') !== null
      && document.querySelector('.supporter-dashboard-mobile-shell [role="dialog"][data-testid^="dialog-game-on-card-"]') === null`, Boolean);
    assert.deepEqual(await connection.evaluate<{ mobileDialogCount: number; desktopDialogCount: number }>(`({
      mobileDialogCount: document.querySelectorAll('.supporter-dashboard-mobile-shell [role="dialog"][data-testid^="dialog-game-on-card-"]').length,
      desktopDialogCount: document.querySelectorAll('.supporter-dashboard-desktop-shell [role="dialog"][data-testid^="dialog-game-on-card-"]').length,
    })`, page.sessionId), {
      mobileDialogCount: 0,
      desktopDialogCount: 1,
    }, 'changing to desktop should transfer the open card dialog to the visible dashboard shell');
    await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
    await waitFor(connection, page.sessionId, '!document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__card--selected")', Boolean);
    assert.deepEqual(await connection.evaluate<{
      oldPanelsRemoved: boolean;
      actionCount: number;
      heroAboveCollection: boolean;
      heroDomBeforeCollection: boolean;
      compactDesktopCards: boolean;
      titleAtBottom: boolean;
      titleReadable: boolean;
      statusVisibleAndClear: boolean;
    }>(`(() => {
      const collection = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="game-on-dashboard-collection"]');
      const hero = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="desktop-game-on-summary"]');
      const grid = collection?.querySelector('[data-testid="grid-game-on-cards"]');
      if (!(collection instanceof HTMLElement) || !(hero instanceof HTMLElement) || !(grid instanceof HTMLElement)) throw new Error('Desktop Game On collection is missing');
      const columnCount = getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length;
      const card = Array.from(grid.querySelectorAll('.game-on-collection__card'))
        .find((item) => !item.classList.contains('game-on-collection__card--selected'));
      const kind = card?.querySelector('.game-on-collection__kind');
      const date = card?.querySelector('.game-on-collection__date');
      const status = card?.querySelector('.game-on-collection__status');
      const summary = card?.querySelector('.game-on-collection__summary');
      const cardRect = card?.getBoundingClientRect();
      const kindRect = kind?.getBoundingClientRect();
      const dateRect = date?.getBoundingClientRect();
      const statusRect = status?.getBoundingClientRect();
      const summaryRect = summary?.getBoundingClientRect();
      return {
        oldPanelsRemoved: !document.querySelector('[data-testid="section-desktop-workspace"], [data-testid="workspace-recommendation"], [data-testid="desktop-game-on-entry"]'),
        actionCount: Array.from(collection.querySelectorAll('.game-on-collection__actions > *'))
          .filter((action) => action.getClientRects().length > 0).length,
        heroAboveCollection: hero.getBoundingClientRect().bottom <= collection.getBoundingClientRect().top + 1,
        heroDomBeforeCollection: Boolean(hero.compareDocumentPosition(collection) & Node.DOCUMENT_POSITION_FOLLOWING),
        compactDesktopCards: columnCount >= 4 && Boolean(cardRect && cardRect.width <= 236),
        titleAtBottom: Boolean(kindRect && dateRect && summaryRect && kindRect.top > dateRect.bottom && kindRect.bottom >= summaryRect.bottom - 18),
        titleReadable: Boolean(kind && Number.parseFloat(getComputedStyle(kind).fontSize) >= 19),
        statusVisibleAndClear: Boolean(cardRect && dateRect && statusRect && status?.getClientRects().length
          && statusRect.left >= cardRect.left - 1
          && statusRect.right <= cardRect.right + 1
          && statusRect.bottom <= dateRect.top + 1
          && summary?.getAttribute('aria-label')?.endsWith(status?.textContent?.trim() || '')),
      };
    })()`, page.sessionId), {
      oldPanelsRemoved: true,
      actionCount: 0,
      heroAboveCollection: true,
      heroDomBeforeCollection: true,
      compactDesktopCards: true,
      titleAtBottom: true,
      titleReadable: true,
      statusVisibleAndClear: true,
    });

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'game-1', type: 'game', date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'live' },
      { id: 'practice-1', type: 'practice', date: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), time: '17:00', location: 'Northside Gym', status: 'upcoming' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__kind'))
      .some((kind) => kind.textContent?.includes('Practice'))`, Boolean);

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'next-game-card', type: 'game', date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'upcoming' },
      { id: 'later-practice-card', type: 'practice', date: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), time: '17:00', location: 'Northside Gym', status: 'upcoming' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="card-game-on-draft:next-game-card"]')?.getAttribute('data-up-next') === 'true'`, Boolean);
    const cardFrontDetails = await connection.evaluate<{
      nextMarker: string | null;
      nextGradient: string;
      nextTime: string;
      nextTimeVisible: boolean;
      nextAccessibleLabel: string;
      laterMarker: string | null;
      laterTime: string;
    }>(`(() => {
      const next = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="card-game-on-draft:next-game-card"]');
      const later = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="card-game-on-draft:later-practice-card"]');
      const nextTime = next?.querySelector('[data-testid="text-game-on-card-time-draft:next-game-card"]');
      const laterTime = later?.querySelector('[data-testid="text-game-on-card-time-draft:later-practice-card"]');
      return {
        nextMarker: next?.getAttribute('data-up-next') ?? null,
        nextGradient: next ? getComputedStyle(next.querySelector('.game-on-collection__flip-front')).backgroundImage : '',
        nextTime: nextTime?.textContent?.trim() ?? '',
        nextTimeVisible: Boolean(nextTime?.getClientRects().length),
        nextAccessibleLabel: next?.querySelector('.game-on-collection__summary')?.getAttribute('aria-label') ?? '',
        laterMarker: later?.getAttribute('data-up-next') ?? null,
        laterTime: laterTime?.textContent?.trim() ?? '',
      };
    })()`, page.sessionId);
    assert.equal(cardFrontDetails.nextMarker, 'true', 'the closest upcoming event card should be marked as next');
    assert.match(cardFrontDetails.nextGradient, /linear-gradient.*(?:220|238|255)/, 'the next event front should use the blue gradient');
    assert.equal(cardFrontDetails.nextTime, '6:30 PM', 'the next event time should be visible on the card front');
    assert.equal(cardFrontDetails.nextTimeVisible, true);
    assert.match(cardFrontDetails.nextAccessibleLabel, /^Up next:/, 'screen readers should hear which event is next');
    assert.equal(cardFrontDetails.laterMarker, 'false', 'later cards should not receive the next-event treatment');
    assert.equal(cardFrontDetails.laterTime, '5:00 PM', 'practice time should also be visible on its card front');

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'game-1', type: 'game', date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'live' },
      { id: 'practice-1', type: 'practice', date: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), time: '17:00', location: 'Northside Gym', status: 'upcoming' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="card-game-on-draft:game-1"]') !== null`, Boolean);

    await connection.evaluate(`(() => {
      const publishedCard = {
        shareToken: 'filter-test-published',
        title: 'Published card',
        savedAt: new Date().toISOString(),
        event: {
          id: 'published-event',
          type: 'game',
          date: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          time: '18:30',
          location: 'Northside Gym',
          opponent: 'Published Opponent',
          status: 'upcoming',
        },
      };
      const storageKey = 'pixlsports-game-on-cards:supporter-save-transition';
      localStorage.setItem(storageKey, JSON.stringify([publishedCard]));
      window.dispatchEvent(new StorageEvent('storage', { key: storageKey, storageArea: localStorage }));
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      window.__setSupporterDashboardEvents([
        { id: 'filter-live', type: 'game', date: futureDate, time: '18:30', location: 'Riverside Arena', opponent: 'Live Opponent', status: 'live' },
        { id: 'filter-complete', type: 'game', date: futureDate, time: '18:30', location: 'Northside Gym', opponent: 'Complete Opponent', status: 'final' },
        { id: 'filter-draft', type: 'practice', date: futureDate, time: '17:00', location: 'Northside Gym', status: 'upcoming' },
      ]);
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `(() => {
      const grid = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="grid-game-on-cards"]');
      return grid?.querySelectorAll('.game-on-collection__card').length === 4
        && ['live', 'complete', 'draft', 'published'].every((status) => grid.querySelector('[data-status="' + status + '"]'));
    })()`, Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid="stage-reminder-got-it"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `!Array.from(document.querySelectorAll('[data-testid="stage-reminder-got-it"]'))
      .some((button) => button.getClientRects().length > 0)`, Boolean);
    await connection.evaluate(`(() => {
      const card = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="card-game-on-share:filter-test-published"]');
      card?.querySelector('.game-on-collection__summary')?.click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId,
      `Boolean(document.querySelector('.supporter-dashboard-desktop-shell [role="dialog"][data-testid="dialog-game-on-card-share:filter-test-published"]'))`,
      Boolean);
    assert.equal(await connection.evaluate<boolean>(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="card-game-on-share:filter-test-published"] .game-on-collection__actions')?.hidden === true`,
      page.sessionId,
    ), true, 'share actions should remain hidden on compact grid tiles');
    await connection.evaluate(`(() => {
      window.__eventCardShareCalls = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (payload) => window.__eventCardShareCalls.push(payload),
      });
    })()`, page.sessionId);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:filter-test-published"] [data-testid="button-share-game-on-card-share:filter-test-published"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `window.__eventCardShareCalls?.length === 1
      && document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:filter-test-published"] [data-testid="status-game-on-share"]')?.textContent === 'Event Card shared.'`, Boolean);
    const sharedCardDetails = await connection.evaluate<{
      sharedUrl: string;
      expectedUrl: string;
      selectedCardActionVisible: boolean;
      editArrowVisible: boolean;
      removedActionTilesAbsent: boolean;
    }>(`(() => {
      const dialog = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:filter-test-published"]');
      const cardAction = dialog?.querySelector('[data-testid="button-share-game-on-card-share:filter-test-published"]');
      return {
        sharedUrl: window.__eventCardShareCalls[0]?.url ?? '',
        expectedUrl: new URL('/game-on/filter-test-published', location.href).href,
        selectedCardActionVisible: Boolean(cardAction?.getClientRects().length),
        editArrowVisible: Boolean(dialog?.querySelector('[data-testid^="button-edit-event-arrow-"]')?.getClientRects().length),
        removedActionTilesAbsent: !dialog?.querySelector('[data-testid^="button-edit-calendar-"], [data-testid^="button-copy-game-on-card-link-"], [data-testid^="link-open-game-on-card-"]'),
      };
    })()`, page.sessionId);
    assert.deepEqual(sharedCardDetails, {
      sharedUrl: sharedCardDetails.expectedUrl,
      expectedUrl: sharedCardDetails.expectedUrl,
      selectedCardActionVisible: true,
      editArrowVisible: true,
      removedActionTilesAbsent: true,
    }, 'Share should send the selected Event Card public link');
    await connection.evaluate(`(() => {
      window.__eventCardCopiedUrl = '';
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (url) => { window.__eventCardCopiedUrl = url; } },
      });
    })()`, page.sessionId);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:filter-test-published"] [data-testid="button-share-game-on-card-share:filter-test-published"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Boolean(window.__eventCardCopiedUrl)
      && document.querySelector('.supporter-dashboard-desktop-shell [data-testid="dialog-game-on-card-share:filter-test-published"] [data-testid="status-game-on-share"]')?.textContent === 'Event Card link copied.'`, Boolean);
    const copiedCardUrl = await connection.evaluate<string>('window.__eventCardCopiedUrl', page.sessionId);
    assert.equal(copiedCardUrl, sharedCardDetails.expectedUrl,
      'browsers without Web Share should copy the same Event Card link');
    await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
    await waitFor(connection, page.sessionId,
      `!document.querySelector('.supporter-dashboard-desktop-shell [role="dialog"][data-testid="dialog-game-on-card-share:filter-test-published"]')`,
      Boolean);
    assert.deepEqual(await connection.evaluate<{
      count: string;
      filterRow: boolean;
      statusButtons: number;
      visibleStatuses: string[];
    }>(`(() => {
      const collection = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="game-on-dashboard-collection"]');
      const grid = collection?.querySelector('[data-testid="grid-game-on-cards"]');
      return {
        count: collection?.querySelector('[data-testid="status-game-on-card-count"]')?.textContent?.trim() ?? '',
        filterRow: Boolean(collection?.querySelector('.game-on-collection__filters')),
        statusButtons: collection?.querySelectorAll('[data-testid^="button-filter-game-on-"]').length ?? 0,
        visibleStatuses: Array.from(grid?.querySelectorAll('.game-on-collection__status') ?? [])
          .filter((status) => status.getClientRects().length > 0)
          .map((status) => status.getAttribute('data-status') || '')
          .sort(),
      };
    })()`, page.sessionId), {
      count: 'Showing 4 of 4 Event Cards',
      filterRow: false,
      statusButtons: 0,
      visibleStatuses: ['complete', 'draft', 'live', 'published'],
    });

    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="input-search-game-on-cards"]')?.focus()`,
      page.sessionId,
    );
    await connection.send('Input.insertText', { text: 'live opponent' }, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 1 of 4 Event Cards'`, Boolean);
    assert.deepEqual(await connection.evaluate<string[]>(
      `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell [data-testid="grid-game-on-cards"] .game-on-collection__status'))
        .filter((status) => status.getClientRects().length > 0)
        .map((status) => status.getAttribute('data-status'))`,
      page.sessionId,
    ), ['live'], 'opponent search should still find cards after status tabs are removed');
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-clear-game-on-search"]')?.click()`,
      page.sessionId,
    );
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="input-search-game-on-cards"]')?.value === ''`, Boolean);
    assert.equal(await connection.evaluate<string>(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() || ''`,
      page.sessionId,
    ), 'Showing 4 of 4 Event Cards', 'clearing a search should show all card statuses');

    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="input-search-game-on-cards"]')?.focus()`,
      page.sessionId,
    );
    await connection.send('Input.insertText', { text: 'Riverside Arena' }, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 1 of 4 Event Cards'`, Boolean);
    assert.deepEqual(await connection.evaluate<string[]>(
      `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell [data-testid="grid-game-on-cards"] .game-on-collection__status'))
        .filter((status) => status.getClientRects().length > 0)
        .map((status) => status.getAttribute('data-status'))`,
      page.sessionId,
    ), ['live'], 'location search should still find the matching card');
    await connection.evaluate(`window.__setSupporterDashboardEvents([
      ...window.__getSupporterDashboardEvents(),
      {
        id: 'filter-live-added',
        type: 'game',
        date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        time: '19:00',
        location: 'Riverside Arena',
        opponent: 'Added Live Opponent',
        status: 'live',
      },
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 2 of 5 Event Cards'
      && document.querySelector('.supporter-dashboard-desktop-shell [data-testid="card-game-on-draft:filter-live-added"]')?.getClientRects().length > 0`, Boolean);
    assert.deepEqual(await connection.evaluate<{
      search: string;
      matchingOpponents: string[];
    }>(`(() => {
      const shell = document.querySelector('.supporter-dashboard-desktop-shell');
      return {
        search: shell?.querySelector('[data-testid="input-search-game-on-cards"]')?.value || '',
        matchingOpponents: Array.from(shell?.querySelectorAll('[data-testid="grid-game-on-cards"] .game-on-collection__status') || [])
          .filter((status) => status.getClientRects().length > 0)
          .map((status) => status.closest('.game-on-collection__card')?.querySelector('.game-on-collection__opponent')?.textContent?.trim() || ''),
      };
    })()`, page.sessionId), {
      search: 'Riverside Arena',
      matchingOpponents: ['vs Live Opponent', 'vs Added Live Opponent'],
    }, 'adding a matching card should update search results and count');
    await connection.evaluate(`window.__setSupporterDashboardEvents(
      window.__getSupporterDashboardEvents().filter((event) => event.id !== 'filter-live-added')
    )`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 1 of 4 Event Cards'
      && !document.querySelector('.supporter-dashboard-desktop-shell [data-testid="card-game-on-draft:filter-live-added"]')`, Boolean);
    assert.deepEqual(await connection.evaluate<{
      search: string;
    }>(`(() => {
      const shell = document.querySelector('.supporter-dashboard-desktop-shell');
      return {
        search: shell?.querySelector('[data-testid="input-search-game-on-cards"]')?.value || '',
      };
    })()`, page.sessionId), {
      search: 'Riverside Arena',
    }, 'removing a matching card should preserve the active query');
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-clear-game-on-search"]')?.click()`,
      page.sessionId,
    );
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="input-search-game-on-cards"]')?.value === ''`, Boolean);
    const liveCardDate = await connection.evaluate<{ stored: string; visible: string }>(`(() => {
      const liveStatus = Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell [data-testid="grid-game-on-cards"] .game-on-collection__status'))
        .find((status) => status.getAttribute('data-status') === 'live' && status.getClientRects().length > 0);
      const date = liveStatus?.closest('.game-on-collection__card')?.querySelector('.game-on-collection__date');
      return {
        stored: date?.getAttribute('aria-label') || '',
        visible: Array.from(date?.querySelectorAll('.game-on-collection__date-month, .game-on-collection__date-day') ?? [])
          .map((part) => part.textContent?.trim() || '')
          .filter(Boolean)
          .join(' '),
      };
    })()`, page.sessionId);
    assert.ok(liveCardDate.stored && liveCardDate.visible, 'the live card should expose its event date for a search check');
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="input-search-game-on-cards"]')?.focus()`,
      page.sessionId,
    );
    await connection.send('Input.insertText', { text: liveCardDate.visible }, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell [data-testid="grid-game-on-cards"] .game-on-collection__status'))
      .some((status) => status.getClientRects().length > 0 && status.getAttribute('data-status') === 'live')`, Boolean);
    assert.ok(await connection.evaluate<boolean>(
      `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell [data-testid="grid-game-on-cards"] .game-on-collection__status'))
        .filter((status) => status.getClientRects().length > 0)
        .map((status) => status.getAttribute('data-status'))
      .includes('live')`,
      page.sessionId,
    ), 'date search should still find the live card after status filters are removed');
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-clear-game-on-search"]')?.click()`,
      page.sessionId,
    );
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="input-search-game-on-cards"]')?.value === ''`, Boolean);
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="input-search-game-on-cards"]')?.focus()`,
      page.sessionId,
    );
    await connection.send('Input.insertText', { text: `Live Opponent Riverside Arena ${liveCardDate.stored}` }, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 1 of 4 Event Cards'`, Boolean);
    assert.deepEqual(await connection.evaluate<string[]>(
      `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell [data-testid="grid-game-on-cards"] .game-on-collection__status'))
        .filter((status) => status.getClientRects().length > 0)
        .map((status) => status.getAttribute('data-status'))`,
      page.sessionId,
    ), ['live'], 'opponent, location, and date terms should combine in search');
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-clear-game-on-search"]')?.click()`,
      page.sessionId,
    );
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="input-search-game-on-cards"]')?.value === ''`, Boolean);
    assert.equal(await connection.evaluate<string>(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() || ''`,
      page.sessionId,
    ), 'Showing 4 of 4 Event Cards', 'clearing a date search should restore all statuses');

    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="input-search-game-on-cards"]')?.focus()`,
      page.sessionId,
    );
    await connection.send('Input.insertText', { text: 'Nowhere' }, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-clear-game-on-search-empty"]') !== null`, Boolean);
    assert.equal(await connection.evaluate<string>(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-on-filter-empty"] .game-on-collection__empty-title')?.textContent?.trim() || ''`,
      page.sessionId,
    ), 'No cards match your search.');
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-clear-game-on-search-empty"]')?.click()`,
      page.sessionId,
    );
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 4 of 4 Event Cards'`, Boolean);

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'filter-complete', type: 'game', date: '2999-01-01', time: '18:30', location: 'Northside Gym', opponent: 'Complete Opponent', status: 'final' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 2 of 2 Event Cards'`, Boolean);

    const filterFixtureSetup = `(() => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      window.__setSupporterDashboardEvents([
        { id: 'filter-live', type: 'game', date: futureDate, time: '18:30', location: 'Northside Gym', opponent: 'Live Opponent', status: 'live' },
        { id: 'filter-complete', type: 'game', date: futureDate, time: '18:30', location: 'Northside Gym', opponent: 'Complete Opponent', status: 'final' },
        { id: 'filter-draft', type: 'practice', date: futureDate, time: '17:00', location: 'Northside Gym', status: 'upcoming' }
      ]);
    })()`;
    await connection.evaluate(filterFixtureSetup, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 4 of 4 Event Cards'`, Boolean);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 260,
      height: 563,
      deviceScaleFactor: 1.5,
      mobile: true,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-mobile-shell [data-testid=\\"game-on-dashboard-collection\\"]")?.getClientRects().length > 0', Boolean);
    assert.deepEqual(await connection.evaluate<{
      filterRow: boolean;
      statusButtons: number;
      searchFits: boolean;
      searchCanBeReached: boolean;
      visibleStatuses: string[];
    }>(`(() => {
      const collection = document.querySelector('.supporter-dashboard-mobile-shell [data-testid="game-on-dashboard-collection"]');
      const search = collection?.querySelector('[data-testid="input-search-game-on-cards"]');
      return {
        filterRow: Boolean(collection?.querySelector('.game-on-collection__filters')),
        statusButtons: collection?.querySelectorAll('[data-testid^="button-filter-game-on-"]').length ?? 0,
        searchFits: Boolean(search && search.getBoundingClientRect().width <= collection.getBoundingClientRect().width),
        searchCanBeReached: Boolean(search && search.getClientRects().length),
        visibleStatuses: Array.from(collection?.querySelectorAll('[data-testid="grid-game-on-cards"] .game-on-collection__status') ?? [])
          .filter((status) => status.getClientRects().length > 0)
          .map((status) => status.getAttribute('data-status') || '')
          .sort(),
      };
    })()`, page.sessionId), {
      filterRow: false,
      statusButtons: 0,
      searchFits: true,
      searchCanBeReached: true,
      visibleStatuses: ['complete', 'draft', 'live', 'published'],
    });
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-mobile-shell [data-testid="input-search-game-on-cards"]')?.focus()`,
      page.sessionId,
    );
    await connection.send('Input.insertText', { text: 'Northside Gym' }, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-mobile-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 4 of 4 Event Cards'`, Boolean);
    await connection.evaluate(
      `document.querySelector('.supporter-dashboard-mobile-shell [data-testid="button-clear-game-on-search"]')?.click()`,
      page.sessionId,
    );
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-mobile-shell [data-testid="input-search-game-on-cards"]')?.value === ''`, Boolean);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-mobile-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 4 of 4 Event Cards'`, Boolean);
    await connection.evaluate(`(() => {
      const storageKey = 'pixlsports-game-on-cards:supporter-save-transition';
      localStorage.removeItem(storageKey);
      window.dispatchEvent(new StorageEvent('storage', { key: storageKey, storageArea: localStorage }));
      window.__setSupporterDashboardEvents([
        { id: 'game-1', type: 'game', date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'live' },
        { id: 'practice-1', type: 'practice', date: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), time: '17:00', location: 'Northside Gym', status: 'upcoming' },
      ]);
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-mobile-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 2 of 2 Event Cards'`, Boolean);
    await connection.evaluate(`(() => {
      sessionStorage.setItem('pixlsports-game-on-status-filter:supporter-save-transition', 'Live');
      window.__navigateSupporterDashboardAwayForFilterTest('Prep');
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('[data-testid="supporter-dashboard-away-tool"]')?.textContent === 'Prep'`, Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-return-to-supporter-dashboard"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-mobile-shell [data-testid="status-game-on-card-count"]')?.textContent?.trim() === 'Showing 2 of 2 Event Cards'`, Boolean);
    assert.deepEqual(await connection.evaluate<{
      filterRow: boolean;
      visibleStatuses: string[];
    }>(`(() => {
      const collection = document.querySelector('.supporter-dashboard-mobile-shell [data-testid="game-on-dashboard-collection"]');
      return {
        filterRow: Boolean(collection?.querySelector('.game-on-collection__filters')),
        visibleStatuses: Array.from(collection?.querySelectorAll('[data-testid="grid-game-on-cards"] .game-on-collection__status') ?? [])
          .filter((status) => status.getClientRects().length > 0)
          .map((status) => status.getAttribute('data-status') || '')
          .sort(),
      };
    })()`, page.sessionId), {
      filterRow: false,
      visibleStatuses: ['draft', 'live'],
    }, 'an old saved status choice should not hide cards when the dashboard is reopened');
    await connection.evaluate(
      `sessionStorage.removeItem('pixlsports-game-on-status-filter:supporter-save-transition')`,
      page.sessionId,
    );

    // A 260 CSS-pixel mobile viewport at 1.5x device scale approximates a
    // 390px phone viewed at 150% zoom, while retaining the real responsive layout.
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 260,
      height: 563,
      deviceScaleFactor: 1.5,
      mobile: true,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-mobile-shell [data-testid=\\"game-on-dashboard-collection\\"]")?.getClientRects().length > 0', Boolean);
    assert.equal(await connection.evaluate<boolean>(`Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__time'))
      .some((time) => time.getClientRects().length > 0 && ['5:00 PM', '6:30 PM'].includes(time.textContent?.trim() ?? ''))`, page.sessionId), true,
    'event times should remain visible on compact mobile card fronts');
    const phoneZoomState = await connection.evaluate<{
      viewportWidth: number;
      pageOverflow: boolean;
      dashboardOverflow: boolean;
      columnCount: number;
      overflowingElements: string[];
      cards: Array<{
        kind: string;
        dateMonth: string;
        dateDay: string;
        kindReadable: boolean;
        dateReadable: boolean;
        status: string;
        statusVisibleAndAnnounced: boolean;
      }>;
    }>(`(() => {
      const root = document.querySelector('.supporter-dashboard-mobile-shell');
      const collection = root?.querySelector('[data-testid="game-on-dashboard-collection"]');
      const grid = collection?.querySelector('[data-testid="grid-game-on-cards"]');
      if (!(root instanceof HTMLElement) || !(collection instanceof HTMLElement) || !(grid instanceof HTMLElement)) {
        throw new Error('The zoomed phone Game On collection is missing');
      }
      const cards = Array.from(grid.querySelectorAll('.game-on-collection__card'))
        .filter((card) => card.getClientRects().length > 0)
        .map((card) => {
          const kind = card.querySelector('.game-on-collection__kind');
          const month = card.querySelector('.game-on-collection__date-month');
          const day = card.querySelector('.game-on-collection__date-day');
          const status = card.querySelector('.game-on-collection__status');
          const summary = card.querySelector('.game-on-collection__summary');
          return {
            kind: kind?.textContent?.trim() || '',
            dateMonth: month?.textContent?.trim() || '',
            dateDay: day?.textContent?.trim() || '',
            kindReadable: Boolean(kind && kind.getClientRects().length
              && kind.scrollWidth <= kind.clientWidth + 1
              && Number.parseFloat(getComputedStyle(kind).fontSize) * devicePixelRatio >= 14),
            dateReadable: Boolean(month && day && month.getClientRects().length && day.getClientRects().length
              && Number.parseFloat(getComputedStyle(month).fontSize) * devicePixelRatio >= 11
              && Number.parseFloat(getComputedStyle(day).fontSize) * devicePixelRatio >= 28),
            status: status?.textContent?.trim() || '',
            statusVisibleAndAnnounced: Boolean(status?.getClientRects().length
              && summary?.getAttribute('aria-label')?.endsWith(status.textContent?.trim() || '')),
          };
        });
      return {
        viewportWidth: document.documentElement.clientWidth,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        dashboardOverflow: root.scrollWidth > root.clientWidth,
        columnCount: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length,
        overflowingElements: Array.from(document.querySelectorAll('body *'))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return { element, right: rect.right, width: rect.width, overflowX: getComputedStyle(element).overflowX };
          })
          .filter(({ element, right }) => right > document.documentElement.clientWidth + 1
            && getComputedStyle(element).visibility !== 'hidden'
            && element.getClientRects().length > 0)
          .sort((left, right) => right.right - left.right)
          .slice(0, 8)
          .map(({ element, right, width, overflowX }) => {
            const name = element.tagName.toLowerCase();
            const classes = typeof element.className === 'string' ? element.className.trim().replace(/\\s+/g, '.') : '';
            return name + (classes ? '.' + classes : '') + ' right=' + Math.round(right) + ' width=' + Math.round(width) + ' overflow-x=' + overflowX;
          }),
        cards,
      };
    })()`, page.sessionId);
    assert.equal(phoneZoomState.viewportWidth, 260);
    assert.equal(phoneZoomState.pageOverflow, false, `zoomed phone dashboard must not create horizontal page scrolling: ${phoneZoomState.overflowingElements.join('; ')}`);
    assert.equal(phoneZoomState.dashboardOverflow, false, 'zoomed phone dashboard must stay within its viewport');
    assert.equal(phoneZoomState.columnCount, 1, 'narrow zoomed phone cards should use a readable single column');
    assert.deepEqual(phoneZoomState.cards.map((card) => card.kind).sort(), ['Game', 'Practice']);
    assert.deepEqual(phoneZoomState.cards.map((card) => card.status).sort(), ['Draft', 'Live']);
    assert.ok(phoneZoomState.cards.every((card) => card.statusVisibleAndAnnounced),
      'live and draft statuses should stay visible and included in the accessible card name');
    assert.ok(phoneZoomState.cards.every((card) => card.dateMonth && card.dateDay && card.kindReadable && card.dateReadable),
      'Game and Practice labels and dates should remain legible at phone zoom');

    await connection.evaluate(`(() => {
      const root = document.querySelector('.supporter-dashboard-mobile-shell');
      const card = Array.from(root?.querySelectorAll('.game-on-collection__card') || [])
        .find((item) => item.getClientRects().length > 0
          && item.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      if (!(card instanceof HTMLElement)) throw new Error('The zoomed phone game card is missing');
      if (card.classList.contains('game-on-collection__card--selected')) {
        card.querySelector('.game-on-collection__summary')?.click();
      }
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, '!document.querySelector(".supporter-dashboard-mobile-shell .game-on-collection__card--selected")', Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
      .find((card) => card.getClientRects().length > 0
        && card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'))
      ?.querySelector('.game-on-collection__summary')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
      .some((card) => card.classList.contains('game-on-collection__card--expanded')
        && card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'))`, Boolean);
    assert.equal(await connection.evaluate<boolean>(`(() => {
      const card = document.querySelector('.supporter-dashboard-mobile-shell .game-on-collection__card--selected');
      const actions = Array.from(card?.querySelectorAll('.game-on-collection__actions > button') || [])
        .filter((action) => action.getClientRects().length > 0);
      const cardRect = card?.getBoundingClientRect();
      return actions.length === 3 && Boolean(cardRect)
        && actions.every((action) => {
          const rect = action.getBoundingClientRect();
          return rect.width >= 44 && rect.left >= cardRect.left && rect.right <= cardRect.right;
        });
    })()`, page.sessionId), true, 'zoomed phone card actions should remain visible, touch-sized, and inside the card');
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [data-testid^="button-open-card-prep-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__flip-back--prep'))
      .some((panel) => panel.getClientRects().length > 0)`, Boolean);
    assert.equal(await connection.evaluate<boolean>(
      'document.documentElement.scrollWidth <= document.documentElement.clientWidth',
      page.sessionId,
    ), true, 'opening a panel at phone zoom must not introduce horizontal page scrolling');
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [data-testid^="button-close-card-prep-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
      .some((card) => card.getAttribute('data-prep-open') === 'false')`, Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-mobile-shell .game-on-collection__card--selected .game-on-collection__summary')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, '!document.querySelector(".supporter-dashboard-mobile-shell .game-on-collection__card--selected")', Boolean);

    // A 1024 CSS-pixel desktop viewport at 2x scale approximates 200% zoom
    // on a 2048px-wide display and keeps the desktop dashboard breakpoint active.
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1024,
      height: 768,
      deviceScaleFactor: 2,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid=\\"game-on-dashboard-collection\\"]")?.getClientRects().length > 0', Boolean);
    const desktopZoomState = await connection.evaluate<{
      pageOverflow: boolean;
      cards: Array<{ kind: string; dateMonth: string; dateDay: string; kindReadable: boolean; dateReadable: boolean }>;
    }>(`(() => {
      const root = document.querySelector('.supporter-dashboard-desktop-shell');
      const grid = root?.querySelector('[data-testid="grid-game-on-cards"]');
      if (!(root instanceof HTMLElement) || !(grid instanceof HTMLElement)) throw new Error('The zoomed desktop Game On collection is missing');
      return {
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        cards: Array.from(grid.querySelectorAll('.game-on-collection__card'))
          .filter((card) => card.getClientRects().length > 0)
          .map((card) => {
            const kind = card.querySelector('.game-on-collection__kind');
            const month = card.querySelector('.game-on-collection__date-month');
            const day = card.querySelector('.game-on-collection__date-day');
            return {
              kind: kind?.textContent?.trim() || '',
              dateMonth: month?.textContent?.trim() || '',
              dateDay: day?.textContent?.trim() || '',
              kindReadable: Boolean(kind && kind.getClientRects().length
                && kind.scrollWidth <= kind.clientWidth + 1
                && Number.parseFloat(getComputedStyle(kind).fontSize) * devicePixelRatio >= 14),
              dateReadable: Boolean(month && day && month.getClientRects().length && day.getClientRects().length
                && Number.parseFloat(getComputedStyle(month).fontSize) * devicePixelRatio >= 14
                && Number.parseFloat(getComputedStyle(day).fontSize) * devicePixelRatio >= 28),
            };
          }),
      };
    })()`, page.sessionId);
    assert.equal(desktopZoomState.pageOverflow, false, 'zoomed desktop dashboard must not create horizontal page scrolling');
    assert.deepEqual(desktopZoomState.cards.map((card) => card.kind).sort(), ['Game', 'Practice']);
    assert.ok(desktopZoomState.cards.every((card) => card.dateMonth && card.dateDay && card.kindReadable && card.dateReadable),
      'Game and Practice labels and dates should remain legible at desktop zoom');
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
      .find((card) => card.getClientRects().length > 0
        && card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'))
      ?.querySelector('.game-on-collection__summary')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
      .some((card) => card.classList.contains('game-on-collection__card--expanded')
        && card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'))`, Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell [data-testid^="button-open-card-prep-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__flip-back--prep'))
      .some((panel) => panel.getClientRects().length > 0)`, Boolean);
    assert.equal(await connection.evaluate<boolean>(
      'document.documentElement.scrollWidth <= document.documentElement.clientWidth',
      page.sessionId,
    ), true, 'opening a panel at desktop zoom must not introduce horizontal page scrolling');
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell [data-testid^="button-close-card-prep-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
      .some((card) => card.getAttribute('data-prep-open') === 'false')`, Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__card--selected .game-on-collection__summary')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, '!document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__card--selected")', Boolean);

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'Rivals' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, `!Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__kind'))
      .some((kind) => kind.textContent?.includes('Practice'))`, Boolean);

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid=\\"game-on-dashboard-collection\\"]")?.getClientRects().length > 0', Boolean);

    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-create-game-on-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid^=\\"card-game-on-new-card-\\"]") !== null', Boolean);
    assert.deepEqual(await connection.evaluate<{
      draftSquare: boolean;
      draftNotExpanded: boolean;
      editorNotOpen: boolean;
    }>(`(() => {
      const draft = document.querySelector('.supporter-dashboard-desktop-shell [data-testid^="card-game-on-new-card-"]');
      if (!(draft instanceof HTMLElement)) throw new Error('New Game On tile is missing');
      const rect = draft.getBoundingClientRect();
      return {
        draftSquare: Math.abs(rect.width / rect.height - 1) < 0.05,
        draftNotExpanded: !draft.classList.contains('game-on-collection__card--selected'),
        editorNotOpen: draft.querySelector('[data-testid="panel-game-on-card-draft"]') === null,
      };
    })()`, page.sessionId), {
      draftSquare: true,
      draftNotExpanded: true,
      editorNotOpen: true,
    });
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid^="button-open-game-on-card-new-card-"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"select-game-on-type\\"]")?.value === "game"', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"input-game-on-date\\"]")?.value || ""', page.sessionId),
      '',
      'a new independent Game On card should not start with a preset date',
    );
    assert.deepEqual(await connection.evaluate<{
      editorInsideSelectedCard: boolean;
      bottomPanelRemoved: boolean;
      draftSelected: boolean;
    }>(`(() => {
      const selected = document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__card--selected');
      return {
        editorInsideSelectedCard: Boolean(selected?.querySelector('[data-testid="panel-game-on-card-draft"]')),
        bottomPanelRemoved: document.querySelector('[data-testid="game-on-card-panel"]') === null,
        draftSelected: Boolean(selected?.getAttribute('data-testid')?.startsWith('card-game-on-new-card-')),
      };
    })()`, page.sessionId), {
      editorInsideSelectedCard: true,
      bottomPanelRemoved: true,
      draftSelected: true,
    });
    await connection.evaluate(`(() => {
      const input = document.querySelector('[data-testid="input-game-on-opponent"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('Opponent field missing');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'Falcons');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__card--selected .game-on-collection__opponent")?.textContent?.includes("Falcons")', Boolean);
    await connection.evaluate(`(() => {
      const select = document.querySelector('[data-testid="select-game-on-type"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Event type picker missing');
      select.value = 'practice';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"select-game-on-type\\"]")?.value === "practice"', Boolean);
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=\\"input-game-on-opponent\\"]") === null', page.sessionId), true);
    assert.equal(await connection.evaluate(
      'document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__card--selected .game-on-collection__opponent")?.textContent?.trim()',
      page.sessionId,
    ), 'Practice', 'the selected card face should reflect the edited practice type');
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid^="button-cancel-game-on-draft-"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"panel-game-on-card-draft\\"]") === null', Boolean);
    assert.equal(await connection.evaluate(
      'document.querySelectorAll(".supporter-dashboard-desktop-shell [data-testid^=\\"card-game-on-new-card-\\"]").length',
      page.sessionId,
    ), 0, 'cancelling should discard the unsaved draft');

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-mobile-shell [data-testid=\\"button-create-game-on-card\\"]")?.getClientRects().length > 0', Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-mobile-shell [data-testid="button-create-game-on-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-mobile-shell [data-testid^=\\"card-game-on-new-card-\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-mobile-shell [data-testid^="button-open-game-on-card-new-card-"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-mobile-shell .game-on-collection__card--selected [data-testid=\\"panel-game-on-card-draft\\"]") !== null', Boolean);
    assert.deepEqual(await connection.evaluate<{ mobileDialogCount: number; desktopDialogCount: number }>(`({
      mobileDialogCount: document.querySelectorAll('.supporter-dashboard-mobile-shell [role="dialog"][data-testid^="dialog-game-on-card-"]').length,
      desktopDialogCount: document.querySelectorAll('.supporter-dashboard-desktop-shell [role="dialog"][data-testid^="dialog-game-on-card-"]').length,
    })`, page.sessionId), {
      mobileDialogCount: 1,
      desktopDialogCount: 0,
    }, 'the mobile shell should own the single active Game On dialog');
    assert.equal(await connection.evaluate(
      'document.querySelector(".supporter-dashboard-desktop-shell [data-testid=\\"panel-game-on-card-draft\\"]") === null',
      page.sessionId,
    ), true, 'the draft editor should render only in the active mobile dashboard shell');
    await connection.evaluate(`document.querySelector('.supporter-dashboard-mobile-shell [data-testid^="button-cancel-game-on-draft-"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-mobile-shell [data-testid=\\"panel-game-on-card-draft\\"]") === null', Boolean);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid=\\"button-create-game-on-card\\"]")?.getClientRects().length > 0', Boolean);

    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-create-game-on-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid^=\\"card-game-on-new-card-\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid^="button-open-game-on-card-new-card-"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"select-game-on-source-event\\"]") !== null', Boolean);
    await connection.evaluate(`(() => {
      const select = document.querySelector('[data-testid="select-game-on-source-event"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Scheduled event picker missing');
      select.value = 'game-1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__card--selected .game-on-collection__opponent")?.textContent?.includes("Rivals")', Boolean);
    assert.equal(await connection.evaluate(
      'document.querySelectorAll(".supporter-dashboard-desktop-shell [data-testid=\\"grid-game-on-cards\\"] .game-on-collection__card").length',
      page.sessionId,
    ), 1, 'starting from a scheduled game should replace, not duplicate, that event in the collection');
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid^="button-cancel-game-on-draft-"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"panel-game-on-card-draft\\"]") === null', Boolean);
    assert.equal(await connection.evaluate(
      'document.querySelector(".supporter-dashboard-desktop-shell [data-testid=\\"card-game-on-draft:game-1\\"]") !== null',
      page.sessionId,
    ), true, 'cancelling should restore the original scheduled card');

    assert.deepEqual(await connection.evaluate<{
      profileTag: string;
      profileHref: string | null;
      statsPath: string;
      statsEventId: string;
      statsEventType: string;
      statsLabel: string;
      prepHref: string;
      trackerAction: string | null;
      hypeQuickLinksRemoved: boolean;
      oldPanelsRemoved: boolean;
    }>(`(() => {
      const profileLink = document.querySelector('[data-testid="btn-mobile-open-profile"]');
      const prep = document.querySelector('[data-testid^="button-open-card-prep-"]');
      const stats = document.querySelector('[data-testid="link-mobile-independent-stats"]');
      const statsUrl = stats instanceof HTMLAnchorElement ? new URL(stats.href) : null;
      const tracker = document.querySelector('[data-testid^="button-open-stat-tracker-"]');
      return {
        profileTag: profileLink?.tagName || '',
        profileHref: profileLink?.getAttribute('href') || null,
        statsPath: statsUrl?.pathname || '',
        statsEventId: statsUrl?.searchParams.get('eventId') || '',
        statsEventType: statsUrl?.searchParams.get('eventType') || '',
        statsLabel: stats?.textContent?.trim() || '',
        prepHref: prep?.getAttribute('data-prep-href') || '',
        trackerAction: tracker?.getAttribute('aria-label') || null,
        hypeQuickLinksRemoved: !document.querySelector('[data-testid="link-mobile-independent-hype"], [data-testid="link-desktop-independent-hype"]'),
        oldPanelsRemoved: !document.querySelector('[data-testid="section-mobile-workspace"], [data-testid="card-mobile-recommendation"]'),
      };
    })()`, page.sessionId), {
      profileTag: 'A',
      profileHref: '/studio/profile',
      statsPath: '/studio/season-stats',
      statsEventId: '',
      statsEventType: '',
      statsLabel: 'View stats',
      prepHref: '/studio/checklist?gameId=game-1&eventType=game',
      trackerAction: 'Open Stat Tracker',
      hypeQuickLinksRemoved: true,
      oldPanelsRemoved: true,
    });
    await connection.evaluate(`(() => {
      const today = new Date();
      const dateKey = (date) => [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
      const inlineGameDate = dateKey(today);
      const practiceDate = new Date(today);
      practiceDate.setDate(practiceDate.getDate() + 1);
      window.__dashboardInlineGameDate = inlineGameDate;
      window.__setSupporterDashboardEvents([
        { id: 'game-1', type: 'game', date: inlineGameDate, time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'live' },
        { id: 'practice-1', type: 'practice', date: dateKey(practiceDate), time: '18:30', location: 'Northside Gym' }
      ]);
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'Array.from(document.querySelectorAll(".game-on-collection__card")).some(card => card.querySelector(".game-on-collection__kind")?.textContent?.includes("Practice"))', Boolean);
    assert.deepEqual(await connection.evaluate<{ practicePrep: boolean; practiceStats: boolean; gameStats: boolean }>(`(() => {
      const cards = Array.from(document.querySelectorAll('.game-on-collection__card'));
      const practice = cards.find((card) => card.querySelector('.game-on-collection__kind')?.textContent?.includes('Practice'));
      const game = cards.find((card) => card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      return {
        practicePrep: Boolean(practice?.querySelector('[data-testid^="button-open-card-prep-"]')),
        practiceStats: Boolean(practice?.querySelector('[data-testid^="button-open-stat-tracker-"]')),
        gameStats: Boolean(game?.querySelector('[data-testid^="button-open-stat-tracker-"]')),
      };
    })()`, page.sessionId), {
      practicePrep: true,
      practiceStats: false,
      gameStats: true,
    });
    await connection.evaluate(`(() => {
      localStorage.removeItem('leaguematrix-stat-tracker-active-game:dashboard-inline-no-sport-test');
      localStorage.removeItem('leaguematrix-stat-tracker:dashboard-inline-no-sport-test');
      window.__setSupporterDashboardSport(null);
      window.__setSupporterDashboardTrackerUserId('dashboard-inline-no-sport-test');
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid^=\\"button-open-stat-tracker-\\"]") !== null', Boolean);
    await connection.evaluate(`(() => {
      const game = Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
        .find((card) => card.getClientRects().length > 0
          && card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      if (game && !game.classList.contains('game-on-collection__card--selected')) {
        game.querySelector('.game-on-collection__summary')?.click();
      }
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
      .some((card) => card.classList.contains('game-on-collection__card--selected')
        && card.querySelector('[data-testid^="button-open-stat-tracker-"]')?.getClientRects().length)`, Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-open-stat-tracker-"]')).find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"inline-tracker-sport-choice\\"]") !== null', Boolean);
    assert.equal(await connection.evaluate<boolean>(
      'localStorage.getItem("leaguematrix-stat-tracker-active-game:dashboard-inline-no-sport-test") === null',
      page.sessionId,
    ), true, 'the Event Card must not create a game before the supporter chooses a sport');
    await connection.evaluate(`document.querySelector('[data-testid="button-inline-start-sport-volleyball"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-inline-scoreboard\\"]") !== null', Boolean);
    assert.equal(await connection.evaluate<string>(
      'JSON.parse(localStorage.getItem("leaguematrix-stat-tracker-active-game:dashboard-inline-no-sport-test") || "null")?.sport || ""',
      page.sessionId,
    ), 'volleyball', 'the inline game must retain the sport the supporter selected');
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-close-stat-tracker-"]')).find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__dialog-card")?.getAttribute("data-tracker-open") === "false"', Boolean);
    await connection.evaluate(`(() => {
      localStorage.removeItem('leaguematrix-stat-tracker-active-game:dashboard-inline-no-sport-test');
      localStorage.removeItem('leaguematrix-stat-tracker:dashboard-inline-no-sport-test');
      window.__setSupporterDashboardSport('basketball');
      window.__setSupporterDashboardTrackerUserId('dashboard-inline-stat-test');
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid^=\\"button-open-stat-tracker-\\"]") !== null', Boolean);
    await connection.evaluate(`(() => {
      const game = Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
        .find((card) => card.getClientRects().length > 0
          && card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      if (game && !game.classList.contains('game-on-collection__card--selected')) {
        const summary = game.querySelector('.game-on-collection__summary');
        summary?.scrollIntoView({ block: 'center' });
        summary?.click();
      }
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
      .some((card) => card.classList.contains('game-on-collection__card--selected')
        && card.querySelector('[data-testid^="button-open-stat-tracker-"]')?.getClientRects().length)`, Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-open-stat-tracker-"]')).find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-inline-start-game\\"]") !== null', Boolean);
    assert.equal(await connection.evaluate<boolean>(
      'localStorage.getItem("leaguematrix-stat-tracker-active-game:dashboard-inline-stat-test") === null',
      page.sessionId,
    ), true, 'opening the inline tracker must leave the game unstarted');
    await connection.evaluate(`document.querySelector('[data-testid="button-inline-start-game"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-inline-scoreboard\\"]") !== null', Boolean);
    const inlineGameDate = await connection.evaluate<string>('window.__dashboardInlineGameDate', page.sessionId);
    assert.deepEqual(await connection.evaluate<{
      open: string | null;
      fullTrackerHref: string | null;
      firstScore: string | null;
    }>(`(() => ({
      open: document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card')?.getAttribute('data-tracker-open') || null,
      fullTrackerHref: document.querySelector('[data-testid^="link-card-stats-"]')?.getAttribute('href') || null,
      firstScore: document.querySelector('[data-testid="game-on-inline-score-value-athlete"]')?.textContent || null,
    }))()`, page.sessionId), {
      open: 'true',
      fullTrackerHref: `/studio/stat-tracker?source=workspace&eventId=game-1&eventType=game&date=${inlineGameDate}&opponent=Rivals`,
      firstScore: '0',
    });
    assert.deepEqual(await connection.evaluate<{
      undoDisabled: boolean;
      undoLabel: string;
      followsStatGrid: boolean;
      precedesGameActions: boolean;
      minHeight: number;
      fillsStatWidth: boolean;
    }>(`(() => {
      const tracker = Array.from(document.querySelectorAll('[data-testid^="game-on-inline-stat-tracker-"]'))
        .find((element) => element.getClientRects().length > 0);
      const statGrid = tracker?.querySelector('.game-on-quick-tracker__stat-grid');
      const undo = tracker?.querySelector('[data-testid="button-inline-stat-undo"]');
      const gameActions = tracker?.querySelector('[data-testid="inline-tracker-game-actions"]');
      const undoRect = undo?.getBoundingClientRect();
      const statGridRect = statGrid?.getBoundingClientRect();
      return {
        undoDisabled: Boolean(undo?.disabled),
        undoLabel: undo?.getAttribute('aria-label') || '',
        followsStatGrid: Boolean(undo && statGrid && statGrid.nextElementSibling === undo),
        precedesGameActions: Boolean(undo && gameActions && (undo.compareDocumentPosition(gameActions) & Node.DOCUMENT_POSITION_FOLLOWING)),
        minHeight: Math.round(undoRect?.height || 0),
        fillsStatWidth: Boolean(undoRect && statGridRect && undoRect.width >= statGridRect.width - 1),
      };
    })()`, page.sessionId), {
      undoDisabled: true,
      undoLabel: 'Undo last stat',
      followsStatGrid: true,
      precedesGameActions: true,
      minHeight: 44,
      fillsStatWidth: true,
    });
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-tap-stat-"][data-testid$="-two-point-team"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-inline-score-value-athlete\\"]")?.textContent === "2"', Boolean);
    await waitFor(connection, page.sessionId, `(() => {
      const tracker = Array.from(document.querySelectorAll('[data-testid^="game-on-inline-stat-tracker-"]'))
        .find((element) => element.getClientRects().length > 0);
      return tracker?.querySelector('[data-testid="button-inline-stat-undo"]')?.disabled === false;
    })()`, Boolean);
    await connection.evaluate(`(() => {
      const tracker = Array.from(document.querySelectorAll('[data-testid^="game-on-inline-stat-tracker-"]'))
        .find((element) => element.getClientRects().length > 0);
      tracker?.querySelector('[data-testid="button-inline-stat-undo"]')?.focus();
    })()`, page.sessionId);
    assert.equal(await connection.evaluate<boolean>('document.activeElement?.getAttribute("data-testid") === "button-inline-stat-undo"', page.sessionId), true);
    await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }, page.sessionId);
    await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }, page.sessionId);
    await waitFor(connection, page.sessionId, `(() => {
      const tracker = Array.from(document.querySelectorAll('[data-testid^="game-on-inline-stat-tracker-"]'))
        .find((element) => element.getClientRects().length > 0);
      const statCard = tracker?.querySelector('[data-testid="card-inline-stat-two-point"]');
      return tracker?.querySelector('[data-testid="game-on-inline-score-value-athlete"]')?.textContent === '0'
        && statCard?.querySelector('strong')?.textContent === '0'
        && tracker?.querySelector('[data-testid="button-inline-stat-undo"]')?.disabled === true;
    })()`, Boolean);
    assert.deepEqual(await connection.evaluate<{
      score: number;
      statCount: number;
      eventCount: number;
    }>(`(() => {
      const stored = JSON.parse(localStorage.getItem('leaguematrix-stat-tracker-active-game:dashboard-inline-stat-test') || 'null');
      return {
        score: stored?.score,
        statCount: stored?.stats?.['two-point'] ?? 0,
        eventCount: stored?.events?.length ?? 0,
      };
    })()`, page.sessionId), {
      score: 0,
      statCount: 0,
      eventCount: 0,
    });
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-tap-stat-"][data-testid$="-two-point-team"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-inline-score-value-athlete\\"]")?.textContent === "2"', Boolean);
    assert.deepEqual(await connection.evaluate<{
      score: number;
      statCount: number;
      attribution: string;
    }>(`(() => {
      const stored = JSON.parse(localStorage.getItem('leaguematrix-stat-tracker-active-game:dashboard-inline-stat-test') || 'null');
      return { score: stored?.score, statCount: stored?.stats?.['two-point'], attribution: stored?.events?.[0]?.attribution };
    })()`, page.sessionId), {
      score: 2,
      statCount: 1,
      attribution: 'team',
    });
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-close-stat-tracker-"]')).find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__dialog-card")?.getAttribute("data-tracker-open") === "false"', Boolean);
    const restoredFocus = await connection.evaluate<{
      testId: string;
      tagName: string;
      frontVisibility: string;
      frontInert: boolean;
      actions: Array<{ testId: string; rects: number; inert: boolean; visibility: string }>;
    }>(`(() => {
      const card = document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card');
      const front = card?.querySelector('.game-on-collection__flip-front');
      return {
        testId: document.activeElement?.getAttribute('data-testid') || '',
        tagName: document.activeElement?.tagName || '',
        frontVisibility: front instanceof HTMLElement ? getComputedStyle(front).visibility : 'missing',
        frontInert: front instanceof HTMLElement ? front.inert : true,
        actions: Array.from(document.querySelectorAll('[data-testid^="button-open-stat-tracker-"]')).map((button) => ({
          testId: button.getAttribute('data-testid') || '',
          rects: button.getClientRects().length,
          inert: Boolean(button.closest('[inert]')),
          visibility: getComputedStyle(button).visibility,
        })),
      };
    })()`, page.sessionId);
    assert.equal(restoredFocus.testId.startsWith('button-open-stat-tracker-'), true, JSON.stringify(restoredFocus));
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-open-stat-tracker-"]')).find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-inline-score-value-athlete\\"]")?.textContent === "2"', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid^=\\"button-tap-stat-\\"][data-testid$=\\"-two-point-team\\"]")?.closest(".game-on-quick-tracker__stat-card")?.querySelector("strong")?.textContent || ""', page.sessionId),
      '1',
    );
    assert.deepEqual(await connection.evaluate<{
      pauseLabel: string;
      endLabel: string;
      bothVisible: boolean;
    }>(`(() => {
      const pause = document.querySelector('[data-testid="button-inline-toggle-game-pause"]');
      const end = document.querySelector('[data-testid="button-inline-end-game"]');
      return {
        pauseLabel: pause?.textContent?.trim() || '',
        endLabel: end?.textContent?.trim() || '',
        bothVisible: Boolean(pause?.getClientRects().length && end?.getClientRects().length),
      };
    })()`, page.sessionId), {
      pauseLabel: 'Pause game',
      endLabel: 'End game',
      bothVisible: true,
    });
    await connection.evaluate(`document.querySelector('[data-testid="button-inline-toggle-game-pause"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('[data-testid="game-on-inline-status"]')?.textContent?.includes('Paused')
      && JSON.parse(localStorage.getItem('leaguematrix-stat-tracker-active-game:dashboard-inline-stat-test') || 'null')?.status === 'paused'`, Boolean);
    assert.deepEqual(await connection.evaluate<{
      status: string;
      statsDisabled: boolean;
      undoDisabled: boolean;
    }>(`(() => {
      const tracker = Array.from(document.querySelectorAll('[data-testid^="game-on-inline-stat-tracker-"]'))
        .find((element) => element.getClientRects().length > 0);
      return {
        status: tracker?.querySelector('[data-testid="game-on-inline-status"]')?.textContent?.trim() || '',
        statsDisabled: Boolean(tracker?.querySelector('[data-testid="button-tap-stat-game-1-two-point-team"]')?.disabled),
        undoDisabled: Boolean(tracker?.querySelector('[data-testid="button-inline-stat-undo"]')?.disabled),
      };
    })()`, page.sessionId), {
      status: 'Paused',
      statsDisabled: true,
      undoDisabled: true,
    });
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-close-stat-tracker-"]')).find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__dialog-card")?.getAttribute("data-tracker-open") === "false"', Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-open-stat-tracker-"]')).find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('[data-testid="game-on-inline-status"]')?.textContent?.includes('Paused')
      && document.querySelector('[data-testid="button-inline-toggle-game-pause"]')?.textContent?.includes('Resume game')`, Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-inline-toggle-game-pause"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('[data-testid="game-on-inline-status"]')?.textContent?.includes('Live')
      && JSON.parse(localStorage.getItem('leaguematrix-stat-tracker-active-game:dashboard-inline-stat-test') || 'null')?.status === 'live'`, Boolean);
    const cardStatusBeforeEnd = await connection.evaluate<{
      cards: Array<{ id: string; kind: string; status: string; visible: boolean }>;
      eventStatus: string | null;
    }>(`(() => ({
      cards: Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card')).map((card) => ({
        id: card.getAttribute('data-testid') || '',
        kind: card.querySelector('.game-on-collection__kind')?.textContent?.trim() || '',
        status: card.querySelector('[data-testid^="status-game-on-card-"]')?.textContent?.trim() || '',
        visible: Boolean(card.getClientRects().length),
      })),
      eventStatus: window.__getSupporterDashboardEvents?.().find((event) => event.id === 'game-1')?.status || null,
    }))()`, page.sessionId);
    assert.equal(cardStatusBeforeEnd.cards.find((card) => card.kind.includes('Game'))?.status, 'Live', JSON.stringify(cardStatusBeforeEnd));
    await connection.evaluate(`document.querySelector('[data-testid="button-inline-end-game"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"confirm-inline-end-game\\"]") !== null', Boolean);
    assert.deepEqual(await connection.evaluate<{
      confirmationVisible: boolean;
      activeGameStatus: string | null;
      historyFinalCount: number;
    }>(`(() => {
      const history = JSON.parse(localStorage.getItem('leaguematrix-stat-tracker:dashboard-inline-stat-test') || '{"games":[]}');
      return {
        confirmationVisible: Boolean(document.querySelector('[data-testid="confirm-inline-end-game"]')?.textContent?.includes('End this game?')),
        activeGameStatus: JSON.parse(localStorage.getItem('leaguematrix-stat-tracker-active-game:dashboard-inline-stat-test') || 'null')?.status || null,
        historyFinalCount: history.games.filter((item) => item.date === window.__dashboardInlineGameDate && item.opponent === 'Rivals' && item.status === 'final').length,
      };
    })()`, page.sessionId), {
      confirmationVisible: true,
      activeGameStatus: 'live',
      historyFinalCount: 0,
    });
    await connection.evaluate(`document.querySelector('[data-testid="button-inline-cancel-end-game"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `!document.querySelector('[data-testid="confirm-inline-end-game"]')
      && JSON.parse(localStorage.getItem('leaguematrix-stat-tracker-active-game:dashboard-inline-stat-test') || 'null')?.status === 'live'`, Boolean);
    const inlineEndFocus = await connection.evaluate<{ testId: string; tagName: string; status: string | null }>(`({
      testId: document.activeElement?.getAttribute('data-testid') || '',
      tagName: document.activeElement?.tagName || '',
      status: JSON.parse(localStorage.getItem('leaguematrix-stat-tracker-active-game:dashboard-inline-stat-test') || 'null')?.status || null,
    })`, page.sessionId);
    assert.equal(inlineEndFocus.testId, 'button-inline-end-game', JSON.stringify(inlineEndFocus));
    await connection.evaluate(`(() => {
      const selector = '.supporter-dashboard-desktop-shell [data-testid="status-game-completion-announcement"]';
      const announcement = document.querySelector(selector);
      if (!(announcement instanceof HTMLElement)) throw new Error('Game On completion announcement is missing');
      if (announcement.textContent?.trim()) throw new Error('The completion announcement should be empty before the game ends');
      window.__gameOnCompletionAnnouncementLastText = '';
      window.__gameOnCompletionAnnouncementMutations = 0;
      window.__gameOnCompletionAnnouncementMessages = [];
      window.__gameOnCompletionAnnouncementObserver = new MutationObserver((records) => {
        const currentAnnouncement = document.querySelector(selector);
        const currentText = currentAnnouncement?.textContent?.trim() || '';
        const regionInserted = records.some((record) => Array.from(record.addedNodes).some((node) => (
          node instanceof Element && (node.matches(selector) || node.querySelector(selector))
        )));
        if (currentText && (currentText !== window.__gameOnCompletionAnnouncementLastText || regionInserted)) {
          window.__gameOnCompletionAnnouncementMutations += 1;
          window.__gameOnCompletionAnnouncementMessages.push(currentText);
          window.__gameOnCompletionAnnouncementLastText = currentText;
        }
      });
      window.__gameOnCompletionAnnouncementObserver.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    })()`, page.sessionId);
    await connection.evaluate(`(() => {
      const recoverySelector = '[data-testid="button-inline-new-tracker"], [data-testid="status-inline-tracker-completed"], [data-testid="stat-tracker-setup"]';
      window.__trackerRecoveryAppearedBeforeCongrats = Boolean(document.querySelector(recoverySelector));
      window.__trackerCongratsSeenByObserver = false;
      window.__trackerRecoveryTransitionObserver = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            const element = node instanceof Element ? node : null;
            const recoveryAppeared = Boolean(element
              && (element.matches(recoverySelector) || element.querySelector(recoverySelector)));
            if (recoveryAppeared && !window.__trackerCongratsSeenByObserver) {
              window.__trackerRecoveryAppearedBeforeCongrats = true;
            }
            if (element
              && (element.matches('[data-testid="dialog-tracker-completed"]')
                || element.querySelector('[data-testid="dialog-tracker-completed"]'))) {
              window.__trackerCongratsSeenByObserver = true;
            }
          }
        }
      });
      window.__trackerRecoveryTransitionObserver.observe(document.body, { childList: true, subtree: true });
    })()`, page.sessionId);
    await connection.evaluate(`document.querySelector('[data-testid="button-inline-end-game"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"confirm-inline-end-game\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-inline-confirm-end-game"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector("[data-testid=\\"dialog-tracker-completed\\"]") !== null
      && document.activeElement?.getAttribute('data-testid') === 'dialog-tracker-completed'
      && document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-completion-announcement"]')?.textContent?.trim() === 'Game vs Rivals is complete.'
      && Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
        .find((card) => card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'))
         ?.querySelector('[data-testid^="status-game-on-card-"]')?.textContent?.trim() === 'Complete'
       && Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
         .find((card) => card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'))
         ?.getAttribute('data-tracker-open') === 'false'`, Boolean);
    await connection.evaluate(`window.__trackerRecoveryTransitionObserver?.disconnect()`, page.sessionId);
    assert.equal(
      await connection.evaluate<boolean>(`window.__trackerRecoveryAppearedBeforeCongrats === false
        && window.__trackerCongratsSeenByObserver === true
        && document.querySelector('[data-testid="dialog-tracker-completed"]')?.textContent?.includes('Congrats!')`, page.sessionId),
      true,
      'saving a completed game should open Congrats without briefly showing the old tracker recovery controls',
    );
    await waitFor(connection, page.sessionId, 'window.__gameOnCompletionAnnouncementMutations === 1', Boolean);
    assert.deepEqual(await connection.evaluate<{
      dashboardStillOpen: boolean;
      activeElementTestId: string;
      announcement: string;
      announcementMutations: number;
    }>(`(() => ({
      dashboardStillOpen: Boolean(document.querySelector('.supporter-dashboard-desktop-shell [data-testid="game-on-dashboard-collection"]')?.getClientRects().length),
      activeElementTestId: document.activeElement?.getAttribute('data-testid') || '',
      announcement: document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-completion-announcement"]')?.textContent?.trim() || '',
      announcementMutations: window.__gameOnCompletionAnnouncementMutations || 0,
    }))()`, page.sessionId), {
      dashboardStillOpen: true,
      activeElementTestId: 'dialog-tracker-completed',
      announcement: 'Game vs Rivals is complete.',
      announcementMutations: 1,
    });
    await connection.send('Accessibility.enable', {}, page.sessionId);
    const accessibilityTree = await connection.send<{
      nodes: Array<{
        role?: { value?: string };
        name?: { value?: string };
        properties?: Array<{ name?: string; value?: { value?: unknown } }>;
      }>;
    }>('Accessibility.getFullAXTree', {}, page.sessionId);
    assert.ok(
      accessibilityTree.nodes.some((node) => node.role?.value === 'status'
        && node.properties?.some((property) => property.name === 'live' && property.value?.value === 'polite')),
      'the completed-game message should appear as a polite status in Chromium’s accessibility tree',
    );
    assert.ok(
      accessibilityTree.nodes.some((node) => node.name?.value === 'Game vs Rivals is complete.'),
      'the completed-game announcement text should be exposed to assistive technology',
    );
    const firstAnnouncementMutations = await connection.evaluate<number>(`window.__gameOnCompletionAnnouncementMutations || 0`, page.sessionId);
    await connection.evaluate(`window.__setSupporterDashboardEvents(window.__getSupporterDashboardEvents())`, page.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(await connection.evaluate<{
      announcement: string;
      announcementMutations: number;
      announcementMessages: string[];
      activeElementTestId: string;
    }>(`(() => ({
      announcement: document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-completion-announcement"]')?.textContent?.trim() || '',
      announcementMutations: window.__gameOnCompletionAnnouncementMutations || 0,
      announcementMessages: window.__gameOnCompletionAnnouncementMessages || [],
      activeElementTestId: document.activeElement?.getAttribute('data-testid') || '',
    }))()`, page.sessionId), {
      announcement: 'Game vs Rivals is complete.',
      announcementMutations: firstAnnouncementMutations,
      announcementMessages: ['Game vs Rivals is complete.'],
      activeElementTestId: 'dialog-tracker-completed',
    }, 'an unrelated dashboard rerender must not repeat the completion announcement or steal focus');
    await connection.evaluate(`document.querySelector('[data-testid="button-completion-done"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"dialog-tracker-completed\\"]") === null', Boolean);
    assert.deepEqual(await connection.evaluate<{
      activeGame: string | null;
      completed: { status: string; score: number; statCount: number; attribution: string } | null;
    }>(`(() => {
      const history = JSON.parse(localStorage.getItem('leaguematrix-stat-tracker:dashboard-inline-stat-test') || '{"games":[]}');
      const completed = history.games.find((item) => item.date === window.__dashboardInlineGameDate && item.opponent === 'Rivals');
      return {
        activeGame: localStorage.getItem('leaguematrix-stat-tracker-active-game:dashboard-inline-stat-test'),
        completed: completed ? {
          status: completed.status,
          score: completed.score,
          statCount: completed.stats?.['two-point'] || 0,
          attribution: completed.events?.[0]?.attribution || '',
        } : null,
      };
    })()`, page.sessionId), {
      activeGame: null,
      completed: {
        status: 'final',
        score: 2,
        statCount: 1,
        attribution: 'team',
      },
    });
    await waitFor(connection, page.sessionId, `(() => {
      const scheduledGame = window.__getSupporterDashboardEvents?.().find((event) => event.id === 'game-1');
      return scheduledGame?.status === 'final' && Number.isFinite(Date.parse(scheduledGame.completedAt));
    })()`, Boolean);
    await waitFor(connection, page.sessionId, 'Array.from(document.querySelectorAll(".game-on-collection__card")).some(card => card.getClientRects().length > 0 && card.querySelector(".game-on-collection__kind")?.textContent?.includes("Game") && card.getAttribute("data-tracker-open") === "false")', Boolean);
    assert.equal(
      await connection.evaluate<string>(`Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
        .find((card) => card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'))
        ?.querySelector('[data-testid^="status-game-on-card-"]')?.textContent?.trim() || ''`, page.sessionId),
      'Complete',
      'ending the inline tracker must finalize its linked Calendar badge',
    );
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-open-stat-tracker-"]')).find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"status-inline-tracker-completed\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(`Boolean(document.querySelector('[data-testid="game-on-inline-scoreboard"]'))`, page.sessionId),
      false,
      'reopening a completed game should not silently start a duplicate tracker',
    );
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-close-stat-tracker-"]')).find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'Array.from(document.querySelectorAll(".game-on-collection__card")).some(card => card.getClientRects().length > 0 && card.querySelector(".game-on-collection__kind")?.textContent?.includes("Game") && card.getAttribute("data-tracker-open") === "false")', Boolean);

    await connection.evaluate(`(() => {
       const secondGameDate = new Date(window.__dashboardInlineGameDate + 'T12:00:00');
       secondGameDate.setDate(secondGameDate.getDate() + 2);
       const dateKey = [
         secondGameDate.getFullYear(),
         String(secondGameDate.getMonth() + 1).padStart(2, '0'),
         String(secondGameDate.getDate()).padStart(2, '0'),
       ].join('-');
       window.__dashboardSecondGameDate = dateKey;
       window.__setSupporterDashboardEvents([
         ...window.__getSupporterDashboardEvents(),
         { id: 'game-2', type: 'game', date: dateKey, time: '19:00', location: 'Northside Gym', opponent: 'Falcons', status: 'live' },
       ]);
     })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
       .some((card) => card.getClientRects().length > 0
         && card.querySelector('.game-on-collection__opponent')?.textContent?.includes('Falcons')
         && card.querySelector('[data-testid^="status-game-on-card-"]')?.textContent?.trim() === 'Live')`, Boolean);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(await connection.evaluate<{
       announcement: string;
       announcementMutations: number;
       announcementMessages: string[];
    }>(`(() => ({
       announcement: document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-completion-announcement"]')?.textContent?.trim() || '',
       announcementMutations: window.__gameOnCompletionAnnouncementMutations || 0,
       announcementMessages: window.__gameOnCompletionAnnouncementMessages || [],
    }))()`, page.sessionId), {
       announcement: 'Game vs Rivals is complete.',
       announcementMutations: 1,
       announcementMessages: ['Game vs Rivals is complete.'],
    }, 'adding another scheduled game must not repeat or replace the first completion announcement');
    await connection.evaluate(`(() => {
       const game = Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
         .find((card) => card.getClientRects().length > 0
           && card.querySelector('.game-on-collection__opponent')?.textContent?.includes('Falcons'));
       if (!game) throw new Error('The second scheduled game card is missing');
       if (!game.classList.contains('game-on-collection__card--selected')) {
         const summary = game.querySelector('.game-on-collection__summary');
         summary?.scrollIntoView({ block: 'center' });
         summary?.click();
       }
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
       .some((card) => card.classList.contains('game-on-collection__card--selected')
         && card.querySelector('.game-on-collection__opponent')?.textContent?.includes('Falcons')
         && card.querySelector('[data-testid^="button-open-stat-tracker-"]')?.getClientRects().length)`, Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card--selected [data-testid^="button-open-stat-tracker-"]'))
       .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-desktop-shell [data-testid="game-on-inline-scoreboard"]') !== null
       && document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-inline-end-game"]')?.getClientRects().length`, Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-inline-end-game"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid=\\"confirm-inline-end-game\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-inline-confirm-end-game"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('[data-testid="dialog-tracker-completed"]') !== null
      && document.activeElement?.getAttribute('data-testid') === 'dialog-tracker-completed'
       && document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-completion-announcement"]')?.textContent?.trim() === 'Game vs Falcons is complete.'
       && Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
         .find((card) => card.querySelector('.game-on-collection__opponent')?.textContent?.includes('Falcons'))
        ?.querySelector('[data-testid^="status-game-on-card-"]')?.textContent?.trim() === 'Complete'
      && Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
        .find((card) => card.querySelector('.game-on-collection__opponent')?.textContent?.includes('Falcons'))
        ?.getAttribute('data-tracker-open') === 'false'`, Boolean);
    await waitFor(connection, page.sessionId, 'window.__gameOnCompletionAnnouncementMutations === 2', Boolean);
    assert.deepEqual(await connection.evaluate<{
       announcement: string;
       announcementMutations: number;
       announcementMessages: string[];
    }>(`(() => ({
       announcement: document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-completion-announcement"]')?.textContent?.trim() || '',
       announcementMutations: window.__gameOnCompletionAnnouncementMutations || 0,
       announcementMessages: window.__gameOnCompletionAnnouncementMessages || [],
    }))()`, page.sessionId), {
       announcement: 'Game vs Falcons is complete.',
       announcementMutations: 2,
       announcementMessages: ['Game vs Rivals is complete.', 'Game vs Falcons is complete.'],
    }, 'completing a second scheduled game should announce its own opponent exactly once');
    await connection.evaluate(`window.__setSupporterDashboardEvents(window.__getSupporterDashboardEvents())`, page.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(await connection.evaluate<{
       announcement: string;
       announcementMutations: number;
       announcementMessages: string[];
    }>(`(() => ({
       announcement: document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-completion-announcement"]')?.textContent?.trim() || '',
       announcementMutations: window.__gameOnCompletionAnnouncementMutations || 0,
       announcementMessages: window.__gameOnCompletionAnnouncementMessages || [],
    }))()`, page.sessionId), {
       announcement: 'Game vs Falcons is complete.',
       announcementMutations: 2,
       announcementMessages: ['Game vs Rivals is complete.', 'Game vs Falcons is complete.'],
    }, 'an unrelated rerender after both games must not repeat either completion announcement');
    await connection.evaluate(`document.querySelector('[data-testid="button-completion-done"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"dialog-tracker-completed\\"]") === null', Boolean);

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-mobile-shell [data-testid="game-on-dashboard-collection"]')?.getClientRects().length > 0
      && !document.querySelector('.supporter-dashboard-desktop-shell [data-testid="game-on-dashboard-collection"]')?.getClientRects().length`, Boolean);
    await connection.evaluate(`(() => {
      localStorage.removeItem('leaguematrix-stat-tracker-active-game:dashboard-inline-stat-test');
      localStorage.removeItem('leaguematrix-stat-tracker:dashboard-inline-stat-test');
      window.__setSupporterDashboardEvents([
        { id: 'game-1', type: 'game', date: window.__dashboardInlineGameDate, time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'live' },
        { id: 'practice-1', type: 'practice', date: window.__dashboardInlineGameDate, time: '18:30', location: 'Northside Gym' },
      ]);
    })()`, page.sessionId);
    await connection.evaluate(`(() => {
      const game = Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
        .find((card) => card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      if (game && !game.classList.contains('game-on-collection__card--selected')) {
        game.querySelector('.game-on-collection__summary')?.click();
      }
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
      .some((card) => card.classList.contains('game-on-collection__card--selected')
        && card.querySelector('[data-testid^="button-open-stat-tracker-"]')?.getClientRects().length)`, Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell [data-testid^="button-open-stat-tracker-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('.supporter-dashboard-mobile-shell [data-testid="game-on-inline-scoreboard"]') !== null
      && document.querySelector('.supporter-dashboard-mobile-shell [data-testid="button-inline-end-game"]')?.getClientRects().length`, Boolean);
    await connection.evaluate(`(() => {
      const selector = '.supporter-dashboard-mobile-shell [data-testid="status-game-completion-announcement"]';
      const announcement = document.querySelector(selector);
      if (!(announcement instanceof HTMLElement)) throw new Error('Phone dashboard completion announcement is missing');
      if (announcement.textContent?.trim()) throw new Error('The phone completion announcement should be empty before the game ends');
      window.__phoneGameCompletionAnnouncementLastText = '';
      window.__phoneGameCompletionAnnouncementMutations = 0;
      window.__phoneGameCompletionAnnouncementObserver = new MutationObserver((records) => {
        const currentText = announcement.textContent?.trim() || '';
        const regionInserted = records.some((record) => Array.from(record.addedNodes).some((node) => (
          node instanceof Element && (node.matches(selector) || node.querySelector(selector))
        )));
        if (currentText && (currentText !== window.__phoneGameCompletionAnnouncementLastText || regionInserted)) {
          window.__phoneGameCompletionAnnouncementMutations += 1;
          window.__phoneGameCompletionAnnouncementLastText = currentText;
        }
      });
      window.__phoneGameCompletionAnnouncementObserver.observe(announcement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    })()`, page.sessionId);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-mobile-shell [data-testid="button-inline-end-game"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-mobile-shell [data-testid=\\"confirm-inline-end-game\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-mobile-shell [data-testid="button-inline-confirm-end-game"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('[data-testid="dialog-tracker-completed"]') !== null
      && document.activeElement?.getAttribute('data-testid') === 'dialog-tracker-completed'
      && document.querySelector('.supporter-dashboard-mobile-shell [data-testid="status-game-completion-announcement"]')?.textContent?.trim() === 'Game vs Rivals is complete.'
      && Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
        .find((card) => card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'))
        ?.querySelector('[data-testid^="status-game-on-card-"]')?.textContent?.trim() === 'Complete'
      && Array.from(document.querySelectorAll('.supporter-dashboard-mobile-shell .game-on-collection__card'))
        .find((card) => card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'))
        ?.getAttribute('data-tracker-open') === 'false'`, Boolean);
    await waitFor(connection, page.sessionId, 'window.__phoneGameCompletionAnnouncementMutations === 1', Boolean);
    await connection.send('Accessibility.enable', {}, page.sessionId);
    const phoneAccessibilityTree = await connection.send<{
      nodes: Array<{
        nodeId?: string;
        parentId?: string;
        ignored?: boolean;
        role?: { value?: string };
        name?: { value?: string };
        value?: { value?: unknown };
        properties?: Array<{ name?: string; value?: { value?: unknown } }>;
      }>;
    }>('Accessibility.getFullAXTree', {}, page.sessionId);
    const phoneAccessibilityNodesById = new Map(
      phoneAccessibilityTree.nodes.filter((node) => node.nodeId).map((node) => [node.nodeId!, node]),
    );
    const phoneCompletionStatusNodeIds = new Set<string>();
    for (const exposedNode of phoneAccessibilityTree.nodes.filter((node) => !node.ignored
      && (node.name?.value === 'Game vs Rivals is complete.' || node.value?.value === 'Game vs Rivals is complete.'))) {
      let current: typeof exposedNode | undefined = exposedNode;
      while (current) {
        if (current.nodeId
          && !current.ignored
          && current.role?.value === 'status'
          && current.properties?.some((property) => property.name === 'live' && property.value?.value === 'polite')) {
          phoneCompletionStatusNodeIds.add(current.nodeId);
        }
        current = current.parentId ? phoneAccessibilityNodesById.get(current.parentId) : undefined;
      }
    }
    assert.deepEqual(await connection.evaluate<{
      dashboardStillOpen: boolean;
      mobileAnnouncementVisible: boolean;
      desktopAnnouncementHidden: boolean;
      activeElementTestId: string;
      activeElementInsidePhoneTracker: boolean;
      phoneAnnouncement: string;
      desktopAnnouncement: string;
      announcementMutations: number;
    }>(`(() => ({
      dashboardStillOpen: Boolean(document.querySelector('.supporter-dashboard-mobile-shell [data-testid="game-on-dashboard-collection"]')?.getClientRects().length),
      mobileAnnouncementVisible: Boolean(document.querySelector('.supporter-dashboard-mobile-shell [data-testid="status-game-completion-announcement"]')?.getClientRects().length),
      desktopAnnouncementHidden: !document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-completion-announcement"]')?.getClientRects().length,
      activeElementTestId: document.activeElement?.getAttribute('data-testid') || '',
      activeElementInsidePhoneTracker: Boolean(document.activeElement?.closest('.supporter-dashboard-mobile-shell .game-on-quick-tracker')),
      phoneAnnouncement: document.querySelector('.supporter-dashboard-mobile-shell [data-testid="status-game-completion-announcement"]')?.textContent?.trim() || '',
      desktopAnnouncement: document.querySelector('.supporter-dashboard-desktop-shell [data-testid="status-game-completion-announcement"]')?.textContent?.trim() || '',
      announcementMutations: window.__phoneGameCompletionAnnouncementMutations || 0,
    }))()`, page.sessionId), {
      dashboardStillOpen: true,
      mobileAnnouncementVisible: true,
      desktopAnnouncementHidden: true,
      activeElementTestId: 'dialog-tracker-completed',
      activeElementInsidePhoneTracker: false,
      phoneAnnouncement: 'Game vs Rivals is complete.',
      desktopAnnouncement: 'Game vs Falcons is complete.',
      announcementMutations: 1,
    });
    assert.equal(
      phoneCompletionStatusNodeIds.size,
      1,
      `Chromium should expose one polite phone completion announcement, not a duplicate from the hidden desktop layout: ${JSON.stringify({
        matchingStatusIds: [...phoneCompletionStatusNodeIds],
        statusNodes: phoneAccessibilityTree.nodes.filter((node) => node.role?.value === 'status').map((node) => ({
          nodeId: node.nodeId,
          parentId: node.parentId,
          ignored: node.ignored,
          name: node.name?.value,
          value: node.value?.value,
          properties: node.properties,
        })),
        textNodes: phoneAccessibilityTree.nodes.filter((node) => node.name?.value === 'Game vs Rivals is complete.').map((node) => ({
          nodeId: node.nodeId,
          parentId: node.parentId,
          ignored: node.ignored,
          role: node.role?.value,
          name: node.name?.value,
          value: node.value?.value,
        })),
      })}`,
    );
    assert.ok(
      phoneAccessibilityTree.nodes.some((node) => !node.ignored && node.name?.value === 'Game vs Rivals is complete.'),
      'the phone completion message should be available in the active dashboard accessibility tree',
    );
    await connection.evaluate(`document.querySelector('[data-testid="button-completion-done"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"dialog-tracker-completed\\"]") === null', Boolean);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid=\\"game-on-dashboard-collection\\"]")?.getClientRects().length > 0', Boolean);

    await connection.evaluate(`(() => {
      if (document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card')) return;
      const game = Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell [data-testid="grid-game-on-cards"] .game-on-collection__card'))
        .find((card) => card.getClientRects().length > 0 && card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      game?.querySelector('.game-on-collection__summary')?.click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__dialog-card") !== null', Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card [data-testid^="button-edit-event-arrow-"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__dialog-card[data-calendar-open=\\"true\\"] [data-testid=\\"input-inline-date\\"]") !== null', Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-close-calendar-editor-"]')).find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__dialog-card")?.getAttribute("data-calendar-open") === "false"', Boolean);
    await waitFor(connection, page.sessionId, 'document.activeElement?.getAttribute("data-testid")?.startsWith("button-edit-event-arrow-") === true', Boolean);

    await connection.evaluate(`window.__setSupporterDashboardTrackerUserId('')`, page.sessionId);

    await connection.evaluate(`window.__setSupporterDashboardTrackerUserId('practice-prep-test')`, page.sessionId);
    await connection.evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
        .find((item) => item.getClientRects().length > 0
          && item.querySelector('.game-on-collection__kind')?.textContent?.includes('Practice'));
      if (card && !card.classList.contains('game-on-collection__card--selected')) {
        const summary = card.querySelector('.game-on-collection__summary');
        summary?.scrollIntoView({ block: 'center' });
        summary?.click();
      }
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.supporter-dashboard-desktop-shell .game-on-collection__card'))
      .some((card) => card.classList.contains('game-on-collection__card--selected')
        && card.querySelector('.game-on-collection__kind')?.textContent?.includes('Practice')
        && card.querySelector('[data-testid^="button-open-card-prep-"]')?.getClientRects().length)`, Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('.game-on-collection__card--selected [data-testid^="button-open-card-prep-"]'))
      .find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'Boolean(document.querySelector(".supporter-dashboard-desktop-shell .game-on-collection__dialog-card [data-testid=\\"game-on-inline-prep-practice-1\\"]"))', Boolean);
    assert.deepEqual(await connection.evaluate<{
      heading: string;
      firstItem: string;
      focusedHeading: boolean;
      statActionCount: number;
    }>(`(() => {
      const card = document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card');
      const heading = card?.querySelector('.game-on-prep__title');
      return {
        heading: heading?.textContent || '',
        firstItem: card?.querySelector('.game-on-prep__item-label')?.textContent || '',
        focusedHeading: document.activeElement === heading,
        statActionCount: card?.querySelectorAll('[data-testid^="button-open-stat-tracker-"]').length || 0,
      };
    })()`, page.sessionId), {
      heading: 'Practice prep',
      firstItem: 'Pack practice gear and shoes',
      focusedHeading: true,
      statActionCount: 0,
    });
    await connection.evaluate(`(() => {
      const card = document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card');
      card?.querySelector('[data-testid="button-close-card-prep-practice-1"]')?.click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `(() => {
      const card = document.querySelector('.supporter-dashboard-desktop-shell .game-on-collection__dialog-card');
      return document.activeElement === card?.querySelector('[data-testid^="button-open-card-prep-"]');
    })()`, Boolean);
    await connection.evaluate(`window.__setSupporterDashboardTrackerUserId('')`, page.sessionId);

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await connection.evaluate(`window.__setSupporterDashboardTrackerUserId('supporter-save-transition')`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid=\\"button-create-game-on-card\\"]")?.getClientRects().length > 0', Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-create-game-on-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid^=\\"card-game-on-new-card-\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid^="button-open-game-on-card-new-card-"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid=\\"panel-game-on-card-draft\\"]") !== null', Boolean);
    const draftLayoutId = await connection.evaluate<string | null>(
      'document.querySelector(".supporter-dashboard-desktop-shell [data-testid^=\\"card-game-on-new-card-\\"]")?.getAttribute("data-layout-id") ?? null',
      page.sessionId,
    );
    assert.ok(draftLayoutId, 'the new draft tile should expose its stable layout identity');
    await connection.evaluate(`(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      const values = [
        ['[data-testid="input-game-on-date"]', '2026-10-10'],
        ['[data-testid="input-game-on-opponent"]', 'Falcons'],
      ];
      for (const [selector, value] of values) {
        const input = document.querySelector(selector);
        if (!(input instanceof HTMLInputElement)) throw new Error('Game On Card field missing: ' + selector);
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-save-game-on-card\\"]")?.disabled === false', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-save-game-on-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'window.__gameOnCardMockSaveRequests === 1', Boolean);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid^=\\"card-game-on-share:mock-game-on-card-token\\"]") !== null', Boolean);
    await waitFor(connection, page.sessionId, `(() => {
      const card = document.querySelector('.supporter-dashboard-desktop-shell [data-testid^="card-game-on-share:mock-game-on-card-token"]');
      if (!(card instanceof HTMLElement)) return false;
      const rect = card.getBoundingClientRect();
      return Math.abs(rect.width / rect.height - 1) < 0.05;
    })()`, Boolean);
    assert.deepEqual(await connection.evaluate<{
      layoutIdPreserved: boolean;
      savedCardCollapsed: boolean;
      savedCardSquare: boolean;
      editorClosed: boolean;
    }>(`(() => {
      const card = document.querySelector('.supporter-dashboard-desktop-shell [data-testid^="card-game-on-share:mock-game-on-card-token"]');
      if (!(card instanceof HTMLElement)) throw new Error('Saved Game On Card is missing');
      const rect = card.getBoundingClientRect();
      return {
        layoutIdPreserved: card.getAttribute('data-layout-id') === ${JSON.stringify(draftLayoutId)},
        savedCardCollapsed: !card.classList.contains('game-on-collection__card--selected')
          && !card.classList.contains('game-on-collection__card--expanded'),
        savedCardSquare: Math.abs(rect.width / rect.height - 1) < 0.05,
        editorClosed: document.querySelector('.supporter-dashboard-desktop-shell [data-testid="panel-game-on-card-draft"]') === null,
      };
    })()`, page.sessionId), {
      layoutIdPreserved: true,
      savedCardCollapsed: true,
      savedCardSquare: true,
      editorClosed: true,
    }, 'saving should animate the expanded draft back into its original grid slot');
    await waitFor(connection, page.sessionId, `document.activeElement?.getAttribute('data-testid')?.startsWith('button-open-game-on-card-')
      && document.activeElement.closest('.game-on-collection__card')?.getAttribute('data-layout-id') === ${JSON.stringify(draftLayoutId)}`, Boolean);

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await connection.evaluate(`(() => {
      const button = document.querySelector('[data-testid="button-mobile-dashboard-menu"]');
      button?.focus();
      button?.click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"mobile-dashboard-menu\\"]") !== null', Boolean);
    assert.deepEqual(await connection.evaluate<{
      expanded: string | null;
      links: string[];
      label: string | null;
    }>(`(() => {
      const button = document.querySelector('[data-testid="button-mobile-dashboard-menu"]');
      const menu = document.querySelector('[data-testid="mobile-dashboard-menu"]');
      return {
        expanded: button?.getAttribute('aria-expanded') || null,
        links: Array.from(menu?.querySelectorAll('a') || []).map((link) => link.getAttribute('href') || ''),
        label: menu?.getAttribute('aria-label') || null,
      };
    })()`, page.sessionId), {
      expanded: 'true',
      links: ['/studio'],
      label: 'Mobile dashboard navigation',
    });
    await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"mobile-dashboard-menu\\"]") === null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.activeElement?.getAttribute("data-testid") || ""', page.sessionId),
      'button-mobile-dashboard-menu',
    );

    await connection.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, page.sessionId);
    for (const [testId, destination] of [
      ['btn-mobile-open-profile', '/studio/profile'],
      ['link-mobile-independent-stats', '/studio/season-stats'],
    ]) {
      const target = await connection.evaluate<{ x: number; y: number; hit: boolean }>(`(() => {
        const element = document.querySelector('[data-testid="${testId}"]');
        if (!(element instanceof HTMLElement)) throw new Error('Missing touch target: ${testId}');
        const rect = element.getBoundingClientRect();
        const x = Math.round(rect.left + rect.width / 2);
        const y = Math.round(rect.top + rect.height / 2);
        return { x, y, hit: element.contains(document.elementFromPoint(x, y)) };
      })()`, page.sessionId);
      assert.equal(target.hit, true, `${testId} must receive touches at its center`);
      await connection.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: target.x, y: target.y }],
      }, page.sessionId);
      await new Promise((resolve) => setTimeout(resolve, 80));
      await connection.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      }, page.sessionId);
      await waitFor(connection, page.sessionId, `window.location.pathname === '${destination}'`, Boolean);
    }

    const swipeX = 195;
    await connection.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: swipeX, y: 650 }],
    }, page.sessionId);
    for (const y of [570, 490, 410, 330, 250]) {
      await connection.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: swipeX, y }],
      }, page.sessionId);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await connection.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, page.sessionId);
    await waitFor(connection, page.sessionId, '(document.scrollingElement?.scrollTop || 0) > 0', Boolean);
    assert.equal(
      await connection.evaluate<number>('document.querySelector(".supporter-dashboard-mobile-shell")?.scrollTop || 0', page.sessionId),
      0,
      'a swipe should scroll the document, not a separate dashboard scroller',
    );
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('saved tracker scores appear in the supporter record after reload on mobile and desktop', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-game-record-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  const accountId = 'supporter-game-record-user';
  const trackerHistory = {
    version: 1,
    games: [
      {
        id: 'basketball-win',
        sport: 'basketball',
        status: 'final',
        date: '2026-09-18',
        opponent: 'Falcons',
        period: 4,
        score: 12,
        opponentScore: 7,
        notes: '',
        stats: {},
        events: [],
        startedAt: '2026-09-18T18:00:00.000Z',
      },
      {
        id: 'basketball-zero-score-loss',
        sport: 'basketball',
        status: 'final',
        date: '2026-09-19',
        opponent: 'Tigers',
        period: 4,
        score: 0,
        opponentScore: 4,
        notes: '',
        stats: {},
        events: [],
        startedAt: '2026-09-19T18:00:00.000Z',
      },
      {
        id: 'basketball-tie',
        sport: 'basketball',
        status: 'final',
        date: '2026-09-20',
        opponent: 'Wolves',
        period: 4,
        score: 5,
        opponentScore: 5,
        notes: '',
        stats: {},
        events: [],
        startedAt: '2026-09-20T18:00:00.000Z',
      },
      {
        id: 'basketball-unscored-final',
        sport: 'basketball',
        status: 'final',
        date: '2026-09-21',
        opponent: 'Bears',
        period: 4,
        score: 18,
        // An incomplete scoreline is not a saved result.
        notes: '',
        stats: {},
        events: [],
        startedAt: '2026-09-21T18:00:00.000Z',
      },
      {
        id: 'basketball-in-progress',
        sport: 'basketball',
        status: 'live',
        date: '2026-09-22',
        opponent: 'Hawks',
        period: 3,
        score: 21,
        opponentScore: 14,
        notes: '',
        stats: {},
        events: [],
        startedAt: '2026-09-22T18:00:00.000Z',
      },
      {
        id: 'baseball-other-sport',
        sport: 'baseball',
        status: 'final',
        date: '2026-09-23',
        opponent: 'Owls',
        period: 7,
        score: 8,
        opponentScore: 2,
        notes: '',
        stats: {},
        events: [],
        startedAt: '2026-09-23T18:00:00.000Z',
      },
    ],
  };

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-supporter-record-browser-'));
    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);

    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(
      connection,
      `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?supporter-game-record`,
    );
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);

    const historyKey = `leaguematrix-stat-tracker:${encodeURIComponent(accountId)}`;
    await connection.evaluate(
      `localStorage.setItem(${JSON.stringify(historyKey)}, ${JSON.stringify(JSON.stringify(trackerHistory))})`,
      page.sessionId,
    );
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"supporter-game-record-mobile\\"]")?.getClientRects().length > 0',
      Boolean,
    );

    const readRecord = (variant: 'mobile' | 'desktop') => connection!.evaluate<{
      visible: boolean;
      wins: string | null;
      losses: string | null;
      ties: string | null;
      sport: string | null;
      footnote: string | null;
    }>(`(() => {
      const variant = ${JSON.stringify(variant)};
      const record = document.querySelector('[data-testid="supporter-game-record-' + variant + '"]');
      const readStat = (kind) => record?.querySelector('[data-testid="record-' + kind + '-' + variant + '"] strong')?.textContent?.trim() ?? null;
      return {
        visible: Boolean(record?.getClientRects().length),
        wins: readStat('wins'),
        losses: readStat('losses'),
        ties: readStat('ties'),
        sport: record?.querySelector('.supporter-game-on-summary__record-heading p')?.textContent?.trim() ?? null,
        footnote: record?.querySelector('.supporter-game-on-summary__record-footnote')?.textContent?.trim() ?? null,
      };
    })()`, page!.sessionId);

    assert.deepEqual(await readRecord('mobile'), {
      visible: true,
      wins: '1',
      losses: '1',
      ties: '1',
      sport: 'basketball · completed games',
      footnote: '3 scored games tracked',
    });
    assert.equal(
      await connection.evaluate<number>(
        `JSON.parse(localStorage.getItem(${JSON.stringify(historyKey)})).games.length`,
        page.sessionId,
      ),
      trackerHistory.games.length,
      'the seeded tracker history must still be present after reload',
    );

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"supporter-game-record-desktop\\"]")?.getClientRects().length > 0',
      Boolean,
    );
    assert.deepEqual(await readRecord('desktop'), {
      visible: true,
      wins: '1',
      losses: '1',
      ties: '1',
      sport: 'basketball · completed games',
      footnote: '3 scored games tracked',
    });
    assert.equal((await readRecord('mobile')).visible, false, 'the mobile summary should be hidden at desktop width');
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('dashboard actions replace mobile navigation while event cards retain Calendar and Prep access', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-dashboard-navigation-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-supporter-dashboard-navigation-'));
    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);

    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(
      connection,
      `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?route=dashboard&game-on-card-save-transition`,
    );
    const session = page.sessionId;
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"mobile-header\\"]"))', Boolean);

    for (const width of [320, 390, 768]) {
      await connection.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: width === 768 ? 1024 : 844,
        deviceScaleFactor: 1,
        mobile: true,
      }, session);
      const mobileActions = await connection.evaluate<{
        bottomNavAbsent: boolean;
        shellPaddingBottom: string;
        statsVisible: boolean;
        statsLabel: string;
        statsPath: string;
        statsEventId: string;
        familyGuideVisible: boolean;
        familyGuidePath: string;
        guideAndStatsAreSpaced: boolean;
        quickLinksFitWithinCard: boolean;
        hypeQuickLinkRemoved: boolean;
        actionsUseSingleStatsButton: boolean;
        statsMatchesReference: boolean;
      }>(`(() => {
        const shell = document.querySelector('.supporter-dashboard-mobile-shell');
        const stats = shell?.querySelector('[data-testid="link-mobile-independent-stats"]');
        const familyGuide = shell?.querySelector('[data-testid="link-mobile-supporter-guide"]');
        const group = shell?.querySelector('[data-testid="dashboard-primary-actions-mobile"]');
        const grid = group?.querySelector('[data-testid="dashboard-primary-actions-grid"]');
        const statsUrl = stats instanceof HTMLAnchorElement ? new URL(stats.href) : null;
        const familyGuideUrl = familyGuide instanceof HTMLAnchorElement ? new URL(familyGuide.href) : null;
        const statsRect = stats instanceof HTMLElement ? stats.getBoundingClientRect() : null;
        const familyGuideRect = familyGuide instanceof HTMLElement ? familyGuide.getBoundingClientRect() : null;
        const gridRect = grid instanceof HTMLElement ? grid.getBoundingClientRect() : null;
        const statsStyle = stats instanceof HTMLElement ? getComputedStyle(stats) : null;
        const visible = (element) => element instanceof HTMLElement
          && getComputedStyle(element).display !== 'none'
          && element.getBoundingClientRect().width > 0
          && element.getBoundingClientRect().height > 0;
        return {
          bottomNavAbsent: !document.querySelector('[data-testid="mobile-bottom-nav"]'),
          shellPaddingBottom: shell instanceof HTMLElement ? getComputedStyle(shell).paddingBottom : '',
          statsVisible: visible(stats),
          statsLabel: stats?.textContent?.trim() || '',
          statsPath: statsUrl?.pathname || '',
          statsEventId: statsUrl?.searchParams.get('eventId') || '',
          familyGuideVisible: visible(familyGuide),
          familyGuidePath: familyGuideUrl?.pathname || '',
          guideAndStatsAreSpaced: Boolean(statsRect && familyGuideRect && (
            Math.abs(statsRect.top - familyGuideRect.top) < 1
              ? familyGuideRect.left - statsRect.right
              : familyGuideRect.top - statsRect.bottom
          ) >= 7),
          quickLinksFitWithinCard: Boolean(
            grid instanceof HTMLElement && gridRect && statsRect && familyGuideRect
            && statsRect.left >= gridRect.left - 1
            && familyGuideRect.left >= gridRect.left - 1
            && statsRect.right <= gridRect.right + 1
            && familyGuideRect.right <= gridRect.right + 1
            && grid.scrollWidth <= grid.clientWidth + 1,
          ),
          hypeQuickLinkRemoved: !shell?.querySelector('[data-testid="link-mobile-independent-hype"]'),
          actionsUseSingleStatsButton: Boolean(
            group && grid && stats?.parentElement === grid && statsStyle?.display === 'flex'
            && getComputedStyle(grid).display === 'flex' && statsRect && gridRect && statsRect.width < gridRect.width,
          ),
          statsMatchesReference: Boolean(
            statsStyle && stats?.querySelector('svg')
            && statsStyle.backgroundColor === 'rgb(243, 246, 250)'
            && statsStyle.color === 'rgb(11, 31, 58)'
            && statsStyle.textTransform === 'uppercase'
            && statsStyle.borderTopWidth === '1px',
          ),
        };
      })()`, session);
      assert.deepEqual(mobileActions, {
        bottomNavAbsent: true,
        shellPaddingBottom: '0px',
        statsVisible: true,
        statsLabel: 'View stats',
        statsPath: '/studio/season-stats',
        statsEventId: '',
        familyGuideVisible: true,
        familyGuidePath: '/supporter-guide',
        guideAndStatsAreSpaced: true,
        quickLinksFitWithinCard: true,
        hypeQuickLinkRemoved: true,
        actionsUseSingleStatsButton: true,
        statsMatchesReference: true,
      }, `mobile dashboard actions at ${width}px`);
    }

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, session);
    const mobileAccess = await connection.evaluate<{
      profilePath: string;
      profileVisible: boolean;
      menuLabel: string;
      helpPath: string;
      helpVisible: boolean;
      privacyPath: string;
      privacyVisible: boolean;
      footerPaddingBottom: string;
    }>(`(() => {
      const profile = document.querySelector('[data-testid="btn-mobile-open-profile"]');
      const menu = document.querySelector('[data-testid="button-mobile-dashboard-menu"]');
      const help = document.querySelector('[data-testid="link-mobile-dashboard-footer-help"]');
      const privacy = document.querySelector('[data-testid="link-mobile-dashboard-footer-privacy"]');
      const footer = help?.closest('footer');
      const visible = (element) => element instanceof HTMLElement
        && getComputedStyle(element).display !== 'none'
        && element.getBoundingClientRect().width > 0
        && element.getBoundingClientRect().height > 0;
      return {
        profilePath: profile instanceof HTMLAnchorElement ? new URL(profile.href).pathname : '',
        profileVisible: visible(profile),
        menuLabel: menu?.getAttribute('aria-label') || '',
        helpPath: help instanceof HTMLAnchorElement ? new URL(help.href).pathname : '',
        helpVisible: visible(help),
        privacyPath: privacy instanceof HTMLAnchorElement ? new URL(privacy.href).pathname : '',
        privacyVisible: visible(privacy),
        footerPaddingBottom: footer instanceof HTMLElement ? getComputedStyle(footer).paddingBottom : '',
      };
    })()`, session);
    assert.deepEqual(mobileAccess, {
      profilePath: '/studio/profile',
      profileVisible: true,
      menuLabel: 'Open navigation',
      helpPath: '/help',
      helpVisible: true,
      privacyPath: '/privacy',
      privacyVisible: true,
      footerPaddingBottom: '32px',
    });
    await connection.evaluate(`document.querySelector('[data-testid="button-mobile-dashboard-menu"]')?.click()`, session);
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"mobile-dashboard-menu\\"]"))', Boolean);
    assert.deepEqual(await connection.evaluate<{
      expanded: string;
      label: string;
      homePath: string;
    }>(`(() => {
      const menu = document.querySelector('[data-testid="mobile-dashboard-menu"]');
      const button = document.querySelector('[data-testid="button-mobile-dashboard-menu"]');
      const home = menu?.querySelector('[data-testid="link-mobile-dashboard-home"]');
      return {
        expanded: button?.getAttribute('aria-expanded') || '',
        label: menu?.getAttribute('aria-label') || '',
        homePath: home instanceof HTMLAnchorElement ? new URL(home.href).pathname : '',
      };
    })()`, session), {
      expanded: 'true',
      label: 'Mobile dashboard navigation',
      homePath: '/studio',
    });
    await connection.evaluate(`document.querySelector('[data-testid="button-mobile-dashboard-menu"]')?.click()`, session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"mobile-dashboard-menu\\"]") === null', Boolean);

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, session);
    const desktopActions = await connection.evaluate<{
      mobileHidden: boolean;
      desktopHypeCardVisible: boolean;
      desktopHypePreviewVisible: boolean;
      desktopHypeCardAtTopLeft: boolean;
      desktopHypeCardNextToRightStack: boolean;
      overviewHeadingAboveTrends: boolean;
      overviewLabelsVisible: boolean;
      seasonLabelAboveTrends: boolean;
      desktopSummaryUnderTrends: boolean;
      shoutoutsUnderTrends: boolean;
      recordUnderShoutouts: boolean;
      desktopInstallReminderRemoved: boolean;
      eventCardsBelowTopRow: boolean;
      eventCardsFillHorizontalSpace: boolean;
      quickLinksBelowHypeCard: boolean;
      eventCardsCentered: boolean;
      statsVisible: boolean;
      statsLabel: string;
      statsPath: string;
      statsEventId: string;
      hypeQuickLinkRemoved: boolean;
      actionsUseTwoColumnQuickLinks: boolean;
      statsMatchesReference: boolean;
    }>(`(() => {
      const mobile = document.querySelector('.supporter-dashboard-mobile-shell');
      const shell = document.querySelector('.supporter-dashboard-desktop-shell');
      const sidebar = shell?.querySelector('[data-testid="dashboard-desktop-sidebar"]');
      const hypeCard = sidebar?.querySelector('[data-testid="dashboard-hype-card-desktop"]');
      const preview = hypeCard?.querySelector('[data-testid="desktop-saved-hype-card"]');
      const quickLinks = sidebar?.querySelector('[data-testid="dashboard-primary-actions-desktop"]');
      const overview = shell?.querySelector('[data-testid="dashboard-desktop-overview-heading"]');
      const overviewRect = overview instanceof HTMLElement ? overview.getBoundingClientRect() : null;
      const overviewText = overview?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      const seasonLabel = overview?.querySelector('.supporter-game-on-summary__locker-season');
      const seasonLabelRect = seasonLabel instanceof HTMLElement ? seasonLabel.getBoundingClientRect() : null;
      const hypeRect = hypeCard instanceof HTMLElement ? hypeCard.getBoundingClientRect() : null;
      const quickLinksRect = quickLinks instanceof HTMLElement ? quickLinks.getBoundingClientRect() : null;
      const summary = shell?.querySelector('.supporter-game-on-summary--desktop');
      const summaryRect = summary instanceof HTMLElement ? summary.getBoundingClientRect() : null;
      const replies = summary?.querySelector('.supporter-game-on-summary__replies');
      const repliesRect = replies instanceof HTMLElement ? replies.getBoundingClientRect() : null;
      const record = summary?.querySelector('.supporter-game-on-summary__record');
      const recordRect = record instanceof HTMLElement ? record.getBoundingClientRect() : null;
      const trend = shell?.querySelector('[data-testid="supporter-stat-trends"]');
      const trendRect = trend instanceof HTMLElement ? trend.getBoundingClientRect() : null;
      const hypeRow = shell?.querySelector('[data-testid="dashboard-hype-trends-row"]');
      const hypeRowRect = hypeRow instanceof HTMLElement ? hypeRow.getBoundingClientRect() : null;
      const rightStack = shell?.querySelector('[data-testid="dashboard-desktop-stat-stack"]');
      const rightStackRect = rightStack instanceof HTMLElement ? rightStack.getBoundingClientRect() : null;
      const collection = shell?.querySelector('[data-testid="game-on-dashboard-collection"]');
      const collectionRect = collection instanceof HTMLElement ? collection.getBoundingClientRect() : null;
      const collectionGrid = shell?.querySelector('[data-testid="game-on-dashboard-collection"] .game-on-collection__grid');
      const stats = shell?.querySelector('[data-testid="link-desktop-independent-stats"]');
      const group = shell?.querySelector('[data-testid="dashboard-primary-actions-desktop"]');
      const grid = group?.querySelector('[data-testid="dashboard-primary-actions-grid"]');
      const familyGuide = group?.querySelector('[data-testid="link-desktop-supporter-guide"]');
      const statsUrl = stats instanceof HTMLAnchorElement ? new URL(stats.href) : null;
      const statsRect = stats instanceof HTMLElement ? stats.getBoundingClientRect() : null;
      const gridRect = grid instanceof HTMLElement ? grid.getBoundingClientRect() : null;
      const statsStyle = stats instanceof HTMLElement ? getComputedStyle(stats) : null;
      const visible = (element) => element instanceof HTMLElement
        && getComputedStyle(element).display !== 'none'
        && element.getBoundingClientRect().width > 0
        && element.getBoundingClientRect().height > 0;
      return {
        mobileHidden: mobile instanceof HTMLElement && getComputedStyle(mobile).display === 'none',
        desktopHypeCardVisible: visible(hypeCard),
        desktopHypePreviewVisible: visible(preview),
        desktopHypeCardAtTopLeft: Boolean(hypeRect && summaryRect
          && hypeRect.top < summaryRect.top
          && Math.abs(hypeRect.left - (hypeRowRect?.left ?? 0)) <= 1),
        desktopHypeCardNextToRightStack: Boolean(hypeRect && rightStackRect
          && Math.abs(hypeRect.top - rightStackRect.top) <= 10
          && rightStackRect.left >= hypeRect.right
          && rightStackRect.left - hypeRect.right < 32),
        overviewHeadingAboveTrends: Boolean(overviewRect && trendRect && overviewRect.bottom <= trendRect.top),
        overviewLabelsVisible: overviewText.includes('Athlete overview') && overviewText.includes('All in, all season'),
        seasonLabelAboveTrends: !summary?.querySelector('.supporter-game-on-summary__locker-season')
          && (!seasonLabel || Boolean(seasonLabelRect && trendRect && seasonLabelRect.bottom <= trendRect.top)),
        desktopSummaryUnderTrends: Boolean(trendRect && summaryRect && summaryRect.top >= trendRect.bottom - 1),
        shoutoutsUnderTrends: Boolean(trendRect && repliesRect && repliesRect.top >= trendRect.bottom - 1),
        recordUnderShoutouts: Boolean(repliesRect && recordRect && recordRect.top >= repliesRect.bottom - 1),
        desktopInstallReminderRemoved: !shell?.querySelector('[data-testid="dashboard-install-reminder-desktop"]'),
        eventCardsBelowTopRow: Boolean(hypeRowRect && collectionRect && collectionRect.top >= hypeRowRect.bottom - 1),
        eventCardsFillHorizontalSpace: Boolean(hypeRowRect && collectionRect && Math.abs(collectionRect.width - hypeRowRect.width) <= 1),
        quickLinksBelowHypeCard: Boolean(hypeRect && quickLinksRect && quickLinksRect.top >= hypeRect.bottom - 1),
        eventCardsCentered: collectionGrid instanceof HTMLElement && getComputedStyle(collectionGrid).justifyContent === 'center',
        statsVisible: visible(stats),
        statsLabel: stats?.textContent?.trim() || '',
        statsPath: statsUrl?.pathname || '',
        statsEventId: statsUrl?.searchParams.get('eventId') || '',
        hypeQuickLinkRemoved: !shell?.querySelector('[data-testid="link-desktop-independent-hype"]'),
        actionsUseTwoColumnQuickLinks: Boolean(
          group && grid && stats?.parentElement === grid && familyGuide?.parentElement === grid
          && statsStyle?.display === 'flex' && getComputedStyle(grid).display === 'grid'
          && statsRect && gridRect && statsRect.width < gridRect.width,
        ),
        statsMatchesReference: Boolean(
          statsStyle && stats?.querySelector('svg')
          && statsStyle.backgroundColor === 'rgb(243, 246, 250)'
          && statsStyle.color === 'rgb(11, 31, 58)'
          && statsStyle.textTransform === 'uppercase'
          && statsStyle.borderTopWidth === '1px',
        ),
      };
    })()`, session);
    assert.deepEqual(desktopActions, {
      mobileHidden: true,
      desktopHypeCardVisible: true,
      desktopHypePreviewVisible: true,
      desktopHypeCardAtTopLeft: true,
      desktopHypeCardNextToRightStack: true,
      overviewHeadingAboveTrends: true,
      overviewLabelsVisible: true,
      seasonLabelAboveTrends: true,
      desktopSummaryUnderTrends: true,
      shoutoutsUnderTrends: true,
      recordUnderShoutouts: true,
      desktopInstallReminderRemoved: true,
      eventCardsBelowTopRow: true,
      eventCardsFillHorizontalSpace: true,
      quickLinksBelowHypeCard: true,
      eventCardsCentered: true,
      statsVisible: true,
      statsLabel: 'View stats',
      statsPath: '/studio/season-stats',
      statsEventId: '',
      hypeQuickLinkRemoved: true,
      actionsUseTwoColumnQuickLinks: true,
      statsMatchesReference: true,
    });
    assert.equal(
      await connection.evaluate<boolean>(`!document.querySelector('.supporter-dashboard-desktop-shell .supporter-game-on-summary__athlete-link')`, session),
      true,
      'the desktop summary does not repeat the athlete-photo tile',
    );

    await connection.evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('.game-on-collection__grid .game-on-collection__card'))
        .find((item) => item instanceof HTMLElement && item.getClientRects().length > 0);
      card?.querySelector('.game-on-collection__summary')?.click();
    })()`, session);
    await waitFor(connection, session, 'Boolean(document.querySelector(".game-on-collection__dialog-card"))', Boolean);
    const eventCardActions = await connection.evaluate<{
      calendarLabel: string;
      prepDestination: string;
    }>(`(() => {
      const card = document.querySelector('.game-on-collection__dialog-card');
      return {
        calendarLabel: card?.querySelector('[data-testid^="button-edit-event-arrow-"]')?.getAttribute('aria-label') || '',
        prepDestination: card?.querySelector('[data-testid^="button-open-card-prep-"]')?.getAttribute('data-prep-href') || '',
      };
    })()`, session);
    assert.deepEqual(eventCardActions, {
      calendarLabel: 'Edit event details',
      prepDestination: '/studio/checklist?gameId=game-1&eventType=game',
    });
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('the authenticated Supporter Hub restores the upcoming Event Card after reload', { concurrency: false }, async () => {
  const release = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-future-event-reload');
  let devServer: ChildProcess | undefined;
  let browser: ChildProcess | undefined;
  let devMonitor: ProcessMonitor | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port } = await listen(viteProbe);
    await new Promise<void>((done) => viteProbe.close(() => done()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(port),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devMonitor = monitorProcess(devServer, 'Future Event Card fixture Vite');
    await waitForUrl(`http://127.0.0.1:${port}/`, 20_000, devMonitor);

    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((done) => debugProbe.close(() => done()));
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-future-event-reload-'));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Future Event Card fixture Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, () =>
      `${devMonitor?.diagnostics()}; ${browserMonitor?.diagnostics()}`);
    page = await openPage(
      connection,
      `http://127.0.0.1:${port}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?supporter-future-event-reload`,
    );
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    const wait = (expression: string) =>
      waitFor(connection!, page!.sessionId, expression, Boolean, 30_000);
    await wait('Boolean(document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]"))');

    await connection.evaluate(`(() => {
      const userId = 'supporter-future-event-reload-user';
      const savedCard = {
        shareToken: 'standalone-reload-card',
        title: 'Night Owls game',
        savedAt: new Date().toISOString(),
        event: {
          id: 'standalone-reload-event',
          type: 'game',
          date: '2999-01-02',
          time: '20:30',
          timezone: 'UTC',
          location: 'Northside Gym',
          opponent: 'Night Owls',
          status: 'upcoming',
        },
      };
      localStorage.setItem(
        \`pixlsports-game-on-cards:\${userId}\`,
        JSON.stringify([{
          ...savedCard,
          shareToken: 'later-reload-card',
          event: { ...savedCard.event, id: 'later-reload-event', date: '2999-02-01', opponent: 'Later Bears' },
        }, savedCard]),
      );
    })()`, page.sessionId);

    await reloadPage(connection, page);
    await wait('Boolean(document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]"))');
    await wait(`Boolean(
      document.querySelector('[data-testid="upcoming-event-badge"]')
        ?.querySelector('[data-testid="button-guidance-event-card"]')
        ?.getClientRects().length
    )`);
    const board = await connection.evaluate<string>(
      'document.querySelector(\'[data-testid="upcoming-event-badge"]\')?.textContent || ""',
      page.sessionId,
    );
    assert.match(board, /The Northside Comets Select Travel Club vs Night Owls/);
    assert.match(board, /Jan 2, 2999 · 8:30 PM/);
    assert.doesNotMatch(board, /Game-day prep|Game day is coming up/);
    assert.match(board, /Get ready/);
    assert.doesNotMatch(board, /Open Event Card/);
    assert.doesNotMatch(board, /Later Bears/);

    await connection.evaluate(
      'document.querySelector(\'[data-testid="upcoming-event-badge"] [data-testid="button-guidance-event-card"]\')?.click()',
      page.sessionId,
    );
    await wait(`Boolean(document.querySelector(
      '[data-testid="dialog-game-on-card-share:standalone-reload-card"]'
    ))`);
    await connection.evaluate(
      'document.querySelector(\'[data-testid="upcoming-event-badge"] [data-testid="button-guidance-event-card"]\')?.click()',
      page.sessionId,
    );
    await wait(`Boolean(document.querySelector(
      '[data-testid="dialog-game-on-card-share:standalone-reload-card"]'
    ))`);
    assert.match(
      await connection.evaluate<string>(
        'document.querySelector(\'[data-testid="dialog-game-on-card-share:standalone-reload-card"]\')?.textContent || ""',
        page.sessionId,
      ),
      /Game vs Night Owls/,
    );
  } finally {
    if (page && connection) {
      await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
    }
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devMonitor) {
      if (!devMonitor.hasExited()) devServer.kill('SIGTERM');
      await devMonitor.waitForExit();
    }
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    release();
  }
});

for (const openPanel of ['prep', 'details'] as const) {
test(`an open Event Card updates its suggested action as the game changes stages with ${openPanel} open`, { concurrency: false }, async () => {
  const release = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-event-card-suggested-action');
  const accountId = 'supporter-game-record-user';
  const eventId = 'suggested-action-game';
  const eventDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let devServer: ChildProcess | undefined;
  let browser: ChildProcess | undefined;
  let devMonitor: ProcessMonitor | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port } = await listen(viteProbe);
    await new Promise<void>((done) => viteProbe.close(() => done()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(port),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devMonitor = monitorProcess(devServer, 'Suggested Event Card action fixture Vite');
    await waitForUrl(`http://127.0.0.1:${port}/`, 20_000, devMonitor);

    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((done) => debugProbe.close(() => done()));
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-event-card-suggestion-'));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Suggested Event Card action fixture Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(
      version.webSocketDebuggerUrl,
      () => `${devMonitor?.diagnostics()}; ${browserMonitor?.diagnostics()}`,
    );
    page = await openPage(
      connection,
      `http://127.0.0.1:${port}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?supporter-game-record${openPanel === 'details' ? '&supporter-event-details-draft' : ''}`,
    );
    const wait = (expression: string) =>
      waitFor(connection!, page!.sessionId, expression, Boolean, 30_000);
    await wait('Boolean(document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]"))');
    await connection.evaluate(`window.__setSupporterDashboardEvents([{
      id: ${JSON.stringify(eventId)},
      type: 'game',
      date: ${JSON.stringify(eventDate)},
      time: '18:30',
      timezone: 'UTC',
      location: 'Northside Gym',
      opponent: 'Rivals',
      status: 'upcoming',
    }])`, page.sessionId);

    await wait(`Boolean(document.querySelector('[data-testid="card-game-on-draft:${eventId}"]'))`);
    await connection.evaluate(`document.querySelector('[data-testid="card-game-on-draft:${eventId}"] .game-on-collection__summary')?.click()`, page.sessionId);
    await wait(`Boolean(document.querySelector('[data-testid="dialog-game-on-card-draft:${eventId}"]'))`);

    const getSuggestedActions = (cardId = eventId) => connection!.evaluate<string[]>(`Array.from(
      document.querySelector('[data-testid="dialog-game-on-card-draft:${cardId}"]')
        ?.querySelectorAll('[data-suggested-next="true"]') ?? []
    ).map((action) => action.getAttribute('data-testid') || '')`, page!.sessionId);
    const getActionAccessibleName = (testId: string) => connection!.evaluate<string | null>(
      `document.querySelector('[data-testid="${testId}"]')?.getAttribute('aria-label') ?? null`,
      page!.sessionId,
    );
    const getActionVisualState = (testId: string) => connection!.evaluate<{
      background: string;
      className: string;
      suggested: string | null;
      expanded: string | null;
    } | null>(
      `(() => {
        const action = document.querySelector('[data-testid="dialog-game-on-card-draft:${eventId}"] [data-testid="${testId}"]');
        return action ? {
          background: getComputedStyle(action).backgroundColor,
          className: action.className,
          suggested: action.getAttribute('data-suggested-next'),
          expanded: action.getAttribute('aria-expanded'),
        } : null;
      })()`,
      page!.sessionId,
    );
    const assertSingleSuggestion = async (expectedTestId: string) => {
      assert.deepEqual(await getSuggestedActions(), [expectedTestId]);
      assert.match(await getActionAccessibleName(expectedTestId) ?? '', /suggested next/i);
    };
    const assertNotSuggestedInAccessibleName = async (testId: string) => {
      const accessibleName = await getActionAccessibleName(testId);
      assert.ok(accessibleName, `expected ${testId} to have an accessible name`);
      assert.doesNotMatch(accessibleName, /suggested next/i);
    };
    const assertActionGroup = async (name: string, cardId: string) => {
      const tree = await connection!.send<{
        nodes: Array<{
          ignored?: boolean;
          role?: { value?: string };
          name?: { value?: string };
          backendDOMNodeId?: number;
        }>;
      }>('Accessibility.getFullAXTree', {}, page!.sessionId);
      const groups = tree.nodes.filter((node) =>
        !node.ignored && node.role?.value === 'group' && node.name?.value === name,
      );
      assert.equal(groups.length, 1, `the opened card must expose one named ${name} group`);
      const { node } = await connection!.send<{ node: { backendNodeId: number } }>(
        'DOM.describeNode',
        { objectId: (await connection!.send<{ result: { objectId: string } }>('Runtime.evaluate', {
          expression: `document.querySelector('[data-testid="dialog-game-on-card-draft:${cardId}"] .game-on-collection__actions')`,
        }, page!.sessionId)).result.objectId },
        page!.sessionId,
      );
      assert.equal(groups[0].backendDOMNodeId, node.backendNodeId,
        'the accessible group must be the opened Event Card action container');
    };

    await assertActionGroup('Game Event Card actions', eventId);
    await assertSingleSuggestion(`button-open-card-prep-draft:${eventId}`);
    assert.equal((await getActionVisualState(`button-open-card-prep-draft:${eventId}`))?.background, 'rgb(40, 120, 245)',
      'Prep uses the blue fill when it is the recommended next action');
    await assertNotSuggestedInAccessibleName(`button-open-stat-tracker-draft:${eventId}`);
    const readAnnouncement = () => connection!.evaluate<string>(
      `document.querySelector('[data-testid="status-game-on-recommendation"]')?.textContent.trim() ?? ''`,
      page!.sessionId,
    );
    const assertOpenPanelAnnouncement = async () => {
      assert.deepEqual(await connection!.evaluate(`(() => {
        const dialog = document.querySelector('[data-testid="dialog-game-on-card-draft:${eventId}"]');
        const region = dialog?.querySelector('[data-testid="status-game-on-recommendation"]');
        const front = dialog?.querySelector('.game-on-collection__flip-front');
        const back = dialog?.querySelector('.game-on-collection__flip-back');
        const panel = dialog?.querySelector('[data-testid="panel-inline-${openPanel === 'details' ? 'calendar' : 'prep'}-draft:${eventId}"]');
        return {
          regionCount: document.querySelectorAll('[data-testid="status-game-on-recommendation"]').length,
          sameRegion: region === window.__recommendationRegion,
          liveAttributes: [region?.getAttribute('role'), region?.getAttribute('aria-live'), region?.getAttribute('aria-atomic')],
          outsideFaces: Boolean(region && !region.closest('.game-on-collection__flip-front, .game-on-collection__flip-back')),
          exposed: Boolean(region && !region.closest('[inert], [aria-hidden="true"], [hidden]')),
          frontInactive: Boolean(front?.inert && front.getAttribute('aria-hidden') === 'true'),
          backActive: Boolean(back && !back.inert && back.getAttribute('aria-hidden') === 'false'),
          panelOpen: Boolean(panel?.getClientRects().length),
          focusPreserved: document.activeElement === window.__activeRecommendationControl && Boolean(panel?.contains(document.activeElement)),
        };
      })()`, page!.sessionId), {
        regionCount: 1,
        sameRegion: true,
        liveAttributes: ['status', 'polite', 'true'],
        outsideFaces: true,
        exposed: true,
        frontInactive: true,
        backActive: true,
        panelOpen: true,
        focusPreserved: true,
      }, `the same polite region must stay outside inactive faces while the exact ${openPanel} input keeps focus`);
      if (openPanel === 'details') {
        assert.deepEqual(await connection!.evaluate(`(() => {
          const input = document.querySelector('[data-testid="dialog-game-on-card-draft:${eventId}"] [data-testid="input-inline-location"]');
          return {
            sameInput: input === window.__activeRecommendationControl,
            draft: input?.value,
            savedLocation: window.__getSupporterDashboardEvents().find(event => event.id === ${JSON.stringify(eventId)})?.location,
            savedCards: localStorage.getItem('pixlsports-game-on-cards:${accountId}'),
            saveRequests: window.__eventDetailsSaveRequests,
            calendarSaves: window.__eventDetailsCalendarSaves,
          };
        })()`, page!.sessionId), {
          sameInput: true,
          draft: 'Unsaved courtside entrance',
          savedLocation: 'Northside Gym',
          savedCards: await connection!.evaluate('window.__eventDetailsSavedCardsBefore', page!.sessionId),
          saveRequests: [],
          calendarSaves: [],
        }, 'status updates must preserve the location draft without saving it to the event, card storage, or API');
      }
    };
    assert.equal(await readAnnouncement(), '', 'opening an upcoming card must not announce its initial recommendation');
    await connection.evaluate(`document.querySelector('[data-testid="dialog-game-on-card-draft:${eventId}"] [data-testid="${openPanel === 'details' ? 'button-edit-event-arrow' : 'button-open-card-prep'}-draft:${eventId}"]').click()`, page.sessionId);
    await wait(openPanel === 'details'
      ? `Boolean(document.querySelector('[data-testid="dialog-game-on-card-draft:${eventId}"] [data-testid="input-inline-location"]')?.getClientRects().length)`
      : `document.activeElement?.matches('[data-testid="panel-inline-prep-draft:${eventId}"] .game-on-prep__title')`);
    if (openPanel === 'details') {
      await connection.evaluate(`(() => {
        window.__eventDetailsSaveRequests = [];
        window.__eventDetailsCalendarSaves = [];
        window.__eventDetailsSavedCardsBefore = localStorage.getItem('pixlsports-game-on-cards:${accountId}');
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
          const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
          if (!['GET', 'HEAD', 'OPTIONS'].includes(method)
            && /\\/api\\/(schedule-shares|game-on-cards)(\\/|$)/.test(url.pathname)) {
            window.__eventDetailsSaveRequests.push({ path: url.pathname, method });
          }
          return originalFetch(input, init);
        };
      })()`, page.sessionId);
      const inputSelector = `[data-testid="dialog-game-on-card-draft:${eventId}"] [data-testid="input-inline-location"]`;
      await connection.evaluate(`document.querySelector(${JSON.stringify(inputSelector)}).focus()`, page.sessionId);
      await connection.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
      }, page.sessionId);
      await connection.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
      }, page.sessionId);
      await connection.send('Input.insertText', { text: 'Unsaved courtside entrance' }, page.sessionId);
      await wait(`document.querySelector(${JSON.stringify(inputSelector)})?.value === 'Unsaved courtside entrance'`);
    }
    assert.deepEqual(await connection.evaluate(`(() => {
      const region = document.querySelector('[data-testid="status-game-on-recommendation"]');
      window.__recommendationRegion = region;
      window.__activeRecommendationControl = document.querySelector(${JSON.stringify(openPanel === 'details'
        ? `[data-testid="dialog-game-on-card-draft:${eventId}"] [data-testid="input-inline-location"]`
        : `[data-testid="panel-inline-prep-draft:${eventId}"] [data-testid="input-card-prep-title-${eventId}"]`)});
      window.__activeRecommendationControl.focus();
      window.__recommendationChanges = [];
      window.__recommendationDialog = region.closest('[role="dialog"]');
      window.__recommendationObserver = new MutationObserver((records) => {
        for (const record of records) {
          const touchesRegion = region.contains(record.target)
            || [...record.addedNodes, ...record.removedNodes].some(node =>
              node.contains(region)
              || (node instanceof Element && (
                node.matches('[data-testid="status-game-on-recommendation"]')
                || node.querySelector('[data-testid="status-game-on-recommendation"]')
              )));
          if (touchesRegion) window.__recommendationChanges.push(region.textContent.trim());
        }
      });
      window.__recommendationObserver.observe(window.__recommendationDialog, { childList: true, subtree: true, characterData: true });
      return [region.getAttribute('role'), region.getAttribute('aria-live'), region.getAttribute('aria-atomic')];
    })()`, page.sessionId), ['status', 'polite', 'true']);
    await assertOpenPanelAnnouncement();
    assert.equal(await readAnnouncement(), '', `opening ${openPanel} must not announce an unchanged recommendation`);
    await connection.evaluate(`window.__setSupporterDashboardEvents([{
      id: ${JSON.stringify(eventId)},
      type: 'game',
      date: ${JSON.stringify(eventDate)},
      time: '18:30',
      timezone: 'UTC',
      location: 'Northside Gym',
      opponent: 'Rivals',
      status: 'live',
    }])`, page.sessionId);
    await wait(`document.querySelector('[data-testid="status-game-on-card-draft:${eventId}"]')?.dataset.status === 'live'`);
    await assertSingleSuggestion(`button-open-stat-tracker-draft:${eventId}`);
    await assertNotSuggestedInAccessibleName(`button-open-card-prep-draft:${eventId}`);
    await connection.evaluate('new Promise(resolve => setTimeout(resolve, 250))', page.sessionId);
    const prepVisualState = await getActionVisualState(`button-open-card-prep-draft:${eventId}`);
    assert.equal(prepVisualState?.suggested, null,
      `Prep must not retain the suggested marker after the handoff; got ${JSON.stringify(prepVisualState)}`);
    assert.doesNotMatch(prepVisualState?.className ?? '', /game-on-collection__action--suggested/,
      `Prep must not retain its suggested styling after the handoff; got ${JSON.stringify(prepVisualState)}`);
    assert.notEqual(prepVisualState?.background, 'rgb(40, 120, 245)',
      `Prep must no longer use the bright blue suggested-action fill; got ${JSON.stringify(prepVisualState)}`);
    await wait(`document.querySelector('[data-testid="status-game-on-recommendation"]')?.textContent.includes('is now Live. Suggested next: Stat Tracker.')`);
    assert.equal(await readAnnouncement(), 'Event Card vs Rivals is now Live. Suggested next: Stat Tracker.');
    await assertOpenPanelAnnouncement();
    assert.deepEqual(await connection.evaluate('window.__recommendationChanges', page.sessionId), [
      'Event Card vs Rivals is now Live. Suggested next: Stat Tracker.',
    ], `the Live transition must update the existing region exactly once while ${openPanel} is open`);
    await connection.evaluate(`window.__setSupporterDashboardEvents(window.__getSupporterDashboardEvents())`, page.sessionId);
    await connection.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', page.sessionId);
    assert.deepEqual(await connection.evaluate('window.__recommendationChanges', page.sessionId), [
      'Event Card vs Rivals is now Live. Suggested next: Stat Tracker.',
    ], 'an unchanged Live recommendation must not announce again or reset the draft');
    await assertOpenPanelAnnouncement();
    if (openPanel === 'prep') {
      const dialogSelector = `[data-testid="dialog-game-on-card-draft:${eventId}"]`;
      const assertPrepFlip = async (
        prepOpen: boolean,
        announcement: string,
        changes: string[],
        suggestedAction: string | null,
      ) => {
        await connection!.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', page!.sessionId);
        await wait(`Array.from(document.querySelector(${JSON.stringify(dialogSelector)})
          ?.querySelector('.game-on-collection__flip-inner')?.getAnimations() ?? [])
          .every(animation => animation.playState !== 'running')`);
        if (suggestedAction) {
          await assertSingleSuggestion(suggestedAction);
        } else {
          assert.deepEqual(await getSuggestedActions(), [], 'a completed card must not retain a suggested game-day action');
        }
        assert.deepEqual(await connection!.evaluate(`(() => {
          const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
          const region = dialog?.querySelector('[data-testid="status-game-on-recommendation"]');
          const front = dialog?.querySelector('.game-on-collection__flip-front');
          const back = dialog?.querySelector('.game-on-collection__flip-back');
          const trigger = dialog?.querySelector('[data-testid="button-open-card-prep-draft:${eventId}"]');
          const panel = dialog?.querySelector('[data-testid="panel-inline-prep-draft:${eventId}"]');
          return {
            sameDialog: dialog === window.__recommendationDialog,
            sameRegion: region === window.__recommendationRegion,
            regionCount: document.querySelectorAll('[data-testid="status-game-on-recommendation"]').length,
            text: region?.textContent.trim(),
            changes: window.__recommendationChanges,
            exposed: Boolean(region && !region.closest('[inert], [aria-hidden="true"], [hidden]')),
            frontActive: Boolean(front && !front.inert && front.getAttribute('aria-hidden') === 'false'),
            backActive: Boolean(back && !back.inert && back.getAttribute('aria-hidden') === 'false'),
            focusCorrect: ${prepOpen
              ? "Boolean(panel?.contains(document.activeElement) && document.activeElement?.matches('.game-on-prep__title'))"
              : "Boolean(trigger?.getClientRects().length && document.activeElement === trigger && !trigger.closest('[inert], [aria-hidden=\"true\"], [hidden]'))"},
          };
        })()`, page!.sessionId), {
          sameDialog: true,
          sameRegion: true,
          regionCount: 1,
          text: announcement,
          changes,
          exposed: true,
          frontActive: !prepOpen,
          backActive: prepOpen,
          focusCorrect: true,
        }, `the Prep ${prepOpen ? 'reopening' : 'closing'} flip must preserve the current announcement without replay and move focus to the visible face`);
      };
      await connection.evaluate(`document.querySelector('${dialogSelector} [data-testid="button-close-card-prep-${eventId}"]').click()`, page.sessionId);
      await wait(`document.activeElement?.matches('${dialogSelector} [data-testid="button-open-card-prep-draft:${eventId}"]')`);
      const liveAnnouncement = 'Event Card vs Rivals is now Live. Suggested next: Stat Tracker.';
      const liveChanges = [liveAnnouncement];
      await assertPrepFlip(false, liveAnnouncement, liveChanges, `button-open-stat-tracker-draft:${eventId}`);
      await connection.evaluate(`window.__setSupporterDashboardEvents([{
        id: ${JSON.stringify(eventId)},
        type: 'game',
        date: ${JSON.stringify(eventDate)},
        time: '18:30',
        timezone: 'UTC',
        location: 'Northside Gym',
        opponent: 'Rivals',
        status: 'final',
      }])`, page.sessionId);
      const completeAnnouncement = 'Event Card vs Rivals is now Complete. Suggested next: No suggested action.';
      const completeChanges = [...liveChanges, completeAnnouncement];
      await wait(`document.querySelector('[data-testid="status-game-on-card-draft:${eventId}"]')?.dataset.status === 'complete'`);
      await wait(`document.querySelector('[data-testid="status-game-on-recommendation"]')?.textContent.includes(${JSON.stringify(completeAnnouncement)})`);
      await assertPrepFlip(false, completeAnnouncement, completeChanges, null);
      assert.equal(await readAnnouncement(), completeAnnouncement,
        'the Live-to-Complete transition while Prep is closed must announce the updated stage once');
      await connection.evaluate(`document.querySelector('${dialogSelector} [data-testid="button-open-card-prep-draft:${eventId}"]').click()`, page.sessionId);
      await wait(`document.activeElement?.matches('${dialogSelector} [data-testid="panel-inline-prep-draft:${eventId}"] .game-on-prep__title')`);
      await assertPrepFlip(true, completeAnnouncement, completeChanges, null);
      assert.equal(await readAnnouncement(), completeAnnouncement,
        'reopening Prep must not replay the Complete announcement');
      // Later stage changes should preserve the reopened panel's focused input.
      await connection.evaluate(`(() => {
        window.__activeRecommendationControl = document.querySelector('${dialogSelector} [data-testid="input-card-prep-title-${eventId}"]');
        window.__activeRecommendationControl.focus();
      })()`, page.sessionId);
      await assertOpenPanelAnnouncement();
    } else {
      const dialogSelector = `[data-testid="dialog-game-on-card-draft:${eventId}"]`;
      const locationSelector = `${dialogSelector} [data-testid="input-inline-location"]`;
      const editArrowTestId = `button-edit-event-arrow-draft:${eventId}`;
      const editArrowSelector = `${dialogSelector} [data-testid="${editArrowTestId}"]`;
      const editorHeadingSelector = `${dialogSelector} [data-testid="game-on-inline-calendar-draft:${eventId}"] .game-on-inline__section h3`;
      const liveAnnouncement = 'Event Card vs Rivals is now Live. Suggested next: Stat Tracker.';
      const liveChanges = [liveAnnouncement];
      const assertDetailsFlip = async (editorOpen: boolean) => {
        await connection!.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', page!.sessionId);
        await wait(`Array.from(document.querySelector(${JSON.stringify(dialogSelector)})
          ?.querySelector('.game-on-collection__flip-inner')?.getAnimations() ?? [])
          .every(animation => animation.playState !== 'running')`);
        assert.deepEqual(await connection!.evaluate(`(() => {
          const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
          const region = dialog?.querySelector('[data-testid="status-game-on-recommendation"]');
          const front = dialog?.querySelector('.game-on-collection__flip-front');
          const back = dialog?.querySelector('.game-on-collection__flip-back');
          const card = dialog?.querySelector('.game-on-collection__dialog-card');
          const panel = dialog?.querySelector('[data-testid="panel-inline-calendar-draft:${eventId}"]');
          const editArrow = dialog?.querySelector('[data-testid="button-edit-event-arrow-draft:${eventId}"]');
          return {
            sameDialog: dialog === window.__recommendationDialog,
            sameRegion: region === window.__recommendationRegion,
            regionCount: document.querySelectorAll('[data-testid="status-game-on-recommendation"]').length,
            text: region?.textContent.trim(),
            changes: window.__recommendationChanges,
            exposed: Boolean(region && !region.closest('[inert], [aria-hidden="true"], [hidden]')),
            frontActive: Boolean(front && !front.inert && front.getAttribute('aria-hidden') === 'false'),
            backActive: Boolean(back && !back.inert && back.getAttribute('aria-hidden') === 'false'),
            editorOpen: card?.getAttribute('data-calendar-open') === 'true',
            panelVisible: Boolean(panel?.getClientRects().length),
            focusCorrect: ${editorOpen
              ? "Boolean(panel?.contains(document.activeElement) && document.activeElement?.matches('.game-on-inline__section h3'))"
              : "Boolean(editArrow?.getClientRects().length && document.activeElement === editArrow && !editArrow.closest('[inert], [aria-hidden=\"true\"], [hidden]'))"},
          };
        })()`, page!.sessionId), {
          sameDialog: true,
          sameRegion: true,
          regionCount: 1,
          text: liveAnnouncement,
          changes: liveChanges,
          exposed: true,
          frontActive: !editorOpen,
          backActive: editorOpen,
          editorOpen,
          panelVisible: editorOpen,
          focusCorrect: true,
        }, `the Details ${editorOpen ? 'reopening' : 'closing'} flip must keep the Live announcement mounted and focus the visible face`);
        assert.equal(await readAnnouncement(), liveAnnouncement,
          `closing or reopening Details must not clear or replay the Live announcement`);
        assert.deepEqual(await connection!.evaluate(`(() => ({
          draft: document.querySelector(${JSON.stringify(locationSelector)})?.value,
          savedLocation: window.__getSupporterDashboardEvents().find(event => event.id === ${JSON.stringify(eventId)})?.location,
          savedCards: localStorage.getItem('pixlsports-game-on-cards:${accountId}'),
          saveRequests: window.__eventDetailsSaveRequests,
          calendarSaves: window.__eventDetailsCalendarSaves,
        }))()`, page!.sessionId), {
          draft: 'Unsaved courtside entrance',
          savedLocation: 'Northside Gym',
          savedCards: await connection!.evaluate('window.__eventDetailsSavedCardsBefore', page!.sessionId),
          saveRequests: [],
          calendarSaves: [],
        }, 'the editor-only round trip must preserve the unsaved draft without saving or replacing event data');
      };

      await connection.evaluate(`(() => {
        const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
        const closeButton = Array.from(dialog?.querySelectorAll('[data-testid^="button-close-calendar-editor-"]') ?? [])
          .find((button) => button.getClientRects().length > 0);
        if (!closeButton) throw new Error('The visible Back to Event Card control is unavailable');
        closeButton.click();
      })()`, page.sessionId);
      await connection.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', page.sessionId);
      const closedDetailsState = await connection.evaluate<{
        calendarOpen: string | null;
        focusTestId: string | null;
        editArrowVisible: boolean;
      }>(`(() => {
        const dialog = document.querySelector(${JSON.stringify(dialogSelector)});
        const card = dialog?.querySelector('.game-on-collection__dialog-card');
        const editArrow = dialog?.querySelector(${JSON.stringify(editArrowSelector)});
        return {
          calendarOpen: card?.getAttribute('data-calendar-open') ?? null,
          focusTestId: document.activeElement?.getAttribute('data-testid') ?? null,
          editArrowVisible: Boolean(editArrow?.getClientRects().length),
        };
      })()`, page.sessionId);
      assert.equal(closedDetailsState.calendarOpen, 'false',
        `closing Details should leave the Event Card open: ${JSON.stringify(closedDetailsState)}`);
      assert.equal(closedDetailsState.editArrowVisible, true,
        `the edit arrow should be visible after closing Details: ${JSON.stringify(closedDetailsState)}`);
      assert.equal(closedDetailsState.focusTestId, editArrowTestId,
        `closing Details should return focus to the visible edit arrow: ${JSON.stringify(closedDetailsState)}`);
      await assertDetailsFlip(false);

      await connection.evaluate(`document.querySelector('${dialogSelector} [data-testid="button-edit-event-arrow-draft:${eventId}"]')?.click()`, page.sessionId);
      await wait(`document.querySelector(${JSON.stringify(`${dialogSelector} [data-testid="panel-inline-calendar-draft:${eventId}"]`)})?.getClientRects().length
        && document.activeElement?.matches(${JSON.stringify(editorHeadingSelector)})`);
      await assertDetailsFlip(true);
      await connection.evaluate(`(() => {
        window.__activeRecommendationControl = document.querySelector(${JSON.stringify(locationSelector)});
        window.__activeRecommendationControl.focus();
      })()`, page.sessionId);
      await assertOpenPanelAnnouncement();
    }
    const { node: announcementNode } = await connection.send<{ node: { backendNodeId: number } }>(
      'DOM.describeNode',
      { objectId: (await connection.send<{ result: { objectId: string } }>('Runtime.evaluate', {
        expression: 'window.__recommendationRegion',
      }, page.sessionId)).result.objectId },
      page.sessionId,
    );
    const announcementTree = await connection.send<{
      nodes: Array<{
        backendDOMNodeId?: number;
        ignored?: boolean;
        role?: { value?: string };
        properties?: Array<{ name: string; value: { value?: unknown } }>;
      }>;
    }>('Accessibility.getFullAXTree', {}, page.sessionId);
    const accessibleAnnouncement = announcementTree.nodes.find((node) =>
      node.backendDOMNodeId === announcementNode.backendNodeId,
    );
    assert.ok(accessibleAnnouncement && !accessibleAnnouncement.ignored,
      'the live region must remain in the accessibility tree while the card front is inert');
    assert.equal(accessibleAnnouncement.role?.value, 'status');
    assert.equal(accessibleAnnouncement.properties?.find((property) => property.name === 'live')?.value.value, 'polite');
    assert.equal(accessibleAnnouncement.properties?.find((property) => property.name === 'atomic')?.value.value, true);

    await connection.evaluate(`window.__setSupporterDashboardEvents([{
      id: ${JSON.stringify(eventId)},
      type: 'game',
      date: ${JSON.stringify(eventDate)},
      time: '18:30',
      timezone: 'UTC',
      location: 'Northside Gym',
      opponent: 'Rivals',
      status: 'final',
    }])`, page.sessionId);
    await wait(`document.querySelector('[data-testid="status-game-on-card-draft:${eventId}"]')?.dataset.status === 'complete'`);
    assert.deepEqual(await getSuggestedActions(), [], 'a completed card must not retain a suggested game-day action');
    await wait(`document.querySelector('[data-testid="status-game-on-recommendation"]')?.textContent.includes('is now Complete. Suggested next: No suggested action.')`);
    await assertOpenPanelAnnouncement();

    const trackerHistory = {
      version: 1,
      games: [{
        id: 'saved-suggested-action-game',
        sport: 'basketball',
        status: 'final',
        date: eventDate,
        opponent: 'Rivals',
        period: 4,
        score: 12,
        opponentScore: 7,
        notes: '',
        stats: { points: 12 },
        events: [],
        startedAt: new Date(`${eventDate}T18:30:00.000Z`).toISOString(),
        sourceEventId: eventId,
      }],
    };
    const historyKey = `leaguematrix-stat-tracker:${encodeURIComponent(accountId)}`;
    await connection.evaluate(`(() => {
      localStorage.setItem(${JSON.stringify(historyKey)}, ${JSON.stringify(JSON.stringify(trackerHistory))});
      window.__setSupporterDashboardEvents(window.__getSupporterDashboardEvents());
    })()`, page.sessionId);
    await wait(`Boolean(document.querySelector('[data-testid="link-view-card-stats-draft:${eventId}"]'))`);
    assert.deepEqual(await getSuggestedActions(), [], 'a past game may retain its stats link without suggesting it over the current journey');
    await assertOpenPanelAnnouncement();
    assert.deepEqual(await connection.evaluate('window.__recommendationChanges', page.sessionId), [
      'Event Card vs Rivals is now Live. Suggested next: Stat Tracker.',
      'Event Card vs Rivals is now Complete. Suggested next: No suggested action.',
    ], 'each stage or action change must update the mounted live region exactly once');
    await connection.evaluate(`window.__setSupporterDashboardEvents(window.__getSupporterDashboardEvents())`, page.sessionId);
    await connection.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', page.sessionId);
    assert.equal(await readAnnouncement(), 'Event Card vs Rivals is now Complete. Suggested next: No suggested action.',
      'an unrelated render must not clear or repeat the announcement');
    assert.equal(await connection.evaluate<number>('window.__recommendationChanges.length', page.sessionId), 2,
      'an unchanged recommendation must not mutate the live region');
    await assertOpenPanelAnnouncement();
    await connection.evaluate('window.__recommendationObserver.disconnect()', page.sessionId);
    await connection.evaluate(`document.querySelector('[aria-label="Close Event Card"]').click()`, page.sessionId);
    await wait(`!document.querySelector('[data-testid="dialog-game-on-card-draft:${eventId}"]')`);
    await connection.evaluate(`document.querySelector('[data-testid="button-open-game-on-card-draft:${eventId}"]').click()`, page.sessionId);
    await wait(`Boolean(document.querySelector('[data-testid="dialog-game-on-card-draft:${eventId}"]'))`);
    assert.equal(await readAnnouncement(), '', 'reopening a completed card must not replay an old announcement');

    const practiceId = 'suggested-action-practice';
    await connection.evaluate(`window.__setSupporterDashboardEvents([{
      id: ${JSON.stringify(practiceId)},
      type: 'practice',
      date: ${JSON.stringify(eventDate)},
      time: '17:00',
      timezone: 'UTC',
      location: 'Northside Gym',
      status: 'upcoming',
    }])`, page.sessionId);
    await wait(`Boolean(document.querySelector('[data-testid="button-open-game-on-card-draft:${practiceId}"]'))`);
    await connection.evaluate(`document.querySelector('[data-testid="button-open-game-on-card-draft:${practiceId}"]')?.click()`, page.sessionId);
    await wait(`Boolean(document.querySelector('[data-testid="dialog-game-on-card-draft:${practiceId}"]'))`);
    await assertActionGroup('Practice Event Card actions', practiceId);
    assert.deepEqual(await getSuggestedActions(practiceId), [`button-open-card-prep-draft:${practiceId}`]);
    assert.equal(await readAnnouncement(), '', 'opening a different card must not announce an initial recommendation');
    assert.match(await getActionAccessibleName(`button-open-card-prep-draft:${practiceId}`) ?? '', /suggested next/i);
    assert.equal(
      await connection.evaluate<boolean>(
        `Boolean(document.querySelector('[data-testid="dialog-game-on-card-draft:${practiceId}"] [data-testid^="button-open-stat-tracker-"]'))`,
        page.sessionId,
      ),
      false,
      'practice cards must not expose a Stat Tracker action',
    );
    await assertNotSuggestedInAccessibleName(`button-edit-event-arrow-draft:${practiceId}`);
  } finally {
    if (page && connection) {
      await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
    }
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devMonitor) {
      if (!devMonitor.hasExited()) devServer.kill('SIGTERM');
      await devMonitor.waitForExit();
    }
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    release();
  }
});
}

test('mobile event guidance prioritizes live games and always offers a next action', { concurrency: false }, async () => {
  const release = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-event-guidance');
  let devServer: ChildProcess | undefined, browser: ChildProcess | undefined;
  let devMonitor: ProcessMonitor | undefined, browserMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined, connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;
  try {
    const probe = createServer();
    const { port } = await listen(probe);
    await new Promise<void>((done) => probe.close(() => done()));
    await writeFile(fixtures.harnessPath, harnessSource());
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)));
    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: { ...process.env, PORT: String(port), BASE_PATH: '/', VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devMonitor = monitorProcess(devServer, 'Guidance fixture Vite');
    await waitForUrl(`http://127.0.0.1:${port}/`, 20_000, devMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((done) => debugProbe.close(() => done()));
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-event-guidance-'));
    browser = spawn(chromiumPath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${tempDirectory}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Guidance fixture Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, () => `${devMonitor?.diagnostics()}; ${browserMonitor?.diagnostics()}`);
    page = await openPage(connection, `http://127.0.0.1:${port}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?mobile-hype-pair`);
    const evaluate = <T,>(expression: string) => connection!.evaluate<T>(expression, page!.sessionId);
    const wait = (expression: string) => waitFor(connection!, page!.sessionId, expression, Boolean, 30_000);
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
    await wait(`typeof window.__setSupporterDashboardEvents==='function'`);
    await evaluate(`window.__setHypePreviewState('velocity'); window.__setSupporterDashboardEvents([])`);
    await wait(`document.querySelector('[data-testid="mobile-event-guidance"]')?.dataset.state==='empty'`);
    assert.match(await evaluate<string>(`document.querySelector('[data-testid="mobile-event-guidance"]').textContent`), /Create Event Card/);
    assert.equal(await evaluate(`document.querySelector('[data-testid="link-guidance-tracker"]')`), null, 'no tracker action without an Event Card');
    assert.doesNotMatch(await evaluate<string>(`document.querySelector('[data-testid="mobile-event-guidance"]').textContent`), /open tracker|open the tracker|continue tracking|already underway/i);
    await evaluate(`window.__setSupporterDashboardEvents([
      {id:'guidance-live',type:'game',date:new Date().toISOString().slice(0,10),time:new Date().toISOString().slice(11,16),timezone:'UTC',opponent:'Live Hawks',location:'Field 1',status:'live'},
      {id:'guidance-future',type:'game',date:new Date(Date.now()+86400000*3).toISOString().slice(0,10),time:'18:00',timezone:'UTC',opponent:'Future Owls',location:'Field 2',status:'upcoming'}
    ])`);
    await wait(`document.querySelector('[data-testid="mobile-event-guidance"]')?.dataset.state==='live'`);
    assert.match(await evaluate<string>(`document.querySelector('[data-testid="mobile-event-guidance"]').textContent`), /Live Hawks/);
    assert.equal(await evaluate<string>(`document.querySelector('[data-testid="button-guidance-event-card"]').textContent.trim()`), 'Capture the game');
    assert.doesNotMatch(await evaluate<string>(`document.querySelector('[data-testid="mobile-event-guidance"]').textContent`), /Future Owls|No upcoming/);
    await evaluate(`document.querySelector('[data-testid="button-guidance-event-card"]').click()`);
    await wait(`!!document.querySelector('[data-testid="card-game-on-draft:guidance-live"] input')`);
    await evaluate(`document.querySelector('[aria-label="Close Event Card"]').click()`);
    await wait(`!document.querySelector('[data-testid="dialog-game-on-card-draft:guidance-live"]')`);
    await evaluate(`(() => {
      const start = new Date(Date.now() - 121 * 60 * 1000).toISOString();
      window.__setSupporterDashboardEvents([
        {id:'guidance-passed',type:'game',date:start.slice(0,10),time:start.slice(11,16),timezone:'UTC',opponent:'Past Bears',location:'Field 1',status:'live'}
      ]);
    })()`);
    await wait(`document.querySelector('[data-testid="mobile-event-guidance"]')?.dataset.state==='empty'`);
    assert.match(await evaluate<string>(`document.querySelector('[data-testid="mobile-event-guidance"]').textContent`), /Create Event Card/);
    assert.equal(await evaluate(`document.querySelector('[data-testid="button-guidance-event-card"]')`), null);
    await wait(`document.querySelector('[data-testid="status-game-on-card-draft:guidance-passed"]')?.dataset.status==='complete'`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="button-open-card-prep-draft:guidance-passed"]')?.getAttribute('data-suggested-next') === 'true'`), false);
    for (const width of [320, 390, 568]) {
      await connection.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
      assert.equal(await evaluate(`(() => {
        const panel=document.querySelector('[data-testid="mobile-event-guidance"]'),button=panel.querySelector('button');
        const p=panel.getBoundingClientRect(),b=button.getBoundingClientRect();
        return b.width>0&&b.height>=44&&b.left>=p.left&&b.right<=p.right&&document.documentElement.scrollWidth<=innerWidth;
      })()`), true, `live guidance remains actionable at ${width}px`);
    }
    await evaluate(`document.querySelector('[data-testid="mobile-event-guidance"]').scrollIntoView({block:'center'})`);
    const capture = await connection.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }, page.sessionId);
    await writeFile(resolve(tmpdir(), 'pixl-live-event-guidance.jpg'), Buffer.from(capture.data, 'base64'));
    await evaluate(`window.__setSupporterDashboardEvents([])`);
    await wait(`document.querySelector('[data-testid="mobile-event-guidance"]')?.dataset.state==='empty'`);
    await evaluate(`document.querySelector('[data-testid="button-guidance-create-event"]').click()`);
    await wait(`!!document.querySelector('[data-testid^="card-game-on-new-card-"]')`);
    await evaluate(`localStorage.setItem('leaguematrix-stat-tracker-active-game:guidance-owner',JSON.stringify({
      id:'guidance-tracker',sport:'basketball',status:'paused',date:new Date().toISOString().slice(0,10),opponent:'Tracker Falcons',period:1,score:2,opponentScore:0,notes:'',stats:{},events:[],startedAt:new Date().toISOString()
    }));window.__setSupporterDashboardTrackerUserId('guidance-owner')`);
    await wait(`document.querySelector('[data-testid="mobile-event-guidance"]')?.dataset.state==='empty'`);
    assert.doesNotMatch(await evaluate<string>(`document.querySelector('[data-testid="mobile-event-guidance"]').textContent`), /Tracker Falcons|paused|open tracker|open the tracker|continue tracking/i, 'a tracker session alone cannot imply a game exists in the Event Card panel');
    assert.equal(await evaluate(`document.querySelector('[data-testid="mobile-event-guidance"] a')`), null);
    assert.equal(await evaluate(`document.querySelectorAll('[data-testid="mobile-event-guidance"] button').length`), 1);
    await evaluate(`window.__setSupporterDashboardTrackerUserId('another-owner')`);
    await wait(`document.querySelector('[data-testid="mobile-event-guidance"]')?.dataset.state==='empty'`);
    assert.doesNotMatch(await evaluate<string>(`document.querySelector('[data-testid="mobile-event-guidance"]').textContent`), /Tracker Falcons/);
  } finally {
    if (connection && page) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
    connection?.close();
    if (browser && browserMonitor) { if (!browserMonitor.hasExited()) browser.kill('SIGTERM'); await browserMonitor.waitForExit(); }
    if (devServer && devMonitor) { if (!devMonitor.hasExited()) devServer.kill('SIGTERM'); await devMonitor.waitForExit(); }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    release();
  }
});

for (const shareOnly of [false, true]) {
test(shareOnly ? 'Hub Share copies the public Player Showcase link on mobile and desktop' : 'mobile Calendar and saved HYPE Card stay paired with safe states and fresh owner data', { concurrency: false }, async () => {
  const release = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-hype-pair');
  let devServer: ChildProcess | undefined, browser: ChildProcess | undefined;
  let devMonitor: ProcessMonitor | undefined, browserMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;
  try {
    const probe = createServer();
    const { port } = await listen(probe);
    await new Promise<void>((done) => probe.close(() => done()));
    await writeFile(fixtures.harnessPath, harnessSource());
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)));
    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(port),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devMonitor = monitorProcess(devServer, 'HYPE fixture Vite');
    await waitForUrl(`http://127.0.0.1:${port}/`, 20_000, devMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((done) => debugProbe.close(() => done()));
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-hype-pair-'));
    browser = spawn(chromiumPath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${tempDirectory}`, 'about:blank'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'HYPE fixture Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(r => r.json());
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    const fixtureUrl = `http://127.0.0.1:${port}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?mobile-hype-pair`;
    page = await openPage(connection, fixtureUrl);
    const evaluate = <T,>(expression: string) => connection!.evaluate<T>(expression, page!.sessionId);
    const wait = (expression: string) => waitFor(connection!, page!.sessionId, expression, Boolean);
    const verifyHypeCardShare = async (variant: 'mobile' | 'desktop') => {
      const expectedUrl = new URL('/showcase/saved-athlete-token', fixtureUrl).toString();
      await wait(`Boolean(document.querySelector('[data-testid="button-${variant}-hype-card-share"]'))`);
      await evaluate(`document.querySelector('[data-testid="button-${variant}-hype-card-share"]').click()`);
      await wait(`Boolean(document.querySelector('[data-testid="img-${variant}-hype-card-qr"]'))`);
      const revealed = await evaluate<{ link: string; qrSrc: string; qrAlt: string }>(`(() => {
        const link = document.querySelector('[data-testid="input-${variant}-hype-card-share-link"]');
        const qr = document.querySelector('[data-testid="img-${variant}-hype-card-qr"]');
        return {
          link: link instanceof HTMLInputElement ? link.value : '',
          qrSrc: qr instanceof HTMLImageElement ? qr.src : '',
          qrAlt: qr instanceof HTMLImageElement ? qr.alt : '',
        };
      })()`);
      assert.deepEqual(revealed, {
        link: expectedUrl,
        qrSrc: revealed.qrSrc,
        qrAlt: "QR code for Alexandria Montgomery-Williams's public Player Showcase",
      });
      assert.match(revealed.qrSrc, /^data:image\/png;base64,/);
      await evaluate(`Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { window.__copiedHypeCardUrl = text; } },
      });
      document.querySelector('[data-testid="button-${variant}-copy-hype-card-link"]').click()`);
      await wait(`document.querySelector('[data-testid="text-${variant}-hype-card-copy-status"]')?.textContent === 'Link copied.'`);
      assert.equal(await evaluate<string>('window.__copiedHypeCardUrl'), expectedUrl);
      await evaluate(`(() => {
        window.__hypeClipboardFallback = { calls: 0, selected: false, command: '', succeeds: true };
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async () => { throw new Error('Clipboard permission denied'); } },
        });
        Object.defineProperty(document, 'execCommand', {
          configurable: true,
          value: (command) => {
            const input = document.querySelector('[data-testid="input-${variant}-hype-card-share-link"]');
            window.__hypeClipboardFallback.calls += 1;
            window.__hypeClipboardFallback.command = command;
            window.__hypeClipboardFallback.selected = input instanceof HTMLInputElement
              && input.selectionStart === 0
              && input.selectionEnd === input.value.length;
            return command === 'copy' && window.__hypeClipboardFallback.selected
              && window.__hypeClipboardFallback.succeeds;
          },
        });
        document.querySelector('[data-testid="button-${variant}-copy-hype-card-link"]').click();
      })()`);
      await wait(`document.querySelector('[data-testid="text-${variant}-hype-card-copy-status"]')?.textContent === 'Link copied.'`);
      assert.deepEqual(await evaluate('window.__hypeClipboardFallback'), {
        calls: 1,
        selected: true,
        command: 'copy',
        succeeds: true,
      }, 'a denied Clipboard API write should fall back to copying the selected link');
      await evaluate(`(() => {
        window.__hypeClipboardFallback.calls = 0;
        window.__hypeClipboardFallback.succeeds = false;
        document.querySelector('[data-testid="button-${variant}-copy-hype-card-link"]').click();
      })()`);
      await wait(`document.querySelector('[data-testid="text-${variant}-hype-card-copy-status"]')?.textContent === 'Could not copy automatically. The link is selected so you can copy it.'`);
      assert.deepEqual(await evaluate('window.__hypeClipboardFallback'), {
        calls: 1,
        selected: true,
        command: 'copy',
        succeeds: false,
      }, 'if the legacy copy command also fails, the link should remain selected for manual copying');
      await connection.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      }, page!.sessionId);
      await connection.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      }, page!.sessionId);
      await wait(`!document.querySelector('[data-testid="dialog-${variant}-hype-card-share"]')`);
      assert.equal(
        await evaluate(`document.activeElement?.getAttribute('data-testid')`),
        `button-${variant}-hype-card-share`,
        `${variant} share dialog returns focus to its button`,
      );
    };
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
    if (shareOnly) {
      await wait(`typeof window.__setHypePreviewState === 'function'`);
      await evaluate(`window.__setHypePreviewState('velocity')`);
    }
    if (!shareOnly) await wait(`document.body?.textContent.includes('Loading your card')`);
    const initialPreviewStates = await evaluate<Array<{ testId: string | null; text: string }>>(`Array.from(document.querySelectorAll('.supporter-hype-preview')).map((preview) => ({
      testId: preview.getAttribute('data-testid'),
      text: preview.textContent || '',
    }))`);
    if (!shareOnly) assert.ok(
      initialPreviewStates.some((preview) => preview.testId === 'mobile-saved-hype-card' && preview.text.includes('Loading')),
      `the mobile card preview should expose its loading state: ${JSON.stringify(initialPreviewStates)}`,
    );
    await wait(`Boolean(document.querySelector('[data-testid="link-mobile-hype-preview"]'))`);
    await verifyHypeCardShare('mobile');
    if (shareOnly) {
      await connection.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, page.sessionId);
      await verifyHypeCardShare('desktop');
      return;
    }
    for (const design of ['velocity', 'wave', 'glass', 'varsity', 'spotlight', 'pixel-edge']) {
      await evaluate(`window.__setHypePreviewState('${design}')`);
      await wait(`document.querySelector('.supporter-hype-preview__surface')?.dataset.design === '${design}'`);
      for (const width of [320, 360, 390, 430]) {
        await connection.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
        const layout = await evaluate<Record<string, boolean>>(`(() => {
          const row = document.querySelector('[data-testid="mobile-calendar-hype-row"]');
          const event = row.children[0], slot = row.children[1];
          const a = event.getBoundingClientRect(), b = slot.getBoundingClientRect();
          const card = slot.querySelector('.supporter-hype-preview__surface'), c = card.getBoundingClientRect();
          const eventCard = event.querySelector('[data-testid="card-mobile-featured-event"]').getBoundingClientRect();
          const board = event.querySelector('[data-testid="upcoming-event-badge"]');
          const ticket = board?.querySelector('.supporter-event-guidance-board__ticket');
          const ticketRect = ticket?.getBoundingClientRect();
          const title = board?.querySelector('.supporter-event-guidance-board__title');
          const date = board?.querySelector('.supporter-event-guidance-board__date strong');
          const action = board?.querySelector('[data-testid="button-guidance-event-card"]');
          const boardRect = board?.getBoundingClientRect();
          const actionRect = action?.getBoundingClientRect();
          const textElements = [title, date].filter((element) => element instanceof HTMLElement);
          const textFits = textElements.every((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0
              && rect.left >= eventCard.left && rect.right <= eventCard.right
              && rect.top >= eventCard.top && rect.bottom <= eventCard.bottom
              && element.scrollHeight <= element.clientHeight + 1;
          });
          const actionFits = action instanceof HTMLElement && actionRect
            && actionRect.width > 0 && actionRect.height >= 44
            && actionRect.left >= eventCard.left && actionRect.right <= eventCard.right
            && actionRect.top >= eventCard.top && actionRect.bottom <= eventCard.bottom
            && action.textContent?.includes('Get ready');
          const cardWidthMatches = Math.abs(eventCard.width-c.width)<1;
          const cardHeightMatches = Math.abs(eventCard.height-c.height)<1;
          const cardTopMatches = Math.abs(eventCard.top-c.top)<1;
          const graphic = event.querySelector('[data-testid="img-upcoming-event-card-mobile"]');
          const graphicRect = graphic?.getBoundingClientRect();
          const navLink = slot.querySelector('[data-testid="link-mobile-hype-preview"]');
          const nav = slot.querySelector('[data-testid="saved-card-navigation"]');
          const athleteLink = document.querySelector('[data-testid="btn-mobile-athlete-switcher"]');
          const profileIcon = document.querySelector('[data-testid="btn-mobile-open-profile"]');
          const quickHypeLink = document.querySelector('[data-testid="link-mobile-independent-hype"]');
          return { equal: Math.abs(a.width-b.width)<1, paired: Math.abs(a.top-b.top)<1 && a.right<=b.left,
            cardWidthMatches, cardHeightMatches, cardTopMatches,
            cardsAligned: cardWidthMatches && cardHeightMatches && cardTopMatches,
            messageBoardFits: board instanceof HTMLElement && !!boardRect
              && boardRect.left >= eventCard.left && boardRect.right <= eventCard.right
              && boardRect.top >= eventCard.top && boardRect.bottom <= eventCard.bottom,
            messageTextFits: textFits,
            messageActionFits: Boolean(actionFits),
            badgeExtended: Boolean(ticketRect && actionRect && ticketRect.height > actionRect.height * 2),
            graphicFits: !graphic || Boolean(graphicRect && graphicRect.left>=eventCard.left && graphicRect.right<=eventCard.right
              && graphicRect.top>=eventCard.top && graphicRect.bottom<=eventCard.bottom),
            graphicKeepsRatio: !graphic || (graphic instanceof HTMLImageElement && graphic.naturalWidth>0
              && graphicRect?.height>0 && Math.abs(graphicRect.width/graphicRect.height-graphic.naturalWidth/graphic.naturalHeight)<.01),
            eventActionAvailable: action instanceof HTMLButtonElement,
            ratio: Math.abs(c.width/c.height-3/4)<.01,
            noOverflow: document.documentElement.scrollWidth<=innerWidth,
            athleteCardRemoved: athleteLink === null,
            profileAccessRemainsInHeader: profileIcon instanceof HTMLElement
              && profileIcon.getClientRects().length > 0,
            hypeQuickLinkRemoved: quickHypeLink === null,
            cardPreviewStillLinks: navLink instanceof HTMLAnchorElement && Boolean(navLink.getAttribute('href')),
            noLandingCardControls: nav === null,
            noCardTextLabels: !event.querySelector('.supporter-hype-preview__label')
              && !slot.querySelector('.supporter-hype-preview__label')
              && !slot.querySelector('.supporter-hype-preview__open'),
            nativeArt: !!card.querySelector('svg[data-frame-template]'),
            spillover: getComputedStyle(card).overflow==='hidden',
            noInteractiveControls: !slot.querySelector('[data-testid="saved-card-navigation"] button'),
            preserved: !!document.querySelector('[data-testid="supporter-game-record-mobile"]') && !document.querySelector('.supporter-game-on-summary--mobile .supporter-game-on-summary__replies'),
            desktopInboxRetained: !!document.querySelector('.supporter-game-on-summary--desktop .supporter-game-on-summary__replies') };
        })()`);
        const cardGeometry = await evaluate<{ event: { width: number; height: number; top: number }; hype: { width: number; height: number; top: number } }>(`(() => {
          const event = document.querySelector('[data-testid="card-mobile-featured-event"]').getBoundingClientRect();
          const hype = document.querySelector('.supporter-hype-preview__surface').getBoundingClientRect();
          return {
            event: { width: event.width, height: event.height, top: event.top },
            hype: { width: hype.width, height: hype.height, top: hype.top },
          };
        })()`);
        const messageTextMetrics = await evaluate<Array<{ selector: string; text: string; height: number; clientHeight: number; scrollHeight: number }>>(`Array.from(document.querySelectorAll(
          '[data-testid="upcoming-event-badge"] .supporter-event-guidance-board__title, [data-testid="upcoming-event-badge"] .supporter-event-guidance-board__date strong',
        )).map((element) => ({
          selector: element.className,
          text: element.textContent?.trim() || '',
          height: element.getBoundingClientRect().height,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }))`);
        assert.deepEqual(layout, { equal: true, paired: true, cardWidthMatches: true, cardHeightMatches: true,
          cardTopMatches: true, cardsAligned: true, messageBoardFits: true, messageTextFits: true,
          messageActionFits: true, badgeExtended: true, graphicFits: true, graphicKeepsRatio: true,
          eventActionAvailable: true, ratio: true, noOverflow: true,
          athleteCardRemoved: true, profileAccessRemainsInHeader: true,
          hypeQuickLinkRemoved: true, cardPreviewStillLinks: true,
          noLandingCardControls: true,
          noCardTextLabels: true,
          nativeArt: true, spillover: true, noInteractiveControls: true, preserved: true, desktopInboxRetained: true },
        `${design} at ${width}px: ${JSON.stringify({ cardGeometry, messageTextMetrics })}`);
        if (design === 'velocity') {
          await evaluate(`(() => {
            const button = document.querySelector('[data-testid="button-guidance-event-card"]');
            button?.focus();
          })()`);
          await connection.send('Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8,
          }, page.sessionId);
          await connection.send('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8,
          }, page.sessionId);
          await connection.send('Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9,
          }, page.sessionId);
          await connection.send('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9,
          }, page.sessionId);
          const focusVisibility = await evaluate<{ focused: boolean; visibleRing: boolean }>(`(() => {
            const button = document.querySelector('[data-testid="button-guidance-event-card"]');
            const style = button && getComputedStyle(button);
            const rect = button?.getBoundingClientRect();
            const parent = button?.closest('[data-testid="upcoming-event-badge"]')?.getBoundingClientRect();
            const offset = style ? Number.parseFloat(style.outlineOffset) : 0;
            const width = style ? Number.parseFloat(style.outlineWidth) : 0;
            return {
              focused: document.activeElement === button,
              visibleRing: Boolean(button?.matches(':focus-visible') && style?.outlineStyle !== 'none'
                && width >= 2 && rect && parent
                && rect.top - offset - width >= parent.top - 1
                && rect.bottom + offset + width <= parent.bottom + 1
                && rect.left - offset - width >= parent.left - 1
                && rect.right + offset + width <= parent.right + 1),
            };
          })()`);
          assert.deepEqual(focusVisibility, { focused: true, visibleRing: true },
            `keyboard focus remains visible on the Event Card action at ${width}px`);
        }
        if (design === 'spotlight' && width === 390) {
          const screenshot = await connection.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, page.sessionId);
          await writeFile('/tmp/supporter-hype-pair-390.png', Buffer.from(screenshot.data, 'base64'));
        }
      }
    }
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await wait(`document.querySelector('[data-testid="desktop-saved-hype-card"] .supporter-hype-preview__surface')?.dataset.design==='pixel-edge'`);
    assert.deepEqual(await evaluate(`(() => {
      const desktop = document.querySelector('.supporter-dashboard-desktop-shell');
      const mobile = document.querySelector('.supporter-dashboard-mobile-shell');
      const preview = desktop?.querySelector('[data-testid="desktop-saved-hype-card"]');
      const surface = preview?.querySelector('.supporter-hype-preview__surface');
      const link = preview?.querySelector('[data-testid="link-desktop-hype-preview"]');
      const rect = surface?.getBoundingClientRect();
      return {
        previewVisible: preview instanceof HTMLElement && preview.getClientRects().length > 0,
        linkPath: link instanceof HTMLAnchorElement ? new URL(link.href).pathname : '',
        cardRatio: Boolean(rect && Math.abs(rect.width / rect.height - 3 / 4) < .01),
        mobileShellHidden: mobile instanceof HTMLElement && getComputedStyle(mobile).display === 'none',
      };
    })()`), {
      previewVisible: true,
      linkPath: '/fan/saved-athlete-token',
      cardRatio: true,
      mobileShellHidden: true,
    });
    await verifyHypeCardShare('desktop');
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);

    await evaluate(`window.__setHypePreviewState('mismatch')`);
    await wait(`document.querySelector('[data-testid="mobile-saved-hype-card"]')?.textContent.includes('different athlete details')`);
    await wait(`Boolean(document.querySelector('[data-testid="button-reconnect-hype-card-saved-athlete-token"]'))`);
    assert.equal(await evaluate(`!!document.querySelector('[data-testid="mobile-saved-hype-card"] svg image')`), false,
      'mismatched artwork stays hidden until the owner chooses to reconnect it');
    await evaluate(`document.querySelector('[data-testid="button-reconnect-hype-card-saved-athlete-token"]').click()`);
    await wait(`Boolean(document.querySelector('[data-testid="mobile-hype-card-reconnect-review"]'))`);
    assert.deepEqual(await evaluate(`({
      showsSavedCard: document.querySelector('[data-testid="mobile-hype-card-reconnect-review"]')?.textContent.includes('Another athlete · Previous Comets'),
      showsCurrentProfile: document.querySelector('[data-testid="mobile-hype-card-reconnect-review"]')?.textContent.includes('Alexandria Montgomery-Williams · The Northside Comets Select Travel Club'),
      showsSavedArtwork: Boolean(document.querySelector('[data-testid="reconnect-card-artwork"]')),
      callsBeforeDecision: window.__hypeReconnectCalls
    })`), {
      showsSavedCard: true,
      showsCurrentProfile: true,
      showsSavedArtwork: true,
      callsBeforeDecision: 0,
    });
    await evaluate(`document.querySelector('[data-testid="mobile-button-cancel-hype-card-reconnect"]').click()`);
    await wait(`!document.querySelector('[data-testid="mobile-hype-card-reconnect-review"]')`);
    assert.equal(await evaluate(`window.__hypeReconnectCalls`), 0, 'canceling the review does not update the saved card');

    await evaluate(`document.querySelector('[data-testid="button-reconnect-hype-card-saved-athlete-token"]').click()`);
    await wait(`Boolean(document.querySelector('[data-testid="mobile-hype-card-reconnect-review"]'))`);
    await evaluate(`document.querySelector('[data-testid="mobile-button-confirm-hype-card-reconnect"]').click()`);
    await wait(`Boolean(document.querySelector('[data-testid="link-mobile-hype-preview"]'))`);
    assert.deepEqual(await evaluate(`({
      calls: window.__hypeReconnectCalls,
      updatePath: window.__hypeReconnectPath,
      athleteName: window.__hypeReconnectBody?.athleteName,
      teamName: window.__hypeReconnectBody?.teamName,
      retainedVisibility: window.__hypeReconnectBody?.showHypeCard === true,
      artworkUntouched: !('cardAppearance' in (window.__hypeReconnectBody || {})),
      showcasePath: new URL(document.querySelector('[data-testid="link-mobile-hype-preview"]').href).pathname
    })`), {
      calls: 1,
      updatePath: '/api/athlete-invites/saved-athlete-token',
      athleteName: 'Alexandria Montgomery-Williams',
      teamName: 'The Northside Comets Select Travel Club',
      retainedVisibility: true,
      artworkUntouched: true,
      showcasePath: '/studio/player-showcase',
    });

    for (const state of ['empty', 'paused', 'hidden', 'error']) {
      await evaluate(`window.__setHypePreviewState('${state}')`);
      await wait(`!document.querySelector('[data-testid="link-mobile-hype-preview"]')`);
      await wait(`document.querySelector('[data-testid="mobile-saved-hype-card"]')?.textContent.includes('${state === 'error' ? 'couldn’t load' : state === 'paused' ? 'paused' : state === 'hidden' ? 'hidden' : 'belongs here'}')`);
      assert.equal(await evaluate(`!!document.querySelector('[data-testid="mobile-saved-hype-card"] svg image')`), false);
      assert.equal(
        await evaluate(`!!document.querySelector('[data-testid="button-mobile-hype-card-share"]')`),
        false,
        `${state} cards do not offer a public share link`,
      );
    }
    await evaluate(`window.__hypePreviewState='glass'; document.querySelector('[data-testid="mobile-saved-hype-card"] button').click()`);
    await wait(`document.querySelector('.supporter-hype-preview__surface')?.dataset.design==='glass'`);
    // Real return-to-Hub remount must fetch the saved update, not rely on a local invalidation.
    await evaluate(`window.__navigateSupporterDashboardAwayForFilterTest('Card editor'); window.__hypePreviewState='spotlight'`);
    await wait(`Boolean(document.querySelector('[data-testid="button-return-to-supporter-dashboard"]'))`);
    await evaluate(`document.querySelector('[data-testid="button-return-to-supporter-dashboard"]').click()`);
    await wait(`document.querySelector('.supporter-hype-preview__surface')?.dataset.design==='spotlight'`);
    await evaluate(`window.__setHypePreviewState('pixel-edge')`);
    await connection.send('Page.navigate', { url: fixtureUrl }, page.sessionId);
    await wait(`document.querySelector('.supporter-hype-preview__surface')?.dataset.design==='pixel-edge'`);
    await evaluate(`window.__setSupporterDashboardTrackerUserId('other-owner')`);
    await wait(`!document.querySelector('[data-testid="link-mobile-hype-preview"]')`);
    await evaluate(`window.__setSupporterDashboardTrackerUserId('hype-owner')`);
    await wait(`Boolean(document.querySelector('[data-testid="link-mobile-hype-preview"]'))`);
     await connection.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
     await connection.send('Emulation.setTouchEmulationEnabled', { enabled: true }, page.sessionId);
     const tap = async (selector: string) => {
       const point = await evaluate<{ x: number; y: number }>(`(() => {
         const target = document.querySelector('${selector}');
         target.scrollIntoView({ block: 'center' });
         const rect = target.getBoundingClientRect();
         return { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
       })()`);
       await connection!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] }, page!.sessionId);
       await connection!.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, page!.sessionId);
     };
      assert.equal(await evaluate(`(() => {
        const board = document.querySelector('[data-testid="upcoming-event-badge"]');
        const action = board?.querySelector('[data-testid="button-guidance-event-card"]');
        return board instanceof HTMLElement
          && board.querySelector('.supporter-event-guidance-board__title')
          && board.querySelector('.supporter-event-guidance-board__date')
           && !board.querySelector('.supporter-event-guidance-board__prep-label, .supporter-event-guidance-board__prep-copy')
          && action instanceof HTMLButtonElement
          && action.closest('a') === null;
      })()`), true, 'the upcoming Event Card keeps its details and native open action without the prep copy');
    await evaluate(`window.__setSupporterDashboardEvents([])`);
    await wait(`document.querySelector('[data-testid="upcoming-calendar-events-empty"]')?.textContent.includes('No upcoming games or practices')`);
    assert.equal(await evaluate(`!!document.querySelector('[data-testid="link-mobile-hype-preview"]')`), true);
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    assert.equal(await evaluate(`!!document.querySelector('[data-testid="desktop-game-on-summary"] [data-testid="mobile-calendar-hype-row"]')`), false);
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, page.sessionId);
    await evaluate(`document.querySelector('[data-testid="link-mobile-hype-preview"]').focus()`);
    assert.equal(await evaluate(`document.activeElement?.getAttribute('data-testid')`), 'link-mobile-hype-preview');
    await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, page.sessionId);
    await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, page.sessionId);
     await wait(`location.pathname==='/studio/player-showcase'`);
     await connection.send('Page.navigate', { url: fixtureUrl }, page.sessionId);
     await wait(`Boolean(document.querySelector('[data-testid="link-mobile-hype-preview"]'))`);
     await tap('[data-testid="link-mobile-hype-preview"]');
     await wait(`location.pathname==='/studio/player-showcase'`);
  } finally {
    if (connection && page) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
    connection?.close();
    if (browser && browserMonitor) { if (!browserMonitor.hasExited()) browser.kill('SIGTERM'); await browserMonitor.waitForExit(); }
    if (devServer && devMonitor) { if (!devMonitor.hasExited()) devServer.kill('SIGTERM'); await devMonitor.waitForExit(); }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    release();
  }
});

}

test('mobile saved HYPE Card follows authenticated real owner API saves, reloads and isolation', { concurrency: false }, async () => {
  const release = await acquireBrowserTestLock();
  try {
    await checkSavedHypeCardOwnerApi(appDirectory, chromiumPath);
  } finally {
    release();
  }
});

test('reconnecting a saved HYPE Card requires review and confirmation', { concurrency: false }, async () => {
  const release = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-hype-reconnect');
  let devServer: ChildProcess | undefined, browser: ChildProcess | undefined;
  let devMonitor: ProcessMonitor | undefined, browserMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;
  try {
    const probe = createServer();
    const { port } = await listen(probe);
    await new Promise<void>((done) => probe.close(() => done()));
    await writeFile(fixtures.harnessPath, harnessSource());
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)));
    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(port),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devMonitor = monitorProcess(devServer, 'HYPE reconnect fixture Vite');
    await waitForUrl(`http://127.0.0.1:${port}/`, 20_000, devMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((done) => debugProbe.close(() => done()));
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-hype-reconnect-'));
    browser = spawn(chromiumPath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${tempDirectory}`, 'about:blank'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'HYPE reconnect fixture Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json());
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    const fixtureUrl = `http://127.0.0.1:${port}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?mobile-hype-pair`;
    page = await openPage(connection, fixtureUrl);
    const evaluate = <T,>(expression: string) => connection!.evaluate<T>(expression, page!.sessionId);
    const wait = (expression: string) => waitFor(connection!, page!.sessionId, expression, Boolean);

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await wait(`Boolean(document.querySelector('[data-testid="link-mobile-hype-preview"]'))`);
    await evaluate(`window.__setHypePreviewState('mismatch')`);
    await wait(`document.querySelector('[data-testid="mobile-saved-hype-card"]')?.textContent.includes('different athlete details')`);
    await evaluate(`document.querySelector('[data-testid="button-reconnect-hype-card-saved-athlete-token"]').click()`);
    await wait(`Boolean(document.querySelector('[data-testid="mobile-hype-card-reconnect-review"]'))`);

    assert.deepEqual(await evaluate(`({
      savedIdentity: document.querySelector('[data-testid="mobile-hype-card-reconnect-review"]')?.textContent.includes('Another athlete · Previous Comets'),
      targetIdentity: document.querySelector('[data-testid="mobile-hype-card-reconnect-review"]')?.textContent.includes('Alexandria Montgomery-Williams · The Northside Comets Select Travel Club'),
      savedArtworkReviewed: Boolean(document.querySelector('[data-testid="reconnect-card-artwork"]')),
      updatesBeforeConfirmation: window.__hypeReconnectCalls,
    })`), {
      savedIdentity: true,
      targetIdentity: true,
      savedArtworkReviewed: true,
      updatesBeforeConfirmation: 0,
    });

    await evaluate(`document.querySelector('[data-testid="mobile-button-cancel-hype-card-reconnect"]').click()`);
    await wait(`!Boolean(document.querySelector('[data-testid="mobile-hype-card-reconnect-review"]'))`);
    assert.equal(await evaluate('window.__hypeReconnectCalls'), 0, 'cancel leaves the invite untouched');

    await evaluate(`document.querySelector('[data-testid="button-reconnect-hype-card-saved-athlete-token"]').click()`);
    await wait(`Boolean(document.querySelector('[data-testid="mobile-hype-card-reconnect-review"]'))`);
    await evaluate(`document.querySelector('[data-testid="mobile-button-confirm-hype-card-reconnect"]').click()`);
    await wait(`Boolean(document.querySelector('[data-testid="link-mobile-hype-preview"]'))`);
    await wait(`!Boolean(document.querySelector('[data-testid="mobile-hype-card-reconnect-review"]'))`);
    assert.deepEqual(await evaluate(`({
      updates: window.__hypeReconnectCalls,
      updatePath: window.__hypeReconnectPath,
      athleteName: window.__hypeReconnectBody?.athleteName,
      teamName: window.__hypeReconnectBody?.teamName,
      artworkUntouched: !('cardAppearance' in (window.__hypeReconnectBody || {})),
      showcasePath: new URL(document.querySelector('[data-testid="link-mobile-hype-preview"]').href).pathname,
    })`), {
      updates: 1,
      updatePath: '/api/athlete-invites/saved-athlete-token',
      athleteName: 'Alexandria Montgomery-Williams',
      teamName: 'The Northside Comets Select Travel Club',
      artworkUntouched: true,
      showcasePath: '/studio/player-showcase',
    });
  } finally {
    if (connection && page) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devMonitor) {
      if (!devMonitor.hasExited()) devServer.kill('SIGTERM');
      await devMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    release();
  }
});

test('paired mobile Hub cards stay readable and open in Linux WebKit (not Apple Safari)', { concurrency: false }, async () => {
  const release = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-hub-webkit');
  const viewportPath = fixtures.htmlPath.replace('.html', '-viewport.html');
  try {
    await writeFile(fixtures.harnessPath, harnessSource());
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)));
    await writeFile(viewportPath, `<!doctype html><html><body style="margin:0">
      <iframe id="hub-viewport" style="border:0;width:390px;height:1600px"
        src="/${fixtures.htmlPath.slice(appDirectory.length + 1)}?mobile-hype-pair&webkit-loading&viewer=hype-owner"></iframe>
      </body></html>`);
    await checkPairedHubInWebKit(appDirectory, viewportPath.slice(appDirectory.length + 1));
  } finally {
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    await rm(viewportPath, { force: true });
    release();
  }
});

function harnessSource() {
  return `
import { createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, useLocation } from 'wouter';
import { ClerkProvider } from '@clerk/react';
import { ChecklistPage, ScheduleEditor } from './src/App';
import { MeetingCapture } from './src/features/meeting-capture';
import { NotificationSettings } from './src/features/notification-settings';
import { SupporterDashboardView, SupporterProfileView } from './src/features/supporter-dashboard';
import { useCachedSupporterPhoto } from './src/features/supporter-photo-cache';
import { LiveTrackerGame, StatTrackerPage } from './src/features/stat-tracker-page';
import { getSportRule } from './src/features/stat-tracker';
import { buildBrandedPremiumHypeCardArtwork } from './src/features/premium-hype-card-brand';
import { preparePremiumCardPngExport } from './src/features/premium-hype-card-artwork';
import { defaultCardAppearance } from './src/features/hype-card-appearance';
import './src/index.css';

const testHypeCardPhotoUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iODAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iODAiIGZpbGw9IiNGOTczMTYiLz48L3N2Zz4=';

window.__premiumNameExport = (design, layer = 'all') => {
  const appearance = { ...defaultCardAppearance(design), athleteScale: 1.45, athleteX: .25, athleteY: -.18 };
  return preparePremiumCardPngExport(buildBrandedPremiumHypeCardArtwork({
    athleteName: 'Alexandria Montgomery-Williams', teamName: 'The Northside Comets Select Travel Club',
    appearance, cutoutUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="770" height="1020"><rect width="770" height="1020" fill="red"/></svg>'),
  }, layer, 'name-export'), appearance, { width: 770, height: 1020 });
};

const profile = {
  displayName: 'Jamie Fan',
  teamName: 'The Northside Comets Select Travel Club',
  athleteName: 'Alexandria Montgomery-Williams',
  jerseyNumber: '24',
  position: 'Guard',
  relationship: 'Parent',
  accessMode: 'full',
  sport: 'basketball',
};

let dashboardEvents = [{
  id: 'game-1',
  type: 'game',
  date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  time: '18:30',
  location: 'Northside Gym',
  opponent: 'Rivals',
}];

const navigate = (path) => {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

function ProfilePropagationHarness() {
  const profileStorageKey = 'pixlsports-supporter-profile';
  const defaultProfile = {
    displayName: 'Jamie Fan',
    teamName: 'Northside Comets',
    athleteName: '',
    jerseyNumber: '',
    position: '',
    relationship: 'Parent',
    accessMode: 'full',
    sport: 'basketball',
  };
  const [route, setRoute] = useState(() => (
    new URLSearchParams(window.location.search).get('route') === 'dashboard' ? 'dashboard' : 'profile'
  ));
  const [profile, setProfile] = useState(() => {
    try {
      const stored = window.localStorage.getItem(profileStorageKey);
      return stored ? { ...defaultProfile, ...JSON.parse(stored) } : defaultProfile;
    } catch {
      return defaultProfile;
    }
  });
  const [draft, setDraft] = useState(profile);
  const rule = getSportRule('basketball');
  const currentGame = {
    id: 'live-game',
    sport: 'basketball',
    date: '2026-09-20',
    opponent: 'Rivals',
    opponentScore: 2,
    score: 0,
    stats: Object.fromEntries(rule.stats.map((stat) => [stat.id, 0])),
    events: [],
    status: 'live',
  };

  const openProfile = () => {
    setDraft(profile);
    setRoute('profile');
  };
  const fanToolNav = createElement('nav', { 'data-testid': 'fan-tool-nav', className: 'flex gap-3 p-4' },
    createElement('button', { type: 'button', 'data-testid': 'button-test-open-dashboard', onClick: () => setRoute('dashboard') }, 'Dashboard'),
    createElement('button', { type: 'button', 'data-testid': 'button-test-open-stat-tracker', onClick: () => setRoute('tracker') }, 'Stat Tracker'),
    createElement('button', { type: 'button', 'data-testid': 'button-test-open-athlete-fan-card', onClick: () => setRoute('fan-card') }, 'HYPE Card'),
    createElement('button', { type: 'button', 'data-testid': 'button-test-edit-profile', onClick: openProfile }, 'Profile'),
  );

  if (route === 'profile') {
    return createElement('main', null,
      createElement(SupporterProfileView, {
        profile: draft,
        userId: 'browser-test-profile-user',
        saving: false,
        error: '',
        onChange: (field, value) => setDraft((current) => ({ ...current, [field]: value })),
        onSave: () => {
          setProfile(draft);
          window.localStorage.setItem(profileStorageKey, JSON.stringify(draft));
          const search = new URLSearchParams(window.location.search);
          search.set('route', 'dashboard');
          window.history.replaceState({}, '', window.location.pathname + '?' + search.toString());
          setRoute('dashboard');
        },
        onCancel: () => {
          const search = new URLSearchParams(window.location.search);
          search.set('route', 'dashboard');
          window.history.replaceState({}, '', window.location.pathname + '?' + search.toString());
          setRoute('dashboard');
        },
        initialSection: 'athlete',
      }),
    );
  }

  if (route === 'tracker') {
    return createElement('main', null,
      fanToolNav,
      createElement(LiveTrackerGame, {
        currentGame,
        rule,
        athleteName: profile.athleteName,
        athleteImageUrl: testHypeCardPhotoUrl,
        teamName: profile.teamName,
        displayStats: rule.stats.slice(0, 6),
        showAllStats: false,
        saving: false,
        captureNotice: '',
        onCapture: () => {},
        onGameChange: () => {},
        onToggleShowAllStats: () => {},
        onLeaveGame: () => setRoute('dashboard'),
        onEndGame: () => {},
      }),
    );
  }

  if (route === 'fan-card') {
    return createElement('main', null,
      fanToolNav,
      createElement('a', { 'data-testid': 'link-athlete-fan-card-manager', href: '/studio/athlete-page' }, 'Manage HYPE Card'),
    );
  }

  return createElement('main', null,
    fanToolNav,
    createElement(SupporterDashboardView, {
      profile,
      events: [],
      nextGameIsUpcoming: false,
      scheduleSource: null,
      connectionLabel: '',
      onOpenStatTracker: () => setRoute('tracker'),
      onOpenChecklist: () => {},
    }),
  );
}

function CachedPhotoStartupHarness() {
  const photo = useCachedSupporterPhoto('user-startup', true);
  return createElement('div', null,
    createElement('output', { 'data-testid': 'cached-photo-url' }, photo.imageUrl || 'none'),
    createElement(SupporterDashboardView, {
      profile,
      userId: 'user-startup',
      events: [],
      nextGameIsUpcoming: false,
      scheduleSource: null,
      connectionLabel: '',
      onOpenStatTracker: () => {},
      onOpenChecklist: () => {},
    }),
  );
}

function ChecklistContextHarness() {
  const [location] = useLocation();
  const [, setRouteVersion] = useState(0);
  useEffect(() => {
    const handlePopState = () => setRouteVersion((version) => version + 1);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const scenario = new URLSearchParams(window.location.search).get('scenario') || 'practice';
  const scenarioEvents = {
    practice: [{
      id: 'practice-1',
      type: 'practice',
      date: '2026-09-23',
      time: '18:30',
      location: 'Northside Gym',
      notes: 'Bring water',
    }],
    meeting: [{
      id: 'meeting-1',
      type: 'meeting',
      date: '2026-09-24',
      time: '17:00',
      location: 'Northside Clubhouse',
      notes: 'Bring the agenda',
    }],
    game: [{
      id: 'game-1',
      type: 'game',
      date: '2026-09-25',
      time: '18:30',
      location: 'Eastside Gym',
      opponent: 'Rivals',
      status: 'upcoming',
    }],
    mixed: [{
      id: 'game-1',
      type: 'game',
      date: '2026-09-23',
      time: '18:30',
      location: 'Eastside Gym',
      opponent: 'Rivals',
      status: 'upcoming',
    }, {
      id: 'practice-1',
      type: 'practice',
      date: '2026-09-24',
      time: '18:30',
      location: 'Northside Gym',
      notes: 'Bring water',
    }, {
      id: 'meeting-1',
      type: 'meeting',
      date: '2026-09-25',
      time: '17:00',
      location: 'Northside Clubhouse',
      notes: 'Bring the agenda',
    }],
  };
  const events = scenarioEvents[scenario] || scenarioEvents.practice;

  if (location === '/studio/checklist' || new URLSearchParams(window.location.search).get('route') === 'checklist') {
    return createElement('div', { 'data-testid': 'checklist-context-harness' }, createElement(ChecklistPage));
  }

  return createElement('div', { 'data-testid': 'checklist-context-harness' },
    createElement(SupporterDashboardView, {
      profile,
      events,
      nextGameIsUpcoming: true,
      scheduleSource: 'custom',
      connectionLabel: 'Northside · 2026',
      onOpenProfile: () => {},
      onOpenStatTracker: () => {},
      onOpenChecklist: () => navigate('/studio/checklist'),
    }),
  );
}

function WorkspaceJourneyHarness() {
  const [location] = useLocation();
  const route = new URLSearchParams(window.location.search).get('route');
  const defaultEvents = [{
    id: 'game-default', type: 'game', status: 'upcoming',
    date: '2026-10-12', time: '18:30', location: 'Main Gym', opponent: 'Falcons',
  }, {
    id: 'game-selected', type: 'game', status: 'upcoming',
    date: '2026-10-13', time: '19:00', location: 'Away Gym', opponent: 'Tigers',
  }];
  const savedDraft = JSON.parse(window.localStorage.getItem('leaguematrix-schedule-draft') || 'null');
  const events = Array.isArray(savedDraft?.events) ? savedDraft.events : defaultEvents;
  const tool = location.startsWith('/studio/') ? location : route ? '/studio/' + route : '';
  return createElement('main', { 'data-testid': 'workspace-journey-harness' },
    createElement('button', { type: 'button', 'data-testid': 'journey-return-dashboard', onClick: () => navigate('/') }, 'Dashboard'),
    tool === '/studio/schedule' ? createElement(ScheduleEditor)
      : tool === '/studio/checklist' ? createElement(ChecklistPage)
      : tool === '/studio/stat-tracker' ? createElement(StatTrackerPage)
      : createElement(SupporterDashboardView, {
        profile,
        userId: window.location.search.includes('supporter-active-game-sync') ? 'supporter-sync-user' : undefined,
        prepUserId: 'workspace-journey',
        events,
        nextGameIsUpcoming: true,
        scheduleSource: 'custom',
        connectionLabel: 'Northside · 2026',
        onOpenProfile: () => {},
        onOpenStatTracker: () => navigate('/studio/stat-tracker'),
        onOpenChecklist: () => navigate('/studio/checklist'),
      }),
  );
}

export function mount() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const requestUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input?.url || String(input || '');
    if (
      window.location.search.includes('game-on-card-save-transition')
      && new URL(requestUrl, window.location.href).pathname === '/api/athlete-invites'
    ) {
      return Promise.resolve(new Response(JSON.stringify([{
        inviteToken: 'browser-test-fan-card',
        athleteName: 'Test Athlete',
        teamName: 'Northside',
        paused: false,
      }]), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (new URL(requestUrl, window.location.href).pathname === '/api/game-on-cards/owned') {
      return Promise.resolve(new Response('[]', {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (new URL(requestUrl, window.location.href).pathname === '/api/athlete-invites') {
      return Promise.resolve(new Response('[]', {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (new URL(requestUrl, window.location.href).pathname === '/api/projects') {
      return Promise.resolve(new Response('[]', {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (
      window.location.search.includes('supporter-active-game-sync')
      && new URL(requestUrl, window.location.href).pathname === '/api/supporter/active-game'
    ) {
      const method = String(init?.method || 'GET').toUpperCase();
      // Shared across tabs like the account endpoint; request history remains per tab.
      const selectionKey = 'supporter-active-game-sync-server-selection';
      const requestsKey = 'supporter-active-game-sync-requests';
      const requests = JSON.parse(window.sessionStorage.getItem(requestsKey) || '[]');
      const body = method === 'PUT' ? JSON.parse(String(init?.body || '{}')) : undefined;
      requests.push({ method, body: body ?? null });
      window.sessionStorage.setItem(requestsKey, JSON.stringify(requests));
      if (method === 'PUT') {
        if (
          Object.keys(body).length !== 1
          || !Object.prototype.hasOwnProperty.call(body, 'gameId')
          || !(typeof body.gameId === 'string' || body.gameId === null)
        ) {
          return Promise.resolve(new Response(JSON.stringify({ error: 'Only a game ID may be saved.' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          }));
        }
        window.localStorage.setItem(selectionKey, JSON.stringify(body.gameId));
        return Promise.resolve(new Response(JSON.stringify({ gameId: body.gameId }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      const gameId = JSON.parse(window.localStorage.getItem(selectionKey) || 'null');
      return Promise.resolve(new Response(JSON.stringify({ gameId }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (
      window.location.search.includes('supporter-game-record')
      && requestUrl.endsWith('/api/supporter/active-game')
    ) {
      return Promise.resolve(new Response(JSON.stringify({ gameId: null }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (new URL(requestUrl, window.location.href).pathname === '/api/supporter/active-game') {
      return Promise.resolve(new Response(JSON.stringify({ gameId: null }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (window.sessionStorage.getItem('workspace-journey')) {
      const url = new URL(requestUrl, window.location.href);
      if (url.pathname.startsWith('/api/')) {
        const method = (init?.method || 'GET').toUpperCase();
        const requests = JSON.parse(window.sessionStorage.getItem('workspace-journey-requests') || '[]');
        requests.push({ path: url.pathname, method, body: String(init?.body || '') });
        window.sessionStorage.setItem('workspace-journey-requests', JSON.stringify(requests));
        if (method !== 'GET') return Promise.reject(new Error('Unexpected public mutation in workspace journey'));
        const data = url.pathname === '/api/account/access' ? { accessMode: 'full', paid: false }
          : url.pathname.endsWith('/supporter-photo') ? null
          : url.pathname.includes('reply-inbox') ? { groups: [], unreadCount: 0, totalCount: 0 }
          : [];
        return Promise.resolve(new Response(JSON.stringify(data), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
    }
    if (window.location.search.includes('notification-preferences')) {
      if (requestUrl.includes('/api/notifications/subscriptions/status')) {
        const signedOut = window.localStorage.getItem('browser-test-notification-user') === 'signed-out';
        return Promise.resolve(new Response(JSON.stringify({
          owned: !signedOut,
          ownedByAnotherAccount: false,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (requestUrl.endsWith('/api/notifications/subscriptions')) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (requestUrl.endsWith('/api/notifications/config')) {
        return Promise.resolve(new Response(JSON.stringify({
          available: true,
          publicKey: 'BROWSER_TEST_PUBLIC_KEY',
          scheduledDeliveryEnabled: window.localStorage.getItem('browser-test-scheduled-delivery-enabled') === 'true',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (requestUrl.endsWith('/api/notifications/preferences')) {
        const preferencesStorageKey = 'browser-test-notification-preferences';
        const requestLogStorageKey = 'browser-test-notification-preference-requests';
        const method = String(init?.method || 'GET').toUpperCase();
        if (method === 'PATCH') {
          const body = JSON.parse(String(init?.body || '{}'));
          const requests = JSON.parse(window.localStorage.getItem(requestLogStorageKey) || '[]');
          requests.push({ method, url: new URL(requestUrl, window.location.href).pathname, body });
          window.localStorage.setItem(requestLogStorageKey, JSON.stringify(requests));
          window.localStorage.setItem(preferencesStorageKey, JSON.stringify(body));
          return Promise.resolve(new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        const preferences = JSON.parse(window.localStorage.getItem(preferencesStorageKey) || '{"oneHourBefore":true,"dayOf":false,"timezone":"UTC"}');
        return Promise.resolve(new Response(JSON.stringify(preferences), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
    }
    if (requestUrl.includes('/api/hype-card-shares/reply-inbox')) {
      return Promise.resolve(new Response(JSON.stringify({ groups: [], unreadCount: 0, totalCount: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (requestUrl.endsWith('/api/supporter-photo')) {
      return new Promise((resolve) => {
        window.setTimeout(() => {
          window.__pixlSupporterPhotoMetadataResolved = true;
          window.__pixlSupporterPhotoMetadataResolvedAt = performance.now();
          resolve(new Response(JSON.stringify({
            url: '/api/supporter-photo/image',
            contentType: 'image/png',
            size: 68,
            cropX: 50,
            cropY: 50,
            cropZoom: 100,
            updatedAt: '2026-09-23T12:00:00.000Z',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }, 1_500);
      });
    }
    return originalFetch(input, init);
  };
  let notificationUserId = null;
  if (window.location.search.includes('notification-preferences')) {
    const storedNotificationUser = window.localStorage.getItem('browser-test-notification-user');
    notificationUserId = storedNotificationUser === 'signed-out'
      ? null
      : storedNotificationUser || 'browser-test-notification-owner';
    const testSubscription = {
      endpoint: 'https://fcm.googleapis.com/wp/browser-test-notification-endpoint',
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/wp/browser-test-notification-endpoint',
        keys: { p256dh: 'BROWSER_TEST_P256DH', auth: 'BROWSER_TEST_AUTH' },
      }),
      unsubscribe: async () => true,
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => testSubscription },
        }),
      },
    });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => 'denied' } });
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.__setReplyInboxUnreadCount = (unreadCount) => {
    const query = queryClient.getQueryCache().findAll().find(({ queryKey }) =>
      queryKey.some((part) => String(part).includes('/api/hype-card-shares/reply-inbox')));
    if (!query) return false;
    queryClient.setQueryData(query.queryKey, { groups: [], unreadCount, totalCount: unreadCount });
    return true;
  };
  const root = createRoot(document.getElementById('test-root'));
  if (window.location.search.includes('supporter-active-game-sync')) {
    dashboardEvents = [{
      id: 'game-default',
      type: 'game',
      date: '2026-10-12',
      time: '18:30',
      location: 'Main Gym',
      opponent: 'Falcons',
      status: 'upcoming',
    }, {
      id: 'game-selected',
      type: 'game',
      date: '2026-10-13',
      time: '19:00',
      location: 'Away Gym',
      opponent: 'Tigers',
      status: 'upcoming',
      notes: 'PRIVATE CHECKLIST NOTES',
      checklistItems: ['PRIVATE CHECKLIST ITEM'],
    }];
    if (!window.localStorage.getItem('supporter-active-game-sync-server-selection')) {
      window.localStorage.setItem('supporter-active-game-sync-server-selection', 'null');
    }
  }
  if (window.location.search.includes('workspace-journey')) {
    window.sessionStorage.setItem('workspace-journey', 'true');
    root.render(createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(WorkspaceJourneyHarness),
      ),
    ));
    return;
  }
  if (window.location.search.includes('profile-propagation')) {
    root.render(createElement(ClerkProvider, {
      publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    },
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(ProfilePropagationHarness),
      ),
    )));
    return;
  }
  if (window.location.search.includes('cached-photo-startup')) {
    window.localStorage.setItem('pixlsports-supporter-photo:user-startup', JSON.stringify({
      url: '/api/supporter-photo/image',
      contentType: 'image/png',
      size: 68,
      cropX: 50,
      cropY: 50,
      cropZoom: 100,
      updatedAt: '2026-09-23T12:00:00.000Z',
    }));
    window.__pixlSupporterPhotoMetadataResolved = false;
    root.render(createElement(ClerkProvider, {
      publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    },
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(CachedPhotoStartupHarness),
      ),
    )));
    return;
  }
  if (window.location.search.includes('meeting-capture')) {
    root.render(createElement(ClerkProvider, {
      publishableKey: 'pk_test_ZXhhbXBsZS5jb20k',
    },
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(MeetingCapture),
      ),
    )));
    return;
  }
  if (window.location.search.includes('checklist-context')) {
    root.render(
      createElement(ClerkProvider, {
        publishableKey: 'pk_test_ZXhhbXBsZS5jb20k',
      },
      createElement(Router, null,
        createElement(QueryClientProvider, { client: queryClient },
          createElement(ChecklistContextHarness),
        ),
      )),
    );
    return;
  }
  if (window.location.search.includes('notification-preferences')) {
    root.render(createElement(QueryClientProvider, { client: queryClient },
      createElement(NotificationSettings, { userId: notificationUserId }),
    ));
    return;
  }
  const dashboardChecklistScenario = new URLSearchParams(window.location.search).get('dashboard-checklist');
  const dashboardChecklistAllItemIds = ['profile', 'shoutouts', 'hype-card', 'event-card', 'install-app'];
  const dashboardChecklistStorageKey = dashboardChecklistScenario === 'complete'
    ? 'supporter-dashboard-checklist-complete'
    : null;
  const savedDashboardChecklist = dashboardChecklistStorageKey
    ? JSON.parse(window.localStorage.getItem(dashboardChecklistStorageKey) || 'null')
    : null;
  let dashboardChecklistItemIds = Array.isArray(savedDashboardChecklist?.checkedItemIds)
    ? savedDashboardChecklist.checkedItemIds
    : dashboardChecklistScenario === 'failure'
      ? dashboardChecklistAllItemIds.slice(0, 4)
      : [];
  let dashboardChecklistDismissed = Boolean(savedDashboardChecklist?.dismissed);
  window.__dashboardChecklistSaves = [];
  window.__dashboardChecklistDismissals = [];
  let dashboardUserId = dashboardChecklistScenario
    ? 'supporter-checklist-' + dashboardChecklistScenario
    : window.location.search.includes('supporter-game-record')
    ? 'supporter-game-record-user'
    : window.location.search.includes('supporter-active-game-sync')
      ? 'supporter-sync-user'
      : window.location.search.includes('supporter-future-event-reload')
        ? 'supporter-future-event-reload-user'
      : undefined;
  if (window.location.search.includes('supporter-future-event-reload')) {
    dashboardEvents = [];
  }
  if (window.location.search.includes('mobile-hype-pair')) {
    dashboardUserId = 'hype-owner';
    window.__hypePreviewState = JSON.parse(localStorage.getItem('hype-preview-fixture') || '"loading"');
    window.__hypeRequests = 0;
    window.__hypeReconnectCalls = 0;
    window.__hypeReconnectBody = null;
    window.__hypeReconnectPath = '';
    window.__hypeReconnected = false;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      const pathname = new URL(requestUrl, location.href).pathname;
      if (pathname.startsWith('/api/athlete-invites/')) {
        window.__hypeReconnectCalls++;
        window.__hypeReconnectPath = pathname;
        window.__hypeReconnectBody = JSON.parse(String(init?.body || '{}'));
        window.__hypeReconnected = true;
        return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (pathname !== '/api/athlete-invites') return originalFetch(input, init);
      window.__hypeRequests++;
      const user = dashboardUserId;
      const initial = window.__hypePreviewState;
      if (initial === 'loading') await new Promise(resolve => {
        if (location.search.includes('webkit-loading')) window.__releaseHypeLoading = resolve;
        else setTimeout(resolve, 600);
      });
      const state = initial === 'loading' ? 'velocity' : initial;
      const headers = { 'Content-Type': 'application/json' };
      if (state === 'error') return new Response('{"error":"Unavailable"}', { status: 503, headers });
      const photo = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><circle cx="200" cy="170" r="90" fill="#eaa44a"/><path d="M60 580V350Q200 230 340 350V580" fill="#eaa44a"/></svg>');
      return new Response(JSON.stringify(state === 'empty' || user !== 'hype-owner' ? [] : [{
        inviteToken: 'saved-athlete-token',
        athleteName: state === 'mismatch' && !window.__hypeReconnected ? 'Another athlete' : profile.athleteName,
        teamName: state === 'mismatch' && !window.__hypeReconnected ? 'Previous Comets' : profile.teamName,
        seasonName: '2026', seasonEndsAt: '2030-01-01',
        sport: profile.sport, timezone: 'America/New_York', trackerProjectId: null, scheduleProjectId: null,
        showHypeCard: state !== 'hidden', showStats: true, showSchedule: true, showEvents: true,
        hypesEnabled: true, paused: state === 'paused', liveTrackerShareToken: null,
        photoUrl: photo, cutoutUrl: photo, photoRevision: 'portrait',
        cardAppearance: { design: ['velocity','wave','glass','varsity','spotlight','pixel-edge'].includes(state) ? state : 'velocity',
          lowerThirdTemplate: 'velocity',
          jerseyNumber: '24', position: 'Guard', borderColor: '#eecc77', accentColor: '#00aadd',
          accentLinked: true, removeBackground: true, athleteX: .02,
          athleteY: location.search.includes('webkit-loading') ? -.18 : -.08,
          athleteScale: location.search.includes('webkit-loading') ? 1.45 : 1.2,
          namePlateX: .02, namePlateY: .03 },
        events: [], createdAt: '2026-01-01', updatedAt: new Date().toISOString()
      }]), { status: 200, headers });
    };
    window.__setHypePreviewState = async (state) => {
      window.__hypePreviewState = state;
      localStorage.setItem('hype-preview-fixture', JSON.stringify(state));
      await queryClient.invalidateQueries({ queryKey: ['/api/athlete-invites'] });
    };
  }
  if (window.location.search.includes('game-on-card-save-transition')) {
    dashboardUserId = 'supporter-save-transition';
    window.__gameOnCardMockSaveRequests = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (typeof requestUrl === 'string') {
        const pathname = new URL(requestUrl, window.location.href).pathname;
        if (pathname.endsWith('/api/game-on-cards/owned')) {
          return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname === '/api/projects') {
          return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname.endsWith('/api/hype-card-shares/reply-inbox')) {
          return new Response(JSON.stringify({ groups: [], unreadCount: 0, totalCount: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (pathname.endsWith('/api/schedule-shares') && method === 'POST') {
          window.__gameOnCardMockSaveRequests += 1;
          return new Response(JSON.stringify({ shareToken: 'mock-game-on-card-token' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return originalFetch(input, init);
    };
  }
  const saveDashboardChecklistProgress = async (checkedItemIds) => {
    if (dashboardChecklistScenario === 'failure') throw new Error('Checklist progress could not be saved');
    dashboardChecklistItemIds = [...checkedItemIds];
    if (dashboardChecklistStorageKey) {
      window.localStorage.setItem(dashboardChecklistStorageKey, JSON.stringify({
        checkedItemIds: dashboardChecklistItemIds,
        dismissed: dashboardChecklistDismissed,
      }));
    }
    window.__dashboardChecklistSaves = [...window.__dashboardChecklistSaves, [...checkedItemIds]];
    renderDashboard();
  };
  const dismissDashboardChecklist = async (checkedItemIds) => {
    if (dashboardChecklistScenario === 'failure') throw new Error('Checklist dismissal could not be saved');
    dashboardChecklistItemIds = [...checkedItemIds];
    dashboardChecklistDismissed = true;
    if (dashboardChecklistStorageKey) {
      window.localStorage.setItem(dashboardChecklistStorageKey, JSON.stringify({
        checkedItemIds: dashboardChecklistItemIds,
        dismissed: dashboardChecklistDismissed,
      }));
    }
    window.__dashboardChecklistDismissals = [...window.__dashboardChecklistDismissals, [...checkedItemIds]];
    renderDashboard();
  };
  const renderDashboard = () => root.render(
    createElement(ClerkProvider, {
      publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    },
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(SupporterDashboardView, {
          profile,
          userId: dashboardUserId,
          showDashboardChecklist: Boolean(
            dashboardChecklistScenario
            && dashboardChecklistScenario !== 'existing'
            && !dashboardChecklistDismissed
            && dashboardChecklistItemIds.length < 5,
          ),
          dashboardChecklistCheckedItemIds: dashboardChecklistItemIds,
          onSaveDashboardChecklistProgress: dashboardChecklistScenario ? saveDashboardChecklistProgress : undefined,
          onDismissDashboardChecklist: dashboardChecklistScenario ? dismissDashboardChecklist : undefined,
          events: dashboardEvents,
          nextGameIsUpcoming: true,
          scheduleSource: 'custom',
          connectionLabel: 'Northside · 2026',
          onSaveCalendarEvent: window.location.search.includes('supporter-event-details-draft')
            ? async (savedEvent) => {
              window.__eventDetailsCalendarSaves.push(savedEvent);
              dashboardEvents = dashboardEvents.map((event) => event.id === savedEvent.id ? savedEvent : event);
              renderDashboard();
            }
            : undefined,
          onCompleteScheduledGame: async (eventId, completedAt) => {
            const scheduledGame = dashboardEvents.find((event) => event.id === eventId && event.type === 'game');
            if (!scheduledGame) throw new Error('The scheduled game is no longer available.');
            dashboardEvents = dashboardEvents.map((event) => event.id === eventId
              ? { ...event, status: 'final', completedAt }
              : event);
            renderDashboard();
          },
          onOpenStatTracker: () => navigate('/studio/stat-tracker'),
          onOpenChecklist: () => navigate('/studio/checklist'),
        }),
      ),
    )),
  );
  window.__setSupporterDashboardEvents = (nextEvents) => {
    dashboardEvents = nextEvents;
    renderDashboard();
  };
  window.__applyRemoteDashboardChecklistCompletion = () => {
    dashboardChecklistItemIds = [...dashboardChecklistAllItemIds];
    renderDashboard();
  };
  window.__getSupporterDashboardEvents = () => dashboardEvents;
  window.__navigateSupporterDashboardAwayForFilterTest = (tool) => root.render(
    createElement('main', null,
      createElement('h1', { 'data-testid': 'supporter-dashboard-away-tool' }, tool),
      createElement('button', {
        type: 'button',
        'data-testid': 'button-return-to-supporter-dashboard',
        onClick: renderDashboard,
      }, 'Return to Dashboard'),
    ),
  );
  window.__setSupporterDashboardTrackerUserId = async (userId) => {
    dashboardUserId = userId || undefined;
    renderDashboard();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  };
  window.__setSupporterDashboardSport = (sport) => {
    profile.sport = sport;
    renderDashboard();
  };
  renderDashboard();
}
`;
}

function htmlSource(harnessFilename: string) {
  return `
<!doctype html>
<html>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Supporter dashboard browser test</title></head>
  <body><div id="test-root"></div><script type="module">
    window.__browserTestConsoleErrors = [];
    const nativeConsoleError = console.error.bind(console);
    console.error = (...args) => {
      window.__browserTestConsoleErrors.push(args.map((argument) => typeof argument === 'string' ? argument : argument?.stack || String(argument)).join(' '));
      nativeConsoleError(...args);
    };
    window.addEventListener('error', (event) => {
      document.body.dataset.testError = String(event.error?.stack || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
      document.body.dataset.testError = String(event.reason?.stack || event.reason);
    });
    import('/${harnessFilename}?browser-test=' + Date.now()).then(({ mount }) => mount()).catch((error) => {
      document.body.dataset.testError = String(error?.stack || error);
    });
  </script></body>
</html>
`;
}

test('cached supporter photo renders before a slow metadata refresh', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-photo-startup-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-supporter-photo-startup-'));

    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?cached-photo-startup`);

    const firstDashboard = await waitFor<{
      dashboardVisible: boolean;
      avatarVisible: boolean;
      metadataResolved: boolean;
      elapsedMs: number;
    }>(
      connection,
      page.sessionId,
      `(() => {
        const dashboard = document.querySelector('[data-testid="athlete-summary"]');
        const cachedPhotoUrl = document.querySelector('[data-testid="cached-photo-url"]')?.textContent || '';
        return {
          dashboardVisible: Boolean(dashboard),
          avatarVisible: cachedPhotoUrl !== 'none' && cachedPhotoUrl.length > 0,
          metadataResolved: Boolean(window.__pixlSupporterPhotoMetadataResolved),
          elapsedMs: performance.now(),
        };
      })()`,
      (result) => result.dashboardVisible && result.avatarVisible,
      20_000,
    );

    assert.equal(firstDashboard.metadataResolved, false, 'cached startup must not wait for photo metadata refresh');
    assert.ok(
      firstDashboard.elapsedMs < 5_000,
      `cached dashboard startup took ${Math.round(firstDashboard.elapsedMs)}ms`,
    );
    const metadataResolvedAt = await waitFor<number>(
      connection,
      page.sessionId,
      'window.__pixlSupporterPhotoMetadataResolvedAt || 0',
      (value) => value > 0,
      5_000,
    );
    assert.ok(
      firstDashboard.elapsedMs < metadataResolvedAt,
      `dashboard first paint at ${Math.round(firstDashboard.elapsedMs)}ms must precede photo metadata at ${Math.round(metadataResolvedAt)}ms`,
    );
    console.log('Cached supporter photo startup timing', JSON.stringify({
      firstDashboardMs: Math.round(firstDashboard.elapsedMs),
      metadataRefreshDelayMs: 1_500,
      metadataResolvedMs: Math.round(metadataResolvedAt),
      avatarVisibleBeforeRefresh: firstDashboard.avatarVisible,
    }));
  } finally {
    if (page && connection) {
      await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    }
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

async function pressKey(connection: DevToolsConnection, sessionId: string, key: string, code: string, keyCode: number) {
  await connection.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  }, sessionId);
  await connection.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  }, sessionId);
}

test('notification reminder choices persist after reload and use the preferences API contract', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('notification-preferences-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-notification-preferences-'));

    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(
      connection,
      `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?notification-preferences`,
    );

    const preferencesExpression = `(() => {
      const oneHour = document.querySelector('[data-testid="checkbox-reminder-one-hour"]');
      const dayOf = document.querySelector('[data-testid="checkbox-reminder-day-of"]');
      const timezone = document.querySelector('[data-testid="select-notification-timezone"]');
      return {
        ready: oneHour instanceof HTMLInputElement && dayOf instanceof HTMLInputElement
          && timezone instanceof HTMLSelectElement && !oneHour.disabled && !dayOf.disabled && !timezone.disabled,
        oneHourBefore: oneHour instanceof HTMLInputElement ? oneHour.checked : null,
        dayOf: dayOf instanceof HTMLInputElement ? dayOf.checked : null,
        timezone: timezone instanceof HTMLSelectElement ? timezone.value : null,
      };
    })()`;
    const connectedExpression = `(() => {
      const toggle = document.querySelector('[data-testid="button-toggle-notifications"]');
      return toggle instanceof HTMLButtonElement
        && !toggle.disabled
        && toggle.textContent?.includes('Turn Off Alerts') === true
        && document.body.textContent?.includes('This device is connected') === true;
    })()`;
    await waitFor(
      connection,
      page.sessionId,
      preferencesExpression,
      (value: { ready: boolean }) => value.ready,
    );
    await waitFor(connection, page.sessionId, connectedExpression, Boolean);
    assert.deepEqual(
      await connection.evaluate(preferencesExpression, page.sessionId),
      { ready: true, oneHourBefore: true, dayOf: false, timezone: 'UTC' },
    );
    assert.equal(
      await connection.evaluate<string>(
        'document.querySelector(\'[data-testid="status-event-card-delivery"]\')?.textContent?.trim() || ""',
        page.sessionId,
      ),
      'Scheduled Event Card delivery is not active on this deployment. Your choices can be saved, but automatic alerts will not be sent until the server schedule is enabled.',
    );
    await connection.evaluate(
      `localStorage.setItem('browser-test-scheduled-delivery-enabled', 'true')`,
      page.sessionId,
    );
    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector(\'[data-testid="status-event-card-delivery"]\')?.textContent?.trim() || ""',
      (value: string) => value === 'Scheduled Event Card delivery is active on this deployment. Choose at least one reminder below to opt in; app installation alone does not enable alerts.',
    );
    await waitFor(connection, page.sessionId, connectedExpression, Boolean);

    const clickPreference = async (testId: string, expectedRequestCount: number) => {
      await connection!.evaluate(`document.querySelector('[data-testid="${testId}"]')?.click()`, page!.sessionId);
      await waitFor(
        connection!,
        page!.sessionId,
        `JSON.parse(localStorage.getItem('browser-test-notification-preference-requests') || '[]').length`,
        (value: number) => value === expectedRequestCount,
      );
    };

    await clickPreference('checkbox-reminder-one-hour', 1);
    await clickPreference('checkbox-reminder-day-of', 2);
    assert.deepEqual(
      await connection.evaluate(preferencesExpression, page.sessionId),
      { ready: true, oneHourBefore: false, dayOf: true, timezone: 'UTC' },
    );

    await connection.evaluate(`(() => {
      const timezone = document.querySelector('[data-testid="select-notification-timezone"]');
      if (!(timezone instanceof HTMLSelectElement)) throw new Error('Alert time zone selector is missing');
      timezone.value = 'America/Los_Angeles';
      timezone.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      `JSON.parse(localStorage.getItem('browser-test-notification-preference-requests') || '[]').length`,
      (value: number) => value === 3,
    );

    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      preferencesExpression,
      (value: { ready: boolean; oneHourBefore: boolean | null; dayOf: boolean | null; timezone: string | null }) => (
        value.ready && value.oneHourBefore === false && value.dayOf === true && value.timezone === 'America/Los_Angeles'
      ),
    );
    await waitFor(connection, page.sessionId, connectedExpression, Boolean);

    await clickPreference('checkbox-reminder-one-hour', 4);
    await clickPreference('checkbox-reminder-day-of', 5);
    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      preferencesExpression,
      (value: { ready: boolean; oneHourBefore: boolean | null; dayOf: boolean | null; timezone: string | null }) => (
        value.ready && value.oneHourBefore === true && value.dayOf === false && value.timezone === 'America/Los_Angeles'
      ),
    );
    await waitFor(connection, page.sessionId, connectedExpression, Boolean);

    assert.deepEqual(
      await connection.evaluate<Array<{
        method: string;
        url: string;
        body: { oneHourBefore: boolean; dayOf: boolean; timezone: string };
      }>>(`JSON.parse(localStorage.getItem('browser-test-notification-preference-requests') || '[]')`, page.sessionId),
      [
        { method: 'PATCH', url: '/api/notifications/preferences', body: { oneHourBefore: false, dayOf: false, timezone: 'UTC' } },
        { method: 'PATCH', url: '/api/notifications/preferences', body: { oneHourBefore: false, dayOf: true, timezone: 'UTC' } },
        { method: 'PATCH', url: '/api/notifications/preferences', body: { oneHourBefore: false, dayOf: true, timezone: 'America/Los_Angeles' } },
        { method: 'PATCH', url: '/api/notifications/preferences', body: { oneHourBefore: true, dayOf: true, timezone: 'America/Los_Angeles' } },
        { method: 'PATCH', url: '/api/notifications/preferences', body: { oneHourBefore: true, dayOf: false, timezone: 'America/Los_Angeles' } },
      ],
    );

    await connection.evaluate(
      `localStorage.setItem('browser-test-notification-user', 'signed-out')`,
      page.sessionId,
    );
    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      `(() => {
        const oneHour = document.querySelector('[data-testid="checkbox-reminder-one-hour"]');
        const dayOf = document.querySelector('[data-testid="checkbox-reminder-day-of"]');
        const toggle = document.querySelector('[data-testid="button-toggle-notifications"]');
        return oneHour instanceof HTMLInputElement && dayOf instanceof HTMLInputElement
          && toggle instanceof HTMLButtonElement && oneHour.disabled && dayOf.disabled && toggle.disabled
          && !document.body.textContent?.includes('This device is connected');
      })()`,
      Boolean,
    );

    await connection.evaluate(
      `localStorage.setItem('browser-test-notification-user', 'browser-test-notification-owner')`,
      page.sessionId,
    );
    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      preferencesExpression,
      (value: { ready: boolean; oneHourBefore: boolean | null; dayOf: boolean | null; timezone: string | null }) => (
        value.ready && value.oneHourBefore === true && value.dayOf === false && value.timezone === 'America/Los_Angeles'
      ),
    );
    await waitFor(connection, page.sessionId, connectedExpression, Boolean);
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('supporter dashboard tools stay keyboard reachable and compact at phone and desktop widths', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-dashboard-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-supporter-dashboard-browser-'));

    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}`);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(`(() => {
        const upcoming = document.querySelector('[data-testid="section-upcoming"]');
        const noHypeQuickLink = !document.querySelector('[data-testid="link-desktop-independent-hype"]');
        const oldPanels = document.querySelector('[data-testid="section-desktop-workspace"], [data-testid="workspace-recommendation"]');
        return Boolean(upcoming && noHypeQuickLink && !oldPanels && !document.querySelector('#all-tools'));
      })()`, page.sessionId),
      true,
    );

    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") !== null', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-reminder-dialog"]\')?.textContent || ""', page.sessionId),
      /Get ready|Capture the game|After the whistle/,
    );
    await connection.evaluate(`document.querySelector('[data-testid="stage-reminder-got-it"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="week-path-content"]\')?.getAttribute("data-selected-path") || ""', page.sessionId),
      'upcoming',
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="week-path-content"]\')?.className || ""', page.sessionId),
      /border-amber-300/,
    );
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-live"]\')?.tagName || ""', page.sessionId),
      'DIV',
    );
    await connection.evaluate(`document.querySelector('[data-testid="stage-live"]')?.click()`, page.sessionId);
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="week-path-content"]\')?.getAttribute("data-selected-path") || ""', page.sessionId),
      'upcoming',
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="week-path-content"]\')?.textContent || ""', page.sessionId),
      /Open checklist/,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-upcoming"]\')?.className || ""', page.sessionId),
      /border-amber-300/,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-upcoming-next"]\')?.textContent || ""', page.sessionId),
      /Next/,
    );

    await reloadPage(connection, page);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]"))', page.sessionId),
      false,
    );

    await connection.evaluate('localStorage.removeItem("pixlsports-supporter-stage-ack:game-1:upcoming")', page.sessionId);
    await reloadPage(connection, page);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") !== null', Boolean);
    await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null', Boolean);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);

    await connection.evaluate('localStorage.removeItem("pixlsports-supporter-stage-ack:game-1:upcoming")', page.sessionId);
    await reloadPage(connection, page);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-close\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="stage-reminder-close"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null', Boolean);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);

    await connection.evaluate(`window.__setSupporterDashboardEvents([{ id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'live' }])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") !== null', Boolean);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"desktop-week-path-celebration\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(`(() => {
        const celebration = document.querySelector('[data-testid="desktop-week-path-celebration"]');
        if (!(celebration instanceof HTMLElement)) return false;
        const rect = celebration.getBoundingClientRect();
        return getComputedStyle(celebration).display !== 'none' && rect.width > 0 && rect.height > 0;
      })()`, page.sessionId),
      true,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="desktop-week-path-celebration"]\')?.textContent || ""', page.sessionId),
      /Get ready complete\. Next up: Capture the game\./,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-reminder-dialog"]\')?.textContent || ""', page.sessionId),
      /Happening now/,
    );
    await connection.evaluate(`document.querySelector('[data-testid="stage-reminder-got-it"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null', Boolean);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"desktop-week-path-celebration\\"]") === null', Boolean, 6_000);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-upcoming"]\')?.textContent || ""', page.sessionId),
      /Done/,
    );
    await connection.evaluate(`window.__setSupporterDashboardEvents([{ id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'live' }])`, page.sessionId);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="desktop-week-path-celebration"]\'))', page.sessionId),
      false,
    );

    await connection.evaluate(`window.__setSupporterDashboardEvents([{
      id: 'meeting-1',
      type: 'meeting',
      date: '2026-09-23',
      time: '17:00',
      location: 'Northside Clubhouse',
      notes: 'Bring the agenda',
      status: 'live'
    }])`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"week-path-content\\"]")?.getAttribute("data-selected-path") === "plan"',
      Boolean,
    );
    assert.doesNotMatch(
      await connection.evaluate<string>('document.body.textContent || ""', page.sessionId),
      /Meeting in progress|Open meeting checklist|Prepare meeting|Open agenda/,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid^="button-context-meeting"]\'))', page.sessionId),
      false,
      'meeting events must not create an active dashboard action',
    );

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'live' },
      { id: 'game-2', type: 'game', date: '2026-09-22', time: '18:30', location: 'Eastside Gym', opponent: 'Visitors', status: 'upcoming' }
    ])`, page.sessionId);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="select-active-supporter-game"], [data-testid="supporter-tool-context"]\'))', page.sessionId),
      false,
    );
    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'final' },
      { id: 'game-2', type: 'game', date: '2026-09-22', time: '18:30', location: 'Eastside Gym', opponent: 'Visitors', status: 'upcoming' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"upcoming-calendar-event-title\\"]")?.textContent?.includes("Visitors") === true', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="stage-upcoming-next"]\'))', page.sessionId),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="stage-completed-next"]\'))', page.sessionId),
      false,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="past-game-notice"], [data-testid="button-return-to-recommended-game"]\'))', page.sessionId),
      false,
    );

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'final' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"upcoming-calendar-events-empty\\"]")?.textContent?.includes("No upcoming games or practices") === true', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('!document.querySelector(\'[data-testid="link-desktop-independent-hype"]\')', page.sessionId),
      true,
    );

    await connection.evaluate(`window.__setSupporterDashboardEvents([])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"section-next-game-context\\"]") !== null', Boolean);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]"))', page.sessionId),
      false,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"select-active-supporter-game\\"]"))', page.sessionId),
      false,
    );
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="section-upcoming"]\')?.textContent || ""', page.sessionId).then((text) => text.includes('No Scheduled Events')),
      true,
    );
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector(\'[data-testid="week-path-content"]\')?.getAttribute("data-selected-path") === "plan"',
      Boolean,
    );

    await connection.evaluate(`window.__setSupporterDashboardEvents([{ id: 'practice-1', type: 'practice', date: '2026-09-22', time: '18:30', location: 'Northside Gym', notes: 'Bring water' }])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"week-path-content\\"]")?.getAttribute("data-selected-path") === "upcoming"', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="section-next-game-context"]\')?.textContent || ""', page.sessionId),
      /practice/i,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="week-path-content"]\')?.textContent || ""', page.sessionId),
      /Get ready for practice.*Sep 22, 2026.*6:30 PM/,
    );

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'practice-1', type: 'practice', date: '2026-09-22', time: '18:30', location: 'Northside Gym', notes: 'Bring water' },
      { id: 'game-1', type: 'game', date: '2026-09-23', time: '18:30', location: 'Eastside Gym', opponent: 'Rivals', status: 'upcoming' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"week-path-content\\"]")?.getAttribute("data-selected-path") === "upcoming"', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="section-next-game-context"]\')?.textContent || ""', page.sessionId),
      /practice/i,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="week-path-content"]\')?.textContent || ""', page.sessionId),
      /Get ready for practice.*Sep 22, 2026.*6:30 PM/,
    );

    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);
    await connection.evaluate(`(() => {
      const game = Array.from(document.querySelectorAll('.game-on-collection__card'))
        .find((card) => card.getClientRects().length > 0
          && card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      if (game && !game.classList.contains('game-on-collection__card--selected')) {
        game.querySelector('.game-on-collection__summary')?.click();
      }
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.game-on-collection__card'))
      .some((card) => card.classList.contains('game-on-collection__card--selected')
        && card.querySelector('[data-testid^="button-open-card-prep-"]')?.getClientRects().length
        && card.querySelector('[data-testid^="button-open-stat-tracker-"]')?.getClientRects().length
        && card.querySelector('[data-testid^="button-edit-event-arrow-"]')?.getClientRects().length)`, Boolean);
    const primaryRoutes = await connection.evaluate<Record<string, string>>(`(() => {
      const card = document.querySelector('.game-on-collection__card--selected');
      const prep = card?.querySelector('[data-testid^="button-open-card-prep-"]');
      const stats = card?.querySelector('[data-testid^="button-open-stat-tracker-"]');
      const calendar = card?.querySelector('[data-testid^="button-edit-event-arrow-"]');
      const dashboardStats = document.querySelector('[data-testid="link-desktop-independent-stats"]');
      const dashboardStatsUrl = dashboardStats instanceof HTMLAnchorElement ? new URL(dashboardStats.href) : null;
      return {
        calendar: calendar?.getAttribute('aria-label') || '',
        prep: prep?.getAttribute('data-prep-href') || '',
        stats: stats?.textContent?.trim() || '',
        statsBackground: stats instanceof HTMLElement ? getComputedStyle(stats).backgroundColor : '',
        trackerExpanded: stats?.getAttribute('aria-expanded') || '',
        dashboardStatsPath: dashboardStatsUrl?.pathname || '',
        dashboardStatsEventId: dashboardStatsUrl?.searchParams.get('eventId') || '',
      };
    })()`, page.sessionId);
    assert.equal(primaryRoutes.calendar, 'Edit event details');
    assert.match(primaryRoutes.prep, /^\/studio\/checklist(?:\?|$)/);
    assert.equal(primaryRoutes.stats, 'Open Stat Tracker');
    assert.equal(primaryRoutes.statsBackground, 'rgb(231, 242, 255)', 'Stat Tracker should use a neutral style before opening');
    assert.equal(primaryRoutes.trackerExpanded, 'false');
    assert.equal(primaryRoutes.dashboardStatsPath, '/studio/stat-tracker');
    assert.equal(await connection.evaluate<boolean>(`(() => {
      const card = document.querySelector('.game-on-collection__card--selected');
      const prep = card?.querySelector('[data-testid^="button-open-card-prep-"]');
      const stats = card?.querySelector('[data-testid^="button-open-stat-tracker-"]');
      return prep instanceof HTMLElement && stats instanceof HTMLElement
        && prep.getClientRects().length > 0 && stats.getClientRects().length > 0
        && prep.tabIndex >= 0 && stats.tabIndex >= 0;
    })()`, page.sessionId), true);
    assert.equal(await connection.evaluate<boolean>(
      'Boolean(document.querySelector(\'[data-testid="section-desktop-workspace"], [data-testid="workspace-recommendation"]\'))',
      page.sessionId,
    ), false);

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    const phoneLayout = await connection.evaluate<{ summaryOverflow: boolean; athleteOverflow: boolean; teamOverflow: boolean; heroToolCards: number }>(`(() => {
      const summary = document.querySelector('[data-testid="athlete-summary"]');
      const athlete = document.querySelector('#athlete-summary-heading');
      const team = summary?.querySelector('[data-testid="athlete-team-name"]');
      return {
        summaryOverflow: Boolean(summary && summary.scrollWidth > summary.clientWidth),
        athleteOverflow: Boolean(athlete && athlete.scrollWidth > athlete.clientWidth),
        teamOverflow: Boolean(team && team.scrollWidth > team.clientWidth),
        heroToolCards: document.querySelectorAll('header [data-testid^="link-quick-"]').length,
      };
    })()`, page.sessionId);
    assert.deepEqual(phoneLayout, {
      summaryOverflow: false,
      athleteOverflow: false,
      teamOverflow: false,
      heroToolCards: 0,
    });
    assert.match(await connection.evaluate<string>('document.body.innerText', page.sessionId), /Alexandria Montgomery-Williams/);
    assert.match(await connection.evaluate<string>('document.body.innerText', page.sessionId), /The Northside Comets Select Travel Club/);

    for (const width of [320, 375, 390, 430, 768]) {
      await connection.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: width === 768 ? 1024 : 844,
        deviceScaleFactor: 1,
        mobile: true,
      }, page.sessionId);
      const mobileDashboard = await connection.evaluate<{
        visible: boolean;
        desktopHidden: boolean;
        viewportOverflow: boolean;
        dashboardOverflow: boolean;
        stepCount: number;
        recommendationVisible: boolean;
        bottomNavAbsent: boolean;
        mobileContentPaddingBottom: string;
        statsActionVisible: boolean;
        hypeActionRemoved: boolean;
        actionsContainStats: boolean;
        mobileHeaderPosition: string;
        mobileHeaderZIndex: string;
        mobileHeaderTop: number;
        mobileHeaderTopAfterScroll: number;
        mobileHeaderHeight: number;
        mobileHeroTop: number;
        diagnostics: string[];
      }>(`(() => {
        const mobileRoot = document.querySelector('.pixl-dashboard-mobile');
        const desktopRoot = document.querySelector('.pixl-dashboard');
        const recommendation = document.querySelector('[data-testid="btn-mobile-recommendation-action"]');
        const statsAction = mobileRoot?.querySelector('[data-testid="link-mobile-independent-stats"]');
        const actionGroup = mobileRoot?.querySelector('[data-testid="dashboard-primary-actions-mobile"]');
        const mobileHeader = document.querySelector('[data-testid="mobile-header"]');
        const mobileHero = document.querySelector('[data-testid="mobile-hero-banner"]');
        const isVisible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          return getComputedStyle(element).display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        if (mobileRoot instanceof HTMLElement) mobileRoot.scrollTop = 0;
        const headerBeforeScroll = mobileHeader instanceof HTMLElement
          ? mobileHeader.getBoundingClientRect()
          : null;
        const heroRect = mobileHero instanceof HTMLElement ? mobileHero.getBoundingClientRect() : null;
        if (mobileRoot instanceof HTMLElement) {
          mobileRoot.scrollTop = Math.min(240, Math.max(0, mobileRoot.scrollHeight - mobileRoot.clientHeight));
        }
        const headerAfterScroll = mobileHeader instanceof HTMLElement
          ? mobileHeader.getBoundingClientRect()
          : null;
        if (mobileRoot instanceof HTMLElement) mobileRoot.scrollTop = 0;
        return {
          visible: isVisible(mobileRoot),
          desktopHidden: desktopRoot instanceof HTMLElement && getComputedStyle(desktopRoot.parentElement).display === 'none',
          viewportOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          dashboardOverflow: mobileRoot instanceof HTMLElement && mobileRoot.scrollWidth > mobileRoot.clientWidth,
          stepCount: document.querySelectorAll('[data-testid="section-mobile-weekly-path"] li').length,
          recommendationVisible: isVisible(recommendation),
          bottomNavAbsent: !document.querySelector('[data-testid="mobile-bottom-nav"]'),
          mobileContentPaddingBottom: mobileRoot instanceof HTMLElement ? getComputedStyle(mobileRoot).paddingBottom : '',
          statsActionVisible: isVisible(statsAction),
          hypeActionRemoved: !mobileRoot?.querySelector('[data-testid="link-mobile-independent-hype"]'),
          actionsContainStats: Boolean(actionGroup && statsAction?.parentElement === actionGroup),
          mobileHeaderPosition: mobileHeader instanceof HTMLElement ? getComputedStyle(mobileHeader).position : '',
          mobileHeaderZIndex: mobileHeader instanceof HTMLElement ? getComputedStyle(mobileHeader).zIndex : '',
          mobileHeaderTop: headerBeforeScroll ? Math.round(headerBeforeScroll.top) : -1,
          mobileHeaderTopAfterScroll: headerAfterScroll ? Math.round(headerAfterScroll.top) : -1,
          mobileHeaderHeight: headerBeforeScroll ? Math.round(headerBeforeScroll.height) : -1,
          mobileHeroTop: heroRect ? Math.round(heroRect.top) : -1,
          diagnostics: Array.from(document.querySelectorAll('.pixl-dashboard-mobile *'))
            .filter((element) => element instanceof HTMLElement
              && element.clientWidth > 1
              && (element.getBoundingClientRect().left < 0 || element.getBoundingClientRect().right > document.documentElement.clientWidth))
            .slice(0, 8)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return [element.tagName, element.className, element.scrollWidth, element.clientWidth, Math.round(rect.right)].join(' | ');
            }),
        };
      })()`, page.sessionId);
      assert.deepEqual(mobileDashboard, {
        visible: true,
        desktopHidden: true,
        viewportOverflow: false,
        dashboardOverflow: false,
        stepCount: 4,
        recommendationVisible: true,
        bottomNavAbsent: true,
        mobileContentPaddingBottom: '0px',
        statsActionVisible: true,
        hypeActionRemoved: true,
        actionsContainStats: true,
         mobileHeaderPosition: 'sticky',
         mobileHeaderZIndex: '70',
         mobileHeaderTop: 0,
         mobileHeaderTopAfterScroll: 0,
         mobileHeaderHeight: 72,
         mobileHeroTop: 72,
        diagnostics: [],
      }, `mobile dashboard layout at ${width}px`);
    }

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);

    await connection.evaluate(`document.querySelector('[data-testid="button-mobile-dashboard-menu"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"mobile-dashboard-menu\\"]") !== null', Boolean);
    assert.deepEqual(await connection.evaluate<{
      expanded: string | null;
      menuLinkCount: number;
      menuLabel: string | null;
    }>(`(() => {
      const button = document.querySelector('[data-testid="button-mobile-dashboard-menu"]');
      const menu = document.querySelector('[data-testid="mobile-dashboard-menu"]');
      return {
        expanded: button?.getAttribute('aria-expanded') || null,
        menuLinkCount: menu?.querySelectorAll('a').length || 0,
        menuLabel: menu?.getAttribute('aria-label') || null,
      };
    })()`, page.sessionId), {
      expanded: 'true',
      menuLinkCount: 3,
      menuLabel: 'Mobile dashboard navigation',
    });
    await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"mobile-dashboard-menu\\"]") === null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.activeElement?.getAttribute("data-testid") || ""', page.sessionId),
      'button-mobile-dashboard-menu',
    );

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'ChampionshipOpponentWithAnUnreasonablyLongName', status: 'final' },
      { id: 'game-2', type: 'game', date: '2026-09-22', time: '18:30', location: 'Eastside Gym', opponent: 'RegionalTournamentVisitorsWithAnUnreasonablyLongName', status: 'upcoming' }
    ])`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"upcoming-calendar-event-title\\"]")?.textContent?.includes("RegionalTournamentVisitorsWithAnUnreasonablyLongName") === true',
      Boolean,
    );
    const narrowGameNoticeLayout = await connection.evaluate<{
      contextOverflow: boolean;
      titleVisible: boolean;
      nextMarkerVisible: boolean;
    }>(`(() => {
      const context = document.querySelector('[data-testid="section-next-game-context"]');
      const title = document.querySelector('[data-testid="upcoming-calendar-event-title"]');
      const nextMarker = document.querySelector('[data-testid="stage-upcoming-next"]');
      const viewportWidth = document.documentElement.clientWidth;
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= viewportWidth;
      };
      return {
        contextOverflow: Boolean(context && context.scrollWidth > context.clientWidth),
        titleVisible: isVisible(title),
        nextMarkerVisible: isVisible(nextMarker),
      };
    })()`, page.sessionId);
    assert.deepEqual(narrowGameNoticeLayout, {
      contextOverflow: false,
      titleVisible: false,
      nextMarkerVisible: false,
    });
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="stage-completed-next"]\'))', page.sessionId),
      false,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="upcoming-calendar-event-title"]\')?.textContent || ""', page.sessionId),
      /RegionalTournamentVisitorsWithAnUnreasonablyLongName/,
    );

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    const desktopGameNoticeLayout = await connection.evaluate<{
      contextOverflow: boolean;
      titleVisible: boolean;
      nextMarkerVisible: boolean;
    }>(`(() => {
      const context = document.querySelector('[data-testid="section-next-game-context"]');
      const title = document.querySelector('[data-testid="upcoming-calendar-event-title"]');
      const nextMarker = document.querySelector('[data-testid="stage-upcoming-next"]');
      const viewportWidth = document.documentElement.clientWidth;
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= viewportWidth;
      };
      return {
        contextOverflow: Boolean(context && context.scrollWidth > context.clientWidth),
        titleVisible: isVisible(title),
        nextMarkerVisible: isVisible(nextMarker),
      };
    })()`, page.sessionId);
    assert.deepEqual(desktopGameNoticeLayout, {
      contextOverflow: false,
      titleVisible: true,
      nextMarkerVisible: true,
    });
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="supporter-tool-context"], [data-testid="select-active-supporter-game"]\'))', page.sessionId),
      false,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="stage-completed-next"]\'))', page.sessionId),
      false,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="upcoming-calendar-event-title"]\')?.textContent || ""', page.sessionId),
      /RegionalTournamentVisitorsWithAnUnreasonablyLongName/,
    );
    const desktopLayout = await connection.evaluate<{ summaryOverflow: boolean; heroToolCards: number }>(`(() => {
      const summary = document.querySelector('[data-testid="athlete-summary"]');
      return {
        summaryOverflow: Boolean(summary && summary.scrollWidth > summary.clientWidth),
        heroToolCards: document.querySelectorAll('header [data-testid^="link-quick-"]').length,
      };
    })()`, page.sessionId);

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await connection.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    }, page.sessionId);
    const reducedMotionCelebration = await connection.evaluate<{
      visible: boolean;
      text: string;
      animationName: string;
    }>(`(() => {
      const celebration = document.querySelector('[data-testid="mobile-week-path-celebration"]');
      if (!(celebration instanceof HTMLElement)) return { visible: false, text: '', animationName: '' };
      const rect = celebration.getBoundingClientRect();
      return {
        visible: getComputedStyle(celebration).display !== 'none' && rect.width > 0 && rect.height > 0,
        text: celebration.textContent || '',
        animationName: getComputedStyle(celebration).animationName,
      };
    })()`, page.sessionId);
    assert.equal(reducedMotionCelebration.visible, true);
    assert.match(reducedMotionCelebration.text, /complete\. Next up:/);
    assert.equal(reducedMotionCelebration.animationName, 'none');
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"mobile-week-path-celebration\\"]") === null', Boolean, 6_000);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="section-mobile-weekly-path"]\')?.textContent || ""', page.sessionId),
      /\(Completed\)/,
    );
    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'ChampionshipOpponentWithAnUnreasonablyLongName', status: 'final' },
      { id: 'game-2', type: 'game', date: '2026-09-22', time: '18:30', location: 'Eastside Gym', opponent: 'RegionalTournamentVisitorsWithAnUnreasonablyLongName', status: 'upcoming' }
    ])`, page.sessionId);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="mobile-week-path-celebration"]\'))', page.sessionId),
      false,
    );
    await connection.send('Emulation.setEmulatedMedia', { features: [] }, page.sessionId);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);

    await connection.evaluate(`window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid^="link-card-stats-"][href*="game-2"]')?.click()`, page.sessionId);
    assert.equal(await connection.evaluate<string>('location.pathname', page.sessionId), '/studio/stat-tracker');
    await connection.evaluate(`window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid^="button-open-card-prep-"][data-prep-href*="game-2"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid^=\\"game-on-inline-prep-\\"]"))', Boolean);
    assert.equal(await connection.evaluate<string>('location.pathname', page.sessionId), '/');
    assert.equal(await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid^=\\"link-open-full-prep-\\"]"))', page.sessionId), false);

  } finally {
    if (page && connection) {
      await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    }
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('Calendar game choice syncs to a clean session and clears when the game disappears', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-active-game-sync-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;
  let otherPage: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.account-lifecycle-browser.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        REPL_ID: '',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-active-game-sync-browser-'));
    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);

    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    const fixtureUrl = `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?workspace-journey&supporter-active-game-sync`;
    const calendarUrl = `${fixtureUrl}&route=schedule`;
    page = await openPage(connection, calendarUrl);
    const first = page.sessionId;
    const schedule = {
      version: 1, teamName: 'Northside Comets', season: '2026', template: 0,
      events: [
        { id: 'game-default', type: 'game', status: 'upcoming', date: '2026-10-12', time: '18:30', location: 'Main Gym', opponent: 'Falcons', snacks: '', drinks: '', notes: '' },
        { id: 'game-selected', type: 'game', status: 'upcoming', date: '2026-10-13', time: '19:00', location: 'Away Gym', opponent: 'Tigers', snacks: '', drinks: '', notes: 'PRIVATE CHECKLIST NOTES', checklistItems: ['PRIVATE CHECKLIST ITEM'] },
      ],
    };
    await connection.evaluate(`localStorage.setItem('leaguematrix-schedule-draft', ${JSON.stringify(JSON.stringify(schedule))})`, first);
    await navigatePage(connection, page, calendarUrl);
    await waitFor(connection, first, 'Boolean(document.querySelector("[data-testid=\\"button-select-schedule-event-1\\"]"))', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"button-select-schedule-event-1\\"]")?.click()', first);
    await waitFor(connection, first, 'JSON.parse(localStorage.getItem("pixlsports-workspace-event-context") || "null")?.id === "game-selected"', Boolean);
    await navigatePage(connection, page, fixtureUrl);
    await waitFor(connection, first, 'JSON.parse(sessionStorage.getItem("supporter-active-game-sync-requests") || "[]").some(request => request.method === "GET")', Boolean);
    assert.equal(await connection.evaluate('JSON.parse(localStorage.getItem("pixlsports-workspace-event-context") || "null")?.id', first), 'game-selected');
    await waitFor(connection, first, 'localStorage.getItem("supporter-active-game-sync-server-selection") === "\\"game-selected\\""', Boolean);
    const requests = () => connection!.evaluate<Array<{ method: string; body: { gameId: string | null } | null }>>(
      'JSON.parse(sessionStorage.getItem("supporter-active-game-sync-requests") || "[]")', first,
    );
    assert.ok((await requests()).some((request) => request.method === 'PUT' && request.body?.gameId === 'game-selected'));

    // Keep only the fake account endpoint's backing value: the next tab starts without a device cache.
    await connection.evaluate(`(() => {
      localStorage.removeItem('pixlsports-supporter-active-game');
      localStorage.removeItem('pixlsports-workspace-event-context');
    })()`, first);
    otherPage = await openPage(connection, fixtureUrl);
    const second = otherPage.sessionId;
    await waitFor(connection, second, 'JSON.parse(localStorage.getItem("pixlsports-workspace-event-context") || "null")?.id === "game-selected"', Boolean);
    await waitFor(connection, second, 'Boolean(document.querySelector(\'[data-testid^="button-open-card-prep-"][data-prep-href*="game-selected"]\'))', Boolean);
    const secondRequests = () => connection!.evaluate<Array<{ method: string; body: { gameId: string | null } | null }>>(
      'JSON.parse(sessionStorage.getItem("supporter-active-game-sync-requests") || "[]")', second,
    );
    assert.ok((await secondRequests()).some((request) => request.method === 'GET'));
    assert.ok(!(await secondRequests()).some((request) => request.method === 'PUT'), 'reading the selection must not overwrite it');
    await reloadPage(connection, otherPage);
    await waitFor(connection, second, 'JSON.parse(localStorage.getItem("pixlsports-workspace-event-context") || "null")?.id === "game-selected"', Boolean);
    await waitFor(connection, second, 'JSON.parse(sessionStorage.getItem("supporter-active-game-sync-requests") || "[]").filter(request => request.method === "GET").length >= 2', Boolean);
    assert.equal(await connection.evaluate('Boolean(document.querySelector(\'[data-testid^="button-open-card-prep-"][data-prep-href*="game-selected"]\'))', second), true);
    assert.ok((await secondRequests()).filter((request) => request.method === 'GET').length >= 2, 'reload reads the account choice again');

    // Remove the selected game through Calendar, then return to the dashboard with its saved account ID stale.
    await navigatePage(connection, otherPage, calendarUrl);
    await waitFor(connection, second, 'Boolean(document.querySelector("[data-testid=\\"button-select-schedule-event-1\\"]"))', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"button-select-schedule-event-1\\"]")?.click()', second);
    await waitFor(connection, second, 'Boolean(document.querySelector("[data-testid=\\"button-remove-event-1\\"]"))', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"button-remove-event-1\\"]")?.click()', second);
    await waitFor(connection, second, '!JSON.parse(localStorage.getItem("leaguematrix-schedule-draft") || "null")?.events?.some(event => event.id === "game-selected")', Boolean);
    await navigatePage(connection, otherPage, fixtureUrl);
    await waitFor(connection, second, 'localStorage.getItem("supporter-active-game-sync-server-selection") === "null"', Boolean);
    await waitFor(connection, second, 'Boolean(document.querySelector(\'[data-testid^="button-open-card-prep-"][data-prep-href*="game-default"]\'))', Boolean);
    assert.ok((await secondRequests()).some((request) => request.method === 'PUT' && request.body?.gameId === null), 'missing game clears the saved account choice');
    assert.equal(await connection.evaluate('localStorage.getItem("pixlsports-supporter-active-game")', second), null);
    assert.notEqual(await connection.evaluate('JSON.parse(localStorage.getItem("pixlsports-workspace-event-context") || "null")?.id || null', second), 'game-selected');
    await reloadPage(connection, otherPage);
    await waitFor(connection, second, 'JSON.parse(sessionStorage.getItem("supporter-active-game-sync-requests") || "[]").filter(request => request.method === "GET").length >= 4', Boolean);
    assert.equal(await connection.evaluate('localStorage.getItem("supporter-active-game-sync-server-selection")', second), 'null');
    assert.doesNotMatch(JSON.stringify([...(await requests()), ...(await secondRequests())]), /PRIVATE CHECKLIST NOTES|PRIVATE CHECKLIST ITEM/);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="select-active-supporter-game"], [data-testid="supporter-tool-context"]\'))', second),
      false,
    );
  } finally {
    if (otherPage && connection) {
      await connection.send('Target.closeTarget', { targetId: otherPage.targetId }).catch(() => undefined);
    }
    if (page && connection) {
      await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    }
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('completed meetings stay stored but disappear from the active dashboard flow', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-dashboard-ended-meeting-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-ended-meeting-'));

    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}`);
    await waitFor(connection, page.sessionId, 'Boolean(window.__setSupporterDashboardEvents)', Boolean);

    const completedMeetingRecord = {
      context: {
        id: 'ended-meeting',
        date: '2020-09-22',
        time: '17:00',
        location: 'Northside Clubhouse',
        title: 'Weekly Team Meeting',
      },
      notes: 'Review the completed meeting.',
      participants: [],
      agenda: [],
      decisions: [],
      followUps: [],
      startedAt: '2020-09-22T17:00:00.000Z',
      endedAt: '2020-09-22T18:00:00.000Z',
    };
    const upcomingEvents = [
      { id: 'ended-meeting', type: 'meeting', date: '2020-09-22', time: '17:00', location: 'Northside Clubhouse' },
      { id: 'next-practice', type: 'practice', date: '2999-01-01', time: '18:30', location: 'Northside Gym' },
    ];
    await connection.evaluate(
      `localStorage.setItem('pixlsports-meeting-capture:guest:ended-meeting', ${JSON.stringify(JSON.stringify(completedMeetingRecord))})`,
      page.sessionId,
    );
    await connection.evaluate(`window.__setSupporterDashboardEvents(${JSON.stringify(upcomingEvents)})`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="meeting-history-item-ended-meeting"]\'))', page.sessionId),
      false,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="game-on-dashboard-collection"]\')?.textContent || ""', page.sessionId),
      /Practice/,
    );
    assert.equal(await connection.evaluate<boolean>(
      'Boolean(document.querySelector(\'[data-testid="workspace-recommendation"], [data-testid="section-desktop-workspace"]\'))',
      page.sessionId,
    ), false);

    await reloadPage(connection, page);
    await waitFor(connection, page.sessionId, 'Boolean(window.__setSupporterDashboardEvents)', Boolean);
    await connection.evaluate(`window.__setSupporterDashboardEvents(${JSON.stringify(upcomingEvents)})`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('localStorage.getItem("pixlsports-meeting-capture:guest:ended-meeting") !== null', page.sessionId),
      true,
      'removing meeting discovery must not delete the legacy record',
    );

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'ended-meeting', type: 'meeting', date: '2020-09-22', time: '17:00', location: 'Northside Clubhouse' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"status-game-on-empty\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="meeting-history-item-ended-meeting"]\'))', page.sessionId),
      false,
    );

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'ended-meeting', type: 'meeting', date: '2020-09-22', time: '17:00', location: 'Northside Clubhouse' },
      { id: 'active-game', type: 'game', date: '2999-01-01', time: '18:30', location: 'Eastside Gym', opponent: 'Rivals', status: 'live' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'Boolean(document.querySelector(\'[data-testid^="button-open-stat-tracker-"]\'))', Boolean);
    await connection.evaluate(`(() => {
      const game = Array.from(document.querySelectorAll('.game-on-collection__card'))
        .find((card) => card.getClientRects().length > 0
          && card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      if (game && !game.classList.contains('game-on-collection__card--selected')) {
        game.querySelector('.game-on-collection__summary')?.click();
      }
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, `Array.from(document.querySelectorAll('.game-on-collection__card'))
      .some((card) => card.classList.contains('game-on-collection__card--selected')
        && card.querySelector('[data-testid^="button-open-stat-tracker-"]')?.getClientRects().length)`, Boolean);
    await connection.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-open-stat-tracker-"]')).find((button) => button.getClientRects().length > 0)?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid^=\\"link-card-stats-\\"][href*=\\"active-game\\"]") !== null', Boolean);
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('meeting capture keeps live notes and turns the finished meeting into a sendable recap', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('meeting-capture-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-meeting-capture-'));

    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(
      connection,
      `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?meeting-capture&gameId=meeting-1&eventType=meeting&title=Weekly%20Team%20Meeting&date=2026-09-25&time=17:00&location=Northside%20Clubhouse`,
    );
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"text-meeting-title\\"]")?.textContent || ""', (value) => value === 'Weekly Team Meeting');
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"checklist-page\\"]"))', page.sessionId),
      false,
      'meeting route must not render the generic checklist',
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"text-meeting-prep-heading\\"]"))', page.sessionId),
      true,
      'an upcoming meeting must open the lightweight prep view',
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"textarea-meeting-notes\\"]"))', page.sessionId),
      false,
      'prep must not expose live notes',
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"button-end-meeting\\"]"))', page.sessionId),
      false,
      'prep must not expose the end action',
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"button-start-meeting\\"]"))', page.sessionId),
      false,
      'scheduled prep must not expose a manual start action',
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"input-prep-meeting-title\\"]"))', page.sessionId),
      false,
      'scheduled meeting titles must stay sourced from the schedule',
    );

    const setField = async (selector: string, value: string) => {
      await connection!.evaluate(`(() => {
        const field = document.querySelector(${JSON.stringify(selector)});
        if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) throw new Error('Field is missing: ' + ${JSON.stringify(selector)});
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
        setter?.call(field, ${JSON.stringify(value)});
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      })()`, page!.sessionId);
    };

    await setField('[data-testid="input-prep-new-agenda"]', 'Confirm tournament transport');
    await connection.evaluate(`document.querySelector('[data-testid="button-prep-add-agenda"]')?.click()`, page.sessionId);
    await setField('[data-testid="input-prep-new-attendee"]', 'Morgan Lee');
    await setField('[data-testid="input-prep-new-attendee-role"]', 'Captain');
    await connection.evaluate(`document.querySelector('[data-testid="button-prep-add-attendee"]')?.click()`, page.sessionId);

    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid^=\\"row-prep-agenda-\\"]"))', page.sessionId),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid^=\\"button-toggle-agenda-\\"]"))', page.sessionId),
      false,
      'prep agenda items must not have completion checkboxes',
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"text-prep-attendance-count\\"]")?.textContent || ""', page.sessionId),
      /3 expected/,
    );

    await waitFor(
      connection,
      page.sessionId,
      'Array.from(document.querySelectorAll("[data-testid^=\\"input-prep-agenda-\\"]")).map((input) => input.value).join("|")',
      (value) => value.includes('Confirm tournament transport'),
    );
    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      'Array.from(document.querySelectorAll("[data-testid^=\\"input-prep-agenda-\\"]")).map((input) => input.value).join("|")',
      (value) => value.includes('Confirm tournament transport'),
    );
    assert.match(
      await connection.evaluate<string>('Array.from(document.querySelectorAll("[data-testid^=\\"input-prep-agenda-\\"]")).map((input) => input.value).join("|")', page.sessionId),
      /Confirm tournament transport/,
      'prep edits must survive reload',
    );

    await navigatePage(
      connection,
      page,
      `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?meeting-capture&gameId=meeting-1&eventType=meeting&title=Weekly%20Team%20Meeting&date=2020-09-25&time=17:00&location=Northside%20Clubhouse`,
    );
    await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid=\\"textarea-meeting-notes\\"]"))', Boolean);
    await setField('[data-testid="textarea-meeting-notes"]', 'We agreed to keep Wednesday practice focused on defense.');
    await connection.evaluate(`document.querySelector('[data-testid^="button-toggle-agenda-"]')?.click()`, page.sessionId);
    await connection.evaluate(`document.querySelector('[data-testid="button-add-decision"]')?.click()`, page.sessionId);
    await setField('[data-testid^="textarea-decision-"]', 'Defense is the priority for Wednesday.');
    await connection.evaluate(`document.querySelector('[data-testid="button-add-follow-up"]')?.click()`, page.sessionId);
    await setField('[data-testid^="input-follow-up-task-"]', 'Confirm tournament transport');
    await setField('[data-testid^="input-follow-up-owner-"]', 'Morgan Lee');

    assert.match(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"text-attendance-count\\"]")?.textContent || ""', page.sessionId),
      /3 present/,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"text-agenda-progress\\"]")?.textContent || ""', page.sessionId),
      /1\/4/,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"text-notes-count\\"]")?.textContent || ""', page.sessionId),
      /characters/,
    );

    await reloadPage(connection, page);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"textarea-meeting-notes\\"]")?.value || ""', (value) => value.includes('Wednesday practice'));
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid^=\\"input-follow-up-task-\\"]")?.value || ""', page.sessionId),
      'Confirm tournament transport',
    );

    await connection.evaluate(`document.querySelector('[data-testid="button-end-meeting"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid=\\"text-recap-content\\"]"))', Boolean);
    const recap = await connection.evaluate<string>('document.querySelector("[data-testid=\\"text-recap-content\\"]")?.textContent || ""', page.sessionId);
    assert.match(recap, /Wednesday practice/);
    assert.match(recap, /Defense is the priority/);
    assert.match(recap, /Confirm tournament transport/);
    assert.match(recap, /Morgan Lee/);

    await connection.evaluate(`document.querySelector('[data-testid="button-copy-recap"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"status-recap-actions\\"]")?.textContent || ""', (value) => value.length > 0);
    await connection.evaluate(`document.querySelector('[data-testid="button-download-recap-pdf"]')?.click()`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"status-download-recap-pdf\\"]")?.textContent || ""',
      (value) => value.includes('PDF downloaded'),
    );
    await connection.evaluate(`document.querySelector('[data-testid="button-return-to-editing"]')?.click()`, page.sessionId);
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"textarea-meeting-notes\\"]")?.value || ""', page.sessionId),
      'We agreed to keep Wednesday practice focused on defense.',
    );

    await connection.evaluate(`document.querySelector('[data-testid="button-back-to-dashboard"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'window.location.search === ""', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"text-meeting-title\\"]"))', page.sessionId),
      false,
      'back to dashboard must leave the query-driven meeting variant',
    );

    await navigatePage(
      connection,
      page,
      `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?meeting-capture&gameId=meeting-unscheduled&eventType=meeting&title=Ad%20Hoc%20Team%20Meeting`,
    );
    await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid=\\"text-meeting-prep-heading\\"]"))', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"button-start-meeting\\"]"))', page.sessionId),
      true,
      'an unscheduled meeting must offer a manual start action',
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"textarea-meeting-notes\\"]"))', page.sessionId),
      false,
      'an unscheduled meeting must remain in prep until started',
    );
    await setField('[data-testid="input-prep-meeting-title"]', 'Friday Family Meeting');
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"text-meeting-title\\"]")?.textContent || ""',
      (value) => value === 'Friday Family Meeting',
    );
    await connection.evaluate(`document.querySelector('[data-testid="button-start-meeting"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid=\\"textarea-meeting-notes\\"]"))', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"text-meeting-title\\"]")?.textContent || ""', page.sessionId),
      'Friday Family Meeting',
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"button-start-meeting\\"]"))', page.sessionId),
      false,
      'manual start must leave prep',
    );
    await setField('[data-testid="textarea-meeting-notes"]', 'We started this conversation without a calendar slot.');
    await connection.evaluate(`document.querySelector('[data-testid="button-end-meeting"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid=\\"text-recap-content\\"]"))', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"text-recap-content\\"]")?.textContent || ""', page.sessionId),
      /We started this conversation without a calendar slot/,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"text-recap-content\\"]")?.textContent || ""', page.sessionId),
      /PIXL SPORTS \/ FRIDAY FAMILY MEETING/,
    );
    const unscheduledRecord = await connection.evaluate<{ startedAt: string | null; endedAt: string | null; notes: string }>(`(() => {
      const entry = Object.entries(localStorage).find(([key]) => key.endsWith(':meeting-unscheduled'));
      return entry ? JSON.parse(entry[1]) : { startedAt: null, endedAt: null, notes: '', context: null };
    })()`, page.sessionId);
    assert.ok(unscheduledRecord.startedAt, 'manual start must persist a local start time');
    assert.ok(unscheduledRecord.endedAt, 'ending must persist the local history record');
    assert.equal(unscheduledRecord.notes, 'We started this conversation without a calendar slot.');
    assert.equal((unscheduledRecord as typeof unscheduledRecord & { context?: { title?: string } }).context?.title, 'Friday Family Meeting');
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('supporters can switch saved checklist event types and keep the latest one after reload', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-dashboard-checklist-context-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-supporter-checklist-context-'));

    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(
      connection,
      `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?checklist-context&scenario=mixed`,
    );
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"checklist-context-harness\\"]"))', page.sessionId),
      true,
      'checklist context browser harness must be mounted',
    );
    const dashboardPath = await connection.evaluate<string>('location.pathname', page.sessionId);
    assert.equal(dashboardPath, `/${fixtures.htmlPath.slice(appDirectory.length + 1)}`);

    const schedule = {
      teamName: 'Northside Comets',
      season: '2026',
      events: [
        {
          id: 'game-1',
          type: 'game',
          status: 'upcoming',
          date: '2026-09-23',
          time: '18:30',
          location: 'Eastside Gym',
          opponent: 'Rivals',
          snacks: '',
          drinks: '',
          notes: '',
        },
        {
          id: 'practice-1',
          type: 'practice',
          date: '2026-09-24',
          time: '18:30',
          location: 'Northside Gym',
          opponent: '',
          snacks: '',
          drinks: '',
          notes: 'Bring water',
        },
        {
          id: 'meeting-1',
          type: 'meeting',
          date: '2026-09-25',
          time: '17:00',
          location: 'Northside Clubhouse',
          opponent: '',
          snacks: '',
          drinks: '',
          notes: 'Bring the agenda',
        },
      ],
      template: 0,
    };
    await connection.evaluate(`window.localStorage.setItem('leaguematrix-schedule-draft', ${JSON.stringify(JSON.stringify(schedule))})`, page.sessionId);
    await connection.evaluate(`window.__setSupporterDashboardEvents(${JSON.stringify(schedule.events)})`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(\'[data-testid^="button-open-card-prep-"][data-prep-href*="game-1"]\') !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid^="button-open-card-prep-"][data-prep-href*="game-1"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'Boolean(document.querySelector("[data-testid^=\\"game-on-inline-prep-\\"]"))', Boolean);
    assert.equal(await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid^=\\"link-open-full-prep-\\"]"))', page.sessionId), false);
    await navigatePage(connection, page, fixtureRoute('checklist', '&gameId=game-1&eventType=game'));
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"checklist-page\\"]") !== null', Boolean);

    const readChecklistContext = () => connection!.evaluate<{
      heading: string;
      selectorText: string;
      selectorAriaLabel: string;
      selectedEventId: string;
      eventSummary: string;
      scheduleDescription: string;
      completionFeedback: string;
      readyHeading: string;
    }>(`(() => {
      const heading = document.querySelector('[data-testid="checklist-page"] h1')?.textContent || '';
      const selector = document.querySelector('[data-testid="select-checklist-game"]');
      const selectorContainer = document.querySelector('[data-testid="checklist-game-selector"]');
      return {
        heading,
        selectorText: selectorContainer?.textContent || '',
        selectorAriaLabel: selector?.getAttribute('aria-label') || '',
        selectedEventId: selector instanceof HTMLSelectElement ? selector.value : '',
        eventSummary: document.querySelector('[data-testid="checklist-selected-event-summary"]')?.textContent || '',
        scheduleDescription: selectorContainer?.querySelector('p')?.textContent || '',
        completionFeedback: document.querySelector('[data-testid="checklist-completion-feedback"]')?.textContent || '',
        readyHeading: document.querySelector('[data-testid="checklist-ready-celebration"] h2')?.textContent || '',
      };
    })()`, page.sessionId);

    const assertContext = async (expected: {
      eventId: string;
      heading: RegExp;
      selectorLabel: string;
      selectorAriaLabel: string;
      summary: RegExp;
      scheduleDescription: string;
    }) => {
      await waitFor(connection!, page!.sessionId, `document.querySelector('[data-testid="select-checklist-game"]')?.value === ${JSON.stringify(expected.eventId)}`, Boolean);
      const context = await readChecklistContext();
      assert.match(context.heading, expected.heading);
      assert.match(context.selectorText, new RegExp(expected.selectorLabel, 'i'));
      assert.equal(context.selectorAriaLabel, expected.selectorAriaLabel);
      assert.equal(context.selectedEventId, expected.eventId);
      assert.match(context.eventSummary, expected.summary);
      assert.equal(context.scheduleDescription, expected.scheduleDescription);
      return context;
    };

    await assertContext({
      eventId: 'game-1',
      heading: /GAMEDAY\s*CHECKLIST/i,
      selectorLabel: 'Checklist for game',
      selectorAriaLabel: 'Choose which game this checklist is for',
      summary: /VS\s*RIVALS/i,
      scheduleDescription: 'Choose a game from your saved schedule.',
    });
    for (let index = 0; index < 6; index += 1) {
      await connection.evaluate(`document.querySelector('[data-testid^="button-checklist-toggle-"]:not([aria-label^="Uncheck"])')?.click()`, page.sessionId);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    }
    const completedGame = await readChecklistContext();
    assert.match(completedGame.completionFeedback, /Game day ready — every task is complete\./);
    assert.match(completedGame.readyHeading, /Game day ready\./);

    await connection.evaluate(`(() => {
      const select = document.querySelector('[data-testid="select-checklist-game"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Checklist event selector is missing');
      select.value = 'practice-1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    const selectedPractice = await assertContext({
      eventId: 'practice-1',
      heading: /PRACTICE\s*CHECKLIST/i,
      selectorLabel: 'Checklist for practice',
      selectorAriaLabel: 'Choose which practice this checklist is for',
      summary: /PRACTICE/i,
      scheduleDescription: 'Choose a practice from your saved schedule.',
    });
    assert.equal(selectedPractice.completionFeedback, '', 'switching events must clear the previous completion announcement');
    assert.equal(selectedPractice.readyHeading, '', 'switching to practice must start the practice form incomplete');
    assert.equal(
      await connection.evaluate<string>(
        `document.querySelector('[data-testid="button-checklist-toggle-uniform"]')?.getAttribute('aria-label') || ''`,
        page.sessionId,
      ),
      'Check Pack practice gear and shoes',
    );
    for (let index = 0; index < 6; index += 1) {
      await connection.evaluate(`document.querySelector('[data-testid^="button-checklist-toggle-"]:not([aria-label^="Uncheck"])')?.click()`, page.sessionId);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    }
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"checklist-completion-feedback\\"]")?.textContent?.includes("Practice ready") === true', Boolean);

    assert.equal(
      await connection.evaluate<boolean>(
        `Array.from(document.querySelectorAll('[data-testid="select-checklist-game"] option')).some((option) => option.value === 'meeting-1')`,
        page.sessionId,
      ),
      false,
      'legacy meeting events must not appear as a new checklist choice',
    );

    await connection.evaluate(`document.querySelector('[data-testid="button-add-checklist-item"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelectorAll(\'[data-testid^="input-checklist-item-custom-"]\').length === 1', Boolean);
    await connection.evaluate(`(() => {
      window.__checklistConfirmMessage = '';
      window.confirm = (message) => {
        window.__checklistConfirmMessage = message;
        return false;
      };
      document.querySelector('[data-testid="button-reset-checklist"]')?.click();
    })()`, page.sessionId);
    const cancelledReset = await connection.evaluate<{
      confirmMessage: string;
      customItems: number;
      completedItems: number;
    }>(`({
      confirmMessage: window.__checklistConfirmMessage || '',
      customItems: document.querySelectorAll('[data-testid^="input-checklist-item-custom-"]').length,
      completedItems: document.querySelectorAll('[data-completed="true"]').length,
    })`, page.sessionId);
    assert.match(cancelledReset.confirmMessage, /custom items and completion state will be replaced with the practice starter template/i);
    assert.equal(cancelledReset.customItems, 1, 'cancelling reset must keep the custom item');
    assert.equal(cancelledReset.completedItems, 6, 'cancelling reset must keep completion state');

    await connection.evaluate(`(() => {
      window.confirm = () => true;
      document.querySelector('[data-testid="button-reset-checklist"]')?.click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelectorAll(\'[data-testid^="input-checklist-item-custom-"]\').length === 0 && document.querySelectorAll(\'[data-completed="true"]\').length === 0', Boolean);
    for (let index = 0; index < 6; index += 1) {
      await connection.evaluate(`document.querySelector('[data-testid^="button-checklist-toggle-"]:not([aria-label^="Uncheck"])')?.click()`, page.sessionId);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
    }
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"checklist-completion-feedback\\"]")?.textContent?.includes("Practice ready") === true', Boolean);

    await navigatePage(
      connection,
      page,
      `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?checklist-context&scenario=mixed&gameId=practice-1&eventType=practice&route=checklist`,
    );
    await reloadPage(connection, page);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"checklist-page\\"]") !== null', Boolean);
    const afterReload = await assertContext({
      eventId: 'practice-1',
      heading: /PRACTICE\s*CHECKLIST/i,
      selectorLabel: 'Checklist for practice',
      selectorAriaLabel: 'Choose which practice this checklist is for',
      summary: /PRACTICE/i,
      scheduleDescription: 'Choose a practice from your saved schedule.',
    });
    assert.equal(afterReload.completionFeedback, '');
    assert.match(afterReload.readyHeading, /Practice ready\./);
  } finally {
    if (page && connection) {
      await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    }
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('a signed-in supporter keeps a chosen Calendar game through Prep and Stats without publishing private prep', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-workspace-journey-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;
  let tempDirectory: string | undefined;
  try {
    const probe = createServer();
    const { port: vitePort } = await listen(probe);
    await new Promise<void>((done) => probe.close(() => done()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');
    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.account-lifecycle-browser.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: { ...process.env, PORT: String(vitePort), BASE_PATH: '/', REPL_ID: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((done) => debugProbe.close(() => done()));
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-workspace-journey-'));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${tempDirectory}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(webSocketDebuggerUrl, browserMonitor.diagnostics);
    const fixtureUrl = `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}`;
    const fixtureRoute = (route: string, params = '') =>
      `${fixtureUrl}?workspace-journey&viewer=workspace-journey&route=${route}${params}`;
    page = await openPage(connection, `${fixtureUrl}?workspace-journey&viewer=workspace-journey`);
    const session = page.sessionId;
    const click = (id: string) => connection!.evaluate(
      `document.querySelector('[data-testid="${id}"]')?.click()`, session,
    );
    const path = () => connection!.evaluate<string>(`(() => {
      const route = new URLSearchParams(location.search).get('route');
      if (route === 'schedule' || route === 'checklist' || route === 'stat-tracker') {
        return '/studio/' + route;
      }
      return location.pathname;
    })()`, session);
    const selected = () => connection!.evaluate<string>(
      'localStorage.getItem("pixlsports-workspace-event-context") || ""', session,
    );
    const schedule = {
      version: 1, teamName: 'Northside Comets', season: '2026', template: 0,
      events: [
        { id: 'game-default', type: 'game', status: 'upcoming', date: '2026-10-12', time: '18:30', location: 'Main Gym', opponent: 'Falcons', snacks: '', drinks: '', notes: '' },
        { id: 'game-selected', type: 'game', status: 'upcoming', date: '2026-10-13', time: '19:00', location: 'Away Gym', opponent: 'Tigers', snacks: '', drinks: '', notes: '' },
      ],
    };
    await connection.evaluate(`localStorage.setItem('leaguematrix-schedule-draft', ${JSON.stringify(JSON.stringify(schedule))})`, session);
    await navigatePage(connection, page, fixtureRoute('schedule'));
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"schedule-event-list\\"]"))', Boolean);
    assert.equal(await path(), '/studio/schedule');
    await connection.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    }, session);
    await connection.evaluate('window.scrollTo(0, 0)', session);
    await click('button-add-event');
    await waitFor(connection, session, `location.pathname === '/studio'
      && (() => {
        const collection = document.getElementById('game-on-dashboard-collection');
        return document.querySelectorAll('#game-on-dashboard-collection').length === 1
          && Boolean(collection?.getClientRects().length)
          && (Math.abs(collection.getBoundingClientRect().top) < 2 || window.scrollY > 0);
      })()`, Boolean);
    await navigatePage(connection, page, fixtureRoute('schedule'));
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"schedule-event-list\\"]"))', Boolean);
    await click('button-select-schedule-event-1');
    await waitFor(connection, session, 'JSON.parse(localStorage.getItem("pixlsports-workspace-event-context") || "null")?.id === "game-selected"', Boolean);
    await click('journey-return-dashboard');
    await waitFor(connection, session, 'Boolean(document.querySelector(\'[data-testid^="button-open-card-prep-"][data-prep-href*="game-selected"]\'))', Boolean);
    const context = JSON.parse(await selected()) as Record<string, string>;
    assert.deepEqual(context, {
      id: 'game-selected', type: 'game', date: '2026-10-13',
      time: '19:00', location: 'Away Gym', opponent: 'Tigers',
    });
    const prepHref = await connection.evaluate<string>(
      'document.querySelector(\'[data-testid^="button-open-card-prep-"][data-prep-href*="game-selected"]\')?.getAttribute("data-prep-href") || ""', session,
    );
    assert.match(prepHref, /gameId=game-selected&eventType=game/);
    await connection.evaluate(`(() => {
      const prep = document.querySelector('[data-testid^="button-open-card-prep-"][data-prep-href*="game-selected"]');
      prep?.closest('.game-on-collection__card')?.querySelector('.game-on-collection__summary')?.click();
    })()`, session);
    await waitFor(connection, session, 'Boolean(document.querySelector(".game-on-collection__dialog-card"))', Boolean);
    await connection.evaluate(`document.querySelector('.game-on-collection__dialog-card [data-testid^="button-open-card-prep-"]')?.click()`, session);
    await waitFor(connection, session, 'Boolean(document.querySelector(\'.game-on-collection__dialog-card [data-testid="game-on-inline-prep-game-selected"]\'))', Boolean);
    assert.equal(await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"button-card-prep-edit-link-game-selected\\"]")?.textContent?.trim() || ""', session,
    ), 'Create edit link');
    assert.equal(await connection.evaluate<boolean>(
      'Boolean(document.querySelector("[data-testid=\\"game-on-inline-prep-game-selected\\"] .game-on-prep__share-url"))', session,
    ), false);
    assert.match(await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"game-on-inline-prep-game-selected\\"]")?.textContent || ""', session,
    ), /GAME VS TIGERS/i);
    await connection.evaluate(`document.querySelector('[data-testid="checkbox-card-prep-game-selected-uniform"]')?.click()`, session);
    await waitFor(connection, session, 'JSON.parse(localStorage.getItem("pixlsports-gameday-checklist:workspace-journey:event:game-selected") || "null")?.items?.some(item => item.id === "uniform" && item.completed)', Boolean);
    await connection.evaluate(`(() => {
      const update = (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(
          element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
        ).set;
        setter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      };
      update(document.querySelector('[data-testid="input-card-prep-title-game-selected"]'), 'Inline event list');
      update(document.querySelector('[data-testid="textarea-card-prep-notes-game-selected"]'), 'Bring the first aid kit');
      document.querySelector('[data-testid="button-add-card-prep-item-game-selected"]')?.click();
      const item = document.querySelector('[data-testid^="input-card-prep-item-game-selected-custom-"]');
      update(item, 'Set up the team tent');
    })()`, session);
    await waitFor(connection, session, `(() => {
      const eventList = JSON.parse(localStorage.getItem('pixlsports-gameday-checklist:workspace-journey:event:game-selected') || 'null');
      const fullDraft = JSON.parse(localStorage.getItem('pixlsports-gameday-checklist:workspace-journey') || 'null');
      const hasEditedList = list => list?.title === 'Inline event list'
        && list?.notes === 'Bring the first aid kit'
        && list?.items?.some(item => item.label === 'Set up the team tent');
      return hasEditedList(eventList) && hasEditedList(fullDraft);
    })()`, Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-close-card-prep-game-selected"]')?.click()`, session);
    await waitFor(connection, session, 'document.querySelector(\'.game-on-collection__dialog-card [data-testid^="button-open-card-prep-"][data-prep-href*="game-selected"]\')?.getAttribute("aria-expanded") === "false"', Boolean);
    await connection.evaluate(`document.querySelector('.game-on-collection__dialog-card [data-testid^="button-open-card-prep-"][data-prep-href*="game-selected"]')?.click()`, session);
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"checkbox-card-prep-game-selected-uniform\\"]")?.checked === true', Boolean);
    assert.equal(await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid^=\\"link-open-full-prep-\\"]"))', session), false);
    await navigatePage(connection, page, fixtureRoute('checklist', '&gameId=game-selected&eventType=game'));
    assert.equal(await path(), '/studio/checklist');
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"select-checklist-game\\"]")?.value === "game-selected"', Boolean);
    assert.equal(await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"input-checklist-notes\\"]")?.value || ""', session,
    ), 'Bring the first aid kit');
    assert.equal(await connection.evaluate<string>(
      'document.querySelector("[data-testid^=\\"input-checklist-item-custom-\\"]")?.value || ""', session,
    ), 'Set up the team tent');
    await navigatePage(connection, page, fixtureRoute('checklist', '&gameId=game-selected&eventType=game'));
    await reloadPage(connection, page);
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"select-checklist-game\\"]")?.value === "game-selected"', Boolean);
    assert.match(await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"checklist-selected-event-summary\\"]")?.textContent || ""', session,
    ), /TIGERS/i);
    const privateNote = 'PRIVATE PREP: meet by the blue gate';
    const privateItem = 'PRIVATE ITEM: pack the striped socks';
    await click('button-add-checklist-item');
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid^=\\"input-checklist-item-custom-\\"]"))', Boolean);
    await connection.evaluate(`(() => {
      const update = (element, value) => {
        const setter = Object.getOwnPropertyDescriptor(
          element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
        ).set;
        setter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      };
      update(document.querySelector('[data-testid^="input-checklist-item-custom-"]'), ${JSON.stringify(privateItem)});
      update(document.querySelector('[data-testid="input-checklist-notes"]'), ${JSON.stringify(privateNote)});
    })()`, session);
    await waitFor(connection, session, `(() => {
      const saved = localStorage.getItem('pixlsports-gameday-checklist:workspace-journey') || '';
      return saved.includes(${JSON.stringify(privateNote)}) && saved.includes(${JSON.stringify(privateItem)});
    })()`, Boolean);
    await navigatePage(connection, page, fixtureRoute('checklist', '&gameId=game-selected&eventType=game'));
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"select-checklist-game\\"]")?.value === "game-selected"', Boolean);
    assert.equal(await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"input-checklist-notes\\"]")?.value || ""', session,
    ), privateNote);
    assert.equal(await connection.evaluate<string>(
      'document.querySelector("[data-testid^=\\"input-checklist-item-custom-\\"]")?.value || ""', session,
    ), privateItem);
    await click('journey-return-dashboard');
    await waitFor(connection, session, 'Boolean(document.querySelector(\'[data-testid^="button-open-stat-tracker-"]\'))', Boolean);
    await connection.evaluate(`(() => {
      const card = Array.from(document.querySelectorAll('.game-on-collection__grid .game-on-collection__card'))
        .find((item) => item.querySelector('[data-prep-href*="game-selected"]'));
      card?.querySelector('.game-on-collection__summary')?.click();
    })()`, session);
    await waitFor(connection, session, 'Boolean(document.querySelector(".game-on-collection__dialog-card"))', Boolean);
    await connection.evaluate(`document.querySelector('.game-on-collection__dialog-card [data-testid^="button-open-stat-tracker-"]')?.click()`, session);
    await waitFor(connection, session, 'Boolean(document.querySelector(\'.game-on-collection__dialog-card [data-testid^="link-card-stats-"][href*="game-selected"]\'))', Boolean);
    const statsHref = await connection.evaluate<string>(
      'document.querySelector(\'.game-on-collection__dialog-card [data-testid^="link-card-stats-"][href*="game-selected"]\')?.getAttribute("href") || ""', session,
    );
    assert.match(statsHref, /eventId=game-selected/);
    await connection.evaluate(`document.querySelector('.game-on-collection__dialog-card [data-testid^="link-card-stats-"][href*="game-selected"]')?.click()`, session);
    await waitFor(
      connection,
      session,
      'document.querySelector("[data-testid=\\"stat-tracker-sport-choice\\"]") !== null || document.querySelector("[data-testid=\\"stat-tracker-setup\\"]") !== null',
      Boolean,
    );
    if (await connection.evaluate<boolean>(
      'document.querySelector("[data-testid=\\"stat-tracker-sport-choice\\"]") !== null',
      session,
    )) {
      await connection.evaluate(`document.querySelector('[data-testid="button-choose-tracker-sport-volleyball"]')?.click()`, session);
      await waitFor(connection, session, 'document.querySelector("[data-testid=\\"stat-tracker-setup\\"]") !== null', Boolean);
      assert.equal(await connection.evaluate<boolean>(
        'Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) || "").some((key) => key.includes("stat-tracker-active-game") && localStorage.getItem(key))',
        session,
      ), false, 'choosing a sport on the full tracker must not start a game by itself');
    }
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"stat-tracker-setup\\"]"))', Boolean);
    assert.equal(await path(), '/studio/stat-tracker');
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"input-athlete-result-opponent\\"]")?.value === "Tigers"', Boolean);
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"stat-tracker-upcoming-notice\\"]")?.textContent?.includes("Tigers") === true', Boolean);
    assert.ok(!(await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"stat-tracker-upcoming-notice\\"]")?.textContent || ""', session,
    )).includes('Falcons'), 'scheduled-game lookup must not fall back to the first recommendation');
    assert.equal(await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"input-athlete-result-date\\"]")?.value || ""', session,
    ), '2026-10-13');
    await navigatePage(connection, page, fixtureRoute('stat-tracker', '&source=workspace&eventId=game-selected&eventType=game&date=2026-10-13&opponent=Tigers'));
    await reloadPage(connection, page);
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"input-athlete-result-opponent\\"]")?.value === "Tigers"', Boolean);
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"stat-tracker-upcoming-notice\\"]")?.textContent?.includes("Tigers") === true', Boolean);
    await click('journey-return-dashboard');
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"link-desktop-independent-stats\\"]"))', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('!document.querySelector("[data-testid=\\"link-desktop-independent-hype\\"]")', session),
      true,
      'the redundant HYPE Card quick link stays removed',
    );
    for (const secret of [privateNote, privateItem]) {
      assert.ok(!(await selected()).includes(secret), 'private checklist content must not reach the HYPE Card manager');
    }

  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('a signed-in Stat Tracker game stays saved when leaving to the dashboard and reopening', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('signed-in-stat-tracker-resume-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;
  let tempDirectory: string | undefined;

  try {
    const probe = createServer();
    const { port: vitePort } = await listen(probe);
    await new Promise<void>((done) => probe.close(() => done()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');
    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.account-lifecycle-browser.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: { ...process.env, PORT: String(vitePort), BASE_PATH: '/', REPL_ID: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);

    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((done) => debugProbe.close(() => done()));
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-signed-in-stat-tracker-resume-'));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${tempDirectory}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(webSocketDebuggerUrl, browserMonitor.diagnostics);
    const fixtureUrl = `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}`;
    const signedInDashboardUrl = `${fixtureUrl}?workspace-journey&viewer=workspace-journey`;
    page = await openPage(connection, signedInDashboardUrl);
    const session = page.sessionId;
    const click = async (testId: string) => {
      const found = await connection!.evaluate<boolean>(
        `Boolean(document.querySelector('[data-testid="${testId}"]'))`, session,
      );
      assert.ok(found, `expected ${testId} to be available before clicking`);
      await connection!.evaluate(
        `document.querySelector('[data-testid="${testId}"]').click()`, session,
      );
    };
    const openStatTrackerFromDashboard = async () => {
      const openedCard = await connection!.evaluate<boolean>(`(() => {
        const card = Array.from(document.querySelectorAll('.game-on-collection__grid .game-on-collection__card'))
          .find((item) => item.querySelector('[data-prep-href*="resume-game"]'));
        if (!card?.querySelector('.game-on-collection__summary')) return false;
        card.querySelector('.game-on-collection__summary').click();
        return true;
      })()`, session);
      assert.equal(openedCard, true, 'the scheduled game card opens from the dashboard');
      await waitFor(connection!, session,
        'Boolean(document.querySelector(".game-on-collection__dialog-card"))', Boolean);
      await waitFor(connection!, session,
        'Boolean(document.querySelector(\'.game-on-collection__dialog-card [data-testid^="button-open-stat-tracker-"]\'))',
        Boolean,
      );
      await connection!.evaluate(
        `document.querySelector('.game-on-collection__dialog-card [data-testid^="button-open-stat-tracker-"]')?.click()`,
        session,
      );
      await waitFor(connection!, session, 'location.pathname === "/studio/stat-tracker"', Boolean);
    };

    const schedule = {
      version: 1,
      teamName: 'Northside Comets',
      season: '2026',
      template: 0,
      events: [{
        id: 'resume-game',
        type: 'game',
        status: 'upcoming',
        date: '2099-10-13',
        time: '18:30',
        location: 'Away Gym',
        opponent: 'Tigers',
        snacks: '',
        drinks: '',
        notes: '',
      }],
    };
    await connection.evaluate(
      `localStorage.setItem('leaguematrix-schedule-draft', ${JSON.stringify(JSON.stringify(schedule))})`,
      session,
    );
    await navigatePage(connection, page, signedInDashboardUrl);
    await waitFor(connection, session,
      'Boolean(document.querySelector("[data-testid=\\"link-desktop-independent-stats\\"]"))', Boolean);
    await openStatTrackerFromDashboard();
    await waitFor(connection, session,
      'Boolean(document.querySelector("[data-testid=\\"stat-tracker-setup\\"]"))'
        + ' && Boolean(document.querySelector("[data-testid=\\"button-use-upcoming-game\\"]"))',
      Boolean,
    );
    await click('button-use-upcoming-game');
    await click('button-confirm-start-game');
    await waitFor(connection, session,
      'Boolean(document.querySelector("[data-testid=\\"live-tracker-layout\\"]"))'
        + ' && document.querySelector("[data-testid=\\"live-tracker-game-state\\"]")?.textContent.trim() === "live"',
      Boolean,
    );

    for (const expectedCount of [1, 2]) {
      await click('athlete-stat-target-three-point');
      await waitFor(connection, session,
        `document.querySelector("[data-testid=\\"stat-count-three-point\\"]")?.textContent.trim().startsWith("${expectedCount}")`,
        Boolean,
      );
    }

    const accountActiveGameKey = 'leaguematrix-stat-tracker-active-game:workspace-journey';
    await waitFor(connection, session,
      `JSON.parse(localStorage.getItem("${accountActiveGameKey}") || "null")?.stats?.["three-point"] === 2`,
      Boolean,
    );
    const activeGameBeforeLeaving = await connection.evaluate<{
      status: string;
      opponent: string;
      stats: Record<string, number>;
      events: unknown[];
    }>(`JSON.parse(localStorage.getItem("${accountActiveGameKey}") || "null")`, session);
    assert.equal(activeGameBeforeLeaving.status, 'live');
    assert.equal(activeGameBeforeLeaving.opponent, 'Tigers');
    assert.equal(activeGameBeforeLeaving.stats['three-point'], 2);
    assert.equal(activeGameBeforeLeaving.events.length, 2);
    assert.equal(
      await connection.evaluate<boolean>(
        'localStorage.getItem("leaguematrix-stat-tracker-active-game") !== null', session,
      ),
      false,
      'the active session is saved under the signed-in account rather than the unscoped legacy key',
    );

    await click('button-leave-game-open');
    await waitFor(connection, session, 'location.pathname === "/studio"', Boolean);
    await waitFor(connection, session,
      'Boolean(document.querySelector("[data-testid=\\"link-desktop-independent-stats\\"]"))', Boolean);
    assert.deepEqual(
      await connection.evaluate(
        `JSON.parse(localStorage.getItem("${accountActiveGameKey}") || "null")`, session,
      ),
      activeGameBeforeLeaving,
      'Leave game open returns to the dashboard without clearing or changing the account-scoped session',
    );

    await openStatTrackerFromDashboard();
    await waitFor(connection, session,
      'document.querySelector("[data-testid=\\"live-tracker-layout\\"]") !== null'
        + ' && document.querySelector("[data-testid=\\"live-tracker-game-state\\"]")?.textContent.trim() === "live"'
        + ' && document.querySelector("[data-testid=\\"live-tracker-matchup\\"]")?.textContent.includes("Tigers") === true'
        + ' && document.querySelector("[data-testid=\\"stat-count-three-point\\"]")?.textContent.trim().startsWith("2")',
      Boolean,
    );
    assert.deepEqual(
      await connection.evaluate(
        `JSON.parse(localStorage.getItem("${accountActiveGameKey}") || "null")`, session,
      ),
      activeGameBeforeLeaving,
      'reopening Stat Tracker restores the saved opponent, live status, and recorded stats',
    );
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('deleting selected games and practices falls back across Calendar and workspace tools', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-removed-workspace-event-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;
  let tempDirectory: string | undefined;
  try {
    const probe = createServer();
    const { port: vitePort } = await listen(probe);
    await new Promise<void>((done) => probe.close(() => done()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');
    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.account-lifecycle-browser.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: { ...process.env, PORT: String(vitePort), BASE_PATH: '/', REPL_ID: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((done) => debugProbe.close(() => done()));
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-removed-workspace-event-'));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${tempDirectory}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(webSocketDebuggerUrl, browserMonitor.diagnostics);
    const fixtureUrl = `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}`;
    const fixtureRoute = (route: string, params = '') =>
      `${fixtureUrl}?workspace-journey&viewer=workspace-journey&route=${route}${params}`;
    page = await openPage(connection, `${fixtureUrl}?workspace-journey&viewer=workspace-journey`);
    const session = page.sessionId;
    const click = (id: string) => connection!.evaluate(
      `document.querySelector('[data-testid="${id}"]')?.click()`, session,
    );
    const links = async () => {
      await connection!.evaluate(`(() => {
        if (document.querySelector('.game-on-collection__dialog-card')) return;
        const card = Array.from(document.querySelectorAll('.game-on-collection__grid .game-on-collection__card'))
          .find((item) => item.getClientRects().length > 0
            && item.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
        card?.querySelector('.game-on-collection__summary')?.click();
      })()`, session);
      await waitFor(connection!, session, 'Boolean(document.querySelector(".game-on-collection__dialog-card"))', Boolean);
      await connection!.evaluate(`document.querySelector('.game-on-collection__dialog-card [data-testid^="button-open-stat-tracker-"]')?.click()`, session);
      await waitFor(connection!, session, 'Boolean(document.querySelector(\'[data-testid^="link-card-stats-"]\'))', Boolean);
      return connection!.evaluate<Record<string, string>>(`(() => {
        const calendar = document.querySelector('.game-on-collection__dialog-card [data-testid^="button-edit-event-arrow-"]');
        const prep = document.querySelector('.game-on-collection__dialog-card [data-testid^="button-open-card-prep-"]');
        const stats = document.querySelector('[data-testid^="link-card-stats-"]');
        return {
          calendarAction: calendar?.getAttribute('aria-label') || '',
          prep: prep?.getAttribute('data-prep-href') || '',
          stats: stats?.getAttribute('href') || '',
        };
      })()`, session);
    };
    const schedule = {
      version: 1, teamName: 'Northside Comets', season: '2026', template: 0,
      events: [
        { id: 'game-default', type: 'game', status: 'upcoming', date: '2026-10-12', time: '18:30', location: 'Main Gym', opponent: 'Falcons', snacks: '', drinks: '', notes: '' },
        { id: 'game-selected', type: 'game', status: 'upcoming', date: '2026-10-13', time: '19:00', location: 'Away Gym', opponent: 'Tigers', snacks: '', drinks: '', notes: '' },
        { id: 'practice-selected', type: 'practice', date: '2026-10-14', time: '17:00', location: 'Practice Gym', opponent: '', snacks: '', drinks: '', notes: '' },
      ],
    };
    await connection.evaluate(`localStorage.setItem('leaguematrix-schedule-draft', ${JSON.stringify(JSON.stringify(schedule))})`, session);
    await navigatePage(connection, page, fixtureRoute('schedule'));
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"button-select-schedule-event-1\\"]"))', Boolean);
    await click('button-select-schedule-event-1');
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"button-remove-event-1\\"]"))', Boolean);
    await click('button-remove-event-1');
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"button-select-schedule-event-1\\"]")?.getAttribute("aria-pressed") === "true"', Boolean);
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=\\"button-select-schedule-event-0\\"]") !== null', session), true, 'game remains in Calendar');
    await waitFor(connection, session, '!JSON.parse(localStorage.getItem("leaguematrix-schedule-draft") || "null")?.events?.some(e => e.id === "game-selected")', Boolean);
    await click('journey-return-dashboard');
    await waitFor(connection, session, 'Boolean(document.querySelector(\'[data-testid^="button-open-card-prep-"]\'))', Boolean);
    const afterGame = await links();
    assert.equal(afterGame.calendarAction, 'Edit event details');
    for (const [tool, href] of Object.entries(afterGame).filter(([tool]) => tool !== 'calendarAction')) {
      assert.ok(href, `${tool} has a destination`);
      assert.doesNotMatch(href, /game-selected|Tigers|2026-10-13/, `${tool} must drop the deleted game`);
    }
    assert.match(afterGame.prep, /gameId=game-default/);
    assert.match(afterGame.stats, /eventId=game-default/);

    await navigatePage(connection, page, fixtureRoute('schedule'));
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"button-select-schedule-event-1\\"]"))', Boolean);
    await click('button-select-schedule-event-1');
    await waitFor(connection, session, 'JSON.parse(localStorage.getItem("pixlsports-workspace-event-context") || "null")?.id === "practice-selected"', Boolean);
    await click('button-remove-event-1');
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"button-select-schedule-event-0\\"]")?.getAttribute("aria-pressed") === "true"', Boolean);
    await waitFor(connection, session, '!JSON.parse(localStorage.getItem("leaguematrix-schedule-draft") || "null")?.events?.some(e => e.id === "practice-selected")', Boolean);
    await click('journey-return-dashboard');
    await waitFor(connection, session, 'Boolean(document.querySelector(\'[data-testid^="button-open-card-prep-"]\'))', Boolean);
    const afterPractice = await links();
    assert.equal(afterPractice.calendarAction, 'Edit event details');
    for (const [tool, href] of Object.entries(afterPractice).filter(([tool]) => tool !== 'calendarAction')) {
      assert.ok(href, `${tool} has a destination after practice deletion`);
      assert.doesNotMatch(href, /game-selected|practice-selected|Tigers|2026-10-14/, `${tool} must drop deleted event context`);
    }
    assert.match(afterPractice.prep, /gameId=game-default/);
    assert.match(afterPractice.stats, /eventId=game-default/);

    await navigatePage(connection, page, fixtureRoute('checklist', `&${afterPractice.prep.split('?')[1]}`));
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"select-checklist-game\\"]")?.value === "game-default"', Boolean);
    await navigatePage(connection, page, fixtureRoute('stat-tracker', `&${afterPractice.stats.split('?')[1]}`));
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"input-athlete-result-opponent\\"]")?.value === "Falcons"', Boolean);
    await navigatePage(connection, page, fixtureRoute('schedule', '&eventId=practice-selected'));
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"button-select-schedule-event-0\\"]")?.getAttribute("aria-pressed") === "true"', Boolean);
    await navigatePage(connection, page, fixtureRoute('checklist', '&gameId=practice-selected&eventType=practice'));
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"select-checklist-game\\"]"))', Boolean);
    assert.notEqual(await connection.evaluate<string>('document.querySelector("[data-testid=\\"select-checklist-game\\"]")?.value || ""', session), 'practice-selected');
    await navigatePage(connection, page, fixtureRoute('stat-tracker', '&date=2026-10-12&opponent=Falcons'));
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"input-athlete-result-opponent\\"]")?.value === "Falcons"', Boolean);
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});

test('signed-in direct Stat Tracker entry keeps the return link visible and usable on a phone', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;
  let tempDirectory: string | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((done) => viteProbe.close(() => done()));
    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.account-lifecycle-browser.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: { ...process.env, PORT: String(vitePort), BASE_PATH: '/', REPL_ID: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    await waitForUrl(`http://127.0.0.1:${vitePort}/studio/stat-tracker`, 20_000, devServerMonitor);

    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((done) => debugProbe.close(() => done()));
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-direct-stat-tracker-return-'));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${tempDirectory}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(webSocketDebuggerUrl, browserMonitor.diagnostics);

    const target = await connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
    const attached = await connection.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    page = { sessionId: attached.sessionId, targetId: target.targetId };
    await connection.send('Page.enable', {}, page.sessionId);
    await connection.send('Runtime.enable', {}, page.sessionId);
    connection.registerTarget(page.targetId, page.sessionId);
    await connection.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const originalFetch = window.fetch.bind(window);
        const jsonResponse = (body) => new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
        window.fetch = async (input, init) => {
          const requestUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
          const pathname = new URL(requestUrl, window.location.href).pathname;
          if (pathname === '/api/account/lifecycle') {
            return jsonResponse({
              status: 'active',
              pauseEndsAt: null,
              planTier: 'free',
              cancelledAt: null,
              lastActivityAt: null,
              deletionEligibleAt: null,
              retentionDays: 90,
              expired: false,
            });
          }
          if (pathname === '/api/account/access') return jsonResponse(null);
          if (pathname.startsWith('/api/')) return jsonResponse([]);
          return originalFetch(input, init);
        };
      })();`,
    }, page.sessionId);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);

    const trackerUrl = `http://127.0.0.1:${vitePort}/studio/stat-tracker?viewer=tracker-direct-browser-user&statTrackerReturnTest=1`;
    const pageLoaded = connection.waitForEvent('Page.loadEventFired', page.sessionId);
    await connection.send('Page.navigate', { url: trackerUrl }, page.sessionId);
    await pageLoaded;
    await waitFor(
      connection,
      page.sessionId,
      `location.pathname === '/studio/stat-tracker'
        && Boolean(document.querySelector('[data-testid="stat-tracker-sport-choice"]'))
        && Boolean(document.querySelector('[data-testid="link-stat-tracker-choice-studio"]'))`,
      Boolean,
    );

    const inspectReturnLink = async (testId: string) => connection!.evaluate<{
      label: string;
      href: string;
      height: number;
    }>(`(() => {
      const link = document.querySelector('[data-testid="${testId}"]');
      const rect = link?.getBoundingClientRect();
      return {
        label: link?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        href: link instanceof HTMLAnchorElement ? new URL(link.href).pathname : '',
        height: rect?.height || 0,
      };
    })()`, page!.sessionId);

    const sportChoiceLink = await inspectReturnLink('link-stat-tracker-choice-studio');
    assert.equal(sportChoiceLink.label, 'Back to Game Day Hub');
    assert.equal(sportChoiceLink.href, '/studio');
    assert.ok(sportChoiceLink.height >= 44, `sport-choice return link should be at least 44px tall, received ${sportChoiceLink.height}px`);

    await connection.evaluate(
      `document.querySelector('[data-testid="button-choose-tracker-sport-basketball"]')?.click()`,
      page.sessionId,
    );
    await waitFor(
      connection,
      page.sessionId,
      `Boolean(document.querySelector('[data-testid="stat-tracker-setup"]'))
        && Boolean(document.querySelector('[data-testid="link-stat-tracker-studio"]'))`,
      Boolean,
    );
    const setupLink = await inspectReturnLink('link-stat-tracker-studio');
    assert.equal(setupLink.label, 'Back to Game Day Hub');
    assert.equal(setupLink.href, '/studio');
    assert.ok(setupLink.height >= 44, `setup return link should be at least 44px tall, received ${setupLink.height}px`);

    await connection.evaluate(
      `document.querySelector('[data-testid="link-stat-tracker-studio"]')?.click()`,
      page.sessionId,
    );
    await waitFor(connection, page.sessionId, `location.pathname === '/studio'`, Boolean);
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    releaseBrowserTestLock();
  }
});

test('saved athlete profile names reach game tools and HYPE Card setup stays the entrypoint', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-dashboard-profile-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    const viteProbe = createServer();
    const { port: vitePort } = await listen(viteProbe);
    await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    await writeFile(fixtures.harnessPath, harnessSource(), 'utf8');
    await writeFile(fixtures.htmlPath, htmlSource(fixtures.harnessPath.slice(appDirectory.length + 1)), 'utf8');

    devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: {
        ...process.env,
        PORT: String(vitePort),
        BASE_PATH: '/',
        VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    devServerMonitor = monitorProcess(devServer, 'Vite dev server');
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-profile-propagation-browser-'));

    await waitForUrl(`http://127.0.0.1:${vitePort}/`, 20_000, devServerMonitor);
    const debugProbe = createServer();
    const { port: debugPort } = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 20_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?profile-propagation`);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"btn-profile-save\\"]") !== null', Boolean, 30_000);

    await connection.evaluate(`(() => {
      const athlete = document.querySelector('#athleteName');
      const team = document.querySelector('#teamName');
      if (!(athlete instanceof HTMLInputElement) || !(team instanceof HTMLInputElement)) throw new Error('Profile fields not found');
      const setValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue(athlete, 'Taylor Morgan');
      setValue(team, 'Northside Comets');
      document.querySelector('[data-testid="btn-profile-save"]')?.click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.body?.innerText.includes("Taylor Morgan")', Boolean);

    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"athlete-summary\\"]") !== null && document.body?.innerText.includes("Taylor Morgan")',
      Boolean,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="athlete-summary"]\')?.textContent || ""', page.sessionId),
      /Taylor Morgan/,
    );

    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-stat-tracker"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-tracker-layout\\"]") !== null', Boolean);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"athlete-stat-target-three-point\\"] img")?.complete === true', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="live-tracker-score-card-athlete"]\')?.textContent || ""', page.sessionId),
      'Taylor Morgan0',
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="live-tracker-stat-controls"]\')?.textContent || ""', page.sessionId),
      /Taylor Morgan/,
    );
    assert.deepEqual(
      await connection.evaluate(`(() => {
        const target = document.querySelector('[data-testid="athlete-stat-target-three-point"]');
        const image = target?.querySelector('img');
        const rect = target?.getBoundingClientRect();
        if (!(target instanceof HTMLButtonElement) || !(image instanceof HTMLImageElement) || !rect) return null;
        return {
          accessibleName: target.getAttribute('aria-label'),
          objectPosition: image.style.objectPosition,
          transform: image.style.transform,
          transformOrigin: image.style.transformOrigin,
          width: rect.width,
          height: rect.height,
        };
      })()`, page.sessionId),
    {
      accessibleName: 'Record Three-point field goal for Taylor Morgan',
      objectPosition: '50% 50%',
      transform: 'scale(1)',
      transformOrigin: '50% 50%',
      width: 44,
      height: 44,
    },
    );
    await connection.evaluate(`document.querySelector('[data-testid="athlete-stat-target-three-point"] img')?.dispatchEvent(new Event('error'))`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"athlete-stat-target-three-point\\"] img") === null', Boolean);
    assert.deepEqual(
      await connection.evaluate(`(() => {
        const target = document.querySelector('[data-testid="athlete-stat-target-three-point"]');
        return {
          accessibleName: target?.getAttribute('aria-label'),
          fallback: target?.textContent?.trim(),
        };
      })()`, page.sessionId),
      {
        accessibleName: 'Record Three-point field goal for Taylor Morgan',
        fallback: 'TM',
      },
    );

    await connection.evaluate(`document.querySelector('[data-testid="button-test-edit-profile"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"btn-profile-save\\"]") !== null', Boolean);
    assert.deepEqual(
      await connection.evaluate(`(() => ({
        fileInputs: document.querySelectorAll('input[type="file"]').length,
        athletePhotoHeading: /Athlete Photo/i.test(document.body.innerText),
        cropEditor: Boolean(document.querySelector('[data-testid="athlete-photo-crop-editor"]')),
      }))()`, page.sessionId),
      { fileInputs: 0, athletePhotoHeading: false, cropEditor: false },
    );
    await connection.evaluate(`document.querySelector('[data-testid="btn-profile-cancel"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-test-open-athlete-fan-card\\"]") !== null', Boolean);

    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-athlete-fan-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"link-athlete-fan-card-manager\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="link-athlete-fan-card-manager"]\')?.getAttribute("href") || ""', page.sessionId),
      '/studio/athlete-page',
    );

    await connection.evaluate(`document.querySelector('[data-testid="button-test-edit-profile"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"btn-profile-save\\"]") !== null', Boolean);
    await connection.evaluate(`(() => {
      const athlete = document.querySelector('#athleteName');
      if (!(athlete instanceof HTMLInputElement)) throw new Error('Profile field not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(athlete, 'Jordan Lee');
      athlete.dispatchEvent(new Event('input', { bubbles: true }));
      athlete.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('[data-testid="btn-profile-save"]')?.click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.body?.innerText.includes("Jordan Lee")', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-athlete-fan-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"link-athlete-fan-card-manager\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="link-athlete-fan-card-manager"]\')?.getAttribute("href") || ""', page.sessionId),
      '/studio/athlete-page',
    );

    await connection.evaluate(`document.querySelector('[data-testid="button-test-edit-profile"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"btn-profile-save\\"]") !== null', Boolean);
    await connection.evaluate(`(() => {
      const athlete = document.querySelector('#athleteName');
      if (!(athlete instanceof HTMLInputElement)) throw new Error('Profile field not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(athlete, '');
      athlete.dispatchEvent(new Event('input', { bubbles: true }));
      athlete.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('[data-testid="btn-profile-save"]')?.click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-test-open-stat-tracker\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-stat-tracker"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-tracker-layout\\"]") !== null', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="live-tracker-score-card-athlete"]\')?.textContent || ""', page.sessionId),
      /Your score/,
    );
    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-athlete-fan-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"link-athlete-fan-card-manager\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="link-athlete-fan-card-manager"]\')?.getAttribute("href") || ""', page.sessionId),
      '/studio/athlete-page',
    );
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    if (devServer && devServerMonitor) {
      if (!devServerMonitor.hasExited()) devServer.kill('SIGTERM');
      await devServerMonitor.waitForExit();
    }
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(fixtures.harnessPath, { force: true });
    await rm(fixtures.htmlPath, { force: true });
    releaseBrowserTestLock();
  }
});
