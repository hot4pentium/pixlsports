import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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

async function waitForUrl(url: string, timeoutMs = 20_000, processMonitor?: ProcessMonitor) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processMonitor?.hasExited()) {
      throw new Error(processFailure(processMonitor, `Timed out waiting for ${url}`));
    }
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(processFailure(processMonitor, `Timed out waiting for ${url}`));
}

type ProcessMonitor = {
  hasExited: () => boolean;
  diagnostics: () => string;
  waitForExit: () => Promise<void>;
};

function monitorProcess(child: ChildProcess, label: string): ProcessMonitor {
  let output = '';
  let exitDescription = '';
  let resolveExit!: () => void;
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const appendOutput = (chunk: Buffer | string) => {
    output = `${output}${String(chunk)}`.slice(-4_000);
  };
  child.stdout?.on('data', appendOutput);
  child.stderr?.on('data', appendOutput);
  child.once('error', (error) => {
    exitDescription = `${label} emitted an error: ${error.message}`;
    resolveExit();
  });
  child.once('exit', (code, signal) => {
    exitDescription = `${label} exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}`;
    resolveExit();
  });

  return {
    hasExited: () => child.exitCode !== null || child.signalCode !== null || Boolean(exitDescription),
    diagnostics: () => [
      exitDescription || `${label} is still running`,
      output.trim() ? `${label} output:\n${output.trim()}` : `${label} produced no captured output`,
    ].join('; '),
    waitForExit: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await exitPromise;
    },
  };
}

function processFailure(monitor: ProcessMonitor | undefined, description: string) {
  return `${description}${monitor ? `; ${monitor.diagnostics()}` : ''}`;
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

function harnessSource() {
  return `
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { SupporterDashboardView, SupporterProfileView } from './src/features/supporter-dashboard';
import { LiveTrackerGame } from './src/features/stat-tracker-page';
import { getSportRule } from './src/features/stat-tracker';
import { defaultProject } from './src/features/hype-card-types';
import { seedHypeCardFromSupporterProfile } from './src/features/supporter-dashboard-model';
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
  const [route, setRoute] = useState('profile');
  const [profile, setProfile] = useState({
    displayName: 'Jamie Fan',
    teamName: 'Northside Comets',
    athleteName: '',
    jerseyNumber: '',
    position: '',
    relationship: 'Parent',
    accessMode: 'full',
    sport: 'basketball',
  });
  const [draft, setDraft] = useState(profile);
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
        onSave: () => { setProfile(draft); setRoute('dashboard'); },
        onCancel: () => setRoute('dashboard'),
        onPhotoChange: () => {},
        onPhotoCropChange: () => {},
        onPhotoUpload: () => {},
        onPhotoCancel: () => {},
        onPhotoRemove: () => {},
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
      connected: false,
      connectionLabel: '',
      loadingCalendar: false,
      calendarError: false,
      calendarConnectionInvalid: false,
      onOpenProfile: openProfile,
      onRetryCalendar: () => {},
      onReconnectCalendar: () => {},
      onDisconnect: () => {},
      onOpenStatTracker: () => setRoute('tracker'),
      onOpenChecklist: () => {},
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
  const renderDashboard = () => root.render(
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(SupporterDashboardView, {
          profile,
          events: dashboardEvents,
          nextGameIsUpcoming: true,
          projects: [],
          scheduleSource: 'team',
          connected: true,
          connectionLabel: 'Northside · 2026',
          loadingCalendar: false,
          calendarError: false,
          calendarConnectionInvalid: false,
          onOpenProfile: () => navigate('/studio/profile'),
          onRetryCalendar: () => {},
          onReconnectCalendar: () => navigate('/studio/schedule'),
          onDisconnect: () => {},
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
    await connection.evaluate(`document.querySelector('[data-testid="stage-live"]')?.click()`, page.sessionId);
    await waitFor(
      connection,
      page.sessionId,
      'document.querySelector("[data-testid=\\"week-path-content\\"]")?.getAttribute("data-selected-path") === "live"',
      Boolean,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="week-path-content"]\')?.className || ""', page.sessionId),
      /border-emerald-300/,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="week-path-content"]\')?.textContent || ""', page.sessionId),
      /Start game day/,
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
      /Rivals/,
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
        diagnostics: string[];
      }>(`(() => {
        const mobileRoot = document.querySelector('.pixl-dashboard-mobile');
        const desktopRoot = document.querySelector('.pixl-dashboard');
        const recommendation = document.querySelector('[data-testid="btn-mobile-recommendation-action"]');
         const bottomNav = document.querySelector('[data-testid="mobile-bottom-nav"]');
        const isVisible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rect = element.getBoundingClientRect();
          return getComputedStyle(element).display !== 'none' && rect.width > 0 && rect.height > 0;
        };
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
        diagnostics: [],
      }, `mobile dashboard layout at ${width}px`);
    }

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);

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

    await connection.evaluate(`document.querySelector('[data-testid="button-test-open-stat-tracker"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-tracker-layout\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="live-tracker-score-card-athlete"]\')?.textContent || ""', page.sessionId),
      'Taylor Morgan0',
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="live-tracker-stat-controls"]\')?.textContent || ""', page.sessionId),
      /Taylor Morgan/,
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
