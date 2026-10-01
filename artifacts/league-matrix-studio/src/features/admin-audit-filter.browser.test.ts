import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
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
} from './browser-test-diagnostics';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const memberId = 'member-taylor-audit-fixture';

type CapturedRequest = {
  viewer: string;
  path: string;
  query: Record<string, string>;
};

function createFixtureData() {
  return Array.from({ length: 53 }, (_, index) => ({
    id: `audit-fixture-${index + 1}`,
    actorClerkUserId: 'admin-audit-fixture',
    targetClerkUserId: memberId,
    action: 'account_suspended',
    status: 'failed',
    changedFields: [],
    reason: null,
    failureCode: 'fixture_failure',
    createdAt: new Date(Date.UTC(2025, 1, 2, 23, 59, 59 - index)).toISOString(),
    completedAt: null,
  }));
}

async function availablePort() {
  const server = createServer();
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('Expected a TCP port'));
      else resolvePort(address.port);
    });
  });
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

test('administrators can filter and page audit history while non-admins cannot view it', async () => {
  const apiPort = await availablePort();
  const vitePort = await availablePort();
  const debugPort = await availablePort();
  const requests: CapturedRequest[] = [];
  const entries = createFixtureData();
  const api = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    const viewer = String(request.headers['x-test-viewer'] || 'unknown');
    const query = Object.fromEntries(url.searchParams.entries());
    requests.push({ viewer, path: url.pathname, query });
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'content-type, x-test-viewer');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    const json = (status: number, body: unknown) => response
      .writeHead(status, { 'content-type': 'application/json' })
      .end(JSON.stringify(body));

    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === '/__fixture/health') {
      json(200, { ready: true });
      return;
    }
    if (url.pathname === '/api/admin/session' && request.method === 'GET') {
      json(200, { isAdmin: viewer === 'administrator' });
      return;
    }
    if (url.pathname === '/api/admin/members' && request.method === 'GET') {
      if (viewer !== 'administrator') {
        json(403, { error: 'Administrator access is required.' });
        return;
      }
      const search = (query.search || '').toLowerCase();
      const items = search.includes('taylor')
        ? [{
            clerkUserId: memberId,
            firstName: 'Taylor',
            lastName: 'Jordan',
            primaryEmailAddress: 'taylor@example.test',
            profile: { displayName: 'Taylor Jordan' },
          }]
        : [];
      json(200, {
        items,
        totalCount: items.length,
        limit: Number(query.limit || 50),
        offset: Number(query.offset || 0),
      });
      return;
    }
    if (url.pathname === '/api/admin/audit' && request.method === 'GET') {
      if (viewer !== 'administrator') {
        json(403, { error: 'Administrator access is required.' });
        return;
      }
      const filtered = entries.filter((entry) => (
        (!query.memberClerkUserId || entry.targetClerkUserId === query.memberClerkUserId)
        && (!query.action || entry.action === query.action)
        && (!query.status || entry.status === query.status)
        && (!query.fromDate || entry.createdAt.slice(0, 10) >= query.fromDate)
        && (!query.toDate || entry.createdAt.slice(0, 10) <= query.toDate)
      ));
      const limit = Number(query.limit || 50);
      const offset = Number(query.offset || 0);
      json(200, {
        items: filtered.slice(offset, offset + limit),
        totalCount: filtered.length,
        limit,
        offset,
      });
      return;
    }
    json(404, { error: 'Not found' });
  });
  await new Promise<void>((resolveListen, reject) => {
    api.once('error', reject);
    api.listen(apiPort, '127.0.0.1', resolveListen);
  });

  const vite = spawn('pnpm', ['exec', 'vite', '--config', 'vite.admin-audit-filter-browser.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: { ...process.env, PORT: String(vitePort), BASE_PATH: '/', REPL_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const viteMonitor = monitorProcess(vite, 'Vite');
  let browser: ChildProcess | undefined;
  let browserMonitor: ReturnType<typeof monitorProcess> | undefined;
  let connection: DevToolsConnection | undefined;
  let directory: string | undefined;
  const pages: BrowserPage[] = [];

  try {
    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    const fixtureUrl = `http://127.0.0.1:${vitePort}/admin-audit-filter-browser-test.html`;
    await waitForUrl(`${apiOrigin}/__fixture/health`);
    await waitForUrl(fixtureUrl, 30_000, viteMonitor);

    directory = await mkdtemp(resolve(tmpdir(), 'pixl-admin-audit-browser-'));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${directory}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(webSocketDebuggerUrl, browserMonitor.diagnostics);

    const open = async (viewer: 'administrator' | 'member') => {
      const page = await openPage(
        connection!,
        `${fixtureUrl}?api=${encodeURIComponent(apiOrigin)}&viewer=${viewer}`,
        { viewport: { width: 1440, height: 1100, mobile: false } },
      );
      pages.push(page);
      return page.sessionId;
    };
    const admin = await open('administrator');
    const auditSection = 'section[aria-labelledby="admin-audit-heading"]';
    const getRange = `document.querySelector(${JSON.stringify(auditSection)})?.innerText || ''`;
    const click = (session: string, selector: string) => connection!.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.click()`,
      session,
    );
    const setValue = (session: string, selector: string, value: string) => connection!.evaluate(
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
        const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (!setter) throw new Error('No value setter for ' + ${JSON.stringify(selector)});
        setter.call(element, ${JSON.stringify(value)});
        element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      })()`,
      session,
    );
    const waitRange = (session: string, text: string) => waitFor(
      connection!,
      session,
      `(${getRange}).includes(${JSON.stringify(text)})`,
      Boolean,
      15_000,
    );

    await waitRange(admin, 'Showing 1–50 of 53 matching actions');
    await click(admin, `${auditSection} button[aria-label="Next audit page"]`);
    await waitRange(admin, 'Showing 51–53 of 53 matching actions');

    await setValue(admin, 'input[role="combobox"]', 'Taylor');
    await waitFor(
      connection,
      admin,
      "document.querySelector('[role=\"option\"]')?.textContent?.includes('Taylor Jordan') || false",
      Boolean,
      10_000,
    );
    await click(admin, '[role="option"]');

    // The filter form presents action/status first and the UTC date range after.
    await connection.evaluate(`(() => {
      const form = document.querySelector(${JSON.stringify(`${auditSection} form`)});
      const selects = [...form.querySelectorAll('select')];
      const dates = [...form.querySelectorAll('input[type="date"]')];
      if (selects.length !== 2 || dates.length !== 2) {
        throw new Error('Unexpected audit filter controls: ' + form.innerText);
      }
      const setSelect = (control, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(control, value);
        control.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const setDate = (control, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(control, value);
        control.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setSelect(selects[0], 'account_suspended');
      setSelect(selects[1], 'failed');
      setDate(dates[0], '2025-02-02');
      setDate(dates[1], '2025-02-02');
    })()`, admin);
    await click(admin, `${auditSection} form button[type="submit"]`);
    await waitRange(admin, 'Showing 1–50 of 53 matching actions');
    await waitFor(
      connection,
      admin,
      `document.querySelector(${JSON.stringify(auditSection)})?.innerText.includes('5 filters applied') || false`,
      Boolean,
    );

    const filteredRequest = requests.find(({ viewer, path, query }) => (
      viewer === 'administrator'
      && path === '/api/admin/audit'
      && query.memberClerkUserId === memberId
      && query.action === 'account_suspended'
      && query.status === 'failed'
      && query.fromDate === '2025-02-02'
      && query.toDate === '2025-02-02'
      && query.offset === '0'
    ));
    assert.ok(filteredRequest, 'applying all filters requests the first filtered page');
    const filteredPageText = await connection.evaluate<string>(
      `document.querySelector(${JSON.stringify(auditSection)})?.innerText || ''`,
      admin,
    );
    assert.match(filteredPageText, /account suspended/i);
    assert.match(filteredPageText, new RegExp(`Target ${memberId}`));

    await click(admin, `${auditSection} button[aria-label="Next audit page"]`);
    await waitRange(admin, 'Showing 51–53 of 53 matching actions');
    const filteredSecondPage = requests.find(({ viewer, path, query }) => (
      viewer === 'administrator'
      && path === '/api/admin/audit'
      && query.memberClerkUserId === memberId
      && query.action === 'account_suspended'
      && query.status === 'failed'
      && query.fromDate === '2025-02-02'
      && query.toDate === '2025-02-02'
      && query.offset === '50'
    ));
    assert.ok(filteredSecondPage, 'moving to the next page retains every applied filter');

    await connection.evaluate(`(() => {
      const form = document.querySelector(${JSON.stringify(`${auditSection} form`)});
      const control = form.querySelectorAll('select')[1];
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(control, 'completed');
      control.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, admin);
    await click(admin, `${auditSection} form button[type="submit"]`);
    await waitFor(
      connection,
      admin,
      `document.querySelector(${JSON.stringify(auditSection)})?.innerText.includes('No audit entries match these filters') || false`,
      Boolean,
    );
    await click(admin, `${auditSection} [aria-live="polite"] button`);
    await waitRange(admin, 'Showing 1–50 of 53 matching actions');
    const clearedControls = await connection.evaluate<boolean>(`(() => {
      const form = document.querySelector(${JSON.stringify(`${auditSection} form`)});
      return [...form.querySelectorAll('select, input')].every((control) => !control.value)
        && !form.querySelector('[aria-label^="Clear selected member"]');
    })()`, admin);
    assert.equal(clearedControls, true, 'clearing an empty result removes all filter selections');

    const nonAdmin = await open('member');
    await waitFor(
      connection,
      nonAdmin,
      "document.querySelector('h1')?.innerText.toLowerCase().includes('administrator access required') || false",
      Boolean,
      15_000,
    );
    assert.equal(
      await connection.evaluate<boolean>(
        `Boolean(document.querySelector(${JSON.stringify(auditSection)}) || document.querySelector('[aria-label="Audit history entries"]'))`,
        nonAdmin,
      ),
      false,
      'a non-administrator does not see audit history',
    );
    assert.equal(
      requests.some(({ viewer, path }) => viewer === 'member' && path === '/api/admin/audit'),
      false,
      'a non-administrator does not request audit entries',
    );
  } finally {
    for (const page of pages) {
      await connection?.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    }
    connection?.close();
    browser?.kill('SIGTERM');
    vite.kill('SIGTERM');
    await Promise.all([
      browserMonitor?.waitForExit(),
      viteMonitor.waitForExit(),
      new Promise<void>((resolveClose) => api.close(() => resolveClose())),
    ]);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});