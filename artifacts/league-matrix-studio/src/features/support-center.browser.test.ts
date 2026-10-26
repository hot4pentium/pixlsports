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

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';

async function freePort() {
  const server: Server = createServer();
  await new Promise<void>((done, reject) => server.once('error', reject).listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP port');
  const port = address.port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

async function stopProcess(child: ChildProcess, monitor: ProcessMonitor) {
  if (monitor.hasExited()) return;
  child.kill('SIGTERM');
  await Promise.race([monitor.waitForExit(), new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))]);
  if (!monitor.hasExited()) {
    child.kill('SIGKILL');
    await monitor.waitForExit();
  }
}

test('new support tickets are easy to find after confirmation for members and guests', async () => {
  const port = await freePort();
  const debugPort = await freePort();
  const profile = await mkdtemp(resolve(tmpdir(), 'pixl-support-center-browser-'));
  const fixturePath = resolve(appDirectory, `support-center-browser-fixture-${process.pid}.html`);
  const configPath = resolve(appDirectory, `support-center-browser-vite-${process.pid}.mjs`);
  const server = spawn('pnpm', ['exec', 'vite', '--config', configPath, '--host', '127.0.0.1'], {
    cwd: appDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      BASE_PATH: '/',
      VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverMonitor = monitorProcess(server, 'support center Vite');
  let chromium: ChildProcess | undefined;
  let chromiumMonitor: ProcessMonitor | undefined;
  let connection: DevToolsConnection | undefined;
  const pages: BrowserPage[] = [];

  try {
    await writeFile(configPath, `
      import baseConfig from './vite.config.ts';
      export default {
        ...baseConfig,
        plugins: [{
          name: 'support-center-browser-clerk-fixture',
          enforce: 'pre',
          resolveId(source) {
            return source === '@clerk/react' ? '\\0support-center-browser-clerk' : null;
          },
          load(id) {
            if (id === '\\0support-center-browser-clerk') {
              return 'export function useUser() { return window.__supportCenterUser; }';
            }
            return null;
          },
        }, ...(baseConfig.plugins || [])],
      };
    `);
    await writeFile(fixturePath, `<!doctype html>
      <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Support ticket browser check</title></head>
      <body><div id="root"></div>
        <script type="module">
          import '/src/index.css';
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
          const params = new URLSearchParams(location.search);
          const member = params.get('member') === '1';
          window.__supportCenterUser = member
            ? { isSignedIn: true, user: { primaryEmailAddress: {
                emailAddress: 'member@example.com', verification: { status: 'verified' }
              } } }
            : { isSignedIn: false, user: null };

          const ticketId = 'f83c88a2-e651-4e09-8e1d-02172e6ca707';
          const ticketReference = 'PS-20261011-ABC123';
          const accessToken = 'browser-test-private-access-token-0123456789';
          let memberListReads = 0;
          let guestTicketReads = 0;
          const serverStateKey = 'support-center-test-server:' + ticketId;
          const readServerState = () => JSON.parse(localStorage.getItem(serverStateKey) || 'null')
            || { ticket: null, accessToken };
          const saveServerState = (state) => localStorage.setItem(serverStateKey, JSON.stringify(state));
          window.__supportCenterPublishReply = () => {
            const state = readServerState();
            state.ticket.messages = [{
              id: 'admin-reply-1', senderRole: 'admin', body: 'We have replied to your request.',
              deliveryStatus: 'sent', createdAt: new Date().toISOString(),
            }];
            saveServerState(state);
          };
          window.__supportCenterReadCounts = () => ({ memberListReads, guestTicketReads });
          window.fetch = async (input, init = {}) => {
            const requestUrl = typeof input === 'string' ? input : input.url;
            const url = new URL(requestUrl, location.origin);
            const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
            if (url.pathname === '/api/support/tickets' && method === 'GET') {
              memberListReads += 1;
              const state = readServerState();
              return new Response(JSON.stringify(state.ticket ? [state.ticket] : []), {
                status: 200, headers: { 'content-type': 'application/json' },
              });
            }
            if (url.pathname === '/api/support/tickets' && method === 'POST') {
              const submitted = JSON.parse(init.body);
              localStorage.setItem('support-center-test-submission', JSON.stringify(submitted));
              const now = new Date().toISOString();
              const state = readServerState();
              state.ticket = {
                id: ticketId, reference: ticketReference, replyEmail: submitted.replyEmail,
                issueId: submitted.issueId, description: submitted.description,
                deviceType: submitted.deviceType, connectionType: submitted.connectionType,
                diagnostics: submitted.diagnostics ?? null, status: 'unread',
                createdAt: now, updatedAt: now, messages: [],
              };
              state.accessToken = accessToken;
              saveServerState(state);
              return new Response(JSON.stringify({ ticket: state.ticket, accessToken }), {
                status: 201, headers: { 'content-type': 'application/json' },
              });
            }
            if (url.pathname === '/api/support/tickets/recovery/request' && method === 'POST') {
              const submitted = JSON.parse(init.body);
              localStorage.setItem('support-center-test-recovery-request', JSON.stringify(submitted));
              return new Response(JSON.stringify({
                message: 'If a guest ticket matches those details, a recovery code has been sent to its original reply email.',
              }), { status: 202, headers: { 'content-type': 'application/json' } });
            }
            if (url.pathname === '/api/support/tickets/recovery/verify' && method === 'POST') {
              const submitted = JSON.parse(init.body);
              if (submitted.reference !== ticketReference || submitted.email !== 'guest@example.com' || submitted.code !== '12345678') {
                return new Response(JSON.stringify({ error: 'Code could not be verified' }), {
                  status: 400, headers: { 'content-type': 'application/json' },
                });
              }
              const state = readServerState();
              state.accessToken = 'recovered-private-access-token-0123456789';
              saveServerState(state);
              return new Response(JSON.stringify({ ticket: state.ticket, accessToken: state.accessToken }), {
                status: 200, headers: { 'content-type': 'application/json' },
              });
            }
            const state = readServerState();
            if (url.pathname === '/api/support/tickets/' + ticketId && method === 'GET' && state.ticket) {
              guestTicketReads += 1;
              const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
              if (headers.get('X-Support-Ticket-Token') !== state.accessToken) {
                return new Response(JSON.stringify({ error: 'Guest ticket access token missing' }), {
                  status: 403, headers: { 'content-type': 'application/json' },
                });
              }
              return new Response(JSON.stringify(state.ticket), {
                status: 200, headers: { 'content-type': 'application/json' },
              });
            }
            return new Response(JSON.stringify({ error: 'Unexpected support API request', path: url.pathname }), {
              status: 500, headers: { 'content-type': 'application/json' },
            });
          };

          const { SupportCenter, DashboardFeedbackBubble } = await import('/src/features/support-center.tsx');
          const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
          createRoot(document.getElementById('root')).render(
            React.createElement(QueryClientProvider, { client: queryClient },
              React.createElement(params.get('feedback') === '1' ? DashboardFeedbackBubble : SupportCenter),
            ),
          );
        </script>
      </body></html>`);

    await waitForUrl(`http://127.0.0.1:${port}/support-center-browser-fixture-${process.pid}.html`, 30_000, serverMonitor);
    chromium = spawn(chromiumPath, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    chromiumMonitor = monitorProcess(chromium, 'support center Chromium');
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 30_000, chromiumMonitor);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl, chromiumMonitor.diagnostics);

    for (const scenario of [
      { name: 'member', query: '?member=1', email: 'member@example.com' },
      { name: 'guest', query: '', email: 'guest@example.com' },
    ]) {
      const page = await openPage(connection, 'about:blank', {
        viewport: { width: 900, height: 700, mobile: false },
      });
      pages.push(page);
      await connection.send('Page.navigate', {
        url: `http://127.0.0.1:${port}/support-center-browser-fixture-${process.pid}.html${scenario.query}`,
      }, page.sessionId);
      await waitFor(connection, page.sessionId,
        'Boolean(document.querySelector("[data-testid=button-submit-support-ticket]"))', Boolean);

      await connection.evaluate(
        'document.querySelector("[data-testid=textarea-support-description]").focus()',
        page.sessionId,
      );
      await connection.send('Input.insertText', { text: `A ${scenario.name} needs help with a saved ticket.` }, page.sessionId);
      const emailValue = await connection.evaluate<string>(
        'document.querySelector("[data-testid=input-support-reply-email]").value',
        page.sessionId,
      );
      if (!emailValue) {
        await connection.evaluate('document.querySelector("[data-testid=input-support-reply-email]").focus()', page.sessionId);
        await connection.send('Input.insertText', { text: scenario.email }, page.sessionId);
      }
      await connection.evaluate('document.querySelector("[data-testid=button-submit-support-ticket]").click()', page.sessionId);
      await waitFor(connection, page.sessionId,
        'Boolean(document.querySelector("[data-testid=dialog-ticket-created]"))', Boolean);
      assert.equal(
        await connection.evaluate<string>(
          'document.querySelector("[data-testid=text-ticket-reference]")?.textContent?.trim() || ""',
          page.sessionId,
        ),
        'PS-20261011-ABC123',
        `${scenario.name} confirmation should show the created ticket reference`,
      );

      await connection.evaluate('document.querySelector("[data-testid=button-view-your-tickets]").click()', page.sessionId);
      await waitFor(connection, page.sessionId, `(() => {
        const heading = document.querySelector("#ticket-history-heading");
        const ticket = document.querySelector("[data-testid='ticket-f83c88a2-e651-4e09-8e1d-02172e6ca707']");
        return Boolean(heading && document.activeElement === heading && ticket
          && heading.getBoundingClientRect().top < 250
          && ticket.querySelector("button[aria-expanded='true']")
          && ticket.innerText.includes("A ${scenario.name} needs help with a saved ticket."));
      })()`, Boolean);
      const historyState = await connection.evaluate<{
        focused: boolean; headingTop: number; windowScrollY: number; expanded: boolean; hasDescription: boolean;
      }>(`(() => {
        const heading = document.querySelector("#ticket-history-heading");
        const ticket = document.querySelector("[data-testid='ticket-f83c88a2-e651-4e09-8e1d-02172e6ca707']");
        return {
          focused: document.activeElement === heading,
          headingTop: heading.getBoundingClientRect().top,
          windowScrollY: window.scrollY,
          expanded: ticket?.querySelector("button[aria-expanded='true']") !== null,
          hasDescription: ticket?.innerText.includes("A ${scenario.name} needs help with a saved ticket.") ?? false,
        };
      })()`, page.sessionId);
      assert.equal(historyState.focused, true, `${scenario.name} View your tickets should focus the history heading`);
      assert.ok(historyState.windowScrollY > 0 && historyState.headingTop < 250,
        `${scenario.name} history should scroll into view: ${JSON.stringify(historyState)}`);
      assert.equal(historyState.expanded, true, `${scenario.name} new ticket should be expanded`);
      assert.equal(historyState.hasDescription, true, `${scenario.name} new ticket should be visible in history`);

      const draftFollowup = `I am adding context as a ${scenario.name}.`;
      await connection.evaluate(
        'document.querySelector("[data-testid=textarea-followup-f83c88a2-e651-4e09-8e1d-02172e6ca707]").focus()',
        page.sessionId,
      );
      await connection.send('Input.insertText', { text: draftFollowup }, page.sessionId);
      await connection.evaluate('window.__supportCenterPublishReply()', page.sessionId);
      await waitFor(connection, page.sessionId, `(() => {
        const ticket = document.querySelector("[data-testid='ticket-f83c88a2-e651-4e09-8e1d-02172e6ca707']");
        const draft = ticket?.querySelector("textarea")?.value;
        return Boolean(ticket?.innerText.includes("We have replied to your request.")
          && draft === ${JSON.stringify(draftFollowup)});
      })()`, Boolean, 30_000);

      const refreshPath = await connection.evaluate<{ memberListReads: number; guestTicketReads: number }>(
        'window.__supportCenterReadCounts()',
        page.sessionId,
      );
      if (scenario.name === 'member') {
        assert.ok(refreshPath.memberListReads >= 2, 'member ticket history should refresh through the authenticated ticket list');
        assert.equal(refreshPath.guestTicketReads, 0, 'members should not switch to guest token access');
      } else {
        assert.equal(refreshPath.memberListReads, 0, 'guest ticket history should not call the member-only ticket list');
        assert.ok(refreshPath.guestTicketReads >= 2, 'guest ticket details should refresh with their private access token');
      }
    }

    const lastCreatedPage = pages[pages.length - 1];
    await connection.evaluate(
      'localStorage.removeItem("pixlsports.support.anonymous-tickets.v1")',
      lastCreatedPage.sessionId,
    );
    const recoveryPage = await openPage(connection, 'about:blank', {
      viewport: { width: 900, height: 700, mobile: false },
    });
    pages.push(recoveryPage);
    await connection.send('Page.navigate', {
      url: `http://127.0.0.1:${port}/support-center-browser-fixture-${process.pid}.html`,
    }, recoveryPage.sessionId);
    await waitFor(connection, recoveryPage.sessionId,
      'Boolean(document.querySelector("[data-testid=section-recover-support-ticket]"))', Boolean);
    assert.equal(
      await connection.evaluate<string>(
        'localStorage.getItem("pixlsports.support.anonymous-tickets.v1")',
        recoveryPage.sessionId,
      ),
      null,
      'a new browser should begin without the original guest access key',
    );
    await connection.evaluate(
      'document.querySelector("[data-testid=input-support-recovery-reference]").focus()',
      recoveryPage.sessionId,
    );
    await connection.send('Input.insertText', { text: 'PS-20261011-ABC123' }, recoveryPage.sessionId);
    await connection.evaluate(
      'document.querySelector("[data-testid=input-support-recovery-email]").focus()',
      recoveryPage.sessionId,
    );
    await connection.send('Input.insertText', { text: 'guest@example.com' }, recoveryPage.sessionId);
    await connection.evaluate(
      'document.querySelector("[data-testid=button-request-support-recovery]").click()',
      recoveryPage.sessionId,
    );
    await waitFor(connection, recoveryPage.sessionId,
      'Boolean(document.querySelector("[data-testid=form-verify-support-recovery]"))', Boolean);
    assert.match(
      await connection.evaluate<string>(
        'document.querySelector("[data-testid=text-support-recovery-feedback]")?.textContent || ""',
        recoveryPage.sessionId,
      ),
      /If those details match a guest ticket/,
      'recovery request should not reveal whether the reference and email matched',
    );
    await connection.evaluate(
      'document.querySelector("[data-testid=input-support-recovery-code]").focus()',
      recoveryPage.sessionId,
    );
    await connection.send('Input.insertText', { text: '12345678' }, recoveryPage.sessionId);
    await connection.evaluate(
      'document.querySelector("[data-testid=button-verify-support-recovery]").click()',
      recoveryPage.sessionId,
    );
    await waitFor(connection, recoveryPage.sessionId, `(() => {
      const ticket = document.querySelector("[data-testid='ticket-f83c88a2-e651-4e09-8e1d-02172e6ca707']");
      return Boolean(ticket && ticket.querySelector("button[aria-expanded='true']")
        && ticket.innerText.includes("A guest needs help with a saved ticket."));
    })()`, Boolean);
    const recoveredState = await connection.evaluate<{ path: string; stored: string; request: string; ticketReadCount: number }>(`(() => ({
      path: location.href,
      stored: localStorage.getItem("pixlsports.support.anonymous-tickets.v1"),
      request: localStorage.getItem("support-center-test-recovery-request"),
      ticketReadCount: window.__supportCenterReadCounts().guestTicketReads,
    }))()`, recoveryPage.sessionId);
    assert.equal(new URL(recoveredState.path).search, '', 'recovery credentials must not be placed in the public URL');
    assert.deepEqual(JSON.parse(recoveredState.request), {
      reference: 'PS-20261011-ABC123', email: 'guest@example.com',
    });
    assert.deepEqual(JSON.parse(recoveredState.stored), [{
      id: 'f83c88a2-e651-4e09-8e1d-02172e6ca707',
      token: 'recovered-private-access-token-0123456789',
    }], 'verified access should be saved only in the new browser storage');
    assert.ok(recoveredState.ticketReadCount > 0, 'the recovered ticket should load with its replacement private key');

    const feedbackPage = await openPage(connection, 'about:blank', {
      viewport: { width: 390, height: 844, mobile: true },
    });
    pages.push(feedbackPage);
    await connection.send('Page.navigate', {
      url: `http://127.0.0.1:${port}/support-center-browser-fixture-${process.pid}.html?member=1&feedback=1`,
    }, feedbackPage.sessionId);
    await waitFor(connection, feedbackPage.sessionId,
      'Boolean(document.querySelector("[data-testid=button-dashboard-feedback]"))', Boolean);
    const feedbackButton = await connection.evaluate<{ right: number; bottom: number; width: number; height: number }>(`(() => {
      const rect = document.querySelector("[data-testid=button-dashboard-feedback]").getBoundingClientRect();
      return { right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    })()`, feedbackPage.sessionId);
    assert.ok(Math.abs(feedbackButton.width - feedbackButton.right) <= 24
      && Math.abs(feedbackButton.height - feedbackButton.bottom) <= 24,
      `mobile feedback bubble should stay reachable at bottom-right: ${JSON.stringify(feedbackButton)}`);
    await connection.evaluate(
      'document.querySelector("[data-testid=button-dashboard-feedback]").click()',
      feedbackPage.sessionId,
    );
    await waitFor(connection, feedbackPage.sessionId,
      'Boolean(document.querySelector("[data-testid=dialog-dashboard-feedback]"))', Boolean);
    await connection.evaluate(
      'document.querySelector("[data-testid=textarea-dashboard-feedback]").focus()',
      feedbackPage.sessionId,
    );
    await connection.send('Input.insertText', {
      text: 'The game card was easy to find. Please make the next action clearer.',
    }, feedbackPage.sessionId);
    await connection.evaluate(
      'document.querySelector("[data-testid=button-submit-dashboard-feedback]").click()',
      feedbackPage.sessionId,
    );
    await waitFor(connection, feedbackPage.sessionId,
      'Boolean(document.querySelector("[data-testid=text-feedback-reference]"))', Boolean);
    const submittedFeedback = await connection.evaluate<{
      issueId: string; description: string; replyEmail: string; deviceType: string; connectionType: string;
    }>('JSON.parse(localStorage.getItem("support-center-test-submission"))', feedbackPage.sessionId);
    assert.deepEqual(submittedFeedback, {
      issueId: 'feedback',
      description: 'The game card was easy to find. Please make the next action clearer.',
      replyEmail: 'member@example.com',
      deviceType: 'mobile',
      connectionType: 'unsure',
    }, 'feedback should use the private support inbox with correct account and device details');
    assert.equal(
      await connection.evaluate<string>(
        'document.querySelector("[data-testid=text-feedback-reference]")?.textContent?.trim() || ""',
        feedbackPage.sessionId,
      ),
      'PS-20261011-ABC123',
      'successful feedback should show its saved ticket reference',
    );
  } finally {
    for (const page of pages) {
      await connection?.send('Target.closeTarget', { targetId: page.targetId }).catch(() => undefined);
    }
    connection?.close();
    if (chromium && chromiumMonitor) await stopProcess(chromium, chromiumMonitor);
    await stopProcess(server, serverMonitor);
    await Promise.all([
      rm(fixturePath, { force: true }),
      rm(configPath, { force: true }),
      rm(profile, { recursive: true, force: true }),
    ]);
  }
});
