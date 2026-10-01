import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DevToolsConnection,
  monitorProcess,
  openPage,
  waitFor,
  waitForUrl,
  type BrowserPage,
  type ProcessMonitor,
} from './browser-test-diagnostics';

const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const harnessPath = resolve(appDirectory, 'game-on-save-only-browser-harness.tsx');
const htmlPath = resolve(appDirectory, 'game-on-save-only-browser-test.html');
const ownerId = 'save-only-regression-owner';

function listen(server: Server) {
  return new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected a TCP server address'));
        return;
      }
      resolvePort(address.port);
    });
  });
}

function harnessSource() {
  return `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GameOnCardPanel } from './src/features/game-on-card';
import { GameOnInlineEditor } from './src/features/game-on-inline-editor';
import './src/index.css';
import './src/features/game-on-dashboard-collection.css';

const ownerId = ${JSON.stringify(ownerId)};
const event = {
  id: 'schedule-game-save-only',
  calendarProjectId: 'calendar-project-save-only',
  type: 'game',
  status: 'upcoming',
  date: '2026-11-12',
  time: '18:00',
  timezone: 'America/Los_Angeles',
  location: 'North Field',
  opponent: 'Hawks',
};
const card = {
  id: 'draft:schedule-game-save-only',
  eventId: event.id,
  calendarProjectId: event.calendarProjectId,
  type: 'game',
  athleteName: 'Alex Tiger',
  opponent: event.opponent,
  date: event.date,
  time: event.time,
  timezone: event.timezone,
  location: event.location,
  status: 'Draft',
  isPublished: false,
};
const api = {
  calls: [],
  shares: {},
  createCount: 0,
  failNextCreate: false,
  clipboardCalls: 0,
  calendarSaves: [],
  changed: [],
};
window.__saveOnlyApi = api;
window.__resetSaveOnlyFixture = () => {
  api.calls = [];
  api.shares = {};
  api.createCount = 0;
  api.failNextCreate = false;
  api.clipboardCalls = 0;
  api.calendarSaves = [];
  api.changed = [];
  window.localStorage.clear();
  queryClient.clear();
};
const hypeEventQueryKeys = [
  ['/api/athlete-invites'],
  ['/api/athlete-invites/athlete'],
  ['/api/athlete-invites/athlete/fan'],
];
window.__seedHypeEventQueries = () => {
  for (const key of hypeEventQueryKeys) queryClient.setQueryData(key, { fixture: true });
};
window.__hypeEventQueriesInvalidated = () => hypeEventQueryKeys.map(
  (key) => queryClient.getQueryState(key)?.isInvalidated || false,
);

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: {
    writeText: async () => {
      api.clipboardCalls += 1;
      throw new Error('Unexpected clipboard access in save-only flow');
    },
  },
});

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const path = new URL(url, window.location.href).pathname;
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

  if (path === '/api/schedule-shares' && method === 'POST') {
    const payload = JSON.parse(String(init?.body || '{}'));
    api.calls.push({ method, path, payload });
    if (api.failNextCreate) {
      api.failNextCreate = false;
      return json({ message: 'Simulated Event Card save failure' }, 503);
    }
    api.createCount += 1;
    const shareToken = api.createCount === 1
      ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const share = {
      shareToken,
      title: payload.title,
      teamSeason: payload.teamSeason,
      events: payload.events,
      createdAt: '2026-09-01T12:00:00.000Z',
    };
    api.shares[shareToken] = share;
    return json(share);
  }

  if (path.startsWith('/api/schedule-shares/') && method === 'PATCH') {
    const shareToken = path.split('/').pop();
    const payload = JSON.parse(String(init?.body || '{}'));
    api.calls.push({ method, path, payload });
    const previous = api.shares[shareToken];
    const share = {
      shareToken,
      title: payload.title,
      teamSeason: payload.teamSeason,
      events: payload.events,
      createdAt: previous?.createdAt || '2026-09-01T12:00:00.000Z',
    };
    api.shares[shareToken] = share;
    return json(share);
  }

  if (path.startsWith('/api/game-on-cards/')) {
    const shareToken = path.split('/').pop();
    api.calls.push({ method, path });
    const share = api.shares[shareToken];
    const savedEvent = share?.events?.[0];
    return json({
      shareToken,
      title: share?.title || 'Tigers',
      teamSeason: '',
      event: savedEvent,
      stage: savedEvent?.status || 'upcoming',
      prepState: 'private',
      statsState: 'not-shared',
      athletePageState: 'unpublished',
      athleteName: 'Alex Tiger',
    });
  }

  return originalFetch(input, init);
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

function Fixture({ mode }) {
  const saveCalendar = async (savedEvent) => {
    api.calendarSaves.push(savedEvent);
  };
  const changed = (selectedId) => {
    api.changed.push(selectedId || null);
  };

  if (mode === 'panel' || mode === 'failure') {
    return (
      <GameOnCardPanel
        key={mode}
        profile={{ teamName: 'Tigers', athleteName: 'Alex Tiger' }}
        userId={ownerId}
        events={[]}
        selectedCard={null}
        onChanged={changed}
        onSaveCalendarEvent={saveCalendar}
      />
    );
  }

  return (
    <GameOnInlineEditor
      card={card}
      scheduledEvent={event}
      teamName="Tigers"
      userId={ownerId}
      view={mode === 'calendar' ? 'calendar' : 'details'}
      onOpenPrep={() => undefined}
      onOpenTracker={() => undefined}
      onSaveCalendarEvent={saveCalendar}
      onChanged={changed}
    />
  );
}

function App() {
  const [mode, setMode] = useState('panel');
  window.__showSaveOnlyMode = (nextMode) => setMode(nextMode);
  return <QueryClientProvider client={queryClient}><Fixture mode={mode} /></QueryClientProvider>;
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
`;
}

