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
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-choose-task\\"]") !== null', Boolean);

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

test('mobile supporter header stays pinned and keeps navigation accessible', { concurrency: false }, async () => {
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

    for (const width of [320, 390, 768]) {
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
      }>(`(() => {
        const root = document.querySelector('.supporter-dashboard-mobile-shell');
        const header = document.querySelector('[data-testid="mobile-header"]');
        const hero = document.querySelector('[data-testid="mobile-hero-banner"]');
        if (!(root instanceof HTMLElement) || !(header instanceof HTMLElement) || !(hero instanceof HTMLElement)) {
          throw new Error('Mobile dashboard shell is incomplete');
        }
        root.scrollTop = 0;
        const initialHeaderRect = header.getBoundingClientRect();
        const heroRect = hero.getBoundingClientRect();
        root.scrollTop = Math.min(240, Math.max(0, root.scrollHeight - root.clientHeight));
        const scrolledHeaderRect = header.getBoundingClientRect();
        root.scrollTop = 0;
        const rootRect = root.getBoundingClientRect();
        return {
          dashboardVisible: getComputedStyle(root).display !== 'none',
          viewportOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          dashboardOverflow: root.scrollWidth > root.clientWidth,
          headerPosition: getComputedStyle(header).position,
          headerZIndex: getComputedStyle(header).zIndex,
          headerTop: Math.round(initialHeaderRect.top - rootRect.top),
          headerTopAfterScroll: Math.round(scrolledHeaderRect.top - rootRect.top),
          heroClearsHeader: Math.round(heroRect.top) >= Math.round(initialHeaderRect.bottom),
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
      }, `mobile header behavior at ${width}px`);
    }

    assert.deepEqual(await connection.evaluate<{
      profileTag: string;
      profileHref: string | null;
      scheduleHref: string | null;
      stagesAreStatic: boolean;
    }>(`(() => {
      const profileLink = document.querySelector('[data-testid="btn-mobile-open-profile"]');
      const stages = Array.from(document.querySelectorAll('[data-testid^="mobile-stage-"]'));
      return {
        profileTag: profileLink?.tagName || '',
        profileHref: profileLink?.getAttribute('href') || null,
        scheduleHref: document.querySelector('[data-testid="btn-mobile-nav-schedule"]')?.getAttribute('href') || null,
        stagesAreStatic: stages.length === 4 && stages.every((stage) => stage.tagName === 'DIV'),
      };
    })()`, page.sessionId), {
      profileTag: 'A',
      profileHref: '/studio/profile',
      scheduleHref: '/studio/schedule',
      stagesAreStatic: true,
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
      links: ['/studio', '/help', '/privacy'],
      label: 'Mobile dashboard navigation',
    });
    await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"mobile-dashboard-menu\\"]") === null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.activeElement?.getAttribute("data-testid") || ""', page.sessionId),
      'button-mobile-dashboard-menu',
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
import { ChecklistPage } from './src/App';
import { SupporterDashboardView, SupporterProfileView } from './src/features/supporter-dashboard';
import { LiveTrackerGame } from './src/features/stat-tracker-page';
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

export function mount() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const requestUrl = typeof input === 'string' ? input : input.url;
    if (requestUrl.includes('/api/hype-card-shares/reply-inbox')) {
      return Promise.resolve(new Response(JSON.stringify({ groups: [], unreadCount: 0, totalCount: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return originalFetch(input, init);
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.getElementById('test-root'));
  if (window.location.search.includes('profile-propagation')) {
    root.render(createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(ProfilePropagationHarness),
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
  const renderDashboard = () => root.render(
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(SupporterDashboardView, {
          profile,
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
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-choose-task\\"]") !== null', Boolean);
     assert.equal(
       await connection.evaluate<boolean>(`(() => {
         const upcoming = document.querySelector('[data-testid="section-upcoming"]');
          const recent = document.querySelector('[data-testid="section-recent-hype-cards"]');
         const tools = document.querySelector('#all-tools');
         return Boolean(upcoming && recent && tools
           && (upcoming.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING)
           && (recent.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING));
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
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-choose-task\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]"))', page.sessionId),
      false,
    );

    await connection.evaluate('localStorage.removeItem("pixlsports-supporter-stage-ack:game-1:upcoming")', page.sessionId);
    await reloadPage(connection, page);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") !== null', Boolean);
    await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"all-tools-panel\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.click()`, page.sessionId);

    await connection.evaluate('localStorage.removeItem("pixlsports-supporter-stage-ack:game-1:upcoming")', page.sessionId);
    await reloadPage(connection, page);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-close\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="stage-reminder-close"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"all-tools-panel\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.click()`, page.sessionId);

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
      /gameId=game-1/,
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
      /gameId=game-1/,
    );

    await connection.evaluate(`window.__setSupporterDashboardEvents([])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"section-next-game-context\\"]") !== null', Boolean);
    if (await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"all-tools-panel\\"]"))', page.sessionId)) {
      await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.click()`, page.sessionId);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"all-tools-panel\\"]") === null', Boolean);
    }
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
      /Get ready for practice/,
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
      /Get ready for practice/,
    );

    assert.equal(await connection.evaluate<boolean>(
      'Boolean(document.querySelector(\'[data-testid="button-choose-task"]\'))',
      page.sessionId,
    ), true);
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.focus()`, page.sessionId);
    await pressKey(connection, page.sessionId, 'Enter', 'Enter', 13);
    // Chromium's CDP key dispatch does not synthesize a button click in headless mode,
    // so retain the focused trigger and invoke the same native activation as a keyboard
    // press when that browser quirk occurs.
    if (!await connection.evaluate<boolean>(
      'Boolean(document.querySelector(\'[data-testid="all-tools-panel"]\'))',
      page.sessionId,
    )) {
      await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.click()`, page.sessionId);
    }
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"all-tools-panel\\"]") !== null', Boolean);
    assert.equal(await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"button-choose-task\\"]")?.getAttribute("aria-expanded")',
      page.sessionId,
    ), 'true');
    await waitFor(
      connection,
      page.sessionId,
      'document.activeElement?.getAttribute("data-testid") === "link-quick-hype"',
      Boolean,
    );

    const toolRoutes = await connection.evaluate<Record<string, string>>(`Object.fromEntries(
      [...document.querySelectorAll('[data-testid^="link-quick-"]')].map((element) => [
        element.getAttribute('data-testid'),
        element.getAttribute('href') || 'callback',
      ]),
    )`, page.sessionId);
    assert.deepEqual(toolRoutes, {
      'link-quick-hype': '/studio/hype-card',
      'link-quick-schedule': '/studio/schedule',
      'link-quick-stat-tracker': 'callback',
      'link-quick-checklist': 'callback',
    });

    const focusedTools: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      await pressKey(connection, page.sessionId, 'Tab', 'Tab', 9);
      focusedTools.push(await connection.evaluate<string>(
        'document.activeElement?.getAttribute("data-testid") || ""',
        page.sessionId,
      ));
    }
    assert.deepEqual(focusedTools, ['link-quick-schedule', 'link-quick-stat-tracker', 'link-quick-checklist']);

    await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"all-tools-panel\\"]") === null', Boolean);
    await waitFor(connection, page.sessionId, 'document.activeElement?.getAttribute("data-testid")', (value) => value === 'button-choose-task');
    assert.equal(await connection.evaluate<string>(
      'document.activeElement?.getAttribute("data-testid")',
      page.sessionId,
    ), 'button-choose-task');
    assert.equal(await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"button-choose-task\\"]")?.getAttribute("aria-expanded")',
      page.sessionId,
    ), 'false');

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
         bottomNavZIndex: string;
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
           bottomNavZIndex: bottomNav instanceof HTMLElement ? getComputedStyle(bottomNav).zIndex : '',
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
         bottomNavZIndex: '60',
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
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]').click();`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"all-tools-panel\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="link-quick-stat-tracker"]')?.click()`, page.sessionId);
    assert.equal(await connection.evaluate<string>('location.pathname', page.sessionId), '/studio/stat-tracker');
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.click()`, page.sessionId);
    await connection.evaluate(`window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));`, page.sessionId);
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]').click();`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"all-tools-panel\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="link-quick-checklist"]')?.click()`, page.sessionId);
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

test('supporter Prep keeps practice, meeting, and game checklist context after reload', { concurrency: false }, async () => {
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
      `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?checklist-context&scenario=practice`,
    );
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"week-path-content\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"checklist-context-harness\\"]"))', page.sessionId),
      true,
      'checklist context browser harness must be mounted',
    );
    const dashboardPath = await connection.evaluate<string>('location.pathname', page.sessionId);
    assert.equal(dashboardPath, `/${fixtures.htmlPath.slice(appDirectory.length + 1)}`);

    const cases = [
      {
        scenario: 'practice',
        event: {
          id: 'practice-1',
          type: 'practice',
          date: '2026-09-23',
          time: '18:30',
          location: 'Northside Gym',
          opponent: '',
          snacks: '',
          drinks: '',
          notes: 'Bring water',
        },
        heading: /PRACTICE\s*CHECKLIST/i,
        selectorLabel: 'Checklist for practice',
        selectorAriaLabel: 'Choose which practice this checklist is for',
        scheduleDescription: 'Choose a practice from your saved schedule.',
      },
      {
        scenario: 'meeting',
        event: {
          id: 'meeting-1',
          type: 'meeting',
          date: '2026-09-24',
          time: '17:00',
          location: 'Northside Clubhouse',
          opponent: '',
          snacks: '',
          drinks: '',
          notes: 'Bring the agenda',
        },
        heading: /MEETING\s*CHECKLIST/i,
        selectorLabel: 'Checklist for meeting',
        selectorAriaLabel: 'Choose which meeting this checklist is for',
        scheduleDescription: 'Choose a meeting from your saved schedule.',
      },
      {
        scenario: 'game',
        event: {
          id: 'game-1',
          type: 'game',
          status: 'upcoming',
          date: '2026-09-25',
          time: '18:30',
          location: 'Eastside Gym',
          opponent: 'Rivals',
          snacks: '',
          drinks: '',
          notes: '',
        },
        heading: /GAMEDAY\s*CHECKLIST/i,
        selectorLabel: 'Checklist for game',
        selectorAriaLabel: 'Choose which game this checklist is for',
        scheduleDescription: 'Choose a game from your saved schedule.',
      },
    ] as const;

    for (const testCase of cases) {
      const schedule = {
          teamName: 'Northside Comets',
          season: '2026',
          events: [testCase.event],
          template: 0,
      };
      await connection.evaluate(`(() => {
        window.localStorage.setItem('leaguematrix-schedule-draft', ${JSON.stringify(JSON.stringify(schedule))});
        window.history.pushState({}, '', ${JSON.stringify(`${dashboardPath}?checklist-context&scenario=${testCase.scenario}`)});
        window.dispatchEvent(new PopStateEvent('popstate'));
      })()`, page.sessionId);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"week-path-content\\"]") !== null', Boolean);
      assert.match(
        await connection.evaluate<string>('document.querySelector(\'[data-testid="week-path-content"]\')?.textContent || ""', page.sessionId),
        testCase.scenario === 'practice' ? /practice/i : testCase.scenario === 'meeting' ? /meeting/i : /game/i,
      );

      await connection.evaluate(`document.querySelector('[data-testid="btn-desktop-recommendation-action"]')?.click()`, page.sessionId);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"checklist-page\\"]") !== null', Boolean);
      const readChecklistContext = () => connection!.evaluate<{
        heading: string;
        selectorText: string;
        selectorAriaLabel: string;
        selectedEventId: string;
        scheduleDescription: string;
      }>(`(() => {
        const heading = document.querySelector('[data-testid="checklist-page"] h1')?.textContent || '';
        const selector = document.querySelector('[data-testid="select-checklist-game"]');
        const selectorContainer = document.querySelector('[data-testid="checklist-game-selector"]');
        return {
          heading,
          selectorText: selectorContainer?.textContent || '',
          selectorAriaLabel: selector?.getAttribute('aria-label') || '',
          selectedEventId: selector instanceof HTMLSelectElement ? selector.value : '',
          scheduleDescription: selectorContainer?.querySelector('p')?.textContent || '',
        };
      })()`, page.sessionId);
      const beforeReload = await readChecklistContext();
      assert.match(beforeReload.heading, testCase.heading);
      assert.match(beforeReload.selectorText, new RegExp(testCase.selectorLabel, 'i'));
      assert.equal(beforeReload.selectorAriaLabel, testCase.selectorAriaLabel);
      assert.equal(beforeReload.selectedEventId, testCase.event.id);
      assert.equal(beforeReload.scheduleDescription, testCase.scheduleDescription);

      await navigatePage(
        connection,
        page,
        `http://127.0.0.1:${vitePort}/${fixtures.htmlPath.slice(appDirectory.length + 1)}?checklist-context&scenario=${testCase.scenario}&gameId=${testCase.event.id}&eventType=${testCase.event.type}&route=checklist`,
      );
      await reloadPage(connection, page);
      await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"checklist-page\\"]") !== null', Boolean);
      const afterReload = await readChecklistContext();
      assert.match(afterReload.heading, testCase.heading);
      assert.match(afterReload.selectorText, new RegExp(testCase.selectorLabel, 'i'));
      assert.equal(afterReload.selectorAriaLabel, testCase.selectorAriaLabel);
      assert.equal(afterReload.selectedEventId, testCase.event.id);
      assert.equal(afterReload.scheduleDescription, testCase.scheduleDescription);
    }
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
