import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { OwnedAthleteInvite } from '@workspace/api-client-react';
import {
  DevToolsConnection, monitorProcess, openPage, waitFor, waitForUrl,
  type ProcessMonitor, type BrowserPage,
} from './browser-test-diagnostics';
import { defaultCardAppearance } from './hype-card-appearance';

async function availablePort() {
  const server = createServer();
  const port = await new Promise<number>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('Expected TCP port'));
      else done(address.port);
    });
  });
  await new Promise<void>(done => server.close(() => done()));
  return port;
}

function harness() {
  return `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, useLocation } from 'wouter';
import { useUser, switchAccount, currentAccountId } from './src/features/account-lifecycle-browser-auth';
import { SupporterDashboardView } from './src/features/supporter-dashboard';
import { LivingAthleteCardPage } from './src/features/living-athlete-card';
import './src/index.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const request = new Request(new URL(input instanceof Request ? input.url : String(input), location.href), init);
  if (new URL(request.url).pathname.startsWith('/api/')) {
    request.headers.set('x-test-user', currentAccountId());
  }
  return nativeFetch(request);
};
window.__switchSavedCardAccount = switchAccount;
const profile = {
  displayName: 'Test Supporter', athleteName: 'Alex Morgan', teamName: 'Northside Comets',
  sport: 'basketball', accessMode: 'full', relationship: 'Parent',
};
function Journey() {
  const { user } = useUser();
  const [route, navigate] = useLocation();
  if (route.startsWith('/fan/')) {
    return createElement(LivingAthleteCardPage, { params: { inviteToken: route.split('/').pop() } });
  }
  if (route === '/studio/athlete-page') {
    return createElement('main', null,
      createElement('h1', null, 'Owner save workspace'),
      createElement('button', { 'data-testid': 'return-hub', onClick: () => navigate('/studio') }, 'Return to Hub'));
  }
  return createElement(SupporterDashboardView, {
    profile, userId: user?.id, events: [], nextGameIsUpcoming: false,
    scheduleSource: 'custom', connectionLabel: 'Northside · Test season',
    onOpenStatTracker: () => {}, onOpenChecklist: () => {},
  });
}
createRoot(document.getElementById('test-root')).render(
  createElement(Router, null, createElement(QueryClientProvider, { client },
    createElement(Journey))));
`;
}

type Front = {
  design: string;
  href: string | null;
  text: string;
  images: string[];
  colors: string[];
  transforms: string[];
};

