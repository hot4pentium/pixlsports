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
const harnessPath = resolve(appDirectory, 'supporter-dashboard-test-harness.tsx');
const htmlPath = resolve(appDirectory, 'supporter-dashboard-test.html');

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

async function waitForUrl(url: string, timeoutMs = 20_000) {
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

function waitForExit(process: ChildProcess) {
  return new Promise<void>((resolveExit) => process.once('exit', () => resolveExit()));
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
  await connection.send('Page.navigate', { url }, sessionId);
  return { sessionId, targetId: target.targetId };
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
    const value = await page.evaluate<T>(expression, sessionId);
    if (predicate(value)) return value;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for browser condition: ${expression}`);
}

function harnessSource() {
  return `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { SupporterDashboardView } from './src/features/supporter-dashboard';

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

function htmlSource() {
  return `
<!doctype html>
<html>
  <head><meta charset="UTF-8"><title>Supporter dashboard browser test</title></head>
  <body><div id="test-root"></div><script type="module">import('/supporter-dashboard-test-harness.tsx?browser-test=' + Date.now()).then(({ mount }) => mount()).catch((error) => { document.body.dataset.testError = String(error); });</script></body>
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

test('supporter dashboard tools stay keyboard reachable and compact at phone and desktop widths', async () => {
  const viteProbe = createServer();
  const { port: vitePort } = await listen(viteProbe);
  await new Promise<void>((resolveClose, rejectClose) => viteProbe.close((error) => error ? rejectClose(error) : resolveClose()));
  await writeFile(harnessPath, harnessSource(), 'utf8');
  await writeFile(htmlPath, htmlSource(), 'utf8');

  const devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: {
      ...process.env,
      PORT: String(vitePort),
      BASE_PATH: '/',
      VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
    },
    stdio: 'ignore',
  });
  const tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-supporter-dashboard-browser-'));

  let browser: ChildProcess | undefined;
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
    await waitForUrl(`http://127.0.0.1:${vitePort}/`);
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
    ], { stdio: 'ignore' });
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl);
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/supporter-dashboard-test.html`);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-choose-task\\"]") !== null', Boolean);
     assert.equal(
       await connection.evaluate<boolean>(`(() => {
         const upcoming = document.querySelector('[data-testid="section-upcoming"]');
         const recent = document.querySelector('[data-testid="section-recent-designs"]');
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
      /Open stat tracker/,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-upcoming"]\')?.className || ""', page.sessionId),
      /border-amber-300/,
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-upcoming-next"]\')?.textContent || ""', page.sessionId),
      /Next/,
    );

    await connection.send('Page.reload', { ignoreCache: true }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-choose-task\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]"))', page.sessionId),
      false,
    );

    await connection.evaluate('localStorage.removeItem("pixlsports-supporter-stage-ack:game-1:upcoming")', page.sessionId);
    await connection.send('Page.reload', { ignoreCache: true }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") !== null', Boolean);
    await pressKey(connection, page.sessionId, 'Escape', 'Escape', 27);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"all-tools-panel\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.click()`, page.sessionId);

    await connection.evaluate('localStorage.removeItem("pixlsports-supporter-stage-ack:game-1:upcoming")', page.sessionId);
    await connection.send('Page.reload', { ignoreCache: true }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-close\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="stage-reminder-close"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"all-tools-panel\\"]") !== null', Boolean);
    await connection.evaluate(`document.querySelector('[data-testid="button-choose-task"]')?.click()`, page.sessionId);

    await connection.evaluate(`window.__setSupporterDashboardEvents([{ id: 'game-1', type: 'game', date: '2026-09-21', time: '18:30', location: 'Northside Gym', opponent: 'Rivals', status: 'live' }])`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") !== null', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector(\'[data-testid="stage-reminder-dialog"]\')?.textContent || ""', page.sessionId),
      /Happening now/,
    );
    await connection.evaluate(`document.querySelector('[data-testid="stage-reminder-got-it"]')?.click()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stage-reminder-dialog\\"]") === null', Boolean);

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
      await connection.evaluate<string>('document.body.innerText', page.sessionId).then((text) => text.includes('No Scheduled Events')),
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

    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    }, page.sessionId);
    const desktopLayout = await connection.evaluate<{ summaryOverflow: boolean; heroToolCards: number }>(`(() => {
      const summary = document.querySelector('[data-testid="athlete-summary"]');
      return {
        summaryOverflow: Boolean(summary && summary.scrollWidth > summary.clientWidth),
        heroToolCards: document.querySelectorAll('header [data-testid^="link-quick-"]').length,
      };
    })()`, page.sessionId);
    assert.deepEqual(desktopLayout, { summaryOverflow: false, heroToolCards: 0 });

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
    browser?.kill('SIGTERM');
    if (browser) await waitForExit(browser);
    devServer.kill('SIGTERM');
    await waitForExit(devServer);
    await rm(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(harnessPath, { force: true });
    await rm(htmlPath, { force: true });
  }
});
