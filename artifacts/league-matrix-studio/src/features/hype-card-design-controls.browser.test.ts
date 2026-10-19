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
const harnessPath = resolve(appDirectory, 'hype-card-design-controls-test.tsx');
const htmlPath = resolve(appDirectory, 'hype-card-design-controls-test.html');

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
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CardFinishOptions } from './src/features/hype-card-design-controls';
import { PreviewArtwork } from './src/features/hype-card-preview';
import { defaultProject } from './src/features/hype-card-types';

function Harness() {
  const [project, setProject] = useState(defaultProject());
  return createElement('main', { style: { display: 'grid', gridTemplateColumns: '1fr 260px', gap: '16px' } },
    createElement('output', { 'data-testid': 'design-state' }, project.finish),
    createElement(CardFinishOptions, {
      project,
      onFinishChange: (finish) => setProject((current) => ({ ...current, finish })),
    }),
    createElement('div', { style: { width: '260px', height: '346.67px' } },
      createElement(PreviewArtwork, { project, ns: 'active-design', testId: 'active-design-preview' }),
    ),
  );
}

createRoot(document.getElementById('root')).render(createElement(Harness));
`;
}

test('card design choices update selection state and the active Hype Card preview', async () => {
  await writeFile(harnessPath, harnessSource(), 'utf8');
  await writeFile(
    htmlPath,
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>html,body{margin:0;min-width:0}#root{padding:12px;box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/hype-card-design-controls-test.tsx"></script></body></html>',
    'utf8',
  );

  const portProbe = createServer();
  const port = await listen(portProbe);
  await new Promise<void>((resolveClose, rejectClose) => portProbe.close((error) => error ? rejectClose(error) : resolveClose()));
  const devServer = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      BASE_PATH: '/',
      VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const devMonitor = monitorProcess(devServer, 'Vite');
  const browserProfile = await mkdtemp(resolve(tmpdir(), 'pixl-hype-card-design-controls-'));
  const debugProbe = createServer();
  const debugPort = await listen(debugProbe);
  await new Promise<void>((resolveClose, rejectClose) => debugProbe.close((error) => error ? rejectClose(error) : resolveClose()));

  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  let page: BrowserPage | undefined;

  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 30_000, devMonitor);
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
    page = await openPage(connection, `http://127.0.0.1:${port}/hype-card-design-controls-test.html`, {
      viewport: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
    });
    const sessionId = page.sessionId;
    await waitFor(connection, sessionId, 'document.querySelector("[data-testid=design-state]")?.textContent || ""', (value) => value === 'classic', 30_000);

    const initial = await connection.evaluate<{ count: number; classicSelected: boolean; noGoldOverlay: boolean }>(`(() => {
      const buttons = [...document.querySelectorAll('[data-testid^="button-card-design-"]')];
      const preview = document.querySelector('[data-testid="active-design-preview"] svg')?.outerHTML || '';
      return {
        count: buttons.length,
        classicSelected: document.querySelector('[data-testid="button-card-design-classic"]')?.getAttribute('aria-pressed') === 'true',
        noGoldOverlay: !preview.includes('#031812'),
      };
    })()`, sessionId);
    assert.equal(initial.count, 5, 'all existing card designs should be selectable');
    assert.equal(initial.classicSelected, true, 'the default Classic design should be selected');
    assert.equal(initial.noGoldOverlay, true, 'Classic should preserve the original preview');

    await connection.evaluate<boolean>(`(() => {
      document.querySelector('[data-testid="button-card-design-gold-spotlight"]').click();
      return true;
    })()`, sessionId);
    await waitFor(connection, sessionId, 'document.querySelector("[data-testid=design-state]")?.textContent || ""', (value) => value === 'gold-spotlight', 5_000);

    const selected = await connection.evaluate<{ pressed: boolean; goldBackground: boolean; goldForeground: boolean }>(`(() => {
      const preview = document.querySelector('[data-testid="active-design-preview"] svg')?.outerHTML || '';
      return {
        pressed: document.querySelector('[data-testid="button-card-design-gold-spotlight"]')?.getAttribute('aria-pressed') === 'true',
        goldBackground: preview.includes('#031812'),
        goldForeground: preview.includes('#ffe17b'),
      };
    })()`, sessionId);
    assert.deepEqual(selected, { pressed: true, goldBackground: true, goldForeground: true });
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor && !browserMonitor.hasExited()) browser.kill('SIGTERM');
    if (browserMonitor) await browserMonitor.waitForExit();
    if (!devMonitor.hasExited()) devServer.kill('SIGTERM');
    await devMonitor.waitForExit();
    await rm(browserProfile, { recursive: true, force: true });
    await rm(harnessPath, { force: true });
    await rm(htmlPath, { force: true });
  }
});