/** Real owner routes + DB + App Storage, with a Clerk session boundary fixture. */
export async function checkSavedHypeCardOwnerApi(appDirectory: string, chromiumPath: string) {
  const apiPort = await availablePort(), vitePort = await availablePort(), debugPort = await availablePort();
  const fixtureBase = `saved-hype-api-${process.pid}`;
  const harnessPath = resolve(appDirectory, `${fixtureBase}.tsx`);
  const htmlPath = resolve(appDirectory, `${fixtureBase}.html`);
  const processes: Array<{ child: ChildProcess; monitor: ProcessMonitor }> = [];
  let connection: DevToolsConnection | undefined, page: BrowserPage | undefined, directory: string | undefined;
  const start = (args: string[], env: NodeJS.ProcessEnv, label: string) => {
    const child = spawn('pnpm', args, { cwd: appDirectory, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const monitor = monitorProcess(child, label);
    processes.push({ child, monitor });
    return monitor;
  };
  try {
    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    const apiMonitor = start(['exec', 'tsx', '../api-server/src/savedHypeCard.browser-fixture.ts'], {
      PORT: String(apiPort), NODE_ENV: 'test', SAVED_HYPE_BROWSER_FIXTURE: '1',
    }, 'Saved HYPE owner API');
    await waitForUrl(`${apiOrigin}/__fixture/health`, 30_000, apiMonitor);
    const { owner, other } = await fetch(`${apiOrigin}/__fixture/health`).then(r => r.json()) as { owner: string; other: string };
    const api = async (viewer: string, path: string, method = 'GET', body?: unknown, expected = 200) => {
      const response = await fetch(`${apiOrigin}/api/athlete-invites${path}`, {
        method, headers: { 'x-test-user': viewer, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
      return response.status === 204 ? null : response.json();
    };
    const input = {
      athleteName: 'Alex Morgan', teamName: 'Northside Comets', seasonName: 'Integration season',
      seasonEndsAt: new Date(Date.now() + 90 * 86_400_000).toISOString(), sport: 'basketball',
      timezone: 'America/New_York', showHypeCard: true, showStats: false, showSchedule: false,
      trackerProjectId: null, scheduleProjectId: null,
    };
    const first = await api(owner, '', 'POST', input, 201) as OwnedAthleteInvite;
    // Same athlete/team under another owner ensures isolation is account-based,
    // not accidentally hidden by a name mismatch.
    const second = await api(other, '', 'POST', input, 201) as OwnedAthleteInvite;
    await api(other, `/${second.inviteToken}/appearance`, 'PATCH', {
      ...defaultCardAppearance('gallery'), borderColor: '#A855F7', accentColor: '#A855F7',
      jerseyNumber: '99', position: 'Other owner',
    });
    await api('', '', 'GET', undefined, 401);

    await writeFile(harnessPath, harness());
    await writeFile(htmlPath, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body><div id="test-root"></div><script type="module" src="/${fixtureBase}.tsx"></script></body></html>`);
    const viteMonitor = start(['exec', 'vite', '--config', 'vite.saved-hype-browser.config.ts', '--host', '127.0.0.1'], {
      PORT: String(vitePort), BASE_PATH: '/', SAVED_HYPE_BROWSER_API: apiOrigin,
    }, 'Saved HYPE browser Vite');
    await waitForUrl(`http://127.0.0.1:${vitePort}/${fixtureBase}.html`, 30_000, viteMonitor);
    directory = await mkdtemp(resolve(tmpdir(), 'pixl-saved-hype-api-'));
    const browser = spawn(chromiumPath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${directory}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const browserMonitor = monitorProcess(browser, 'Saved HYPE Chromium');
    processes.push({ child: browser, monitor: browserMonitor });
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(r => r.json());
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, browserMonitor.diagnostics);
    const fixtureUrl = `http://127.0.0.1:${vitePort}/${fixtureBase}.html?viewer=${owner}`;
    page = await openPage(connection, fixtureUrl, { viewport: { width: 390, height: 844, mobile: true } });
    const evaluate = <T,>(expression: string) => connection!.evaluate<T>(expression, page!.sessionId);
    const wait = (expression: string) => waitFor(connection!, page!.sessionId, expression, Boolean);
    const click = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const hubReady = () => wait(`Boolean(document.querySelector('[data-testid="link-mobile-hype-preview"]'))`);
    const reload = async () => {
      // Direct fixture URL avoids Vite's production SPA fallback on /studio.
      await connection!.send('Page.navigate', { url: fixtureUrl }, page!.sessionId);
      await hubReady();
    };
    const away = async () => {
      await evaluate(`history.pushState({}, '', '/studio/athlete-page'); dispatchEvent(new PopStateEvent('popstate'))`);
      await wait(`Boolean(document.querySelector('[data-testid="return-hub"]'))`);
    };
    const back = async () => { await click('[data-testid="return-hub"]'); await hubReady(); };
    const readFront = (full = false) => evaluate<Front>(`(() => {
      const root = document.querySelector(${JSON.stringify(full ? '.living-card-page .living-card-face' : '.supporter-hype-preview__surface')});
      return {
        design: root.dataset.design || root.querySelector('[data-design]')?.dataset.design || 'classic',
        href: document.querySelector('[data-testid="link-mobile-hype-preview"]')?.getAttribute('href') || null,
        text: Array.from(root.querySelectorAll('text,h2,p')).map(e => e.textContent).join('|'),
        images: Array.from(root.querySelectorAll('image,img')).map(e => e.getAttribute('href') || e.getAttribute('xlink:href') || e.getAttribute('src')).filter(Boolean),
        colors: Array.from(root.querySelectorAll('[fill],[stroke]')).flatMap(e => [e.getAttribute('fill'),e.getAttribute('stroke')]).filter(v => v?.startsWith('#')),
        transforms: Array.from(root.querySelectorAll('[transform]')).map(e => e.getAttribute('transform')),
      };
    })()`);
    const ownerCard = async () => {
      const cards = await api(owner, '') as OwnedAthleteInvite[];
      assert.equal(cards.length, 1);
      assert.equal(cards[0].inviteToken, first.inviteToken);
      return cards[0];
    };
    const expectFront = async (card: OwnedAthleteInvite, design: string, media: string | null) => {
      await wait(`document.querySelector('.supporter-hype-preview__surface')?.dataset.design === ${JSON.stringify(design)}`);
      if (media) {
        await wait(`Array.from(document.querySelectorAll('.supporter-hype-preview__surface image,.supporter-hype-preview__surface img'))
          .some(e => [e.getAttribute('href'),e.getAttribute('xlink:href'),e.getAttribute('src')].includes(${JSON.stringify(media)}))`);
      }
      const front = await readFront();
      assert.equal(front.href, null, 'dashboard artwork is not a navigation link');
      assert.ok(front.text.toUpperCase().includes(card.athleteName.toUpperCase()), front.text);
      assert.ok(front.text.toUpperCase().includes(card.teamName.toUpperCase()), front.text);
      if (media) {
        assert.ok(front.images.includes(media), `saved ${design} front uses the current owner media`);
        assert.equal(await evaluate(`new Promise(resolve => { const image = new Image(); image.onload = () => resolve(true); image.onerror = () => resolve(false); image.src = ${JSON.stringify(media)}; })`), true,
          'saved image URL returns renderable bytes through the real photo endpoint');
      }
      if (design !== 'classic') {
        assert.ok(front.colors.includes(card.cardAppearance!.borderColor));
        assert.ok(front.text.includes(card.cardAppearance!.jerseyNumber));
        assert.ok(front.text.includes(card.cardAppearance!.position.toUpperCase()));
      }
      return front;
    };
    const fullMatches = async (front: Front) => {
      const card = await ownerCard();
      await evaluate(`history.pushState({}, '', ${JSON.stringify(`/fan/${card.inviteToken}`)}); dispatchEvent(new PopStateEvent('popstate'))`);
      await wait(`Boolean(document.querySelector('.living-card-page .living-card-face'))`);
      await wait(`(() => {
        const root = document.querySelector('.living-card-page .living-card-face');
        const design = root?.dataset.design || 'classic';
        const images = Array.from(root?.querySelectorAll('image,img') || [])
          .map(e => e.getAttribute('href') || e.getAttribute('xlink:href') || e.getAttribute('src')).filter(Boolean);
        return design === ${JSON.stringify(front.design)} && JSON.stringify(images) === ${JSON.stringify(JSON.stringify(front.images))};
      })()`);
      assert.equal(await evaluate('location.pathname'), `/fan/${card.inviteToken}`);
      const full = await readFront(true);
      assert.deepEqual({ ...full, href: front.href }, front, 'Hub and real full-card destination render the same saved front');
      await evaluate(`history.back()`);
      await hubReady();
    };
    const saveAppearance = async (appearance: unknown, expected = 200) => evaluate<{ status: number; body: unknown }>(`(async () => {
      const response = await fetch('/api/athlete-invites/${first.inviteToken}/appearance', {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(appearance)})
      });
      return { status: response.status, body: await response.json() };
    })()`).then(result => { assert.equal(result.status, expected); return result.body; });
    const upload = async (variant: string, role = 'photo', revision?: string | null, expected = 200) =>
      evaluate<{ status: number; body: { photoUrl?: string } }>(`(async () => {
        const blob = await fetch('/__fixture/portrait/${variant}').then(r => r.blob());
        const prepared = await fetch('/api/athlete-invites/${first.inviteToken}/photo/upload-url', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contentType: blob.type, size: blob.size })
        });
        if (!prepared.ok) throw new Error('Real upload preparation failed: ' + prepared.status);
        const { uploadUrl, objectPath } = await prepared.json();
        const uploaded = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': blob.type }, body: blob });
        if (!uploaded.ok) throw new Error('Real object upload failed: ' + uploaded.status);
        const confirmed = await fetch('/api/athlete-invites/${first.inviteToken}/photo', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ objectPath, mediaRole: ${JSON.stringify(role)}, ${revision ? `sourcePhotoRevision: ${JSON.stringify(revision)}` : ''} })
        });
        return { status: confirmed.status, body: await confirmed.json() };
      })()`).then(result => { assert.equal(result.status, expected, JSON.stringify(result.body)); return result.body; });

    await hubReady();
    await away();
    const original = await upload('original');
    await back();
    let card = await ownerCard();
    assert.equal(card.photoUrl, original.photoUrl);
    await expectFront(card, 'classic', card.photoUrl);
    await reload();
    await fullMatches(await expectFront(card, 'classic', card.photoUrl));

    await away();
    const appearance = {
      ...defaultCardAppearance('spotlight'), borderColor: '#22C55E', accentColor: '#22C55E',
      jerseyNumber: '27', position: 'Forward', athleteX: .12, athleteY: -.09,
      athleteScale: 1.3, namePlateX: -.08, namePlateY: .06,
    };
    await saveAppearance(appearance);
    await upload('cutout', 'cutout', card.photoRevision);
    await back();
    card = await ownerCard();
    assert.deepEqual(card.cardAppearance, appearance, 'real owner list persists every appearance setting');
    assert.ok(card.cutoutUrl);
    await expectFront(card, 'spotlight', card.cutoutUrl);
    await reload();
    const savedPremium = await expectFront(card, 'spotlight', card.cutoutUrl);
    await fullMatches(savedPremium);

    // Real contract rejection must leave the saved preview unchanged.
    await away();
    await saveAppearance({ ...appearance, borderColor: 'not-a-color' }, 400);
    await upload('cutout', 'cutout', 'stale-original-revision', 409);
    await back();
    assert.deepEqual(await readFront(), savedPremium);
    await reload();
    assert.deepEqual(await readFront(), savedPremium);
    assert.deepEqual((await ownerCard()).cardAppearance, appearance);
    assert.equal((await ownerCard()).cutoutUrl, card.cutoutUrl);

    // Replacement clears the old derivative; no stale cutout may survive reload.
    await away();
    await upload('replacement');
    await back();
    const replacement = await ownerCard();
    assert.notEqual(replacement.photoUrl, card.photoUrl);
    assert.equal(replacement.cutoutUrl, null);
    await expectFront(replacement, 'spotlight', replacement.photoUrl);
    await reload();
    await fullMatches(await expectFront(replacement, 'spotlight', replacement.photoUrl));

    await evaluate(`window.__switchSavedCardAccount(${JSON.stringify(other)})`);
    await wait(`document.querySelector('.supporter-hype-preview__surface')?.dataset.design === 'gallery'`);
    const isolated = await readFront();
    assert.equal(isolated.design, 'gallery');
    assert.ok(isolated.text.includes('99'));
    assert.ok(!isolated.images.includes(replacement.photoUrl!));
    await saveAppearance(appearance, 404);
    await api(other, `/${first.inviteToken}/photo/upload-url`, 'POST', { contentType: 'image/png', size: 100 }, 404);
    await api(other, `/${first.inviteToken}/photo`, 'PUT', { objectPath: '/objects/not-owned', mediaRole: 'photo' }, 404);
    await api('', `/${first.inviteToken}/appearance`, 'PATCH', appearance, 401);
    await evaluate(`window.__switchSavedCardAccount('')`);
    await wait(`!document.querySelector('[data-testid="link-mobile-hype-preview"]')`);
    assert.equal(await evaluate(`!!document.querySelector('[data-testid="mobile-saved-hype-card"] image')`), false);
    await evaluate(`window.__switchSavedCardAccount(${JSON.stringify(owner)})`);
    await hubReady();
    await reload();
    await expectFront(await ownerCard(), 'spotlight', replacement.photoUrl);
  } finally {
    if (connection && page) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
    connection?.close();
    for (const { child, monitor } of processes.reverse()) {
      if (!monitor.hasExited()) child.kill('SIGTERM');
      await monitor.waitForExit();
    }
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(harnessPath, { force: true });
    await rm(htmlPath, { force: true });
    const apiProcess = processes.find(({ monitor }) => monitor.diagnostics().startsWith('Saved HYPE owner API'));
    if (apiProcess?.child.exitCode && apiProcess.child.exitCode !== 0) {
      assert.fail(apiProcess.monitor.diagnostics());
    }
  }
}