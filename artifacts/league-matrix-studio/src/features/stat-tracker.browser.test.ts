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

async function reloadPage(connection: DevToolsConnection, sessionId: string) {
  const loadComplete = connection.waitForEvent('Page.loadEventFired', sessionId);
  await connection.send('Page.reload', { ignoreCache: false }, sessionId);
  await loadComplete;
}

function harnessSource() {
  return `
import { createElement, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from 'wouter';
import {
  LiveTrackerGame,
  StatTrackerSaveRecoveryAlert,
  StatTrackerSaveStatus,
  StatTrackerStartPanel,
  StatTrackerUpcomingNotice,
  subscribeToTrackerOnlineRetry,
  type ScheduledGame,
} from './src/features/stat-tracker-page';
import { GameOnInlineStatTracker } from './src/features/game-on-inline-stat-tracker';
import { GameReportView } from './src/features/stat-tracker-game-report';
import { TrackerCompletionDialog } from './src/features/tracker-completion-dialog';
import {
  buildGameReport,
  clearStoredTrackerSyncFailure,
  createGameSession,
  endGame,
  getLiveTrackingStats,
  getSportRule,
  getTrackerStorageKeys,
  normalizeTrackerData,
  readStoredTrackerData,
  readStoredTrackerSyncFailure,
  readStoredTrackerFavorites,
  saveStoredTrackerSyncFailure,
  saveStoredTrackerFavorites,
  trackerSaveErrorMessage,
} from './src/features/stat-tracker';
import './src/index.css';
import './src/features/tracker-completion-dialog.css';

const scheduledGame = {
  id: 'game-1',
  type: 'game',
  date: '2026-09-21',
  time: '18:30',
  opponent: 'Northside',
};

function SaveFeedbackHarness() {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  const finish = (outcome) => {
    window.setTimeout(() => {
      setSaving(false);
      if (outcome === 'success') {
        setStatus('cloud-saved');
        return;
      }
      setStatus('local-saved');
      const conflict = outcome === 'conflict';
      setRevisionConflict(conflict);
      setRetryAvailable(!conflict);
      setMessage(trackerSaveErrorMessage(conflict ? { status: 409 } : { status: 503 }));
    }, 250);
  };
  const start = (outcome) => {
    setStatus('saving');
    setMessage('');
    setRetryAvailable(false);
    setRevisionConflict(false);
    setSaving(true);
    finish(outcome);
  };
  const retry = () => {
    setStatus('saving');
    setMessage('');
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      setRetryAvailable(false);
      setStatus('cloud-saved');
    }, 250);
  };

  return createElement('main', { className: 'mx-auto w-full max-w-[390px] px-5 py-6' },
    createElement('div', { className: 'flex flex-wrap gap-2' },
      createElement('button', { type: 'button', 'data-testid': 'save-outcome-success', onClick: () => start('success') }, 'Save success'),
      createElement('button', { type: 'button', 'data-testid': 'save-outcome-local', onClick: () => start('local') }, 'Save local'),
      createElement('button', { type: 'button', 'data-testid': 'save-outcome-conflict', onClick: () => start('conflict') }, 'Save conflict'),
    ),
    createElement('div', { className: 'mt-5 flex min-w-0 justify-start' },
      status && createElement(StatTrackerSaveStatus, { status }),
    ),
    createElement('div', { className: 'mt-5' },
      createElement(StatTrackerSaveRecoveryAlert, {
        message,
        retryAvailable,
        revisionConflict,
        hasConflict: revisionConflict,
        saving,
        onRetry: retry,
        onRefresh: () => {},
      }),
    ),
    revisionConflict && createElement('section', {
      'data-testid': 'stat-tracker-conflict',
      className: 'border border-primary/50 bg-card p-5',
    }, 'History needs a choice. Newer cloud copy found.'),
  );
}

function ReconnectRecoveryHarness() {
  const accountId = 'browser-reconnect-user';
  const keys = getTrackerStorageKeys(accountId);
  const cloudHistoryKey = 'stat-tracker-browser-cloud-history';
  const attemptsKey = 'stat-tracker-browser-cloud-attempts';
  const storedFailure = readStoredTrackerSyncFailure(window.localStorage, accountId);
  const [games, setGames] = useState(() => readStoredTrackerData(window.localStorage, accountId).games);
  const [cloudGames, setCloudGames] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(cloudHistoryKey) || '[]');
    } catch {
      return [];
    }
  });
  const [status, setStatus] = useState(storedFailure ? 'local-saved' : null);
  const [message, setMessage] = useState(storedFailure
    ? trackerSaveErrorMessage(storedFailure === 'revision-conflict' ? { status: 409 } : { status: 503 })
    : '');
  const [retryAvailable, setRetryAvailable] = useState(storedFailure === 'retry');
  const [revisionConflict, setRevisionConflict] = useState(storedFailure === 'revision-conflict');
  const [saving, setSaving] = useState(false);
  const [ackPending, setAckPending] = useState(false);
  const [attempts, setAttempts] = useState(() => Number(window.localStorage.getItem(attemptsKey) || '0'));
  const pendingAck = useRef(null);

  const saveLocalGames = (nextGames) => {
    window.localStorage.setItem(keys.history, JSON.stringify({ version: 1, games: nextGames }));
    setGames(nextGames);
  };

  const saveToMockCloud = async (nextGames, shouldConflict = false) => {
    const nextAttempt = Number(window.localStorage.getItem(attemptsKey) || '0') + 1;
    window.localStorage.setItem(attemptsKey, String(nextAttempt));
    setAttempts(nextAttempt);
    if (!navigator.onLine) throw { status: 503 };
    if (shouldConflict) throw { status: 409 };
    if (window.__trackerHoldNextCloudAck) {
      window.__trackerHoldNextCloudAck = false;
      setAckPending(true);
      await new Promise((resolve) => { pendingAck.current = resolve; });
      setAckPending(false);
    }
    window.localStorage.setItem(cloudHistoryKey, JSON.stringify(nextGames));
    setCloudGames(nextGames);
  };

  const persistFailure = (error) => {
    const conflict = error && error.status === 409;
    saveStoredTrackerSyncFailure(window.localStorage, accountId, conflict ? 'revision-conflict' : 'retry');
    setRetryAvailable(!conflict);
    setRevisionConflict(conflict);
    setStatus('local-saved');
    setMessage(trackerSaveErrorMessage(conflict ? { status: 409 } : { status: 503 }));
  };

  const saveResult = async (opponent, shouldConflict = false) => {
    if (saving) return;
    const completed = endGame(createGameSession('football', { opponent }));
    const nextGames = [...games, completed];
    saveLocalGames(nextGames);
    setStatus('saving');
    setMessage('');
    setRetryAvailable(false);
    setRevisionConflict(false);
    setSaving(true);
    try {
      await saveToMockCloud(nextGames, shouldConflict);
      clearStoredTrackerSyncFailure(window.localStorage, accountId);
      setStatus('cloud-saved');
    } catch (error) {
      persistFailure(error);
    } finally {
      setSaving(false);
    }
  };

  const retryCloudSync = async () => {
    if (saving || !retryAvailable) return;
    setSaving(true);
    setStatus('saving');
    setMessage('');
    try {
      await saveToMockCloud(games);
      clearStoredTrackerSyncFailure(window.localStorage, accountId);
      setRetryAvailable(false);
      setStatus('cloud-saved');
    } catch (error) {
      persistFailure(error);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => subscribeToTrackerOnlineRetry({
    retryAvailable,
    revisionConflict,
    saving,
    onRetry: retryCloudSync,
  }), [retryAvailable, revisionConflict, saving]);

  return createElement('main', { className: 'mx-auto w-full max-w-[390px] px-5 py-6' },
    createElement('div', { className: 'flex flex-wrap gap-2' },
      createElement('button', {
        type: 'button',
        'data-testid': 'browser-save-completed-result',
        onClick: () => void saveResult('Northside'),
      }, 'Save completed result'),
      createElement('button', {
        type: 'button',
        'data-testid': 'browser-save-conflicting-result',
        onClick: () => void saveResult('Westview', true),
      }, 'Simulate revision conflict'),
      ackPending && createElement('button', {
        type: 'button',
        'data-testid': 'browser-release-cloud-ack',
        onClick: () => {
          const resolve = pendingAck.current;
          pendingAck.current = null;
          if (resolve) resolve();
        },
      }, 'Release cloud acknowledgement'),
    ),
    status && createElement('div', { className: 'mt-5 flex min-w-0 justify-start' },
      createElement(StatTrackerSaveStatus, { status }),
    ),
    createElement('div', { className: 'mt-5' },
      createElement(StatTrackerSaveRecoveryAlert, {
        message,
        retryAvailable,
        revisionConflict,
        hasConflict: revisionConflict,
        saving,
        onRetry: () => void retryCloudSync(),
        onRefresh: () => window.location.reload(),
      }),
    ),
    revisionConflict && createElement('section', {
      'data-testid': 'browser-tracker-conflict',
      role: 'alert',
    }, 'Local history: ' + games.map((game) => game.opponent).join(', ')
      + ' | Cloud history: ' + cloudGames.map((game) => game.opponent).join(', ')),
    createElement('output', { 'data-testid': 'browser-local-game-count' }, String(games.length)),
    createElement('output', { 'data-testid': 'browser-cloud-game-count' }, String(cloudGames.length)),
    createElement('output', { 'data-testid': 'browser-cloud-attempt-count' }, String(attempts)),
  );
}

function TrackerHarness() {
  const saveFeedbackMode = new URLSearchParams(window.location.search).get('saveFeedback') === '1';
  const reconnectRecoveryMode = new URLSearchParams(window.location.search).get('reconnectRecovery') === '1';
  const completionMode = new URLSearchParams(window.location.search).get('completion') === '1';
  const footballMode = new URLSearchParams(window.location.search).get('sport') === 'football';
  const persistenceMode = new URLSearchParams(window.location.search).get('persistence') === '1';
  const trackerHistoryStorageKey = 'stat-tracker-browser-history';
  const trackerActiveStorageKey = 'stat-tracker-browser-active-game';
  const [nextGame, setNextGame] = useState(scheduledGame);
  const [showNotice, setShowNotice] = useState(true);
  const [showManualSetup, setShowManualSetup] = useState(false);
  const [currentGame, setCurrentGame] = useState(() => {
    try {
      const stored = window.localStorage.getItem(trackerActiveStorageKey);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const favoriteSport = currentGame?.sport ?? (footballMode ? 'football' : 'soccer');
  const validFavoriteIds = getLiveTrackingStats(
    favoriteSport,
    getSportRule(favoriteSport).stats.filter((item) => !item.liveHidden),
  ).map((item) => item.id);
  const [favoriteStatIds, setFavoriteStatIds] = useState(() =>
    readStoredTrackerFavorites(window.localStorage, 'tracker-browser-user', favoriteSport, validFavoriteIds));
  useEffect(() => {
    setFavoriteStatIds(readStoredTrackerFavorites(
      window.localStorage,
      'tracker-browser-user',
      favoriteSport,
      validFavoriteIds,
    ));
  }, [favoriteSport]);
  const toggleFavorite = (statId) => {
    const nextFavorites = favoriteStatIds.includes(statId)
      ? favoriteStatIds.filter((id) => id !== statId)
      : [...favoriteStatIds, statId];
    setFavoriteStatIds(nextFavorites);
    saveStoredTrackerFavorites(
      window.localStorage,
      'tracker-browser-user',
      favoriteSport,
      nextFavorites,
      validFavoriteIds,
    );
  };
  const [savedGames, setSavedGames] = useState(() => {
    try {
      return normalizeTrackerData(JSON.parse(window.localStorage.getItem(trackerHistoryStorageKey) || 'null')).games;
    } catch {
      return [];
    }
  });
  const [selectedReportGameId, setSelectedReportGameId] = useState(null);
  const [date, setDate] = useState(scheduledGame.date);
  const [opponent, setOpponent] = useState(scheduledGame.opponent);
  const [notes, setNotes] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [captureNotice, setCaptureNotice] = useState('');
  const historyRef = useRef(null);
  const persistActiveGame = (game) => {
    if (game) window.localStorage.setItem(trackerActiveStorageKey, JSON.stringify(game));
    else window.localStorage.removeItem(trackerActiveStorageKey);
    setCurrentGame(game);
  };

  useEffect(() => {
    setShowNotice(Boolean(nextGame));
    setShowManualSetup(false);
    if (nextGame) {
      setDate(nextGame.date);
      setOpponent(nextGame.opponent);
    }
  }, [nextGame]);

  window.__setTrackerNextGame = (game) => setNextGame(game || undefined);
  window.__startSoccerRegression = () => {
    setCaptureNotice('');
    persistActiveGame(createGameSession('soccer', {
      date, opponent, notes, soccerPeriodFormat: 'halves',
    }));
  };
  window.__clearSoccerRegression = () => persistActiveGame(null);
  const report = selectedReportGameId
    ? buildGameReport(savedGames, 'football', selectedReportGameId)
    : null;

  if (saveFeedbackMode) return createElement(SaveFeedbackHarness);
  if (reconnectRecoveryMode) return createElement(ReconnectRecoveryHarness);
  if (completionMode) return createElement(CompletionHarness);

  return createElement('main', { className: 'studio-editor-page-background stat-tracker-editor-page min-h-dvh w-full min-w-0' },
    createElement('output', {
      hidden: true,
      'data-testid': 'tracker-next-game-source',
    }, nextGame?.id || 'none'),
    !currentGame && nextGame && createElement(StatTrackerUpcomingNotice, {
      nextGame,
      onUseUpcomingGame: () => setShowManualSetup(true),
      onDismiss: () => setShowNotice(false),
      onToggleManualSetup: () => setShowManualSetup((value) => !value),
      showManualSetup,
      hiddenOnDesktop: !showNotice,
    }),
    currentGame
      ? createElement(LiveTrackerGame, {
          currentGame,
          // Deliberately stale setup rules: a resumed soccer game must still
          // render and record soccer, not silently reject football stat IDs.
          rule: getSportRule('football'),
          athleteName: 'Maya',
          teamName: 'Falcons',
          displayStats: getSportRule('football').stats.filter((item) => !item.liveHidden && item.featured),
          showAllStats: false,
          favoriteStatIds,
          onToggleFavorite: toggleFavorite,
          saving: false,
           captureNotice,
           onCapture: (kind, file) => setCaptureNotice(!file
             ? 'No media selected. You can try again whenever you are ready.'
             : kind === 'photo'
               ? 'Photo ready for Falcons vs ' + (currentGame?.opponent || 'this game') + '. Tap Save to Photos below; Pixl Sports does not upload or store it here.'
               : 'Video ready for Falcons vs ' + (currentGame?.opponent || 'this game') + '. Pixl Sports does not upload or store it here.'),
           onGameChange: persistActiveGame,
          onToggleShowAllStats: () => {},
           onLeaveGame: () => persistActiveGame(null),
           onEndGame: () => {
             if (!persistenceMode || !currentGame) return;
             const completed = endGame(currentGame);
             const nextGames = [...savedGames, completed];
             window.localStorage.setItem(trackerHistoryStorageKey, JSON.stringify({ version: 1, games: nextGames }));
             setSavedGames(nextGames);
             persistActiveGame(null);
           },
        })
      : createElement(StatTrackerStartPanel, {
          nextGame,
          label: footballMode ? 'Football' : 'Basketball',
          date,
          opponent,
          notes,
          showManualSetup,
          onToggleManualSetup: () => setShowManualSetup((value) => !value),
          onDateChange: setDate,
          onOpponentChange: setOpponent,
          onNotesChange: setNotes,
          onStartGame: footballMode
            ? () => {
                 persistActiveGame(createGameSession('football', { date, opponent, notes }));
                setShowManualSetup(false);
              }
            : () => {},
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
    }, persistenceMode
      ? savedGames.length
        ? savedGames.map((game) => createElement('button', {
            key: game.id,
            type: 'button',
            'data-testid': 'history-card-' + game.id,
            onClick: () => setSelectedReportGameId(game.id),
          }, 'vs ' + game.opponent + ' ' + game.events.length + ' plays'))
        : 'No completed football games yet.'
      : 'Previous games'),
    report && createElement(GameReportView, {
      report,
      rule: getSportRule('football'),
      onClose: () => setSelectedReportGameId(null),
      onSelectGame: setSelectedReportGameId,
    }),
  );
}

function CompletionHarness() {
  const [open, setOpen] = useState(true);
  const [viewed, setViewed] = useState(false);
  const [game] = useState(() => endGame(createGameSession('football', { opponent: 'Northside' })));
  return createElement('main', null,
    createElement('button', { type: 'button', 'data-testid': 'reopen-completion', onClick: () => setOpen(true) }, 'Open completion'),
    createElement('output', { 'data-testid': 'completion-viewed' }, viewed ? 'Viewed' : 'Not viewed'),
    createElement(TrackerCompletionDialog, {
      game,
      open,
      onOpenChange: setOpen,
      teamName: 'Falcons',
      onViewStats: () => { setViewed(true); setOpen(false); },
      viewHref: '/studio/stat-tracker',
    }),
  );
}

export function mount() {
  const root = createRoot(document.getElementById('test-root'));
  const search = new URLSearchParams(window.location.search);
  if (search.get('inlineFootball') === '1') {
    root.render(createElement(Router, null,
      createElement(GameOnInlineStatTracker, {
        userId: 'inline-football-user',
        sport: 'football',
        athleteName: 'Maya',
        teamName: 'Falcons',
        eventId: 'inline-football-game',
        date: '2026-09-21',
        time: '18:30',
        location: 'Northside Field',
        opponent: 'Northside',
      }),
    ));
    return;
  }
  if (search.get('inlineSportChoice') === '1') {
    root.render(createElement(Router, null,
      createElement(GameOnInlineStatTracker, {
        userId: 'inline-sport-choice-user',
        sport: null,
        athleteName: 'Maya',
        teamName: 'Falcons',
        eventId: 'inline-choice-game',
        date: '2026-09-21',
        time: '18:30',
        location: 'Northside Gym',
        opponent: 'Northside',
      }),
    ));
    return;
  }
  root.render(createElement(TrackerHarness));
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

async function runTrackerBrowserChecks(soccerOnly = false) {
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
    const capturedPhotoPath = resolve(tempDirectory, 'captured-photo.png');
    await writeFile(capturedPhotoPath, Buffer.from('captured photo fixture'));
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
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-upcoming-notice\\"]") !== null', Boolean);

    if (soccerOnly) {
    // Reproduce the reported soccer stat path, including paused taps and reload.
    await connection.evaluate('window.__startSoccerRegression()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-stat-shot-on-target\\"]") !== null', Boolean);
    await connection.evaluate(`(() => {
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: (data) => Boolean(data?.files?.length),
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => {
          window.__trackerPhotoShare = {
            name: data.files[0].name,
            type: data.files[0].type,
            size: data.files[0].size,
          };
        },
      });
    })()`, page.sessionId);
    const documentNode = await connection.send<{ root: { nodeId: number } }>('DOM.getDocument', {}, page.sessionId);
    const photoInput = await connection.send<{ nodeId: number }>('DOM.querySelector', {
      nodeId: documentNode.root.nodeId,
      selector: '[data-testid="input-stat-tracker-capture-photo"]',
    }, page.sessionId);
    assert.ok(photoInput.nodeId, 'the game photo input should be mounted');
    await connection.send('DOM.setFileInputFiles', { files: [capturedPhotoPath], nodeId: photoInput.nodeId }, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-save-captured-photo\\"]") !== null', Boolean);
    assert.match(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"status-stat-tracker-capture-notice\\"]")?.textContent || ""', page.sessionId),
      /Tap Save to Photos below/,
    );
    const capturedPhotoLayout = await connection.evaluate<{ viewport: number; document: number; scoreboardRight: number }>(`(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      scoreboardRight: document.querySelector('[data-testid="live-tracker-scoreboard"]').getBoundingClientRect().right,
    }))()`, page.sessionId);
    assert.ok(capturedPhotoLayout.document <= capturedPhotoLayout.viewport + 1, 'captured-photo status must not widen the phone page');
    assert.ok(capturedPhotoLayout.scoreboardRight <= capturedPhotoLayout.viewport + 1, 'scoreboard stays inside the phone viewport after capture');
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"button-save-captured-photo\\"]")?.textContent.trim() || ""', page.sessionId),
      'Save to Photos',
    );
    await connection.evaluate('document.querySelector("[data-testid=\\"button-save-captured-photo\\"]").click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'window.__trackerPhotoShare?.name === "captured-photo.png"', Boolean);
    assert.equal(await connection.evaluate<string>('window.__trackerPhotoShare.type', page.sessionId), 'image/png');
    assert.ok(await connection.evaluate<number>('window.__trackerPhotoShare.size', page.sessionId) > 0);
    assert.equal(
      await connection.evaluate<boolean>('localStorage.getItem("stat-tracker-browser-active-game")?.includes("captured-photo.png") || false', page.sessionId),
      false,
      'captured photo metadata must not be persisted with tracker data',
    );
    assert.match(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"status-captured-photo-save\\"]")?.textContent || ""', page.sessionId),
      /If you chose Save Image/,
    );
    await connection.evaluate(`Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false })`, page.sessionId);

    await connection.evaluate('document.querySelector("[data-testid=\\"toggle-stat-favorite-shot-on-target\\"]").click()', page.sessionId);
    await waitFor(connection, page.sessionId, `document.querySelector('[data-testid="toggle-stat-favorite-shot-on-target"]')?.getAttribute('aria-pressed') === 'true' &&
      document.querySelector('[data-testid="live-stat-group-favorites"] [data-testid="live-stat-card-shot-on-target"]') !== null &&
      document.activeElement?.getAttribute('data-testid') === 'toggle-stat-favorite-shot-on-target'`, Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"button-save-captured-photo\\"]")?.textContent.trim() || ""', page.sessionId),
      'Download photo',
      'unsupported file sharing should offer an explicit download instead',
    );
    assert.deepEqual(
      await connection.evaluate<string[]>('JSON.parse(localStorage.getItem("leaguematrix-stat-tracker:favorites:tracker-browser-user:soccer"))', page.sessionId),
      ['shot-on-target'],
    );
    assert.equal(
      await connection.evaluate<boolean>(`(() => {
        const star = document.querySelector('[data-testid="toggle-stat-favorite-shot-on-target"]').getBoundingClientRect();
        const athlete = document.querySelector('[data-testid="athlete-stat-target-shot-on-target"]').getBoundingClientRect();
        return star.width >= 44 && star.height >= 44 && athlete.width >= 44 && athlete.height >= 44;
      })()`, page.sessionId),
      true,
      'mobile favorite and athlete controls should remain full-size touch targets',
    );
    await connection.evaluate(`(() => {
      const shot = document.querySelector('[data-testid="live-stat-shot-on-target"]');
      shot.click(); shot.click(); shot.click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'JSON.parse(localStorage.getItem("stat-tracker-browser-active-game")).stats["shot-on-target"]', (count) => count === 3);
    assert.match(await connection.evaluate<string>('document.querySelector("[data-testid=\\"stat-count-shot-on-target\\"]").textContent.trim()', page.sessionId), /^3/);
    await connection.evaluate('document.querySelector("[data-testid=\\"button-toggle-live-game-pause\\"]").click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"notice-live-tracker-paused\\"]") !== null', Boolean);
    assert.equal(await connection.evaluate<boolean>(`['live-stat-shot-on-target', 'athlete-stat-target-shot-on-target', 'score-adjust-athlete-increase'].every(id => document.querySelector('[data-testid="' + id + '"]').matches(':disabled'))`, page.sessionId), true);
    assert.equal(await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"toggle-stat-favorite-shot-on-target\\"]")?.matches(":enabled")', page.sessionId), true);
    await connection.evaluate('document.querySelector("[data-testid=\\"live-stat-shot-on-target\\"]").click()', page.sessionId);
    assert.equal(await connection.evaluate<number>('JSON.parse(localStorage.getItem("stat-tracker-browser-active-game")).events.length', page.sessionId), 3);
    await reloadPage(connection, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"notice-live-tracker-paused\\"]") !== null', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"button-resume-live-stats\\"]").click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-stat-shot-on-target\\"]")?.matches(":enabled")', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"athlete-stat-target-shot-on-target\\"]").click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'JSON.parse(localStorage.getItem("stat-tracker-browser-active-game")).stats["shot-on-target"]', (count) => count === 4);
    assert.match(await connection.evaluate<string>('document.querySelector("[data-testid=\\"stat-count-shot-on-target\\"]").textContent.trim()', page.sessionId), /^4/);
    assert.match(await connection.evaluate<string>('document.querySelector("[data-testid=\\"live-stat-shot-on-target\\"]").textContent', page.sessionId), /Team 3.*Maya 1/);
    for (const statId of ['pass', 'header', 'clearance', 'corner-kick', 'penalty-kick', 'red-card']) {
      await connection.evaluate(`document.querySelector('[data-testid="live-stat-${statId}"]').click(); document.querySelector('[data-testid="athlete-stat-target-${statId}"]').click();`, page.sessionId);
      await waitFor(connection, page.sessionId, `JSON.parse(localStorage.getItem("stat-tracker-browser-active-game")).stats["${statId}"]`, (count) => count === 2);
      assert.match(await connection.evaluate<string>(`document.querySelector('[data-testid="stat-count-${statId}"]').textContent.trim()`, page.sessionId), /^2/);
      assert.match(await connection.evaluate<string>(`document.querySelector('[data-testid="live-stat-${statId}"]').textContent`, page.sessionId), /Team 1.*Maya 1/);
    }
    await reloadPage(connection, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-count-corner-kick\\"]")?.textContent.trim().startsWith("2")', Boolean);
    assert.equal(await connection.evaluate<number>('JSON.parse(localStorage.getItem("stat-tracker-browser-active-game")).score', page.sessionId), 0);
    await connection.evaluate('window.__clearSoccerRegression()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-upcoming-notice\\"]") !== null', Boolean);
    return;
    }

    const noticeText = await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"stat-tracker-upcoming-notice\\"]")?.textContent || ""',
      page.sessionId,
    );
    assert.match(noticeText, /Northside/);
    assert.match(noticeText, /2026/);

    assert.equal(
      await connection.evaluate<boolean>(`(() => {
        const use = document.querySelector('[data-testid="button-use-upcoming-game"]')?.getBoundingClientRect();
        const manual = document.querySelector('[data-testid="button-start-manual-game"]')?.getBoundingClientRect();
        const summary = document.querySelector('[data-testid="stat-tracker-start-summary"]');
        return Boolean(use && manual && summary
          && manual.left >= use.right
          && Math.abs(manual.top - use.top) < 2
          && getComputedStyle(summary).display === 'none'
          && document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      })()`, page.sessionId),
      true,
    );

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
    await connection.evaluate('document.querySelector("[data-testid=\\"button-review-previous-games\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-history\\"]")?.dataset.reviewed === "true"', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("#manual-game-setup"))', page.sessionId),
      false,
    );

    await connection.evaluate('window.location.search = "?sport=football&persistence=1"', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-upcoming-notice\\"]") !== null', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"button-start-manual-game\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("#manual-game-setup") !== null', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"button-confirm-start-game\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-tracker-layout\\"]") !== null', Boolean);
    await connection.evaluate(`(() => {
      const input = document.querySelector('[data-testid="input-stat-tracker-capture-photo"]');
      input?.focus();
      input?.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.activeElement?.getAttribute("data-testid") !== "input-stat-tracker-capture-photo"', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(
        'document.documentElement.scrollWidth <= document.documentElement.clientWidth && window.innerWidth === 390',
        page.sessionId,
      ),
      true,
    );

    assert.equal(
      await connection.evaluate<boolean>(
        '!document.querySelector("[data-testid=\\"football-yard-tracking\\"]") && !document.querySelector("[data-testid=\\"toggle-football-yard-tracking\\"]") && document.querySelectorAll("[data-testid^=\\"input-yard-\\"]").length === 0 && document.querySelectorAll("[data-testid^=\\"yard-control-\\"]").length === 0',
        page.sessionId,
      ),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>(
        '["touchdown", "tackle"].every((id) => document.querySelector(`[data-testid="live-stat-${id}"]`) !== null)',
        page.sessionId,
      ),
      true,
    );
    assert.equal(
      await connection.evaluate<number>(
        'parseFloat(getComputedStyle(document.querySelector("[data-testid=\\"stat-title-touchdown\\"]")).fontSize)',
        page.sessionId,
      ),
      12,
      'stat titles should be comfortably readable at phone size',
    );
    assert.equal(
      await connection.evaluate<boolean>(
        '(() => { const pass = document.querySelector("[data-testid=\\"live-stat-pass-reception\\"]"); const rush = document.querySelector("[data-testid=\\"live-stat-rush-yard\\"]"); const interception = document.querySelector("[data-testid=\\"live-stat-interception\\"]"); return pass?.textContent.includes("PASS/REC") && rush?.textContent.includes("RUSH") && !/yds/i.test(pass?.textContent || "") && !/yds/i.test(rush?.textContent || "") && interception?.textContent.includes("INT") && !document.querySelector("[data-testid=\\"live-stat-reception\\"]") && !document.querySelector("[data-testid=\\"live-stat-pass-yard\\"]"); })()',
        page.sessionId,
      ),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>(
        'document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.querySelector("[data-testid=\\"live-tracker-stat-controls\\"]").scrollWidth <= document.querySelector("[data-testid=\\"live-tracker-stat-controls\\"]").clientWidth',
        page.sessionId,
      ),
      true,
    );

    await connection.evaluate(`(() => {
      const pass = document.querySelector('[data-testid="athlete-stat-target-pass-reception"]');
      const rush = document.querySelector('[data-testid="athlete-stat-target-rush-yard"]');
      pass?.click();
      pass?.click();
      pass?.click();
      rush?.click();
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-stat-card-pass-reception\\"]")?.dataset.athleteAssigned === "true"', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(
        'document.querySelector("[data-testid=\\"live-stat-card-pass-reception\\"]")?.className.includes("border-border") && !document.querySelector("[data-testid=\\"live-stat-card-pass-reception\\"]")?.className.includes("border-accent") && !document.querySelector("[data-testid=\\"athlete-stat-target-pass-reception\\"]")?.className.includes("ring-accent")',
        page.sessionId,
      ),
      true,
    );
    assert.equal(
      await connection.evaluate<string>(
        'document.querySelector("[data-testid=\\"live-stat-pass-reception\\"]")?.getAttribute("aria-describedby") || ""',
        page.sessionId,
      ),
      'athlete-assignment-pass-reception',
    );

    assert.equal(
      await connection.evaluate<boolean>(
        '(() => { const game = JSON.parse(localStorage.getItem("stat-tracker-browser-active-game") || "null"); const paired = game?.events?.filter((event) => event.playId) || []; return game?.stats?.["pass-yard"] === 3 && game?.stats?.reception === 3 && game?.stats?.["rush-yard"] === 1 && game.events.length === 7 && paired.length === 6 && paired.every((event) => event.attribution === "athlete") && game.events.every((event) => event.yards == null) && Object.keys(game.yardStats || {}).length === 0; })()',
        page.sessionId,
      ),
      true,
    );

    await connection.evaluate('document.querySelector("[data-testid=\\"live-stat-interception\\"]")?.click(); document.querySelector("[data-testid=\\"athlete-stat-target-interception\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'JSON.parse(localStorage.getItem("stat-tracker-browser-active-game") || "null")?.stats?.interception === 2', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"live-stat-card-interception\\"]")?.textContent.includes("Team 1") && document.querySelector("[data-testid=\\"live-stat-card-interception\\"]")?.dataset.athleteAssigned === "true"', page.sessionId),
      true,
    );
    await connection.evaluate('document.querySelector("[data-testid=\\"live-stat-touchdown\\"]")?.click(); document.querySelector("[data-testid=\\"live-stat-tackle\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-stat-card-touchdown\\"]")?.textContent.includes("1") && document.querySelector("[data-testid=\\"live-stat-card-tackle\\"]")?.textContent.includes("1")', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"live-tracker-score-card-athlete\\"]")?.textContent.includes("6")', page.sessionId),
      true,
    );
    const recentActivityText = await connection.evaluate<string>(
      'document.querySelector("[data-testid=\\"live-tracker-recent-activity\\"]")?.textContent || ""',
      page.sessionId,
    );
    assert.ok(recentActivityText.indexOf('Tackle') < recentActivityText.indexOf('Touchdown'));
    await connection.evaluate('document.querySelector("[data-testid=\\"score-adjust-athlete-increase\\"]")?.click(); document.querySelector("[data-testid=\\"score-adjust-athlete-increase\\"]")?.click(); document.querySelector("[data-testid=\\"score-adjust-opponent-increase\\"]")?.click(); document.querySelector("[data-testid=\\"score-adjust-opponent-increase\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-tracker-score-card-athlete\\"]")?.textContent.includes("8") && document.querySelector("[data-testid=\\"live-tracker-score-card-opponent\\"]")?.textContent.includes("2")', Boolean);
    await connection.evaluate(`window.__setTrackerNextGame({
      id: 'game-2',
      type: 'game',
      date: '2026-09-28',
      time: '19:00',
      opponent: 'Westview',
    })`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"tracker-next-game-source\\"]")?.textContent === "game-2"', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"live-tracker-layout\\"]"))', page.sessionId),
      true,
    );
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"live-tracker-matchup\\"]")?.textContent || ""', page.sessionId),
      'Falcons vs Northside',
    );
    assert.equal(
      await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"live-tracker-score-card-athlete\\"]")?.textContent.includes("8") && document.querySelector("[data-testid=\\"live-tracker-score-card-opponent\\"]")?.textContent.includes("2")', page.sessionId),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>(
        '["pass-reception", "rush-yard", "interception", "touchdown", "tackle"].every((id) => { const element = document.querySelector(`[data-testid="live-stat-${id}"]`); const rect = element?.getBoundingClientRect(); return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= window.innerWidth); })',
        page.sessionId,
      ),
      true,
    );

    await connection.evaluate('window.location.reload()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-tracker-layout\\"]") !== null && document.querySelector("[data-testid=\\"live-tracker-score-card-athlete\\"]")?.textContent.includes("8") && document.querySelector("[data-testid=\\"live-tracker-score-card-opponent\\"]")?.textContent.includes("2")', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(
        'document.querySelectorAll("[data-testid^=\\"input-yard-\\"]").length === 0 && document.querySelectorAll("[data-testid^=\\"button-correct-yards-\\"]").length === 0 && document.querySelector("[data-testid=\\"live-stat-card-pass-reception\\"]")?.textContent.includes("3")',
        page.sessionId,
      ),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>(
        '(() => { const game = JSON.parse(localStorage.getItem("stat-tracker-browser-active-game") || "null"); return game?.stats?.["pass-yard"] === 3 && game?.stats?.reception === 3 && game?.stats?.["rush-yard"] === 1 && game?.stats?.interception === 2 && game.events.every((event) => event.yards == null) && Object.keys(game.yardStats || {}).length === 0; })()',
        page.sessionId,
      ),
      true,
    );

    await connection.evaluate('document.querySelector("[data-testid=\\"button-advance-game-period\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"live-tracker-scoreboard\\"]")?.textContent.includes("Quarter 2")', Boolean);
    assert.equal(
      await connection.evaluate<number>('JSON.parse(localStorage.getItem("stat-tracker-browser-active-game") || "null")?.period', page.sessionId),
      2,
      'advancing a quarter should persist the active game period',
    );

    await connection.evaluate('document.querySelector("[data-testid=\\"button-end-live-game\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"confirm-end-live-game\\"]") !== null', Boolean);
    await waitFor(connection, page.sessionId, 'document.activeElement?.getAttribute("data-testid") === "button-cancel-end-live-game"', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"radio-final-score-yes\\"]")?.checked === true && document.querySelector("[data-testid=\\"tracker-end-summary\\"]")?.textContent.includes("final score") === true', page.sessionId),
      true,
      'an entered scoreboard should offer to save the final score and explain that choice',
    );
    await connection.evaluate('document.querySelector("[data-testid=\\"radio-final-score-no\\"]")?.click()', page.sessionId);
    await connection.evaluate('document.querySelector("[data-testid=\\"button-game-outcome-win\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"tracker-end-summary\\"]")?.textContent.includes("Win result · no final score recorded")', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"radio-final-score-yes\\"]")?.click()', page.sessionId);
    await connection.evaluate('document.querySelector("[data-testid=\\"button-game-outcome-loss\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"tracker-score-result-warning\\"]")?.textContent.includes("Both will be saved as shown")', Boolean);
    assert.deepEqual(
      await connection.evaluate<{
        confirmationParts: {
          asksToEnd: boolean;
          explainsSaving: boolean;
          cancelLabel: boolean;
          confirmLabel: boolean;
        };
        activeGameKept: boolean;
        historyCards: number;
      }>(`(() => {
        const text = document.querySelector('[data-testid="confirm-end-live-game"]')?.textContent || '';
        return {
          confirmationParts: {
            asksToEnd: text.includes('End this game?'),
            explainsSaving: text.includes('This will save the current stats as a completed game in your history.'),
            cancelLabel: text.includes('Keep tracking'),
            confirmLabel: text.includes('End & save game'),
          },
          activeGameKept: Boolean(JSON.parse(localStorage.getItem('stat-tracker-browser-active-game') || 'null')),
          historyCards: document.querySelectorAll('[data-testid^="history-card-"]').length,
        };
      })()`, page.sessionId),
      {
        confirmationParts: {
          asksToEnd: true,
          explainsSaving: true,
          cancelLabel: true,
          confirmLabel: true,
        },
        activeGameKept: true,
        historyCards: 0,
      },
      'requesting to end a game should ask first without clearing the live game',
    );
    await connection.evaluate('document.querySelector("[data-testid=\\"button-cancel-end-live-game\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"confirm-end-live-game\\"]") === null && document.querySelector("[data-testid=\\"live-tracker-layout\\"]") !== null', Boolean);
    await waitFor(connection, page.sessionId, 'document.activeElement?.getAttribute("data-testid") === "button-end-live-game"', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(JSON.parse(localStorage.getItem("stat-tracker-browser-active-game") || "null"))', page.sessionId),
      true,
      'canceling confirmation should leave the game open',
    );
    await connection.evaluate('document.querySelector("[data-testid=\\"button-end-live-game\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-confirm-end-live-game\\"]") !== null', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"button-confirm-end-live-game\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid^=\\"history-card-\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid^=\\"history-card-\\"]")?.textContent || ""', page.sessionId),
      'vs Northside 11 plays',
    );
    assert.equal(
      await connection.evaluate<boolean>(
        'document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.querySelector("[data-testid=\\"stat-tracker-history\\"]").scrollWidth <= document.querySelector("[data-testid=\\"stat-tracker-history\\"]").clientWidth',
        page.sessionId,
      ),
      true,
    );

    await reloadPage(connection, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid^=\\"history-card-\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('Boolean(document.querySelector("[data-testid=\\"live-tracker-layout\\"]"))', page.sessionId),
      false,
    );
    await connection.evaluate('document.querySelector("[data-testid^=\\"history-card-\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-report-overlay\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(
        '!document.querySelector("[data-testid=\\"report-yardage\\"]") && document.querySelectorAll("[data-testid^=\\"report-yard-\\"]").length === 0',
        page.sessionId,
      ),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"report-score-box\\"]")?.textContent.includes("8") && document.querySelector("[data-testid=\\"report-score-box\\"]")?.textContent.includes("2")', page.sessionId),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>(
        'document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.querySelector("[data-testid=\\"game-report-overlay\\"]").scrollWidth <= document.querySelector("[data-testid=\\"game-report-overlay\\"]").clientWidth',
        page.sessionId,
      ),
      true,
    );

    await connection.evaluate('window.location.search = "?saveFeedback=1"', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"save-outcome-success\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>('document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]") === null', page.sessionId),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>('!document.body.textContent.includes("Cloud sync active")', page.sessionId),
      true,
    );

    await connection.evaluate('window.location.href = "/stat-tracker-test.html?completion=1"', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"dialog-tracker-completed\\"]") !== null', Boolean);
    await connection.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, page.sessionId);
    await connection.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 568, deviceScaleFactor: 1, mobile: true }, page.sessionId);
    assert.equal(
      await connection.evaluate<boolean>(`(() => {
        const confetti = document.querySelector('.tracker-completion-confetti');
        return confetti && getComputedStyle(confetti).animationDuration === '3.2s';
      })()`, page.sessionId),
      true,
      'celebration confetti should remain animated for over three seconds',
    );
    const tapCompletion = async (testId: string, selectorTag = '') => {
      const target = await connection!.evaluate<{ x: number; y: number; hit: boolean }>(`(() => {
        const element = document.querySelector('${selectorTag}[data-testid="${testId}"]');
        if (!(element instanceof HTMLElement)) throw new Error('Missing completion action: ${testId}');
        element.scrollIntoView({ block: 'center' });
        const rect = element.getBoundingClientRect();
        const x = Math.round(rect.left + rect.width / 2);
        const y = Math.round(rect.top + rect.height / 2);
        return { x, y, hit: element.contains(document.elementFromPoint(x, y)) };
      })()`, page!.sessionId);
      assert.equal(target.hit, true, `${testId} must receive touches at its center`);
      await connection!.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target.x, y: target.y }] }, page!.sessionId);
      await new Promise((resolve) => setTimeout(resolve, 80));
      await connection!.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, page!.sessionId);
    };
    await tapCompletion('button-completion-close');
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"dialog-tracker-completed\\"]") === null', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"reopen-completion\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"dialog-tracker-completed\\"]") !== null', Boolean);
    await tapCompletion('button-completion-done');
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"dialog-tracker-completed\\"]") === null', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"reopen-completion\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"dialog-tracker-completed\\"]") !== null', Boolean);
    await tapCompletion('button-completion-view-stats');
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"completion-viewed\\"]")?.textContent === "Viewed" && document.querySelector("[data-testid=\\"dialog-tracker-completed\\"]") === null', Boolean);
    await connection.evaluate('document.querySelector("[data-testid=\\"reopen-completion\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"dialog-tracker-completed\\"]") !== null', Boolean);
    await tapCompletion('button-completion-view-stats', 'a');
    await waitFor(connection, page.sessionId, 'window.location.pathname === "/studio/stat-tracker"', Boolean);
    await connection.evaluate('window.location.href = "/stat-tracker-test.html?saveFeedback=1"', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"save-outcome-success\\"]") !== null', Boolean);

    await connection.evaluate('document.querySelector("[data-testid=\\"save-outcome-success\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]")?.textContent.includes("Saving game to cloud")', Boolean);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]")?.textContent.includes("Game saved to cloud")', Boolean);

    await connection.evaluate('document.querySelector("[data-testid=\\"save-outcome-local\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]")?.textContent.includes("Saving game to cloud")', Boolean);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]")?.textContent.includes("Saved on this device") && document.querySelector("[data-testid=\\"stat-tracker-save-recovery\\"]")?.textContent.includes("cloud sync failed") && document.querySelector("[data-testid=\\"button-retry-stat-tracker-save\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(
        '["stat-tracker-save-status", "stat-tracker-save-recovery"].every((id) => { const element = document.querySelector(`[data-testid="${id}"]`); const rect = element?.getBoundingClientRect(); return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= window.innerWidth && element.scrollWidth <= element.clientWidth); }) && document.documentElement.scrollWidth <= document.documentElement.clientWidth',
        page.sessionId,
      ),
      true,
    );
    await connection.evaluate('document.querySelector("[data-testid=\\"button-retry-stat-tracker-save\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]")?.textContent.includes("Saving game to cloud")', Boolean);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]")?.textContent.includes("Game saved to cloud") && document.querySelector("[data-testid=\\"stat-tracker-save-recovery\\"]") === null', Boolean);

    await connection.evaluate('document.querySelector("[data-testid=\\"save-outcome-conflict\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]")?.textContent.includes("Saving game to cloud")', Boolean);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]")?.textContent.includes("Saved on this device") && document.querySelector("[data-testid=\\"stat-tracker-save-recovery\\"]")?.textContent.includes("changed elsewhere") && document.querySelector("[data-testid=\\"stat-tracker-conflict\\"]")?.textContent.includes("Newer cloud copy found")', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(
        'document.querySelector("[data-testid=\\"button-retry-stat-tracker-save\\"]") === null && document.documentElement.scrollWidth <= document.documentElement.clientWidth && ["stat-tracker-save-status", "stat-tracker-save-recovery", "stat-tracker-conflict"].every((id) => { const element = document.querySelector(`[data-testid="${id}"]`); const rect = element?.getBoundingClientRect(); return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= window.innerWidth); })',
        page.sessionId,
      ),
      true,
    );
    assert.equal(
      await connection.evaluate<boolean>('!document.body.textContent.includes("Cloud sync active")', page.sessionId),
      true,
    );

    await connection.evaluate(`(() => {
      localStorage.removeItem('leaguematrix-stat-tracker:browser-reconnect-user');
      localStorage.removeItem('leaguematrix-stat-tracker:pending-sync-failure:browser-reconnect-user');
      localStorage.removeItem('leaguematrix-stat-tracker:pending-conflict:browser-reconnect-user');
      localStorage.removeItem('stat-tracker-browser-cloud-history');
      localStorage.removeItem('stat-tracker-browser-cloud-attempts');
      window.location.href = '/stat-tracker-test.html?reconnectRecovery=1';
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"browser-save-completed-result\\"]") !== null', Boolean);
    await connection.evaluate(
      'Object.defineProperty(navigator, "onLine", { configurable: true, value: false })',
      page.sessionId,
    );
    await connection.evaluate('document.querySelector("[data-testid=\\"browser-save-completed-result\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId,
      'document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]")?.textContent.includes("Saved on this device") && document.querySelector("[data-testid=\\"button-retry-stat-tracker-save\\"]") !== null',
      Boolean,
    );
    assert.deepEqual(
      await connection.evaluate<{ local: string; cloud: string; attempts: string }>(
        `({
          local: document.querySelector('[data-testid="browser-local-game-count"]')?.textContent || '',
          cloud: document.querySelector('[data-testid="browser-cloud-game-count"]')?.textContent || '',
          attempts: document.querySelector('[data-testid="browser-cloud-attempt-count"]')?.textContent || '',
        })`,
        page.sessionId,
      ),
      { local: '1', cloud: '0', attempts: '1' },
      'a failed offline save must leave the completed game on this device without claiming cloud success',
    );
    await connection.evaluate('delete navigator.onLine', page.sessionId);
    await reloadPage(connection, page.sessionId);
    await waitFor(connection, page.sessionId,
      'document.querySelector("[data-testid=\\"browser-local-game-count\\"]")?.textContent === "1" && document.querySelector("[data-testid=\\"browser-cloud-attempt-count\\"]")?.textContent === "1" && document.querySelector("[data-testid=\\"button-retry-stat-tracker-save\\"]") !== null',
      Boolean,
    );
    const reloadRecoveryState = await connection.evaluate<{
      attemptsText: string | null;
      attemptStorage: string | null;
      bodyText: string;
    }>(`({
      attemptsText: document.querySelector('[data-testid="browser-cloud-attempt-count"]')?.textContent ?? null,
      attemptStorage: localStorage.getItem('stat-tracker-browser-cloud-attempts'),
      bodyText: document.body?.textContent || '',
    })`, page.sessionId);
    assert.equal(
      reloadRecoveryState.attemptsText,
      '1',
      'reloading must restore the local result and recovery action without falsely retrying: '
        + JSON.stringify(reloadRecoveryState),
    );
    await connection.evaluate('window.__trackerHoldNextCloudAck = true', page.sessionId);
    await connection.send('Network.enable', {}, page.sessionId);
    await connection.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: 'none',
    }, page.sessionId);
    await connection.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'wifi',
    }, page.sessionId);
    await waitFor(connection, page.sessionId,
      'document.querySelector("[data-testid=\\"browser-release-cloud-ack\\"]") !== null && document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]")?.textContent.includes("Saving game to cloud")',
      Boolean,
    );
    assert.equal(
      await connection.evaluate<boolean>(
        'document.querySelector("[data-testid=\\"browser-local-game-count\\"]")?.textContent === "1" && document.querySelector("[data-testid=\\"browser-cloud-game-count\\"]")?.textContent === "0"',
        page.sessionId,
      ),
      true,
      'the result must not appear synced before the service acknowledges the retry',
    );
    await connection.evaluate('document.querySelector("[data-testid=\\"browser-release-cloud-ack\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId,
      'document.querySelector("[data-testid=\\"stat-tracker-save-status\\"]")?.textContent.includes("Game saved to cloud") && document.querySelector("[data-testid=\\"stat-tracker-save-recovery\\"]") === null',
      Boolean,
    );
    assert.deepEqual(
      await connection.evaluate<{ local: string; cloud: string; attempts: string }>(
        `({
          local: document.querySelector('[data-testid="browser-local-game-count"]')?.textContent || '',
          cloud: document.querySelector('[data-testid="browser-cloud-game-count"]')?.textContent || '',
          attempts: document.querySelector('[data-testid="browser-cloud-attempt-count"]')?.textContent || '',
        })`,
        page.sessionId,
      ),
      { local: '1', cloud: '1', attempts: '2' },
    );

    await connection.evaluate('document.querySelector("[data-testid=\\"browser-save-conflicting-result\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId,
      'document.querySelector("[data-testid=\\"browser-tracker-conflict\\"]")?.textContent.includes("Northside, Westview") && document.querySelector("[data-testid=\\"button-retry-stat-tracker-save\\"]") === null',
      Boolean,
    );
    assert.equal(
      await connection.evaluate<boolean>(
        'document.querySelector("[data-testid=\\"browser-local-game-count\\"]")?.textContent === "2" && document.querySelector("[data-testid=\\"browser-cloud-game-count\\"]")?.textContent === "1"',
        page.sessionId,
      ),
      true,
      'revision conflicts must preserve both the local and cloud histories',
    );
    await connection.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: 'none',
    }, page.sessionId);
    await connection.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'wifi',
    }, page.sessionId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(
      await connection.evaluate<string>('document.querySelector("[data-testid=\\"browser-cloud-attempt-count\\"]")?.textContent || ""', page.sessionId),
      '3',
      'a revision conflict must not retry automatically when the browser reports reconnection',
    );
    await reloadPage(connection, page.sessionId);
    await waitFor(connection, page.sessionId,
      'document.querySelector("[data-testid=\\"browser-tracker-conflict\\"]")?.textContent.includes("Northside, Westview") && document.querySelector("[data-testid=\\"button-retry-stat-tracker-save\\"]") === null',
      Boolean,
    );
    assert.equal(
      await connection.evaluate<boolean>(
        'document.querySelector("[data-testid=\\"browser-local-game-count\\"]")?.textContent === "2" && document.querySelector("[data-testid=\\"browser-cloud-game-count\\"]")?.textContent === "1"',
        page.sessionId,
      ),
      true,
      'conflicting local and cloud copies must still be available after a reload',
    );

    await connection.evaluate(`(() => {
      localStorage.removeItem('leaguematrix-stat-tracker-active-game:inline-sport-choice-user');
      localStorage.removeItem('leaguematrix-stat-tracker:inline-sport-choice-user');
      window.location.href = '/stat-tracker-test.html?inlineSportChoice=1';
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"inline-tracker-sport-choice\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(
        'localStorage.getItem("leaguematrix-stat-tracker-active-game:inline-sport-choice-user") === null',
        page.sessionId,
      ),
      true,
      'a sportless Event Card must ask before creating its local game',
    );
    await connection.evaluate('document.querySelector("[data-testid=\\"button-inline-start-sport-volleyball\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-inline-scoreboard\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<string>(
        'JSON.parse(localStorage.getItem("leaguematrix-stat-tracker-active-game:inline-sport-choice-user") || "null")?.sport || ""',
        page.sessionId,
      ),
      'volleyball',
      'the inline game must use the sport the supporter chose',
    );

    await connection.evaluate(`(() => {
      localStorage.removeItem('leaguematrix-stat-tracker-active-game:inline-football-user');
      localStorage.removeItem('leaguematrix-stat-tracker:inline-football-user');
      window.location.href = '/stat-tracker-test.html?inlineFootball=1';
    })()`, page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"button-inline-start-game\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(
        'localStorage.getItem("leaguematrix-stat-tracker-active-game:inline-football-user") === null && document.querySelector("[data-testid=\\"game-on-inline-scoreboard\\"]") === null',
        page.sessionId,
      ),
      true,
      'opening a scheduled Event Card must not create or mark its game live',
    );
    await connection.evaluate('document.querySelector("[data-testid=\\"button-inline-start-game\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"game-on-inline-scoreboard\\"]") !== null', Boolean);
    await waitFor(connection, page.sessionId, 'document.querySelector("[data-testid=\\"card-inline-stat-pass-reception\\"]") !== null', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(
        '(() => { const pass = document.querySelector("[data-testid=\\"card-inline-stat-pass-reception\\"]"); const rush = document.querySelector("[data-testid=\\"card-inline-stat-rush-yard\\"]"); const interception = document.querySelector("[data-testid=\\"card-inline-stat-interception\\"]"); return pass?.textContent.includes("PASS/REC") && !/yds/i.test(pass?.textContent || "") && rush?.textContent.includes("RUSH") && !/yds/i.test(rush?.textContent || "") && interception?.textContent.includes("INT") && !document.querySelector("[data-testid=\\"card-inline-stat-pass-yard\\"]") && !document.querySelector("[data-testid=\\"card-inline-stat-reception\\"]"); })()',
        page.sessionId,
      ),
      true,
      'the inline football tracker should show combined PASS/REC, short RUSH, and INT cards',
    );

    await connection.evaluate('document.querySelector("[data-testid=\\"button-tap-stat-inline-football-game-pass-reception-athlete\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, '(() => { const game = JSON.parse(localStorage.getItem("leaguematrix-stat-tracker-active-game:inline-football-user") || "null"); return game?.stats?.["pass-yard"] === 1 && game?.stats?.reception === 1; })()', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(
        '(() => { const game = JSON.parse(localStorage.getItem("leaguematrix-stat-tracker-active-game:inline-football-user") || "null"); const paired = game?.events?.filter((event) => event.playId) || []; return paired.length === 2 && paired[0].statId === "pass-yard" && paired[1].statId === "reception" && paired[0].playId === paired[1].playId && paired.every((event) => event.attribution === "athlete"); })()',
        page.sessionId,
      ),
      true,
      'one inline PASS/REC tap should persist a paired passing and reception play',
    );
    await connection.evaluate('document.querySelector("[data-testid=\\"button-inline-stat-undo\\"]")?.click()', page.sessionId);
    await waitFor(connection, page.sessionId, '(() => { const game = JSON.parse(localStorage.getItem("leaguematrix-stat-tracker-active-game:inline-football-user") || "null"); return (game?.stats?.["pass-yard"] ?? 0) === 0 && (game?.stats?.reception ?? 0) === 0 && game?.events?.length === 0; })()', Boolean);
    assert.equal(
      await connection.evaluate<boolean>(
        '(() => { const game = JSON.parse(localStorage.getItem("leaguematrix-stat-tracker-active-game:inline-football-user") || "null"); return (game?.stats?.["pass-yard"] ?? 0) === 0 && (game?.stats?.reception ?? 0) === 0 && game?.events?.length === 0 && document.querySelector("[data-testid=\\"button-inline-stat-undo\\"]")?.disabled; })()',
        page.sessionId,
      ),
      true,
      'undo should remove both persisted stats from the paired inline play',
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
}

test('soccer stat cards increment live, block paused taps, and resume after reload', () => runTrackerBrowserChecks(true));
test('stat tracker protects scheduled, live football, and completed-game states in the browser', () => runTrackerBrowserChecks());