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
  type ProcessMonitor,
} from './browser-test-diagnostics';

const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const harnessPath = resolve(appDirectory, 'stat-tracker-test-harness.tsx');
const htmlPath = resolve(appDirectory, 'stat-tracker-test.html');

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

function harnessSource() {
  return `
import { createElement, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  StatTrackerStartPanel,
  StatTrackerUpcomingNotice,
  type ScheduledGame,
} from './src/features/stat-tracker-page';
import './src/index.css';

const scheduledGame = {
  id: 'game-1',
  type: 'game',
  date: '2026-09-21',
  time: '18:30',
  opponent: 'Northside',
};

function TrackerHarness() {
  const [nextGame, setNextGame] = useState(scheduledGame);
  const [showNotice, setShowNotice] = useState(true);
  const [showManualSetup, setShowManualSetup] = useState(false);
  const [date, setDate] = useState(scheduledGame.date);
  const [opponent, setOpponent] = useState(scheduledGame.opponent);
  const [notes, setNotes] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const historyRef = useRef(null);

  useEffect(() => {
    setShowNotice(Boolean(nextGame));
    setShowManualSetup(false);
    if (nextGame) {
      setDate(nextGame.date);
      setOpponent(nextGame.opponent);
    }
  }, [nextGame]);

  window.__setTrackerNextGame = (game) => setNextGame(game || undefined);

  return createElement('main', null,
    nextGame && showNotice && createElement(StatTrackerUpcomingNotice, {
      nextGame,
      onUseUpcomingGame: () => setShowManualSetup(true),
      onDismiss: () => setShowNotice(false),
    }),
    createElement(StatTrackerStartPanel, {
      nextGame,
      label: 'Basketball',
      date,
      opponent,
      notes,
      showManualSetup,
      onToggleManualSetup: () => setShowManualSetup((value) => !value),
      onDateChange: setDate,
      onOpponentChange: setOpponent,
      onNotesChange: setNotes,
      onStartGame: () => {},
      onReviewPreviousGames: () => {
        setReviewed(true);
        historyRef.current?.focus();
      },
    }),
    createElement('section', {
      id: 'tracker-game-history',
      tabIndex: -1,
      'data-testid': 'stat-tracker-history',
      'data-reviewed': reviewed ? 'true' : 'false',
    }, 'Previous games'),
  );
}

export function mount() {
  createRoot(document.getElementById('test-root')).render(createElement(TrackerHarness));
}
`;
}

function htmlSource() {
  return `
<!doctype html>
<html>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Stat tracker browser test</title></head>
  <body><div id="test-root"></div><script type="module">import('/stat-tracker-test-harness.tsx?browser-test=' + Date.now()).then(({ mount }) => mount()).catch((error) => { document.body.dataset.testError = String(error); });</script></body>
</html>
`;
}

test('stat tracker protects scheduled and unscheduled start states in the browser', async () => {
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
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tempDirectory = await mkdtemp(resolve(tmpdir(), 'pixl-stat-tracker-browser-'));
  let browser: ChildProcess | undefined;
  let browserMonitor: ProcessMonitor | undefined;
  const devServerMonitor = monitorProcess(devServer, 'Vite dev server');
  let connection: DevToolsConnection | undefined;
  let page: { sessionId: string; targetId: string } | undefined;

  try {
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
    page = await openPage(connection, `http://127.0.0.1:${vitePort}/stat-tracker-test.html`);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-upcoming-notice\\"]") !== null', Boolean);

    const noticeText = await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"stat-tracker-upcoming-notice\\"]")?.textContent || ""',
      page.sessionId,
    );
    assert.match(noticeText, /Northside/);
    assert.match(noticeText, /2026/);

    await connection.evaluate('document.querySelector("[data-testid=\\"button-dismiss-upcoming-notice\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-upcoming-notice\\"]") === null', Boolean);

    await connection.evaluate('document.querySelector("[data-testid=\\"button-start-manual-game\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("#manual-game-setup") !== null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"button-start-manual-game\\"]")?.getAttribute("aria-expanded") || ""', page.sessionId),
      'true',
    );
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"input-stat-tracker-date\\"]")?.value || ""', page.sessionId),
      '2026-09-21',
    );
    assert.equal(
      await connection.evaluate<string>('document.querySelector("#manual-game-setup input:not([type=\\"date\\"])")?.value || ""', page.sessionId),
      'Northside',
    );

    await connection.evaluate('document.querySelector("[data-testid=\\"button-start-manual-game\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("#manual-game-setup") === null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"button-start-manual-game\\"]")?.getAttribute("aria-expanded") || ""', page.sessionId),
      'false',
    );

    await connection.evaluate('window.__setTrackerNextGame(null)', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-blank-state\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"stat-tracker-upcoming-notice\\"]"))', page.sessionId),
      false,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"button-review-previous-games\\"]"))', page.sessionId),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("#manual-game-setup"))', page.sessionId),
      false,
    );
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"button-start-manual-game\\"]")?.getAttribute("aria-expanded") || ""', page.sessionId),
      'false',
    );

    await connection.evaluate('document.querySelector("[data-testid=\\"button-review-previous-games\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-history\\"]")?.dataset.reviewed === "true"', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("#manual-game-setup"))', page.sessionId),
      false,
    );
  } finally {
    if (page && connection) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browserMonitor) {
      if (!browserMonitor.hasExited()) browser.kill('SIGTERM');
      await browserMonitor.waitForExit();
    }
    devServer.kill('SIGTERM');
    await devServerMonitor.waitForExit();
    await rm(tempDirectory, { recursive: true, force: true });
    await rm(harnessPath, { force: true });
    await rm(htmlPath, { force: true });
  }
});