async function setViewport(connection: DevToolsConnection, page: BrowserPage, width: number) {
  await connection.send('Emulation.setDeviceMetricsOverride', {
    width,
    height: width === 390 ? 844 : 900,
    deviceScaleFactor: 1,
    mobile: width === 390,
  }, page.sessionId);
}

async function assertSaveButtonInBounds(
  connection: DevToolsConnection,
  page: BrowserPage,
  testId: string,
  label: string,
  width: number,
) {
  const state = await connection.evaluate<{ label: string; inBounds: boolean; height: number; scrollWidth: number }>(
    `(() => {
      const button = document.querySelector('[data-testid="${testId}"]');
      const rect = button?.getBoundingClientRect();
      return {
        label: button?.textContent?.trim() || '',
        inBounds: !!rect && rect.width > 0 && rect.left >= -1 && rect.right <= innerWidth + 1,
        height: rect?.height || 0,
        scrollWidth: document.documentElement.scrollWidth,
      };
    })()`,
    page.sessionId,
  );
  assert.equal(state.label, label, `save action label at ${width}px`);
  assert.equal(state.inBounds, true, `save action should fit at ${width}px`);
  const minimumHeight = testId === 'button-save-game-on-card' ? 44 : 38;
  assert.equal(state.height >= minimumHeight, true, `save action should have a sensible tap target at ${width}px`);
  assert.equal(state.scrollWidth <= width + 1, true, `page should not overflow horizontally at ${width}px`);
}

