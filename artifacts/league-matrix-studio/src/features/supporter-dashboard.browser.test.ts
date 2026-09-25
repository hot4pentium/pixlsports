import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
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
  const diagnostic = await page.evaluate<{ body: string; testError?: string }>(
    '({ body: document.body?.innerText || "", testError: document.body?.dataset.testError })',
    sessionId,
  ).catch((error) => ({
    body: `unavailable: ${error instanceof Error ? error.message : String(error)}`,
    testError: undefined,
  }));
  throw new Error(`Timed out waiting for browser condition: ${expression}; testError=${diagnostic.testError || 'none'}; body=${diagnostic.body.slice(0, 700)}`);
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

test('supporter dashboard keeps Game On Card prominent and mobile navigation accessible', { concurrency: false }, async () => {
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
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}`);

    for (const width of [320, 390, 430, 639, 640, 768]) {
      const height = width === 768 ? 1024 : 844;
      await connection.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: true,
      }, page.sessionId);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"mobile-header\\"]") !== null', Boolean);
      const result = await connection.evaluate<{
        dashboardVisible: boolean;
        viewportOverflow: boolean;
        dashboardOverflow: boolean;
        headerPosition: string;
        headerZIndex: string;
        headerTop: number;
        headerTopAfterScroll: number;
        heroClearsHeader: boolean;
        heroColumnCount: number;
        heroCornerRadius: string;
        heroCardsContained: boolean;
        heroKickerFits: boolean;
        collectionVisible: boolean;
        collectionLeadsHero: boolean;
        collectionFits: boolean;
        portraitCard: boolean;
        eventActionsVisible: boolean;
        removedPanels: boolean;
      }>(`(() => {
        const root = document.querySelector('.supporter-dashboard-mobile-shell');
        const header = document.querySelector('[data-testid="mobile-header"]');
        const hero = document.querySelector('[data-testid="mobile-hero-banner"]');
        const collection = root?.querySelector('[data-testid="game-on-dashboard-collection"]');
        const card = collection?.querySelector('.game-on-collection__card');
        const edit = card?.querySelector('[data-testid^="button-edit-calendar-"]');
        const prep = card?.querySelector('[data-testid^="link-card-prep-"]');
        const stats = card?.querySelector('[data-testid^="link-card-stats-"]');
        const columns = document.querySelector('.mobile-hero-columns');
        const athleteCard = document.querySelector('[data-testid="btn-mobile-athlete-switcher"]');
        const eventCard = document.querySelector('[data-testid="card-mobile-featured-event"]');
        const eventKicker = document.querySelector('.mobile-featured-event-kicker');
        if (!(root instanceof HTMLElement) || !(header instanceof HTMLElement) || !(hero instanceof HTMLElement)
          || !(collection instanceof HTMLElement) || !(card instanceof HTMLElement)
          || !(edit instanceof HTMLElement) || !(prep instanceof HTMLElement) || !(stats instanceof HTMLElement)
          || !(columns instanceof HTMLElement) || !(athleteCard instanceof HTMLElement)
          || !(eventCard instanceof HTMLElement) || !(eventKicker instanceof HTMLElement)) {
          throw new Error('Mobile dashboard shell is incomplete');
        }
        const scroller = document.scrollingElement;
        if (!(scroller instanceof HTMLElement)) throw new Error('Missing document scroller');
        scroller.scrollTop = 0;
        const initialHeaderRect = header.getBoundingClientRect();
        const heroRect = hero.getBoundingClientRect();
        const athleteRect = athleteCard.getBoundingClientRect();
        const eventRect = eventCard.getBoundingClientRect();
        const gridColumns = getComputedStyle(columns).gridTemplateColumns.trim().split(/\\s+/);
        scroller.scrollTop = Math.min(240, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
        const scrolledHeaderRect = header.getBoundingClientRect();
        scroller.scrollTop = 0;
        const rootRect = root.getBoundingClientRect();
        return {
          dashboardVisible: getComputedStyle(root).display !== 'none',
          viewportOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          dashboardOverflow: root.scrollWidth > root.clientWidth,
          headerPosition: getComputedStyle(header).position,
          headerZIndex: getComputedStyle(header).zIndex,
          headerTop: Math.round(initialHeaderRect.top - rootRect.top),
          headerTopAfterScroll: Math.round(scrolledHeaderRect.top),
          heroClearsHeader: Math.round(heroRect.top) >= Math.round(initialHeaderRect.bottom),
          heroColumnCount: gridColumns.length,
          heroCornerRadius: getComputedStyle(hero).borderRadius,
          heroCardsContained: athleteRect.left >= heroRect.left
            && athleteRect.right <= heroRect.right
            && eventRect.left >= heroRect.left
            && eventRect.right <= heroRect.right,
          heroKickerFits: eventKicker.scrollWidth <= eventKicker.clientWidth,
          collectionVisible: getComputedStyle(collection).display !== 'none',
          collectionLeadsHero: Boolean(collection.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING),
          collectionFits: collection.getBoundingClientRect().left >= -1
            && collection.getBoundingClientRect().right <= innerWidth + 1,
          portraitCard: card.getBoundingClientRect().width / card.getBoundingClientRect().height <= 0.5,
          eventActionsVisible: [edit, prep, stats].every((action) => getComputedStyle(action).display !== 'none'),
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
        heroColumnCount: width < 640 ? 1 : 2,
        heroCornerRadius: '24px',
        heroCardsContained: true,
        heroKickerFits: true,
        collectionVisible: true,
        collectionLeadsHero: true,
        collectionFits: true,
        portraitCard: true,
        eventActionsVisible: true,
        removedPanels: true,
      }, `mobile header behavior at ${width}px`);
    }

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector(".supporter-dashboard-desktop-shell [data-testid=\\"game-on-dashboard-collection\\"]") !== null', Boolean);
    assert.deepEqual(await connection.evaluate<{
      oldPanelsRemoved: boolean;
      actionCount: number;
      collectionLeadsHero: boolean;
    }>(`(() => {
      const collection = document.querySelector('.supporter-dashboard-desktop-shell [data-testid="game-on-dashboard-collection"]');
      const hero = document.querySelector('.supporter-dashboard-desktop-shell .dashboard-hero-banner');
      if (!(collection instanceof HTMLElement)) throw new Error('Desktop Game On collection is missing');
      return {
        oldPanelsRemoved: !document.querySelector('[data-testid="section-desktop-workspace"], [data-testid="workspace-recommendation"], [data-testid="desktop-game-on-entry"]'),
        actionCount: collection.querySelectorAll('.game-on-collection__actions > *').length,
        collectionLeadsHero: Boolean(collection && hero && (collection.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING)),
      };
    })()`, page.sessionId), {
      oldPanelsRemoved: true,
      actionCount: 3,
      collectionLeadsHero: true,
    });

    await connection.evaluate(`document.querySelector('.supporter-dashboard-desktop-shell [data-testid="button-create-game-on-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"select-game-on-type\\"]")?.value === "game"', Boolean);
    await connection.evaluate(`(() => {
      const select = document.querySelector('[data-testid="select-game-on-type"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Event type picker missing');
      select.value = 'practice';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"select-game-on-type\\"]")?.value === "practice"', Boolean);
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=\\"input-game-on-opponent\\"]") === null', page.sessionId), true);

    assert.deepEqual(await connection.evaluate<{
      profileTag: string;
      profileHref: string | null;
      scheduleHref: string | null;
      prepHref: string;
      statsHref: string;
      hypeHref: string | null;
      oldPanelsRemoved: boolean;
    }>(`(() => {
      const profileLink = document.querySelector('[data-testid="btn-mobile-open-profile"]');
      const prep = document.querySelector('[data-testid^="link-card-prep-"]');
      const stats = document.querySelector('[data-testid^="link-card-stats-"]');
      return {
        profileTag: profileLink?.tagName || '',
        profileHref: profileLink?.getAttribute('href') || null,
        scheduleHref: document.querySelector('[data-testid="btn-mobile-nav-schedule"]')?.getAttribute('href') || null,
        prepHref: prep?.getAttribute('href') || '',
        statsHref: stats?.getAttribute('href') || '',
        hypeHref: document.querySelector('[data-testid="link-mobile-independent-hype"]')?.getAttribute('href') || null,
        oldPanelsRemoved: !document.querySelector('[data-testid="section-mobile-workspace"], [data-testid="card-mobile-recommendation"]'),
      };
    })()`, page.sessionId), {
      profileTag: 'A',
      profileHref: '/studio/profile',
      scheduleHref: '/studio/schedule?eventId=game-1',
      prepHref: '/studio/checklist?gameId=game-1&eventType=game',
      statsHref: '/studio/stat-tracker?source=workspace&eventId=game-1&eventType=game&date=2026-09-21&opponent=Rivals',
      hypeHref: '/studio/hype-card?source=workspace&eventId=game-1&eventType=game&date=2026-09-21&opponent=Rivals',
      oldPanelsRemoved: true,
    });
    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'Rivals' },
      { id: 'practice-1', type: 'practice', date: '2026-09-22', time: '18:30', location: 'Northside Gym' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'Array.from(document.querySelectorAll(".game-on-collection__card")).some(card => card.querySelector(".game-on-collection__kind")?.textContent?.includes("Practice"))', Boolean);
    assert.deepEqual(await connection.evaluate<{ practicePrep: boolean; practiceStats: boolean; gameStats: boolean }>(`(() => {
      const cards = Array.from(document.querySelectorAll('.game-on-collection__card'));
      const practice = cards.find((card) => card.querySelector('.game-on-collection__kind')?.textContent?.includes('Practice'));
      const game = cards.find((card) => card.querySelector('.game-on-collection__kind')?.textContent?.includes('Game'));
      return {
        practicePrep: Boolean(practice?.querySelector('[data-testid^="link-card-prep-"]')),
        practiceStats: Boolean(practice?.querySelector('[data-testid^="link-card-stats-"]')),
        gameStats: Boolean(game?.querySelector('[data-testid^="link-card-stats-"]')),
      };
    })()`, page.sessionId), {
      practicePrep: true,
      practiceStats: false,
      gameStats: true,
    });

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
      ['btn-mobile-nav-schedule', '/studio/schedule'],
      ['btn-mobile-nav-home', '/studio'],
      ['btn-mobile-nav-prep', '/studio/checklist'],
      ['btn-mobile-nav-stat-tracker', '/studio/stat-tracker'],
      ['btn-mobile-nav-hype', '/studio/hype-card'],
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

function harnessSource() {
  return `
import { createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, useLocation } from 'wouter';
import { ClerkProvider } from '@clerk/react';
import { HypeCardEditor } from './src/features/hype-card';
import { ChecklistPage, ScheduleEditor } from './src/App';
import { MeetingCapture } from './src/features/meeting-capture';
import { NotificationSettings } from './src/features/notification-settings';
import { SupporterDashboardView, SupporterProfileView } from './src/features/supporter-dashboard';
import { useCachedSupporterPhoto } from './src/features/supporter-photo-cache';
import { LiveTrackerGame, StatTrackerPage } from './src/features/stat-tracker-page';
import { getSportRule } from './src/features/stat-tracker';
import { defaultProject, readHypeCardProject } from './src/features/hype-card-types';
import { mapLocalSupporterHypeCard, mapRecentSupporterProjects, parseSupporterStorageSyncEvent, seedHypeCardFromSupporterProfile } from './src/features/supporter-dashboard-model';
import './src/index.css';

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
  date: '2026-09-21',
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
    athleteImageUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="80"%3E%3Crect width="120" height="80" fill="%23007A78"/%3E%3C/svg%3E',
    athleteImageCrop: { x: 20, y: 70, zoom: 150 },
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
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [pendingPhotoCrop, setPendingPhotoCrop] = useState({ x: 50, y: 50, zoom: 100 });
  const [savedCloudProject] = useState({
    playerName: 'Past Season Athlete',
    jerseyNumber: '4',
    position: 'Forward',
    teamName: 'Legacy Team',
  });
  const seededLocalProject = seedHypeCardFromSupporterProfile(defaultProject(), profile);
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
  const handlePhotoChange = (file) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setPendingPhoto({ url: String(reader.result || '') });
      setPendingPhotoCrop({ x: 50, y: 50, zoom: 100 });
    });
    reader.readAsDataURL(file);
  };
  const fanToolNav = createElement('nav', { 'data-testid': 'fan-tool-nav', className: 'flex gap-3 p-4' },
    createElement('button', { type: 'button', 'data-testid': 'button-test-open-dashboard', onClick: () => setRoute('dashboard') }, 'Dashboard'),
    createElement('button', { type: 'button', 'data-testid': 'button-test-open-stat-tracker', onClick: () => setRoute('tracker') }, 'Stat Tracker'),
    createElement('button', { type: 'button', 'data-testid': 'button-test-open-hype-card', onClick: () => setRoute('hype') }, 'Hype Card'),
    createElement('button', { type: 'button', 'data-testid': 'button-test-edit-profile', onClick: openProfile }, 'Profile'),
  );

  if (route === 'profile') {
    return createElement('main', null,
      createElement(SupporterProfileView, {
        profile: draft,
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
         athletePhotoUrl: profile.athleteImageUrl,
         athletePhotoCrop: profile.athleteImageCrop,
         pendingPhotoUrl: pendingPhoto?.url,
         pendingPhotoCrop,
         onPhotoChange: handlePhotoChange,
         onPhotoCropChange: setPendingPhotoCrop,
         onPhotoUpload: () => {
           if (!pendingPhoto) return;
           const nextProfile = {
             ...profile,
             athleteImageUrl: pendingPhoto.url,
             athleteImageCrop: pendingPhotoCrop,
           };
           setProfile(nextProfile);
           window.localStorage.setItem(profileStorageKey, JSON.stringify(nextProfile));
           setPendingPhoto(null);
         },
         onPhotoCancel: () => setPendingPhoto(null),
         onPhotoRemove: () => {
           const nextProfile = { ...profile, athleteImageUrl: '', athleteImageCrop: undefined };
           setProfile(nextProfile);
           window.localStorage.setItem(profileStorageKey, JSON.stringify(nextProfile));
         },
        photoBusy: false,
        photoError: '',
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
        athleteImageUrl: profile.athleteImageUrl,
        athleteImageCrop: profile.athleteImageCrop,
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

  if (route === 'hype') {
    return createElement('main', null,
      fanToolNav,
      createElement('section', { 'data-testid': 'hype-card-profile-seed' },
        createElement('label', null, 'Player name',
          createElement('input', { 'data-testid': 'input-hype-player-name', value: seededLocalProject.playerName, readOnly: true }),
        ),
        createElement('p', { 'data-testid': 'text-hype-cloud-player-name' }, savedCloudProject.playerName),
      ),
    );
  }

  return createElement('main', null,
    fanToolNav,
    createElement(SupporterDashboardView, {
      profile,
      events: [],
      nextGameIsUpcoming: false,
      projects: [],
      scheduleSource: null,
      connectionLabel: '',
      athletePhotoUrl: profile.athleteImageUrl,
      athletePhotoCrop: profile.athleteImageCrop,
      onOpenStatTracker: () => setRoute('tracker'),
      onOpenChecklist: () => {},
    }),
  );
}

function LocalHypeCardFlowHarness() {
  const [location] = useLocation();
  const [localProject, setLocalProject] = useState(() => readHypeCardProject());
  useEffect(() => {
    const handleStorage = (event) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (parseSupporterStorageSyncEvent(event)?.type !== 'local-hype-card') return;
      setLocalProject(readHypeCardProject());
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  const cloudProjects = [{
    id: 'cloud-hype-card-1',
    name: 'Cloud Championship',
    updatedAt: '2026-09-19T12:00:00.000Z',
    project: {
      ...defaultProject(),
      tool: 'hype-card',
      headline: 'Cloud Championship',
      playerName: 'Cloud Athlete',
    },
  }];

  if (location === '/studio/hype-card') {
    return createElement(HypeCardEditor);
  }

  if (location === '/studio/hype-card/cloud-hype-card-1') {
    return createElement('main', { 'data-testid': 'cloud-hype-card-editor-route' },
      createElement('h1', null, 'Cloud Hype Card editor'),
    );
  }

  const projects = localProject
    ? [
      mapLocalSupporterHypeCard(localProject, '2026-09-20T12:00:00.000Z'),
      ...mapRecentSupporterProjects(cloudProjects),
    ]
    : [];

  return createElement(SupporterDashboardView, {
    profile,
    events: [],
    nextGameIsUpcoming: false,
    projects,
    scheduleSource: null,
    connectionLabel: '',
    onOpenStatTracker: () => {},
    onOpenChecklist: () => {},
  });
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
      projects: [],
      scheduleSource: null,
      connectionLabel: '',
      athletePhotoUrl: photo.imageUrl,
      athletePhotoCrop: photo.data
        ? { x: photo.data.cropX, y: photo.data.cropY, zoom: photo.data.cropZoom }
        : undefined,
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
      projects: [],
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
      : tool === '/studio/hype-card' ? createElement(HypeCardEditor)
      : createElement(SupporterDashboardView, {
        profile,
        events,
        nextGameIsUpcoming: true,
        projects: [],
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
    const requestUrl = typeof input === 'string' ? input : input.url;
    if (new URL(requestUrl, window.location.href).pathname === '/api/game-on-cards/owned') {
      return Promise.resolve(new Response('[]', {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (
      window.location.search.includes('supporter-active-game-sync')
      && requestUrl.endsWith('/api/supporter/active-game')
    ) {
      const method = String(init?.method || 'GET').toUpperCase();
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
        window.sessionStorage.setItem(selectionKey, JSON.stringify(body.gameId));
        return Promise.resolve(new Response(JSON.stringify({ gameId: body.gameId }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      const gameId = JSON.parse(window.sessionStorage.getItem(selectionKey) || 'null');
      return Promise.resolve(new Response(JSON.stringify({ gameId }), {
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
      if (requestUrl.endsWith('/api/notifications/config')) {
        return Promise.resolve(new Response(JSON.stringify({
          available: true,
          publicKey: 'BROWSER_TEST_PUBLIC_KEY',
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
        const preferences = JSON.parse(window.localStorage.getItem(preferencesStorageKey) || '{"oneHourBefore":true,"dayOf":false}');
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
  if (window.location.search.includes('notification-preferences')) {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({}) },
    });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => 'denied' } });
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    if (!window.sessionStorage.getItem('supporter-active-game-sync-server-selection')) {
      window.sessionStorage.setItem('supporter-active-game-sync-server-selection', 'null');
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
    root.render(createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(ProfilePropagationHarness),
      ),
    ));
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
    root.render(createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(CachedPhotoStartupHarness),
      ),
    ));
    return;
  }
  if (window.location.search.includes('local-hype-card-flow')) {
    root.render(createElement(ClerkProvider, {
      publishableKey: 'pk_test_ZXhhbXBsZS5jb20k',
    },
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(LocalHypeCardFlowHarness),
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
      createElement(NotificationSettings),
    ));
    return;
  }
  const renderDashboard = () => root.render(
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(SupporterDashboardView, {
          profile,
          userId: window.location.search.includes('supporter-active-game-sync') ? 'supporter-sync-user' : undefined,
          events: dashboardEvents,
          nextGameIsUpcoming: true,
          projects: [],
          scheduleSource: 'custom',
          connectionLabel: 'Northside · 2026',
          onOpenStatTracker: () => navigate('/studio/stat-tracker'),
          onOpenChecklist: () => navigate('/studio/checklist'),
        }),
      ),
    ),
  );
  window.__setSupporterDashboardEvents = (nextEvents) => {
    dashboardEvents = nextEvents;
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
  <body><div id="test-root"></div><script type="module">import('/${harnessFilename}?browser-test=' + Date.now()).then(({ mount }) => mount()).catch((error) => { document.body.dataset.testError = String(error); });</script></body>
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
      return {
        ready: oneHour instanceof HTMLInputElement && dayOf instanceof HTMLInputElement && !oneHour.disabled && !dayOf.disabled,
        oneHourBefore: oneHour instanceof HTMLInputElement ? oneHour.checked : null,
        dayOf: dayOf instanceof HTMLInputElement ? dayOf.checked : null,
      };
    })()`;
    await waitFor(
      connection,
      page.sessionId,
      preferencesExpression,
      (value: { ready: boolean }) => value.ready,
    );
    assert.deepEqual(
      await connection.evaluate(preferencesExpression, page.sessionId),
      { ready: true, oneHourBefore: true, dayOf: false },
    );

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
      { ready: true, oneHourBefore: false, dayOf: true },
    );

    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      preferencesExpression,
      (value: { ready: boolean; oneHourBefore: boolean | null; dayOf: boolean | null }) => (
        value.ready && value.oneHourBefore === false && value.dayOf === true
      ),
    );

    await clickPreference('checkbox-reminder-one-hour', 3);
    await clickPreference('checkbox-reminder-day-of', 4);
    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      preferencesExpression,
      (value: { ready: boolean; oneHourBefore: boolean | null; dayOf: boolean | null }) => (
        value.ready && value.oneHourBefore === true && value.dayOf === false
      ),
    );

    assert.deepEqual(
      await connection.evaluate<Array<{
        method: string;
        url: string;
        body: { oneHourBefore: boolean; dayOf: boolean };
      }>>(`JSON.parse(localStorage.getItem('browser-test-notification-preference-requests') || '[]')`, page.sessionId),
      [
        { method: 'PATCH', url: '/api/notifications/preferences', body: { oneHourBefore: false, dayOf: false } },
        { method: 'PATCH', url: '/api/notifications/preferences', body: { oneHourBefore: false, dayOf: true } },
        { method: 'PATCH', url: '/api/notifications/preferences', body: { oneHourBefore: true, dayOf: true } },
        { method: 'PATCH', url: '/api/notifications/preferences', body: { oneHourBefore: true, dayOf: false } },
      ],
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
          const recent = document.querySelector('[data-testid="section-recent-hype-cards"]');
          const oldPanels = document.querySelector('[data-testid="section-desktop-workspace"], [data-testid="workspace-recommendation"]');
          return Boolean(upcoming && recent && !oldPanels && !document.querySelector('#all-tools'));
       })()`, page.sessionId),
       true,
     );

    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") !== null', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-reminder-dialog"]\')?.textContent || ""', page.sessionId),
      /Get ready/,
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
    await connection.evaluate(`(() => { const select = document.querySelector('[data-testid="select-active-supporter-game"]'); if (!(select instanceof HTMLSelectElement)) throw new Error('Active game selector missing'); select.value = 'game-2'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") !== null', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-reminder-dialog"]\')?.textContent || ""', page.sessionId),
      /Get ready/,
    );
    await connection.evaluate(`(() => { const select = document.querySelector('[data-testid="select-active-supporter-game"]'); if (!(select instanceof HTMLSelectElement)) throw new Error('Active game selector missing'); select.value = 'game-1'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null', Boolean);

    await connection.evaluate('localStorage.removeItem("pixlsports-supporter-stage-ack:game-1:completed")', page.sessionId);
    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'final' },
      { id: 'game-2', type: 'game', date: '2026-09-22', time: '18:30', location: 'Eastside Gym', opponent: 'Visitors', status: 'upcoming' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") !== null', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-reminder-dialog"]\')?.textContent || ""', page.sessionId),
      /Send the hype/,
    );
    await connection.evaluate(`document.querySelector('[data-testid="stage-reminder-got-it"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="stage-upcoming-next"]\'))', page.sessionId),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="stage-completed-next"]\'))', page.sessionId),
      false,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="past-game-notice"]\'))', page.sessionId),
      true,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="past-game-notice"]\')?.textContent || ""', page.sessionId),
      /past game/i,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="link-context-hype-card"]\')?.getAttribute("href") || ""', page.sessionId),
      /eventId=game-1/,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="button-return-to-recommended-game"]\'))', page.sessionId),
      true,
    );
    await connection.evaluate(`document.querySelector('[data-testid="stage-completed"]')?.click()`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"week-path-content\\"]")?.getAttribute("data-selected-path") === "completed"',
      Boolean,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="week-path-content"] a\')?.getAttribute("href") || ""', page.sessionId),
      /gameId=game-1/,
    );
    await connection.evaluate(`document.querySelector('[data-testid="button-return-to-recommended-game"]')?.click()`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"select-active-supporter-game\\"]")?.value === "game-2"',
      Boolean,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="past-game-notice"]\'))', page.sessionId),
      false,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="button-return-to-recommended-game"]\'))', page.sessionId),
      false,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="stage-upcoming-next"]\'))', page.sessionId),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="stage-completed-next"]\'))', page.sessionId),
      false,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="week-path-content"] a\')?.getAttribute("href") || ""', page.sessionId),
      /gameId=game-2/,
    );

    await connection.evaluate(`window.__setSupporterDashboardEvents([
      { id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'final' }
    ])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"section-next-game-context\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="past-game-notice"]\'))', page.sessionId),
      false,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="link-context-hype-card"]\')?.getAttribute("href") || ""', page.sessionId),
      /eventId=game-1/,
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
    const primaryRoutes = await connection.evaluate<Record<string, string>>(`(() => {
      const prep = document.querySelector('[data-testid^="link-card-prep-"]');
      const stats = document.querySelector('[data-testid^="link-card-stats-"]');
      const hype = document.querySelector('[data-testid="link-desktop-independent-hype"]');
      return {
        prep: prep?.getAttribute('href') || '',
        stats: stats?.getAttribute('href') || '',
        hype: hype?.getAttribute('href') || '',
      };
    })()`, page.sessionId);
    assert.match(primaryRoutes.prep, /^\/studio\/checklist(?:\?|$)/);
    assert.match(primaryRoutes.stats, /^\/studio\/stat-tracker(?:\?|$)/);
    assert.match(primaryRoutes.hype, /^\/studio\/hype-card(?:\?|$)/);
    assert.equal(await connection.evaluate<boolean>(`(() => {
      const prep = document.querySelector('[data-testid^="link-card-prep-"]');
      const stats = document.querySelector('[data-testid^="link-card-stats-"]');
      return prep instanceof HTMLElement && stats instanceof HTMLElement
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
        bottomNavVisible: boolean;
         bottomNavPosition: string;
         bottomNavZIndex: string;
         bottomNavLeft: number;
         bottomNavRight: number;
         bottomNavBottom: number;
         bottomNavHeight: number;
         mobileContentPaddingBottom: string;
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
         const bottomNav = document.querySelector('[data-testid="mobile-bottom-nav"]');
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
          bottomNavVisible: isVisible(bottomNav),
           bottomNavPosition: bottomNav instanceof HTMLElement ? getComputedStyle(bottomNav).position : '',
           bottomNavZIndex: bottomNav instanceof HTMLElement ? getComputedStyle(bottomNav).zIndex : '',
           bottomNavLeft: bottomNav instanceof HTMLElement ? Math.round(bottomNav.getBoundingClientRect().left) : -1,
           bottomNavRight: bottomNav instanceof HTMLElement ? Math.round(bottomNav.getBoundingClientRect().right) : -1,
           bottomNavBottom: bottomNav instanceof HTMLElement ? Math.round(bottomNav.getBoundingClientRect().bottom) : -1,
           bottomNavHeight: bottomNav instanceof HTMLElement ? Math.round(bottomNav.getBoundingClientRect().height) : -1,
           mobileContentPaddingBottom: mobileRoot instanceof HTMLElement ? getComputedStyle(mobileRoot).paddingBottom : '',
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
        bottomNavVisible: true,
          bottomNavPosition: 'fixed',
         bottomNavZIndex: '60',
          bottomNavLeft: 0,
          bottomNavRight: width,
         bottomNavBottom: width === 768 ? 1024 : 844,
         bottomNavHeight: 88,
         mobileContentPaddingBottom: '112px',
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
      'document.querySelector("[data-testid=\\"select-active-supporter-game\\"]")?.value === "game-2"',
      Boolean,
    );
    await connection.evaluate(`(() => {
      const select = document.querySelector('[data-testid="select-active-supporter-game"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Active game selector is missing');
      select.value = 'game-1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"past-game-notice\\"]") !== null',
      Boolean,
    );
    const narrowPastGameLayout = await connection.evaluate<{
      contextOverflow: boolean;
      noticeOverflow: boolean;
      titleVisible: boolean;
      hypeCardVisible: boolean;
      nextMarkerVisible: boolean;
    }>(`(() => {
      const context = document.querySelector('[data-testid="section-next-game-context"]');
      const notice = document.querySelector('[data-testid="past-game-notice"]');
      const title = document.querySelector('[data-testid="next-game-heading"]');
      const hypeCard = document.querySelector('[data-testid="link-context-hype-card"]');
      const nextMarker = document.querySelector('[data-testid="stage-upcoming-next"]');
      const viewportWidth = document.documentElement.clientWidth;
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= viewportWidth;
      };
      return {
        contextOverflow: Boolean(context && context.scrollWidth > context.clientWidth),
        noticeOverflow: Boolean(notice && notice.scrollWidth > notice.clientWidth),
        titleVisible: isVisible(title),
        hypeCardVisible: isVisible(hypeCard),
        nextMarkerVisible: isVisible(nextMarker),
      };
    })()`, page.sessionId);
    assert.deepEqual(narrowPastGameLayout, {
      contextOverflow: false,
      noticeOverflow: false,
      titleVisible: false,
      hypeCardVisible: false,
      nextMarkerVisible: false,
    });
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="stage-completed-next"]\'))', page.sessionId),
      false,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="next-game-heading"]\')?.textContent || ""', page.sessionId),
      /ChampionshipOpponentWithAnUnreasonablyLongName/,
    );

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    const desktopPastGameLayout = await connection.evaluate<{
      contextOverflow: boolean;
      noticeOverflow: boolean;
      titleVisible: boolean;
      hypeCardVisible: boolean;
      nextMarkerVisible: boolean;
    }>(`(() => {
      const context = document.querySelector('[data-testid="section-next-game-context"]');
      const notice = document.querySelector('[data-testid="past-game-notice"]');
      const title = document.querySelector('[data-testid="next-game-heading"]');
      const hypeCard = document.querySelector('[data-testid="link-context-hype-card"]');
      const nextMarker = document.querySelector('[data-testid="stage-upcoming-next"]');
      const viewportWidth = document.documentElement.clientWidth;
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= viewportWidth;
      };
      return {
        contextOverflow: Boolean(context && context.scrollWidth > context.clientWidth),
        noticeOverflow: Boolean(notice && notice.scrollWidth > notice.clientWidth),
        titleVisible: isVisible(title),
        hypeCardVisible: isVisible(hypeCard),
        nextMarkerVisible: isVisible(nextMarker),
      };
    })()`, page.sessionId);
    assert.deepEqual(desktopPastGameLayout, {
      contextOverflow: true,
      noticeOverflow: false,
      titleVisible: true,
      hypeCardVisible: true,
      nextMarkerVisible: true,
    });
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="stage-completed-next"]\'))', page.sessionId),
      false,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="next-game-heading"]\')?.textContent || ""', page.sessionId),
      /ChampionshipOpponentWithAnUnreasonablyLongName/,
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
    await connection.evaluate(`document.querySelector('[data-testid^="link-card-prep-"][href*="game-2"]')?.click()`, page.sessionId);
    assert.equal(await connection.evaluate<string>('location.pathname', page.sessionId), '/studio/checklist');

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

test('supporter active game sync survives a device change and clears inaccessible games', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-active-game-sync-test');
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
    page = await openPage(
      connection,
      `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?supporter-active-game-sync`,
    );

    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"select-active-supporter-game\\"]")?.value === "game-default"',
      Boolean,
    );
    await waitFor(
      connection,
      page.sessionId,
      'JSON.parse(sessionStorage.getItem("supporter-active-game-sync-requests") || "[]").some((request) => request.method === "GET")',
      Boolean,
    );
    await connection.evaluate(`(() => {
      const select = document.querySelector('[data-testid="select-active-supporter-game"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('Active game selector missing');
      select.value = 'game-selected';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'JSON.parse(sessionStorage.getItem("supporter-active-game-sync-server-selection") || "null") === "game-selected"',
      Boolean,
    );
    const savedSelectionRequests = await connection.evaluate<Array<{ method: string; body: unknown }>>(
      'JSON.parse(sessionStorage.getItem("supporter-active-game-sync-requests") || "[]")',
      page.sessionId,
    );
    assert.deepEqual(
      savedSelectionRequests.find((request) => request.method === 'PUT')?.body,
      { gameId: 'game-selected' },
    );
    assert.doesNotMatch(JSON.stringify(savedSelectionRequests), /PRIVATE CHECKLIST NOTES|PRIVATE CHECKLIST ITEM/);

    await connection.evaluate(`(() => {
      localStorage.removeItem('pixlsports-supporter-active-game');
      localStorage.removeItem('pixlsports-workspace-event-context');
    })()`, page.sessionId);
    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"select-active-supporter-game\\"]")?.value === "game-selected"',
      Boolean,
    );

    await connection.evaluate(`(() => {
      sessionStorage.setItem('supporter-active-game-sync-server-selection', JSON.stringify('deleted-game'));
      localStorage.removeItem('pixlsports-supporter-active-game');
      localStorage.removeItem('pixlsports-workspace-event-context');
    })()`, page.sessionId);
    await reloadPage(connection, page);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"select-active-supporter-game\\"]")?.value === "game-default" && JSON.parse(sessionStorage.getItem("supporter-active-game-sync-server-selection") || "null") === null',
      Boolean,
    );
    const finalSelectionRequests = await connection.evaluate<Array<{ method: string; body: unknown }>>(
      'JSON.parse(sessionStorage.getItem("supporter-active-game-sync-requests") || "[]")',
      page.sessionId,
    );
    const selectionWrites = finalSelectionRequests.filter((request) => request.method === 'PUT');
    assert.ok(selectionWrites.some((request) => JSON.stringify(request.body) === JSON.stringify({ gameId: null })));
    assert.ok(selectionWrites.every((request) => {
      const body = request.body as Record<string, unknown>;
      return Object.keys(body).length === 1 && Object.hasOwn(body, 'gameId');
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
    await waitFor(connection, page.sessionId, 'document.querySelector(\'[data-testid^="link-card-prep-"][href*="game-1"]\') !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid^="link-card-prep-"][href*="game-1"]')?.click()`, page.sessionId);
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

test('a signed-in supporter keeps a chosen Calendar game through Prep, Stats, and Hype without publishing private prep', { concurrency: false }, async () => {
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
    const path = () => connection!.evaluate<string>('location.pathname', session);
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
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"btn-mobile-nav-schedule\\"]"))', Boolean);
    await connection.evaluate(`localStorage.setItem('leaguematrix-schedule-draft', ${JSON.stringify(JSON.stringify(schedule))})`, session);
    await click('btn-mobile-nav-schedule');
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"schedule-event-list\\"]"))', Boolean);
    assert.equal(await path(), '/studio/schedule');
    await click('button-select-schedule-event-1');
    await waitFor(connection, session, 'JSON.parse(localStorage.getItem("pixlsports-workspace-event-context") || "null")?.id === "game-selected"', Boolean);
    await click('journey-return-dashboard');
    await waitFor(connection, session, 'Boolean(document.querySelector(\'[data-testid^="link-card-prep-"][href*="game-selected"]\'))', Boolean);
    const context = JSON.parse(await selected()) as Record<string, string>;
    assert.deepEqual(context, {
      id: 'game-selected', type: 'game', date: '2026-10-13',
      time: '19:00', location: 'Away Gym', opponent: 'Tigers',
    });
    const prepHref = await connection.evaluate<string>(
      'document.querySelector(\'[data-testid^="link-card-prep-"][href*="game-selected"]\')?.getAttribute("href") || ""', session,
    );
    assert.match(prepHref, /gameId=game-selected&eventType=game/);
    await connection.evaluate(`document.querySelector('[data-testid^="link-card-prep-"][href*="game-selected"]')?.click()`, session);
    assert.equal(await path(), '/studio/checklist');
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"select-checklist-game\\"]")?.value === "game-selected"', Boolean);
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
    await waitFor(connection, session, 'Boolean(document.querySelector(\'[data-testid^="link-card-stats-"][href*="game-selected"]\'))', Boolean);
    const statsHref = await connection.evaluate<string>(
      'document.querySelector(\'[data-testid^="link-card-stats-"][href*="game-selected"]\')?.getAttribute("href") || ""', session,
    );
    assert.match(statsHref, /eventId=game-selected/);
    await connection.evaluate(`document.querySelector('[data-testid^="link-card-stats-"][href*="game-selected"]')?.click()`, session);
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
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"link-desktop-independent-hype\\"]"))', Boolean);
    const hypeHref = await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"link-desktop-independent-hype\\"]")?.getAttribute("href") || ""', session,
    );
    assert.match(hypeHref, /eventId=game-selected/);
    await click('link-desktop-independent-hype');
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"hype-card-notice\\"]")?.textContent?.includes("Game details are ready"))', Boolean);
    assert.equal(await path(), '/studio/hype-card');
    await waitFor(connection, session, `JSON.parse(localStorage.getItem('leaguematrix-hype-card-project-v2') || 'null')?.project?.achievement?.includes('Tigers') === true`, Boolean);
    const readHype = () => connection!.evaluate<{ text: string; inputs: string[]; stored: string; requests: string }>(`({
      text: document.body.innerText,
      inputs: Array.from(document.querySelectorAll('input')).map((node) => node.value),
      stored: localStorage.getItem('leaguematrix-hype-card-project-v2') || '',
      requests: sessionStorage.getItem('workspace-journey-requests') || '[]',
    })`, session);
    const hype = await readHype();
    assert.match(hype.stored, /vs Tigers/);
    assert.equal(JSON.parse(hype.stored).project.playerName, 'Alexandria Montgomery-Williams', 'athlete comes from the signed-in profile');
    for (const secret of [privateNote, privateItem]) {
      assert.ok(!JSON.stringify(hype).includes(secret), 'private checklist content must not reach Hype or public requests');
      assert.ok(!(await selected()).includes(secret), 'workspace context must not include private checklist content');
    }
    await connection.evaluate(`Array.from(document.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent?.includes('4.'))?.click()`, session);
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"walkthrough-publish-page\\"]"))', Boolean);
    await navigatePage(connection, page, fixtureRoute('hype-card', '&source=workspace&eventId=game-selected&eventType=game&date=2026-10-13&opponent=Tigers'));
    await reloadPage(connection, page);
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"hype-card-notice\\"]")?.textContent?.includes("Game details are ready"))', Boolean);
    const reloadedHype = await readHype();
    assert.match(reloadedHype.stored, /vs Tigers/);
    assert.equal(JSON.parse(reloadedHype.stored).project.playerName, 'Alexandria Montgomery-Williams');
    for (const secret of [privateNote, privateItem]) {
      assert.ok(!JSON.stringify(reloadedHype).includes(secret), 'reload must not copy private prep to Hype or public requests');
    }
    const requests = JSON.parse((await readHype()).requests) as { path: string; method: string; body: string }[];
    assert.ok(requests.some((request) => request.path === '/api/projects' && request.method === 'GET'));
    assert.ok(requests.every((request) => request.method === 'GET'), 'prefill must never publish without an explicit action');
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
    const links = () => connection!.evaluate<Record<string, string>>(`Object.fromEntries(
      [
        ['calendar', '[data-testid="btn-mobile-nav-schedule"]'],
        ['prep', '[data-testid^="link-card-prep-"]'],
        ['stats', '[data-testid^="link-card-stats-"]'],
        ['hype', '[data-testid="link-desktop-independent-hype"]'],
      ].map(([tool, selector]) => [
        tool, document.querySelector(selector)?.getAttribute('href') || ''
      ])
    )`, session);
    const schedule = {
      version: 1, teamName: 'Northside Comets', season: '2026', template: 0,
      events: [
        { id: 'game-default', type: 'game', status: 'upcoming', date: '2026-10-12', time: '18:30', location: 'Main Gym', opponent: 'Falcons', snacks: '', drinks: '', notes: '' },
        { id: 'game-selected', type: 'game', status: 'upcoming', date: '2026-10-13', time: '19:00', location: 'Away Gym', opponent: 'Tigers', snacks: '', drinks: '', notes: '' },
        { id: 'practice-selected', type: 'practice', date: '2026-10-14', time: '17:00', location: 'Practice Gym', opponent: '', snacks: '', drinks: '', notes: '' },
      ],
    };
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"btn-mobile-nav-schedule\\"]"))', Boolean);
    await connection.evaluate(`localStorage.setItem('leaguematrix-schedule-draft', ${JSON.stringify(JSON.stringify(schedule))})`, session);
    await click('btn-mobile-nav-schedule');
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"button-select-schedule-event-1\\"]"))', Boolean);
    await click('button-select-schedule-event-1');
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"button-remove-event-1\\"]"))', Boolean);
    await click('button-remove-event-1');
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"button-select-schedule-event-1\\"]")?.getAttribute("aria-pressed") === "true"', Boolean);
    assert.equal(await connection.evaluate('document.querySelector("[data-testid=\\"button-select-schedule-event-0\\"]") !== null', session), true, 'game remains in Calendar');
    await waitFor(connection, session, '!JSON.parse(localStorage.getItem("leaguematrix-schedule-draft") || "null")?.events?.some(e => e.id === "game-selected")', Boolean);
    await click('journey-return-dashboard');
    await waitFor(connection, session, 'Boolean(document.querySelector(\'[data-testid^="link-card-prep-"]\'))', Boolean);
    const afterGame = await links();
    for (const [tool, href] of Object.entries(afterGame)) {
      assert.ok(href, `${tool} has a destination`);
      assert.doesNotMatch(href, /game-selected|Tigers|2026-10-13/, `${tool} must drop the deleted game`);
    }
    assert.match(afterGame.calendar, /eventId=game-default/);
    assert.match(afterGame.prep, /gameId=game-default/);
    assert.match(afterGame.stats, /eventId=game-default/);
    assert.match(afterGame.hype, /eventId=game-default/);

    await click('btn-mobile-nav-schedule');
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"button-select-schedule-event-1\\"]"))', Boolean);
    await click('button-select-schedule-event-1');
    await waitFor(connection, session, 'JSON.parse(localStorage.getItem("pixlsports-workspace-event-context") || "null")?.id === "practice-selected"', Boolean);
    await click('button-remove-event-1');
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"button-select-schedule-event-0\\"]")?.getAttribute("aria-pressed") === "true"', Boolean);
    await waitFor(connection, session, '!JSON.parse(localStorage.getItem("leaguematrix-schedule-draft") || "null")?.events?.some(e => e.id === "practice-selected")', Boolean);
    await click('journey-return-dashboard');
    await waitFor(connection, session, 'Boolean(document.querySelector(\'[data-testid^="link-card-prep-"]\'))', Boolean);
    const afterPractice = await links();
    for (const [tool, href] of Object.entries(afterPractice)) {
      assert.ok(href, `${tool} has a destination after practice deletion`);
      assert.doesNotMatch(href, /game-selected|practice-selected|Tigers|2026-10-14/, `${tool} must drop deleted event context`);
    }
    assert.match(afterPractice.calendar, /eventId=game-default/);
    assert.match(afterPractice.prep, /gameId=game-default/);
    assert.match(afterPractice.stats, /eventId=game-default/);
    assert.match(afterPractice.hype, /eventId=game-default/);

    await navigatePage(connection, page, fixtureRoute('checklist', `&${afterPractice.prep.split('?')[1]}`));
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"select-checklist-game\\"]")?.value === "game-default"', Boolean);
    await navigatePage(connection, page, fixtureRoute('stat-tracker', `&${afterPractice.stats.split('?')[1]}`));
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"input-athlete-result-opponent\\"]")?.value === "Falcons"', Boolean);
    await navigatePage(connection, page, fixtureRoute('hype-card', `&${afterPractice.hype.split('?')[1]}`));
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"hype-card-notice\\"]")?.textContent?.includes("Game details are ready") === true', Boolean);
    await navigatePage(connection, page, fixtureRoute('schedule', '&eventId=practice-selected'));
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"button-select-schedule-event-0\\"]")?.getAttribute("aria-pressed") === "true"', Boolean);
    await navigatePage(connection, page, fixtureRoute('checklist', '&gameId=practice-selected&eventType=practice'));
    await waitFor(connection, session, 'Boolean(document.querySelector("[data-testid=\\"select-checklist-game\\"]"))', Boolean);
    assert.notEqual(await connection.evaluate<string>('document.querySelector("[data-testid=\\"select-checklist-game\\"]")?.value || ""', session), 'practice-selected');
    await navigatePage(connection, page, fixtureRoute('stat-tracker', '&date=2026-10-12&opponent=Falcons'));
    await waitFor(connection, session, 'document.querySelector("[data-testid=\\"input-athlete-result-opponent\\"]")?.value === "Falcons"', Boolean);
    await navigatePage(connection, page, fixtureRoute('hype-card', '&date=2026-10-12&opponent=Falcons'));
    await waitFor(connection, session, 'document.body?.innerText?.includes("Hype Cards") === true', Boolean);
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

test('local Hype Cards stay fresh across supporter tabs and reopen correctly', { concurrency: false }, async () => {
  const releaseBrowserTestLock = await acquireBrowserTestLock();
  const fixtures = fixturePaths('supporter-dashboard-hype-card-flow-test');
  let devServer: ChildProcess | undefined;
  let devServerMonitor: ProcessMonitor | undefined;
  let tempDirectory: string | undefined;
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;
  let editorPage: { sessionId: string; targetId: string } | undefined;

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
    tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-supporter-hype-card-flow-'));
    const downloadDirectory = resolve(tempDirectory, 'downloads');

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
    await connection.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDirectory,
    });
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?local-hype-card-flow`);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"section-recent-hype-cards\\"]") !== null', Boolean);

    await connection.evaluate(`window.history.pushState({}, '', '/studio'); window.dispatchEvent(new PopStateEvent('popstate'));`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"section-recent-hype-cards\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector(\'[data-testid="link-project-local-hype-card"]\'))', page.sessionId),
      false,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="section-recent-hype-cards"]\')?.textContent || ""', page.sessionId),
      /No Hype Cards Yet/,
    );

    editorPage = await openPage(connection, `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?local-hype-card-flow`);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, editorPage.sessionId);
    await waitFor(connection, editorPage.sessionId, 'document.querySelector("[data-testid=\\"section-recent-hype-cards\\"]") !== null', Boolean);
    await connection.evaluate(`window.history.pushState({}, '', '/studio/hype-card'); window.dispatchEvent(new PopStateEvent('popstate'));`, editorPage.sessionId);
    await waitFor(connection, editorPage.sessionId, 'document.querySelector("input[placeholder=\\"Big Play!\\"]") !== null', Boolean);
    const setInputByLabel = async (labelText: string, value: string) => {
      await connection!.evaluate(`(() => {
        const label = Array.from(document.querySelectorAll('label')).find((candidate) => candidate.textContent?.includes(${JSON.stringify(labelText)}));
        const input = label?.querySelector('input');
        if (!(input instanceof HTMLInputElement)) throw new Error(${JSON.stringify(`${labelText} input not found`)});
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`, editorPage!.sessionId);
    };
    await setInputByLabel('Custom moment', 'HUB CHAMPIONSHIP');
    await connection.evaluate(
      `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Next: Media')?.click()`,
      editorPage.sessionId,
    );
    await waitFor(connection, editorPage.sessionId, 'document.body?.innerText ?? ""', (body) => body.toLowerCase().includes('add media'));

    const pngData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await connection.evaluate(`(() => {
      const input = document.querySelector('input[type="file"][accept="image/*,video/*"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('Media file input not found');
      const bytes = Uint8Array.from(atob(${JSON.stringify(pngData)}), (value) => value.charCodeAt(0));
      const file = new File([bytes], 'hub-photo.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, editorPage.sessionId);
    await waitFor(connection, editorPage.sessionId, 'document.body?.innerText ?? ""', (body) => body.toLowerCase().includes('media added'), 20_000);
    await connection.evaluate(
      `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Next: Details')?.click()`,
      editorPage.sessionId,
    );
    await waitFor(connection, editorPage.sessionId, 'document.querySelector("input[placeholder=\\"e.g. Jordan Smith\\"]") !== null', Boolean);
    await setInputByLabel('Player name', 'Jordan Hub');
    await setInputByLabel('Jersey number', '11');
    await setInputByLabel('Position', 'Forward');
    await setInputByLabel('Team name', 'Northside Comets');
    for (const nextStep of ['Next: Format', 'Next: Layout', 'Next: Palette', 'Next: Review']) {
      await connection.evaluate(
        `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === ${JSON.stringify(nextStep)})?.click()`,
        editorPage.sessionId,
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    await connection.evaluate(
      `document.querySelector('[data-testid="walkthrough-publish-page"]')?.click()`,
      editorPage.sessionId,
    );
    await waitFor(connection, editorPage.sessionId, 'document.querySelector("[data-testid=\\"button-download-hype-card\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-download-hype-card"]')?.click()`, editorPage.sessionId);
    const downloadDeadline = Date.now() + 20_000;
    let downloads: string[] = [];
    while (Date.now() < downloadDeadline) {
      downloads = await readdir(downloadDirectory).catch(() => []);
      if (downloads.some((file) => file.endsWith('.png'))) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    assert.ok(downloads.some((file) => file.endsWith('.png')), 'Expected a local Hype Card export');
    await waitFor(
      connection,
      editorPage.sessionId,
      `JSON.parse(localStorage.getItem('leaguematrix-hype-card-project-v2') || '{}')?.project?.headline`,
      (headline) => headline === 'HUB CHAMPIONSHIP',
      10_000,
    );

    const savedProjectJson = await connection.evaluate<string>(
      `localStorage.getItem('leaguematrix-hype-card-project-v2') || ''`,
      editorPage.sessionId,
    );
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"link-project-local-hype-card\\"]") !== null', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="link-project-local-hype-card"]\')?.textContent || ""', page.sessionId),
      /Northside Comets - HUB CHAMPIONSHIP/,
    );
    await connection.evaluate(`localStorage.removeItem('leaguematrix-hype-card-project-v2')`, editorPage.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"link-project-local-hype-card\\"]") === null', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="section-recent-hype-cards"]\')?.textContent || ""', page.sessionId),
      /No Hype Cards Yet/,
    );
    await connection.evaluate(
      `localStorage.setItem('leaguematrix-hype-card-project-v2', ${JSON.stringify(savedProjectJson)})`,
      editorPage.sessionId,
    );
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"link-project-local-hype-card\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="link-project-local-hype-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'location.pathname === "/studio/hype-card"', Boolean);
    await connection.evaluate(
      `Array.from(document.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent?.includes('3. Details'))?.click()`,
      page.sessionId,
    );
    await waitFor(connection, page.sessionId, 'document.querySelector("input[placeholder=\\"e.g. Jordan Smith\\"]") !== null', Boolean);
    assert.deepEqual(
      await connection.evaluate<{ headline: string; playerName: string; jerseyNumber: string; teamName: string }>(`(() => {
        const field = (labelText) => Array.from(document.querySelectorAll('label'))
          .find((label) => label.textContent?.includes(labelText))
          ?.querySelector('input')?.value || '';
        return {
          headline: JSON.parse(localStorage.getItem('leaguematrix-hype-card-project-v2') || '{}')?.project?.headline || '',
          playerName: field('Player name'),
          jerseyNumber: field('Jersey number'),
          teamName: field('Team name'),
        };
      })()`, page.sessionId),
      {
        headline: 'HUB CHAMPIONSHIP',
        playerName: 'Jordan Hub',
        jerseyNumber: '11',
        teamName: 'Northside Comets',
      },
    );

    await connection.evaluate(`window.history.pushState({}, '', '/studio'); window.dispatchEvent(new PopStateEvent('popstate'));`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"link-project-cloud-hype-card-1\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="link-project-cloud-hype-card-1"]\')?.getAttribute("href") || ""', page.sessionId),
      '/studio/hype-card/cloud-hype-card-1',
    );
    await connection.evaluate(`document.querySelector('[data-testid="link-project-cloud-hype-card-1"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'location.pathname === "/studio/hype-card/cloud-hype-card-1"', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"cloud-hype-card-editor-route\\"]"))', page.sessionId),
      true,
    );
  } finally {
    if (editorPage && connection) {
      await connection.send('Target.closeTarget', { targetId: editorPage.targetId }).catch(() => undefined);
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

test('saved athlete profile names reach every fan tool without rewriting cloud cards', { concurrency: false }, async () => {
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
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"btn-profile-save\\"]") !== null', Boolean);

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
        objectPosition: '20% 70%',
        transform: 'scale(1.5)',
        transformOrigin: '20% 70%',
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
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"input-athlete-photo\\"]") !== null', Boolean);
    await connection.evaluate(`(() => {
      const input = document.querySelector('[data-testid="input-athlete-photo"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('Athlete photo input not found');
      const transfer = new DataTransfer();
      transfer.items.add(new File([
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#F97316"/></svg>',
      ], 'updated-athlete.svg', { type: 'image/svg+xml' }));
      Object.defineProperty(input, 'files', { value: transfer.files, configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"athlete-photo-crop-editor\\"]") !== null', Boolean);
    assert.deepEqual(
      await connection.evaluate(`(() => {
        const card = document.querySelector('[data-testid="athlete-photo-crop-preview"]');
        const image = card?.querySelector('img');
        return {
          hasGradientCard: Boolean(card?.classList.contains('athlete-photo-settings-preview')),
          hasSwitchAffordance: Boolean(card?.querySelector('svg')),
          details: card?.textContent?.replace(/\\s+/g, ' ').trim() || '',
          objectPosition: image?.style.objectPosition || '',
          transform: image?.style.transform || '',
        };
      })()`, page.sessionId),
      {
        hasGradientCard: true,
        hasSwitchAffordance: true,
        details: 'Taylor Morgan#00 · Northside Comets',
        objectPosition: '50% 50%',
        transform: 'scale(1)',
      },
    );
    await connection.evaluate(`(() => {
      const input = Array.from(document.querySelectorAll('input[type="range"]')).find((element) => element.getAttribute('aria-label') === 'Horizontal position');
      if (!(input instanceof HTMLInputElement)) throw new Error('Photo crop input not found: Horizontal position');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '72');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"athlete-photo-crop-preview\\"] img")?.style.objectPosition === "72% 50%"', Boolean);
    await connection.evaluate(`(() => {
      const input = Array.from(document.querySelectorAll('input[type="range"]')).find((element) => element.getAttribute('aria-label') === 'Vertical position');
      if (!(input instanceof HTMLInputElement)) throw new Error('Photo crop input not found: Vertical position');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '34');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"athlete-photo-crop-preview\\"] img")?.style.objectPosition === "72% 34%"', Boolean);
    await connection.evaluate(`(() => {
      const input = Array.from(document.querySelectorAll('input[type="range"]')).find((element) => element.getAttribute('aria-label') === 'Zoom');
      if (!(input instanceof HTMLInputElement)) throw new Error('Photo crop input not found: Zoom');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '185');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"athlete-photo-crop-preview\\"] img")?.style.transform === "scale(1.85)"', Boolean);
    assert.deepEqual(
      await connection.evaluate(`(() => {
        const resetButton = document.querySelector('[data-testid="btn-reset-athlete-photo-crop"]');
        const controls = Object.fromEntries(Array.from(document.querySelectorAll('[data-testid="athlete-photo-crop-editor"] input')).map((input) => [input.getAttribute('aria-label') || '', input instanceof HTMLInputElement ? input.value : '']));
        return {
          buttonLabel: resetButton?.textContent?.replace(/\\s+/g, ' ').trim() || '',
          crop: controls,
        };
      })()`, page.sessionId),
      {
        buttonLabel: 'Reset crop',
        crop: {
          'Horizontal position': '72',
          'Vertical position': '34',
          Zoom: '185',
        },
      },
    );
    await connection.evaluate(`document.querySelector('[data-testid="btn-reset-athlete-photo-crop"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"athlete-photo-crop-preview\\"] img")?.style.objectPosition === "50% 50%" && document.querySelector("[data-testid=\\"athlete-photo-crop-preview\\"] img")?.style.transform === "scale(1)"', Boolean);
    assert.deepEqual(
      await connection.evaluate(`(() => Object.fromEntries(Array.from(document.querySelectorAll('[data-testid="athlete-photo-crop-editor"] input')).map((input) => [input.getAttribute('aria-label') || '', input instanceof HTMLInputElement ? input.value : ''])))()`, page.sessionId),
      {
        'Horizontal position': '50',
        'Vertical position': '50',
        Zoom: '100',
      },
    );
    await connection.evaluate(`(() => {
      const values = { 'Horizontal position': '72', 'Vertical position': '34', Zoom: '185' };
      for (const [label, value] of Object.entries(values)) {
        const input = Array.from(document.querySelectorAll('[data-testid="athlete-photo-crop-editor"] input')).find((element) => element.getAttribute('aria-label') === label);
        if (!(input instanceof HTMLInputElement)) throw new Error('Photo crop input not found: ' + label);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"athlete-photo-crop-preview\\"] img")?.style.objectPosition === "72% 34%" && document.querySelector("[data-testid=\\"athlete-photo-crop-preview\\"] img")?.style.transform === "scale(1.85)"', Boolean);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    assert.deepEqual(
      await connection.evaluate(`(() => {
        const card = document.querySelector('[data-testid="athlete-photo-crop-preview"]');
        const editor = document.querySelector('[data-testid="athlete-photo-crop-editor"]');
        const controls = Array.from(document.querySelectorAll('[data-testid="athlete-photo-crop-editor"] input'));
        const cardRect = card?.getBoundingClientRect();
        const editorRect = editor?.getBoundingClientRect();
        return {
          cardWithinViewport: Boolean(cardRect && cardRect.left >= 0 && cardRect.right <= window.innerWidth),
          editorWithinViewport: Boolean(editorRect && editorRect.left >= 0 && editorRect.right <= window.innerWidth),
          controlsWithinViewport: controls.every((control) => {
            const rect = control.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= window.innerWidth;
          }),
           resetWithinViewport: (() => {
             const reset = document.querySelector('[data-testid="btn-reset-athlete-photo-crop"]');
             const rect = reset?.getBoundingClientRect();
             return Boolean(reset && rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.height >= 44);
           })(),
          documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      })()`, page.sessionId),
      {
        cardWithinViewport: true,
        editorWithinViewport: true,
        controlsWithinViewport: true,
         resetWithinViewport: true,
        documentOverflow: false,
      },
    );
    await connection.evaluate(`document.querySelector('[data-testid="btn-upload-cropped-photo"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"athlete-photo-crop-editor\\"]") === null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="btn-back"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-test-open-stat-tracker\\"]") !== null', Boolean);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"desktop-athlete-photo\\"] img")?.style.objectPosition === "72% 34%"', Boolean);
    const desktopFraming = await connection.evaluate<{
      objectPosition: string;
      transform: string;
      cardRadius: string;
      cardWidth: number;
      cardHeight: number;
      editVisible: boolean;
      details: string;
    }>(`(() => {
        const desktopCard = document.querySelector('[data-testid="desktop-athlete-photo"]');
        const desktopImage = desktopCard?.querySelector('img');
        const editButton = document.querySelector('[data-testid="btn-edit-athlete-avatar"]');
        const desktopRect = desktopCard?.getBoundingClientRect();
        const editRect = editButton?.getBoundingClientRect();
        return {
          objectPosition: desktopImage?.style.objectPosition || '',
          transform: desktopImage?.style.transform || '',
          cardRadius: desktopCard ? getComputedStyle(desktopCard).borderRadius : '',
          cardWidth: desktopRect ? Math.round(desktopRect.width) : 0,
          cardHeight: desktopRect ? Math.round(desktopRect.height) : 0,
          editVisible: Boolean(editButton && editRect && editRect.width > 0 && editRect.height > 0),
          details: document.querySelector('[data-testid="athlete-summary"]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        };
      })()`, page.sessionId);
    assert.deepEqual(
      {
        objectPosition: desktopFraming.objectPosition,
        transform: desktopFraming.transform,
        cardRadius: desktopFraming.cardRadius,
      },
      {
        objectPosition: '72% 34%',
        transform: 'scale(1.85)',
        cardRadius: '20px',
      },
    );
    assert.ok(desktopFraming.cardWidth >= 132 && desktopFraming.cardHeight >= 220);
    assert.equal(desktopFraming.editVisible, true);
    assert.match(desktopFraming.details, /Taylor Morgan/);
    assert.match(desktopFraming.details, /Northside Comets/);
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"btn-mobile-athlete-switcher\\"] img")?.style.objectPosition === "72% 34%"', Boolean);
    assert.deepEqual(
      await connection.evaluate(`(() => {
        const card = document.querySelector('[data-testid="btn-mobile-athlete-switcher"]');
        const image = card?.querySelector('img');
        return {
          objectPosition: image?.style.objectPosition || '',
          transform: image?.style.transform || '',
          details: card?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        };
      })()`, page.sessionId),
      {
        objectPosition: '72% 34%',
        transform: 'scale(1.85)',
        details: 'Taylor Morgan•Northside Comets',
      },
    );
    await reloadPage(connection, page);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"btn-mobile-athlete-switcher\\"] img")?.style.objectPosition === "72% 34%"', Boolean);
    assert.deepEqual(
      await connection.evaluate(`(() => {
        const image = document.querySelector('[data-testid="btn-mobile-athlete-switcher"] img');
        return {
          objectPosition: image?.style.objectPosition || '',
          transform: image?.style.transform || '',
        };
      })()`, page.sessionId),
      {
        objectPosition: '72% 34%',
        transform: 'scale(1.85)',
      },
    );
    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-stat-tracker"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-tracker-layout\\"]") !== null && document.querySelector("[data-testid=\\"athlete-stat-target-three-point\\"] img") !== null', Boolean);
    assert.deepEqual(
      await connection.evaluate(`(() => {
        const target = document.querySelector('[data-testid="athlete-stat-target-three-point"]');
        const image = target?.querySelector('img');
        const rect = target?.getBoundingClientRect();
        return {
          imageSource: image?.getAttribute('src') || '',
          objectPosition: image?.style.objectPosition || '',
          transform: image?.style.transform || '',
          width: rect ? rect.width : 0,
          height: rect ? rect.height : 0,
          accessibleName: target?.getAttribute('aria-label') || '',
        };
      })()`, page.sessionId),
      {
        imageSource: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iODAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iODAiIGZpbGw9IiNGOTczMTYiLz48L3N2Zz4=',
        objectPosition: '72% 34%',
        transform: 'scale(1.85)',
        width: 44,
        height: 44,
        accessibleName: 'Record Three-point field goal for Taylor Morgan',
      },
    );
    await connection.evaluate(`document.querySelector('[data-testid="button-test-edit-profile"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"btn-remove-athlete-photo\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="btn-remove-athlete-photo"]')?.click()`, page.sessionId);
    await connection.evaluate(`document.querySelector('[data-testid="btn-back"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-test-open-stat-tracker\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-stat-tracker"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-tracker-layout\\"]") !== null && document.querySelector("[data-testid=\\"athlete-stat-target-three-point\\"] img") === null', Boolean);
    assert.deepEqual(
      await connection.evaluate(`(() => {
        const target = document.querySelector('[data-testid="athlete-stat-target-three-point"]');
        return {
          accessibleName: target?.getAttribute('aria-label') || '',
          fallback: target?.textContent?.trim() || '',
          width: target?.getBoundingClientRect().width || 0,
          height: target?.getBoundingClientRect().height || 0,
        };
      })()`, page.sessionId),
      {
        accessibleName: 'Record Three-point field goal for Taylor Morgan',
        fallback: 'TM',
        width: 44,
        height: 44,
      },
    );

    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-hype-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"input-hype-player-name\\"]")?.value === "Taylor Morgan"', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="text-hype-cloud-player-name"]\')?.textContent || ""', page.sessionId),
      'Past Season Athlete',
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
    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-hype-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"input-hype-player-name\\"]")?.value === "Jordan Lee"', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="text-hype-cloud-player-name"]\')?.textContent || ""', page.sessionId),
      'Past Season Athlete',
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
    await waitFor(connection, page.sessionId, 'document.body?.innerText.includes("Unassigned")', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-stat-tracker"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-tracker-layout\\"]") !== null', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="live-tracker-score-card-athlete"]\')?.textContent || ""', page.sessionId),
      /Your score/,
    );
    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-hype-card"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"input-hype-player-name\\"]")?.value === ""', Boolean);
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
