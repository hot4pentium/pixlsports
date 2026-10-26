import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DevToolsConnection, monitorProcess, openPage, waitFor, waitForUrl, type BrowserPage } from './browser-test-diagnostics';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';

async function availablePort() {
  const server = createServer();
  const port = await new Promise<number>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('Expected a TCP port'));
      else done(address.port);
    });
  });
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

test('signed-in account controls survive phone and desktop transitions against real lifecycle routes', async () => {
  const apiPort = await availablePort();
  const vitePort = await availablePort();
  const debugPort = await availablePort();
  const api = spawn('pnpm', ['exec', 'tsx', '../api-server/src/accountLifecycle.browser-fixture.ts'], {
    cwd: appDirectory,
    env: { ...process.env, PORT: String(apiPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const apiMonitor = monitorProcess(api, 'Lifecycle fixture API');
  let vite: ChildProcess | undefined;
  let browser: ChildProcess | undefined;
  let connection: DevToolsConnection | undefined;
  let directory: string | undefined;
  const pages: BrowserPage[] = [];
  try {
    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    await waitForUrl(`${apiOrigin}/__fixture/health`, 30_000, apiMonitor);
    const { owner, other } = await fetch(`${apiOrigin}/__fixture/health`)
      .then((response) => response.json() as Promise<{ owner: string; other: string }>);
    const admin = async (path: string, body: unknown) => {
      const response = await fetch(`${apiOrigin}/__fixture/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 204, `${path}: ${await response.text()}`);
    };
    const state = async (viewer: string) => fetch(`${apiOrigin}/__fixture/state?viewer=${encodeURIComponent(viewer)}`)
      .then((response) => response.json() as Promise<{
        status: string;
        pauseEndsAt: string | null;
        provisionedMarker: boolean | null;
      }>);
    const profile = async (viewer: string) => fetch(
      `${apiOrigin}/__fixture/profile?viewer=${encodeURIComponent(viewer)}`,
    ).then((response) => response.json() as Promise<{ unsafeMetadata: Record<string, unknown> }>);
    const athleteInvites = async (viewer: string) => fetch(
      `${apiOrigin}/__fixture/athlete-invites?viewer=${encodeURIComponent(viewer)}`,
    ).then((response) => response.json() as Promise<Array<Record<string, unknown>>>);

    vite = spawn('pnpm', ['exec', 'vite', '--config', 'vite.account-lifecycle-browser.config.ts', '--host', '127.0.0.1'], {
      cwd: appDirectory,
      env: { ...process.env, PORT: String(vitePort), BASE_PATH: '/', REPL_ID: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const viteMonitor = monitorProcess(vite, 'Vite');
    await waitForUrl(`http://127.0.0.1:${vitePort}/account-lifecycle-browser-test.html`, 30_000, viteMonitor);

    directory = await mkdtemp(resolve(tmpdir(), 'pixl-lifecycle-browser-'));
    browser = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${directory}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const browserMonitor = monitorProcess(browser, 'Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, browserMonitor);
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(webSocketDebuggerUrl, browserMonitor.diagnostics);
    const appUrl = (viewer: string, route = '/studio/profile') =>
      `http://127.0.0.1:${vitePort}/account-lifecycle-browser-test.html?api=${encodeURIComponent(apiOrigin)}&viewer=${encodeURIComponent(viewer)}&route=${encodeURIComponent(route)}`;
    const open = async (viewer: string, width: number, height: number, route = '/studio/profile') => {
      const page = await openPage(connection!, appUrl(viewer, route), { viewport: { width, height, mobile: width < 600 } });
      pages.push(page);
      return page.sessionId;
    };
    const visible = (id: string) => `Boolean(document.querySelector('[data-testid="${id}"]'))`;
    const click = (session: string, id: string) => connection!.evaluate(
      `document.querySelector('[data-testid="${id}"]').click()`, session,
    );
    const pressKey = async (session: string, key: string, code: string, windowsVirtualKeyCode: number) => {
      await connection!.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key, code, windowsVirtualKeyCode,
      }, session);
      await connection!.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key, code, windowsVirtualKeyCode,
      }, session);
    };
    const focusTarget = async (session: string, id: string) => {
      const target = await connection!.evaluate<{
        focused: boolean; visible: boolean; tag: string; tabIndex: number; label: string;
      }>(
        `(() => {
          const element = document.querySelector('[data-testid="${id}"]');
          if (!element) return { focused: false, visible: false, tag: '', tabIndex: -1, label: '' };
          element.focus();
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            focused: document.activeElement === element,
            visible: style.display !== 'none' && style.visibility !== 'hidden'
              && rect.width > 0 && rect.height > 0
              && rect.left >= 0 && rect.right <= innerWidth
              && rect.top >= 0 && rect.bottom <= innerHeight,
            tag: element.tagName,
            tabIndex: element.tabIndex,
            label: element.innerText || element.getAttribute('aria-label') || '',
          };
        })()`,
        session,
      );
      assert.ok(target.focused, `${id} should receive keyboard focus`);
      assert.ok(target.visible, `${id} should be visible in the current viewport`);
      assert.equal(target.tag, 'BUTTON', `${id} should be a native button`);
      assert.ok(target.tabIndex >= 0, `${id} should be in the keyboard tab order`);
      assert.ok(target.label.trim(), `${id} should have an accessible name`);
      return target;
    };
    const assertSignOutDestination = async (session: string, path: '/' | '/sign-in') => {
      const destination = path === '/' ? 'lifecycle-public-home' : 'lifecycle-sign-in';
      await waitVisible(session, destination);
      await waitFor(connection!, session, `location.pathname === ${JSON.stringify(path)}`, Boolean);
      const state = await connection!.evaluate<{
        path: string;
        accountId: string;
        redirectUrl: string | null | undefined;
      }>(`({
        path: location.pathname,
        accountId: window.__currentLifecycleAccountId(),
        redirectUrl: window.__lastLifecycleSignOutRedirectUrl,
      })`, session);
      assert.equal(state.path, path, 'sign-out should remain on its intended destination without routing back');
      assert.equal(state.accountId, '', 'the browser fixture should be signed out at the destination');
      assert.equal(state.redirectUrl, path, 'the exit should request the intended redirect from Clerk');
    };
    const signOutFromSharedNav = async (session: string, mobile: boolean) => {
      if (mobile) {
        await focusTarget(session, 'button-mobile-menu');
        await pressKey(session, ' ', 'Space', 32);
        await waitVisible(session, 'menu-mobile');
        await pressKey(session, 'Tab', 'Tab', 9);
        assert.equal(await connection!.evaluate<string>(
          "document.activeElement?.getAttribute('data-testid') || ''", session,
        ), 'link-mobile-studio', 'the first mobile menu link should be keyboard reachable');
        await pressKey(session, 'Tab', 'Tab', 9);
        await focusTarget(session, 'btn-mobile-sign-out');
        await pressKey(session, ' ', 'Space', 32);
      } else {
        await focusTarget(session, 'btn-sign-out');
        await pressKey(session, ' ', 'Space', 32);
      }
      await assertSignOutDestination(session, '/');
    };
    const signOutFromUnavailablePage = async (session: string) => {
      await focusTarget(session, 'button-sign-out-unavailable-account');
      await pressKey(session, ' ', 'Space', 32);
      await assertSignOutDestination(session, '/sign-in');
    };
    const waitVisible = (session: string, id: string) =>
      waitFor(connection!, session, visible(id), Boolean, 30_000);
    const fillSetup = async (session: string, details: {
      name: string; team: string; athlete: string; season: string; sport: string;
    }) => {
      await connection!.evaluate(`(() => {
        const details = ${JSON.stringify(details)};
        for (const field of ['name', 'team', 'athlete', 'season', 'sport']) {
          const input = document.querySelector('[data-testid="' +
            (field === 'sport' ? 'select' : 'input') + '-profile-' + field + '"]');
          const prototype = field === 'sport' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, details[field]);
          input.dispatchEvent(new Event(field === 'sport' ? 'change' : 'input', { bubbles: true }));
        }
      })()`, session);
    };
    const reloadSetup = async (session: string) => {
      const loaded = connection!.waitForEvent('Page.loadEventFired', session);
      await connection!.send('Page.navigate', { url: appUrl('first-save-supporter', '/studio/setup') }, session);
      await loaded;
      await waitVisible(session, 'button-save-profile');
    };
    const assertCardProfileIdentity = (card: Record<string, unknown>, metadata: Record<string, unknown>) => {
      for (const field of ['athleteName', 'teamName', 'sport', 'seasonName']) {
        assert.equal(metadata[field], card[field], `completed profile must use the owner card's ${field}`);
      }
    };
    const fit = async (session: string) => {
      const size = await connection!.evaluate<{ viewport: number; document: number }>(
        '({viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth})', session,
      );
      assert.ok(size.document <= size.viewport + 2, `Horizontal page overflow: ${JSON.stringify(size)}`);
    };
    const dialog = async (session: string, title: string) => {
      await waitFor(connection!, session, `Boolean(document.querySelector('[role="dialog"]'))`, Boolean);
      await waitFor(connection!, session, `(() => {
        const box = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
        return Boolean(box && box.left >= -2 && box.right <= document.documentElement.clientWidth + 2);
      })()`, Boolean, 2_000);
      const details = await connection!.evaluate<{
        title: string; description: string; labelled: boolean; described: boolean;
        left: number; right: number; viewport: number; focused: boolean;
      }>(`(() => {
        const node = document.querySelector('[role="dialog"]');
        const box = node.getBoundingClientRect();
        return {
          title: node.querySelector('[data-slot="dialog-title"],h2')?.textContent || '',
          description: node.querySelector('[data-slot="dialog-description"]')?.textContent || node.textContent,
          labelled: Boolean(node.getAttribute('aria-labelledby') && document.getElementById(node.getAttribute('aria-labelledby'))),
          described: Boolean(node.getAttribute('aria-describedby') && document.getElementById(node.getAttribute('aria-describedby'))),
          left: box.left, right: box.right, viewport: document.documentElement.clientWidth,
          focused: node.contains(document.activeElement),
        };
      })()`, session);
      assert.match(details.title.toLowerCase(), new RegExp(title));
      assert.match(details.description.toLowerCase(), /external billing/);
      assert.ok(details.labelled && details.described && details.focused, `Dialog accessibility: ${JSON.stringify(details)}`);
      assert.ok(details.left >= -2 && details.right <= details.viewport + 2, `Dialog overflows phone: ${JSON.stringify(details)}`);
      await fit(session);
    };

    const firstSaveOwner = 'first-save-supporter';
    const firstSaveCache = await open(firstSaveOwner, 390, 844, '/studio/setup');
    await waitVisible(firstSaveCache, 'button-save-profile');
    await waitVisible(firstSaveCache, 'initial-hype-card-notice');
    await waitFor(connection, firstSaveCache, `(
      localStorage.getItem('pixl-sports:private-dashboard:v1:first-save-supporter') === null
      && localStorage.getItem('leaguematrix-stat-tracker:first-save-supporter') === null
    )`, Boolean, 30_000);
    const privateDataBeforeRetry = await connection.evaluate<{ dashboard: string | null; tracker: string | null }>(
      `({
        dashboard: localStorage.getItem('pixl-sports:private-dashboard:v1:first-save-supporter'),
        tracker: localStorage.getItem('leaguematrix-stat-tracker:first-save-supporter'),
      })`,
      firstSaveCache,
    );
    assert.deepEqual(privateDataBeforeRetry, { dashboard: null, tracker: null },
      'a confirmed unprovisioned identity must not restore another private dashboard snapshot');

    const setupPhoneExit = await open(firstSaveOwner, 390, 844, '/studio/setup');
    await waitVisible(setupPhoneExit, 'button-save-profile');
    await fit(setupPhoneExit);
    await signOutFromSharedNav(setupPhoneExit, true);
    const setupDesktop = await open(firstSaveOwner, 1280, 850, '/studio/setup');
    await waitVisible(setupDesktop, 'button-save-profile');
    await fit(setupDesktop);
    await signOutFromSharedNav(setupDesktop, false);

    await connection.evaluate(`(() => {
      const values = {
        'input-profile-name': 'Morgan Supporter',
        'input-profile-team': 'Northside Comets',
        'input-profile-athlete': 'Alex Morgan',
        'input-profile-season': 'Fall 2026',
      };
      for (const [id, value] of Object.entries(values)) {
        const input = document.querySelector('[data-testid="' + id + '"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`, firstSaveCache);
    await click(firstSaveCache, 'button-save-profile');
    assert.equal(await connection.evaluate<boolean>(
      "document.querySelector('[data-testid=\"select-profile-sport\"]')?.validity.valueMissing === true",
      firstSaveCache,
    ), true, 'sport must be selected before supporter setup can be submitted');
    await connection.evaluate(`(() => {
      const sport = document.querySelector('[data-testid="select-profile-sport"]');
      const setSelectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setSelectValue.call(sport, 'softball');
      sport.dispatchEvent(new Event('change', { bubbles: true }));
    })()`, firstSaveCache);
    await admin('fail-clerk-once', { viewer: firstSaveOwner });
    await click(firstSaveCache, 'button-save-profile');
    await waitFor(connection, firstSaveCache,
      "Boolean(document.querySelector('[role=\"alert\"]')?.textContent.includes('could not save your profile'))",
      Boolean, 30_000);
    assert.equal(await connection.evaluate<string>(
      "document.querySelector('[data-testid=\"select-profile-sport\"]')?.value || ''",
      firstSaveCache,
    ), 'softball', 'a temporary save failure must not clear the selected sport');
    assert.equal((await state(firstSaveOwner)).status, 'not_provisioned');
    assert.equal((await state(firstSaveOwner)).provisionedMarker, false);
    assert.deepEqual(await athleteInvites(firstSaveOwner), [], 'a failed account setup must not leave a half-created HYPE Card');
    assert.deepEqual(await connection.evaluate<{ dashboard: string | null; tracker: string | null }>(
      `({
        dashboard: localStorage.getItem('pixl-sports:private-dashboard:v1:first-save-supporter'),
        tracker: localStorage.getItem('leaguematrix-stat-tracker:first-save-supporter'),
      })`,
      firstSaveCache,
    ), { dashboard: null, tracker: null });

    await admin('fail-profile-once', {});
    await click(firstSaveCache, 'button-save-profile');
    await waitFor(connection, firstSaveCache,
      "Boolean(document.querySelector('[role=\"alert\"]')?.textContent.includes('could not save your profile'))",
      Boolean, 30_000);
    const interruptedCards = await athleteInvites(firstSaveOwner);
    assert.equal(interruptedCards.length, 1, 'profile failure after creation must retain the one owner card');
    assert.equal(interruptedCards[0].paused, true, 'an interrupted starter must remain private');
    assert.deepEqual((await profile(firstSaveOwner)).unsafeMetadata, {},
      'the simulated interruption must happen before Clerk profile persistence');
    assert.equal((await state(firstSaveOwner)).status, 'active', 'provisioning succeeded before the interruption');

    await reloadSetup(firstSaveCache);
    assert.match(await connection.evaluate<string>(
      "document.querySelector('[data-testid=\"initial-hype-card-notice\"]').textContent", firstSaveCache,
    ), /setup keeps that card/);
    await fillSetup(firstSaveCache, {
      name: 'Morgan Retried', team: 'Different Team', athlete: 'Different Athlete',
      season: 'Spring 2027', sport: 'soccer',
    });
    await click(firstSaveCache, 'button-save-profile');
    await waitFor(connection, firstSaveCache,
      "Boolean(document.querySelector('[data-testid=\"studio-restored\"]') || document.querySelector('[role=\"alert\"]'))",
      Boolean, 30_000);
    const setupError = await connection.evaluate<string | null>(
      "document.querySelector('[role=\"alert\"]')?.textContent || null", firstSaveCache,
    );
    assert.equal(setupError, null, `Unexpected setup failure: ${JSON.stringify(
      await fetch(`${apiOrigin}/__fixture/errors`).then(response => response.json()),
    )}`);
    await waitVisible(firstSaveCache, 'studio-restored');
    assert.equal(await connection.evaluate<string>('location.pathname', firstSaveCache), '/studio');
    assert.deepEqual(await state(firstSaveOwner), {
      status: 'active',
      pauseEndsAt: null,
      provisionedMarker: true,
    });
    assert.equal(await connection.evaluate<string>(
      "document.querySelector('[data-testid=\"studio-restored\"]')?.textContent.trim() || ''",
      firstSaveCache,
    ), 'Studio access restored');
    const firstHypeCards = await athleteInvites(firstSaveOwner);
    assert.equal(firstHypeCards.length, 1, 'new account setup should assign one starter HYPE Card');
    assert.deepEqual(firstHypeCards, interruptedCards,
      'retrying with changed details must reuse, not overwrite or replace, the existing owner card');
    assert.deepEqual({
      athleteName: firstHypeCards[0].athleteName,
      teamName: firstHypeCards[0].teamName,
      seasonName: firstHypeCards[0].seasonName,
      sport: firstHypeCards[0].sport,
      trackerProjectId: firstHypeCards[0].trackerProjectId,
      scheduleProjectId: firstHypeCards[0].scheduleProjectId,
      showHypeCard: firstHypeCards[0].showHypeCard,
      paused: firstHypeCards[0].paused,
    }, {
      athleteName: 'Alex Morgan',
      teamName: 'Northside Comets',
      seasonName: 'Fall 2026',
      sport: 'softball',
      trackerProjectId: null,
      scheduleProjectId: null,
      showHypeCard: true,
      paused: true,
    }, 'the assigned card uses setup details and remains private until the owner chooses to share');
    const savedProfile = await profile(firstSaveOwner);
    assert.deepEqual({
      role: savedProfile.unsafeMetadata.role,
      displayName: savedProfile.unsafeMetadata.displayName,
      teamName: savedProfile.unsafeMetadata.teamName,
      athleteName: savedProfile.unsafeMetadata.athleteName,
      sport: savedProfile.unsafeMetadata.sport,
      seasonName: savedProfile.unsafeMetadata.seasonName,
    }, {
      role: 'fan',
      displayName: 'Morgan Retried',
      teamName: 'Northside Comets',
      athleteName: 'Alex Morgan',
      sport: 'softball',
      seasonName: 'Fall 2026',
    }, 'supporter and athlete details must be persisted in the Clerk profile source');

    const reloadComplete = connection.waitForEvent('Page.loadEventFired', firstSaveCache);
    await connection.send('Page.navigate', {
      url: appUrl(firstSaveOwner, '/studio/setup'),
    }, firstSaveCache);
    await reloadComplete;
    await waitVisible(firstSaveCache, 'studio-restored');
    assert.equal(await connection.evaluate<string>('location.pathname', firstSaveCache), '/studio',
      'the persisted supporter profile must send a refreshed setup visit back to the studio');
    assert.equal((await athleteInvites(firstSaveOwner)).length, 1, 'returning to setup must not duplicate the assigned HYPE Card');
    assert.deepEqual(await state(firstSaveOwner), {
      status: 'active',
      pauseEndsAt: null,
      provisionedMarker: true,
    }, 'the supporter account must remain active after a full document reload');
    assert.deepEqual((await profile(firstSaveOwner)).unsafeMetadata, savedProfile.unsafeMetadata,
      'supporter and athlete details must be restored from the persisted profile after reload');
    await connection.evaluate("window.__navigateLifecycle('/studio/stat-tracker')", firstSaveCache);
    await waitVisible(firstSaveCache, 'stat-tracker-setup');
    await waitFor(connection, firstSaveCache,
      "document.querySelector('[role=\"tab\"][aria-selected=\"true\"]')?.textContent.trim().toLowerCase() === 'softball'",
      Boolean, 30_000);
    assert.equal(await connection.evaluate<boolean>(
      "document.querySelector('[data-testid=\"stat-tracker-sport-choice\"]') !== null",
      firstSaveCache,
    ), false, 'a saved signup sport should skip the tracker sport prompt');

    // Two stale tabs both observe no card. The fixture blocks creation until both
    // POSTs arrive, then enforces the same unique-owner conflict as the real API.
    await admin('reset-setup', {});
    const concurrentPhone = await open(firstSaveOwner, 390, 844, '/studio/setup');
    const concurrentDesktop = await open(firstSaveOwner, 1280, 850, '/studio/setup');
    await Promise.all([
      waitVisible(concurrentPhone, 'button-save-profile'),
      waitVisible(concurrentDesktop, 'button-save-profile'),
    ]);
    await fillSetup(concurrentPhone, {
      name: 'Phone Supporter', team: 'Phone Comets', athlete: 'Phone Athlete',
      season: 'Winter 2026', sport: 'softball',
    });
    await fillSetup(concurrentDesktop, {
      name: 'Desktop Supporter', team: 'Desktop Falcons', athlete: 'Desktop Athlete',
      season: 'Spring 2027', sport: 'soccer',
    });
    await admin('concurrent-creates', {});
    await Promise.all([
      click(concurrentPhone, 'button-save-profile'),
      click(concurrentDesktop, 'button-save-profile'),
    ]);
    await Promise.all([
      waitVisible(concurrentPhone, 'studio-restored'),
      waitVisible(concurrentDesktop, 'studio-restored'),
    ]);
    const concurrentCards = await athleteInvites(firstSaveOwner);
    assert.equal(concurrentCards.length, 1);
    assert.equal(concurrentCards[0].paused, true);
    assertCardProfileIdentity(concurrentCards[0], (await profile(firstSaveOwner)).unsafeMetadata);
    assert.deepEqual(await fetch(`${apiOrigin}/__fixture/create-counts`).then(res => res.json()),
      { createAttempts: 2, createConflicts: 1 }, 'the losing tab must recover the unique-owner 409');
    for (const session of [concurrentPhone, concurrentDesktop]) {
      const loaded = connection.waitForEvent('Page.loadEventFired', session);
      await connection.send('Page.navigate', { url: appUrl(firstSaveOwner, '/studio/setup') }, session);
      await loaded;
      await waitVisible(session, 'studio-restored');
    }
    assert.deepEqual(await athleteInvites(firstSaveOwner), concurrentCards);

    // Authored cards are not safe to identify by "looks like a starter". Preserve
    // the entire existing record, including public state and custom appearance.
    const authoredCard = {
      ...concurrentCards[0],
      athleteName: 'Authored Athlete', teamName: 'Authored Team', seasonName: 'Showcase Season',
      sport: 'basketball', paused: false, showStats: false, showEvents: true,
      cardAppearance: { theme: 'spotlight', headline: 'Keep my design' },
    };
    await admin('reset-setup', { invites: [authoredCard] });
    const authoredSetup = await open(firstSaveOwner, 1280, 850, '/studio/setup');
    await waitVisible(authoredSetup, 'button-save-profile');
    await fillSetup(authoredSetup, {
      name: 'Returning Supporter', team: 'New Team', athlete: 'New Athlete',
      season: 'New Season', sport: 'softball',
    });
    await click(authoredSetup, 'button-save-profile');
    await waitVisible(authoredSetup, 'studio-restored');
    assert.deepEqual(await athleteInvites(firstSaveOwner), [authoredCard],
      'setup must not alter an authored card, its sharing state, or its appearance');
    assertCardProfileIdentity(authoredCard, (await profile(firstSaveOwner)).unsafeMetadata);
    assert.deepEqual(await fetch(`${apiOrigin}/__fixture/create-counts`).then(res => res.json()),
      { createAttempts: 0, createConflicts: 0 });

    const edit = await connection.evaluate<{ status: number; card: Record<string, unknown> }>(`fetch(
      '/api/athlete-invites/' + ${JSON.stringify(authoredCard.inviteToken)}, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(${JSON.stringify({
          ...authoredCard, athleteName: 'Owner Edited Athlete',
        })}),
      }).then(async response => ({ status: response.status, card: await response.json() }))`, authoredSetup);
    assert.equal(edit.status, 200, 'the reused card must remain editable by its owner');
    assert.equal(edit.card.inviteToken, authoredCard.inviteToken);
    assert.equal(edit.card.athleteName, 'Owner Edited Athlete');
    assert.deepEqual(edit.card.cardAppearance, authoredCard.cardAppearance);
    assert.equal((await athleteInvites(firstSaveOwner)).length, 1);
    const deniedEdit = await fetch(`${apiOrigin}/api/athlete-invites/${authoredCard.inviteToken}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'x-test-user': other },
      body: JSON.stringify(authoredCard),
    });
    assert.equal(deniedEdit.status, 404, 'another account must not be able to edit the retained card');

    await admin('fail', { viewer: owner, method: 'GET', path: '/account/lifecycle' });
    const phone = await open(owner, 390, 844);
    await waitFor(connection, phone, "Boolean(document.body?.innerText.includes('Could not check your account access'))", Boolean, 30_000);
    assert.equal(await state(owner).then((result) => result.status), 'active');
    await connection.evaluate("Array.from(document.querySelectorAll('button')).find(button => /try again|retry/i.test(button.textContent || ''))?.click()", phone);
    await waitVisible(phone, 'button-hype-manager-account-information');
    await waitFor(connection, phone,
      "Boolean(document.querySelector('[data-testid=\"studio-tool-toolbar\"]'))", Boolean, 30_000);
    const profileMobileNavigation = await connection.evaluate<{
      hub: boolean;
      playerShowcase: boolean;
      tabCount: number;
    }>(`({
      hub: Boolean(document.querySelector('[data-testid="link-studio-directory"]')),
      playerShowcase: Boolean(document.querySelector('[data-testid="link-toolbar-player-showcase"]')),
      tabCount: document.querySelectorAll('[data-testid="studio-tool-toolbar"] a').length,
    })`, phone);
    assert.deepEqual(profileMobileNavigation, {
      hub: true,
      playerShowcase: true,
      tabCount: 2,
    }, 'the supporter profile navigation should show only Supporter Hub and Player Showcase');
    await click(phone, 'button-hype-manager-account-information');
    await waitVisible(phone, 'account-information');
    await waitFor(connection, phone, "document.querySelector('[data-testid=\"account-plan\"]')?.textContent.trim() === 'Pro'", Boolean);
    assert.match(await connection.evaluate<string>("document.querySelector('[data-testid=\"account-information\"]').innerText", phone), /morgan@example.test/);
    await fit(phone);

    await click(phone, 'button-open-pause-account');
    await dialog(phone, 'pause for 90 days');
    await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, phone);
    await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, phone);
    await waitFor(connection, phone, "!document.querySelector('[role=\"dialog\"]')", Boolean);
    assert.equal((await state(owner)).status, 'active');

    const desktop = await open(other, 1280, 850);
    await waitVisible(desktop, 'button-hype-manager-account-information');
    await click(desktop, 'button-hype-manager-account-information');
    await waitVisible(desktop, 'account-information');
    await waitFor(connection, desktop, "document.querySelector('[data-testid=\"account-plan\"]')?.textContent.trim() === 'Free'", Boolean);
    assert.match(await connection.evaluate<string>("document.querySelector('[data-testid=\"account-information\"]').innerText", desktop), /taylor@example.test/);
    await fit(desktop);
    await click(desktop, 'button-open-cancel-account');
    await dialog(desktop, 'cancel your account');
    await connection.evaluate("Array.from(document.querySelectorAll('[role=\"dialog\"] button')).find(button => button.textContent.includes('Keep account')).click()", desktop);
    assert.equal((await state(other)).status, 'active');

    await admin('fail', { viewer: owner, method: 'POST', path: '/account/pause' });
    await click(phone, 'button-open-pause-account');
    await click(phone, 'button-confirm-pause-account');
    await waitFor(connection, phone, "Boolean(document.querySelector('[role=\"alert\"]')?.textContent.includes('Pause failed'))", Boolean);
    assert.equal((await state(owner)).status, 'active');
    await click(phone, 'button-confirm-pause-account');
    await waitVisible(phone, 'locked-account-page');
    await waitVisible(phone, 'button-resume-account');
    assert.equal((await state(owner)).status, 'paused');
    await fit(phone);
    await signOutFromSharedNav(phone, true);
    await connection.evaluate(
      `window.__switchLifecycleAccount(${JSON.stringify(owner)}); window.__navigateLifecycle('/studio/profile')`,
      phone,
    );
    await waitVisible(phone, 'locked-account-page');
    const lockedDesktop = await open(owner, 1280, 850);
    await waitVisible(lockedDesktop, 'locked-account-page');
    await fit(lockedDesktop);
    await signOutFromSharedNav(lockedDesktop, false);
    await connection.evaluate(
      `window.__switchLifecycleAccount(${JSON.stringify(owner)}); window.__navigateLifecycle('/studio/profile')`,
      phone,
    );
    await waitVisible(phone, 'locked-account-page');
    await admin('fail', { viewer: owner, method: 'POST', path: '/account/resume' });
    await click(phone, 'button-resume-account');
    await waitFor(connection, phone, "Boolean(document.querySelector('[role=\"alert\"]')?.textContent.includes('Resume failed'))", Boolean);
    assert.equal((await state(owner)).status, 'paused');
    await click(phone, 'button-resume-account');
    await waitVisible(phone, 'studio-restored');
    assert.equal((await state(owner)).status, 'active');
    assert.equal(await connection.evaluate<string>('location.pathname', phone), '/studio');

    await connection.evaluate(`window.__switchLifecycleAccount(${JSON.stringify(other)}); window.__navigateLifecycle('/studio/profile')`, phone);
    await waitVisible(phone, 'button-hype-manager-account-information');
    await click(phone, 'button-hype-manager-account-information');
    await waitVisible(phone, 'account-information');
    await waitFor(connection, phone, "document.querySelector('[data-testid=\"account-plan\"]')?.textContent.trim() === 'Free'", Boolean);
    const switched = await connection.evaluate<string>("document.querySelector('[data-testid=\"account-information\"]').innerText", phone);
    assert.match(switched, /taylor@example.test/);
    assert.doesNotMatch(switched, /morgan@example.test|Pro/);

    await admin('fail', { viewer: other, method: 'POST', path: '/account/cancel' });
    await click(phone, 'button-open-cancel-account');
    await dialog(phone, 'cancel your account');
    await click(phone, 'button-confirm-cancel-account');
    await waitFor(connection, phone, "Boolean(document.querySelector('[role=\"alert\"]')?.textContent.includes('Cancellation failed'))", Boolean);
    assert.equal((await state(other)).status, 'active');
    await click(phone, 'button-confirm-cancel-account');
    await waitVisible(phone, 'button-reactivate-account');
    assert.equal((await state(other)).status, 'cancelled');
    await fit(phone);
    await admin('fail', { viewer: other, method: 'POST', path: '/account/reactivate' });
    await click(phone, 'button-reactivate-account');
    await waitFor(connection, phone, "Boolean(document.querySelector('[role=\"alert\"]')?.textContent.includes('Reactivation failed'))", Boolean);
    assert.equal((await state(other)).status, 'cancelled');
    await click(phone, 'button-reactivate-account');
    await waitVisible(phone, 'studio-restored');
    assert.equal((await state(other)).status, 'active');

    await connection.evaluate("window.__navigateLifecycle('/studio/profile')", phone);
    await waitVisible(phone, 'button-hype-manager-account-information');
    await click(phone, 'button-hype-manager-account-information');
    await waitVisible(phone, 'button-open-pause-account');
    await click(phone, 'button-open-pause-account');
    await click(phone, 'button-confirm-pause-account');
    await waitVisible(phone, 'button-resume-account');
    await admin('expire', { viewer: other });
    const afterExpiry = await open(other, 390, 844);
    await waitVisible(afterExpiry, 'button-hype-manager-account-information');
    await click(afterExpiry, 'button-hype-manager-account-information');
    await waitVisible(afterExpiry, 'account-information');
    assert.equal((await state(other)).status, 'active');
    assert.equal(await connection.evaluate(visible('locked-account-page'), afterExpiry), false);
    await fit(afterExpiry);

    const dashboardCacheKey = `pixl-sports:private-dashboard:v1:${encodeURIComponent(owner)}`;
    const trackerCacheKey = `leaguematrix-stat-tracker:${owner}`;
    const cachedLifecycle = {
      status: 'active',
      pauseEndsAt: null,
      planTier: 'free',
      cancelledAt: null,
      lastActivityAt: null,
      deletionEligibleAt: null,
      retentionDays: 90,
      expired: false,
    };
    const cachedSnapshot = {
      version: 1,
      accountId: owner,
      verifiedAt: new Date().toISOString(),
      lifecycle: cachedLifecycle,
    };
    await connection.evaluate(
      `localStorage.setItem(${JSON.stringify(dashboardCacheKey)}, ${JSON.stringify(JSON.stringify(cachedSnapshot))})`,
      phone,
    );
    await connection.evaluate(
      `localStorage.setItem(${JSON.stringify(trackerCacheKey)}, 'private tracker data')`,
      phone,
    );
    const cachedBeforeDeletion = await connection.evaluate<string | null>(
      `localStorage.getItem(${JSON.stringify(dashboardCacheKey)})`,
      phone,
    );
    assert.ok(cachedBeforeDeletion, 'the owner should have a previously verified offline snapshot');

    await admin('delete-account', { viewer: owner });
    const afterDeletion = await open(owner, 390, 844);
    await waitVisible(afterDeletion, 'account-unavailable-page');
    const protectedApiStatus = await connection.evaluate<number>(
      "fetch('/api/account/access').then(response => response.status)",
      afterDeletion,
    );
    assert.equal(protectedApiStatus, 423);
    const privateCache = await connection.evaluate<{ dashboard: string | null; tracker: string | null }>(
      `({
        dashboard: localStorage.getItem(${JSON.stringify(dashboardCacheKey)}),
        tracker: localStorage.getItem(${JSON.stringify(trackerCacheKey)}),
      })`,
      afterDeletion,
    );
    assert.deepEqual(privateCache, { dashboard: null, tracker: null });
    await fit(afterDeletion);
    await signOutFromUnavailablePage(afterDeletion);
    const unavailableDesktop = await open(owner, 1280, 850);
    await waitVisible(unavailableDesktop, 'account-unavailable-page');
    await fit(unavailableDesktop);
    await signOutFromUnavailablePage(unavailableDesktop);
  } finally {
    if (connection) for (const page of pages) await connection.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    connection?.close();
    if (browser && browser.exitCode === null) browser.kill('SIGTERM');
    if (vite && vite.exitCode === null) vite.kill('SIGTERM');
    if (!apiMonitor.hasExited()) api.kill('SIGTERM');
    await apiMonitor.waitForExit();
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});