test('Game On save-only browser regressions cover create, update, inline calendar sync, and retry', async () => {
  await writeFile(harnessPath, harnessSource(), 'utf8');
  await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import('/game-on-save-only-browser-harness.tsx?test=' + Date.now()).catch(error => { document.body.dataset.testError = String(error); });</script></body></html>`, 'utf8');

  const portProbe = createServer();
  const port = await listen(portProbe);
  await new Promise<void>((resolveClose, rejectClose) => portProbe.close((error) => error ? rejectClose(error) : resolveClose()));
  const devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: { ...process.env, PORT: String(port), BASE_PATH: '/', VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const devMonitor = monitorProcess(devServer, 'Vite');
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-game-on-save-only-browser-'));
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: BrowserPage | undefined;

  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 30_000, devMonitor);
    const debugProbe = createServer();
    const debugPort = await listen(debugProbe);
    await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    page = await openPage(connection, `http://127.0.0.1:${port}/game-on-save-only-browser-test.html`, {
      viewport: { width: 390, height: 844, mobile: true },
    });
    await waitFor(connection, page.sessionId, '!!document.querySelector("[data-testid=\\"button-save-game-on-card\\"]")', Boolean, 30_000);

    await assertSaveButtonInBounds(connection, page, 'button-save-game-on-card', 'Save Event Card', 390);
    await setViewport(connection, page, 1280);
    await assertSaveButtonInBounds(connection, page, 'button-save-game-on-card', 'Save Event Card', 1280);
    await setViewport(connection, page, 390);

    const fillPanel = async (date: string, opponent: string) => {
      await connection!.evaluate(`(() => {
        const date = document.querySelector('[data-testid="input-game-on-date"]');
        const rival = document.querySelector('[data-testid="input-game-on-opponent"]');
        const setValue = (element, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(element, value);
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        };
        setValue(date, ${JSON.stringify(date)});
        setValue(rival, ${JSON.stringify(opponent)});
      })()`, page!.sessionId);
    };
    const click = async (selector: string) => connection!.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.click()`,
      page!.sessionId,
    );
    const panelApiState = () => connection!.evaluate<any>(
      '({ calls: window.__saveOnlyApi.calls, clipboardCalls: window.__saveOnlyApi.clipboardCalls, shares: window.__saveOnlyApi.shares })',
      page!.sessionId,
    );
    const localCards = () => connection!.evaluate<any[]>(
      `JSON.parse(localStorage.getItem('pixlsports-game-on-cards:${ownerId}') || '[]')`,
      page!.sessionId,
    );

    await fillPanel('2026-11-13', 'Falcons');
    await connection.evaluate('window.__seedHypeEventQueries()', page.sessionId);
    await click('[data-testid="button-save-game-on-card"]');
    await waitFor(connection, page.sessionId, '!!document.querySelector("[data-testid=\\"game-on-card-saved\\"]")', Boolean);
    await waitFor(connection, page.sessionId, 'window.__saveOnlyApi.calls.some(call => call.method === "POST")', Boolean);
    await waitFor(connection, page.sessionId, 'window.__saveOnlyApi.calls.some(call => call.path.startsWith("/api/game-on-cards/"))', Boolean);
    await waitFor(connection, page.sessionId, 'window.__hypeEventQueriesInvalidated().every(Boolean)', Boolean);

    let apiState = await panelApiState();
    assert.equal(apiState.calls[0].method, 'POST');
    assert.equal(apiState.calls[0].path, '/api/schedule-shares');
    assert.equal(apiState.calls[0].payload.purpose, 'game-on-card');
    assert.equal(apiState.calls[0].payload.events[0].opponent, 'Falcons');
    assert.equal(apiState.calls[0].payload.events[0].date, '2026-11-13');
    assert.equal(apiState.clipboardCalls, 0, 'saving should not touch the clipboard');
    let cards = await localCards();
    assert.equal(cards.length, 1);
    assert.equal(cards[0].event.opponent, 'Falcons');
    assert.equal(cards[0].event.date, '2026-11-13');
    assert.equal(cards[0].shareToken, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(apiState.shares[cards[0].shareToken].events[0].opponent, 'Falcons', 'server copy should retain the saved event');

    const savedControls = await connection.evaluate<{ copyOrOpenEventCard: string[]; standaloneCardLinks: number; savedText: string }>(
      `(() => {
        const saved = document.querySelector('[data-testid="game-on-card-saved"]');
        const controls = [...(saved?.querySelectorAll('button, a') || [])];
        return {
          copyOrOpenEventCard: controls.map((control) => control.textContent?.trim() || '')
            .filter((text) => /copy.*event card|open.*event card/i.test(text)),
          standaloneCardLinks: controls.filter((control) => control instanceof HTMLAnchorElement
            && /\\/game-on\\//.test(control.getAttribute('href') || '')).length,
          savedText: saved?.textContent || '',
        };
      })()`,
      page.sessionId,
    );
    assert.match(savedControls.savedText, /Event Card saved/);
    assert.deepEqual(savedControls.copyOrOpenEventCard, []);
    assert.equal(savedControls.standaloneCardLinks, 0);

    await click('[data-testid="button-edit-game-on-card"]');
    await waitFor(connection, page.sessionId, '!!document.querySelector("[data-testid=\\"button-save-game-on-card\\"]")', Boolean);
    await assertSaveButtonInBounds(connection, page, 'button-save-game-on-card', 'Save Event Card', 390);
    await setViewport(connection, page, 1280);
    await assertSaveButtonInBounds(connection, page, 'button-save-game-on-card', 'Save Event Card', 1280);
    await setViewport(connection, page, 390);
    await fillPanel('2026-11-14', 'Ravens');
    await connection.evaluate('window.__seedHypeEventQueries()', page.sessionId);
    await click('[data-testid="button-save-game-on-card"]');
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-card-saved\\"]")?.textContent.includes("Ravens")', Boolean);
    await waitFor(connection, page.sessionId, 'window.__saveOnlyApi.calls.some(call => call.method === "PATCH")', Boolean);
    await waitFor(connection, page.sessionId, 'window.__hypeEventQueriesInvalidated().every(Boolean)', Boolean);

    apiState = await panelApiState();
    const updateCall = apiState.calls.find((call: any) => call.method === 'PATCH');
    assert.ok(updateCall, 'updating a saved card should call the update endpoint');
    assert.equal(updateCall.path, '/api/schedule-shares/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(updateCall.payload.purpose, 'game-on-card');
    assert.equal(updateCall.payload.events[0].opponent, 'Ravens');
    assert.equal(updateCall.payload.events[0].date, '2026-11-14');
    assert.equal(apiState.clipboardCalls, 0);
    cards = await localCards();
    assert.equal(cards.length, 1);
    assert.equal(cards[0].shareToken, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(cards[0].event.opponent, 'Ravens');
    assert.equal(cards[0].event.date, '2026-11-14');
    assert.equal(apiState.shares[cards[0].shareToken].events[0].opponent, 'Ravens');
    assert.equal(apiState.shares[cards[0].shareToken].events[0].date, '2026-11-14');

    await connection.evaluate('window.__resetSaveOnlyFixture(); window.__showSaveOnlyMode("failure")', page.sessionId);
    await waitFor(connection, page.sessionId, '!!document.querySelector("[data-testid=\\"button-save-game-on-card\\"]")', Boolean);
    await fillPanel('2026-11-15', 'Wolves');
    await connection.evaluate('window.__saveOnlyApi.failNextCreate = true', page.sessionId);
    await click('[data-testid="button-save-game-on-card"]');
    await waitFor(connection, page.sessionId, '!!document.querySelector("[data-testid=\\"game-on-card-error\\"]")', Boolean);
    await waitFor(connection, page.sessionId, '(() => { const button = document.querySelector("[data-testid=\\"button-save-game-on-card\\"]"); return !!button && !button.disabled; })()', Boolean);
    assert.equal(await connection.evaluate<boolean>(
      '(() => { const button = document.querySelector("[data-testid=\\"button-save-game-on-card\\"]"); return !!button && !button.disabled && button.textContent.includes("Save Event Card"); })()',
      page.sessionId,
    ), true, 'failed Event Card saves should remain retryable');
    assert.deepEqual(await localCards(), [], 'a failed request must not create a local saved card');
    await click('[data-testid="button-save-game-on-card"]');
    await waitFor(connection, page.sessionId, '!!document.querySelector("[data-testid=\\"game-on-card-saved\\"]")', Boolean);
    assert.equal((await localCards()).length, 1, 'retry should persist the successfully saved card');

    await connection.evaluate('window.__resetSaveOnlyFixture(); window.__showSaveOnlyMode("details")', page.sessionId);
    await waitFor(connection, page.sessionId, '!!document.querySelector("[data-testid=\\"button-save-inline-event\\"]")', Boolean);
    await assertSaveButtonInBounds(connection, page, 'button-save-inline-event', 'Save Event Card', 390);
    await setViewport(connection, page, 1280);
    await assertSaveButtonInBounds(connection, page, 'button-save-inline-event', 'Save Event Card', 1280);
    await setViewport(connection, page, 390);
    await connection.evaluate('window.__seedHypeEventQueries()', page.sessionId);
    await click('[data-testid="button-save-inline-event"]');
    await waitFor(connection, page.sessionId, '!!document.querySelector(".game-on-inline__notice")', Boolean);
    await waitFor(connection, page.sessionId, 'window.__saveOnlyApi.calls.some(call => call.method === "POST")', Boolean);
    await waitFor(connection, page.sessionId, 'window.__hypeEventQueriesInvalidated().every(Boolean)', Boolean);
    const inlineState = await connection.evaluate<any>(
      '({ calls: window.__saveOnlyApi.calls, calendarSaves: window.__saveOnlyApi.calendarSaves, changed: window.__saveOnlyApi.changed, clipboardCalls: window.__saveOnlyApi.clipboardCalls })',
      page.sessionId,
    );
    assert.equal(inlineState.calendarSaves.length, 1, 'inline detail save should update its linked calendar event');
    assert.equal(inlineState.calendarSaves[0].id, 'schedule-game-save-only');
    const inlineCreate = inlineState.calls.find((call: any) => call.method === 'POST');
    assert.equal(inlineCreate.payload.purpose, 'game-on-card');
    assert.equal(inlineCreate.payload.events[0].id, 'schedule-game-save-only');
    assert.equal(inlineCreate.payload.events[0].opponent, 'Hawks');
    assert.deepEqual(inlineState.changed, ['share:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
    assert.equal(inlineState.clipboardCalls, 0);
    assert.match(await connection.evaluate<string>(
      'document.querySelector(".game-on-inline__notice")?.textContent || ""',
      page.sessionId,
    ), /Hype Card’s Events section/);
    const inlineCards = await localCards();
    assert.equal(inlineCards.length, 1);
    assert.equal(inlineCards[0].shareToken, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(inlineCards[0].event.id, 'schedule-game-save-only');

    await connection.evaluate('window.__resetSaveOnlyFixture(); window.__showSaveOnlyMode("calendar")', page.sessionId);
    await waitFor(connection, page.sessionId, '!!document.querySelector("[data-testid=\\"button-save-inline-event\\"]")', Boolean);
    await assertSaveButtonInBounds(connection, page, 'button-save-inline-event', 'Save Calendar details', 390);
    await setViewport(connection, page, 1280);
    await assertSaveButtonInBounds(connection, page, 'button-save-inline-event', 'Save Calendar details', 1280);
    await setViewport(connection, page, 390);
    await click('[data-testid="button-save-inline-event"]');
    await waitFor(connection, page.sessionId, '!!document.querySelector(".game-on-inline__notice")', Boolean);
    const calendarOnly = await connection.evaluate<any>(
      '({ calls: window.__saveOnlyApi.calls, calendarSaves: window.__saveOnlyApi.calendarSaves })',
      page.sessionId,
    );
    assert.equal(calendarOnly.calendarSaves.length, 1, 'calendar-only details should still save to the calendar');
    assert.equal(calendarOnly.calls.some((call: any) => call.method === 'POST' || call.method === 'PATCH'), false);
    assert.deepEqual(await localCards(), [], 'calendar-only view must not manufacture an Event Card from a schedule draft');
    assert.match(await connection.evaluate<string>(
      'document.querySelector(".game-on-inline__notice")?.textContent || ""',
      page.sessionId,
    ), /Calendar event saved/);
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor && !browserMonitor.hasExited()) browser.kill('SIGTERM');
    if (browserMonitor) await browserMonitor.waitForExit();
    if (!devMonitor.hasExited()) devServer.kill('SIGTERM');
    await devMonitor.waitForExit();
    await rm(profile, { recursive: true, force: true });
    await rm(harnessPath, { force: true });
    await rm(htmlPath, { force: true });
  }
});