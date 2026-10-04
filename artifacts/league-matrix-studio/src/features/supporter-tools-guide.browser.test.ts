import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  type ProcessMonitor,
} from './browser-test-diagnostics';

const execFileAsync = promisify(execFile);
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const chromiumPath = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose());
  });
  return address.port;
}

function launch(command: string, args: string[], label: string, env = process.env) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  return { child, monitor: monitorProcess(child, label) };
}

async function stopProcess(child: ChildProcess, monitor: ProcessMonitor) {
  if (monitor.hasExited()) return;
  child.kill('SIGTERM');
  await Promise.race([
    monitor.waitForExit(),
    new Promise(resolveDelay => setTimeout(resolveDelay, 2_000)),
  ]);
  if (!monitor.hasExited()) {
    child.kill('SIGKILL');
    await monitor.waitForExit();
  }
}

async function webDriverCommand<T>(
  origin: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as {
    value?: T & { error?: string; message?: string };
  };
  if (!response.ok || payload.value?.error) {
    throw new Error(
      `WebDriver ${method} ${path} failed: ${payload.value?.message || response.statusText}`,
    );
  }
  return payload.value as T;
}

test('supporter guide prints on one Letter page and keeps its content in narrow WebKitGTK layout', async () => {
  const port = await availablePort();
  const fixturePath = resolve(
    appDirectory,
    `supporter-tools-guide-webkit-fixture-${process.pid}.html`,
  );
  const componentFixturePath = resolve(
    appDirectory,
    `supporter-tools-guide-webkit-component-${process.pid}.html`,
  );
  const browserWorkdir = await mkdtemp(resolve(tmpdir(), 'pixl-supporter-guide-browser-'));
  const viteEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    BASE_PATH: '/',
    VITE_CLERK_PUBLISHABLE_KEY:
      process.env.VITE_CLERK_PUBLISHABLE_KEY || 'pk_test_ZXhhbXBsZS5jb20k',
  };
  delete viteEnvironment.REPL_ID;

  const vite = launch(
    'pnpm',
    ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1'],
    'supporter guide Vite',
    viteEnvironment,
  );
  let chromium: ReturnType<typeof launch> | undefined;
  let webkitDriver: ReturnType<typeof launch> | undefined;
  let display: ReturnType<typeof launch> | undefined;
  let connection: DevToolsConnection | undefined;
  let webdriverOrigin = '';
  let webkitSessionPath: string | undefined;

  try {
    await waitForUrl(`http://127.0.0.1:${port}/`, 30_000, vite.monitor);

    // Print the real routed page through Chromium using its CSS @page Letter size.
    const debugPort = await availablePort();
    chromium = launch(chromiumPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${resolve(browserWorkdir, 'chromium-profile')}`,
      'about:blank',
    ], 'supporter guide Chromium');
    await waitForUrl(
      `http://127.0.0.1:${debugPort}/json/version`,
      30_000,
      chromium.monitor,
    );
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then(response => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(
      version.webSocketDebuggerUrl,
      chromium.monitor.diagnostics,
    );
    const page = await openPage(
      connection,
      `http://127.0.0.1:${port}/supporter-guide`,
      { viewport: { width: 900, height: 1100, mobile: false } },
    );
    await waitFor(
      connection,
      page.sessionId,
      'Boolean(document.querySelector("[data-testid=supporter-tools-guide]"))',
      Boolean,
    );
    await connection.evaluate('document.fonts.ready', page.sessionId);
    const pdf = await connection.send<{ data: string }>(
      'Page.printToPDF',
      {
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
        paperWidth: 8.5,
        paperHeight: 11,
      },
      page.sessionId,
    );
    const pdfPath = resolve(browserWorkdir, 'supporter-tools-guide.pdf');
    await writeFile(pdfPath, Buffer.from(pdf.data, 'base64'));
    const { stdout: pdfInfo } = await execFileAsync('pdfinfo', [pdfPath]);
    const { stdout: extractedText } = await execFileAsync('pdftotext', [
      '-layout',
      pdfPath,
      '-',
    ]);
    assert.match(pdfInfo, /Pages:\s+1\b/, `Expected a one-page PDF:\n${pdfInfo}`);
    assert.match(
      pdfInfo,
      /Page size:\s+612 x 792 pts \(letter\)/i,
      `Expected Letter page dimensions:\n${pdfInfo}`,
    );

    const pdfText = extractedText.replace(/\s+/g, ' ').normalize('NFC').toLowerCase();
    for (const phrase of [
      'your athlete’s tools',
      'with the public hype card',
      'live taps use the family qr',
      'private family QR created by the card owner',
      'it works while game day live is active',
      'the owner can revoke the qr access',
    ]) {
      const normalizedPhrase = phrase.toLowerCase();
      assert.ok(
        pdfText.includes(normalizedPhrase),
        `PDF contains "${phrase}": ${pdfText}`,
      );
    }
    connection.close();
    connection = undefined;
    await stopProcess(chromium.child, chromium.monitor);
    chromium = undefined;

    // WebKitGTK's WebDriver has no print-to-PDF command. Mount the real guide
    // component directly to avoid the app's Clerk-gated route, then use a real
    // 390px same-origin iframe and activate its exact @media print declarations
    // in a test-only screen stylesheet to inspect layout.
    await writeFile(componentFixturePath, `<!doctype html>
      <html><head><meta charset="utf-8"></head><body>
        <div id="guide-root"></div>
        <script type="module">
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { SupporterToolsGuidePage } from '/src/features/supporter-tools-guide.tsx';
          createRoot(document.getElementById('guide-root'))
            .render(React.createElement(SupporterToolsGuidePage));
        </script>
      </body></html>`);
    await writeFile(fixturePath, `<!doctype html>
      <html><head><meta charset="utf-8"><style>
        html, body { margin: 0; }
        #guide-viewport { display: block; width: 390px; height: 1200px; border: 0; }
      </style></head><body>
        <iframe id="guide-viewport" src="/supporter-tools-guide-webkit-component-${process.pid}.html" title="Supporter guide print layout check"></iframe>
      </body></html>`);

    const mesaLibrary = [...(process.env.NIX_LDFLAGS || '').matchAll(
      /-L(\S*mesa-\S*\/lib)(?:\s|$)/g,
    )]
      .map(match => match[1])
      .find(path => existsSync(`${path}/../share/glvnd/egl_vendor.d/50_mesa.json`));
    assert.ok(mesaLibrary, 'Install the mesa Nix package before running WebKitGTK checks');

    display = launch(
      'Xvfb',
      ['-displayfd', '1', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp'],
      'supporter guide Xvfb',
    );
    const displayNumber = await new Promise<string>((resolveDisplay, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error(display!.monitor.diagnostics())),
        10_000,
      );
      display!.child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      display!.child.stdout!.on('data', chunk => {
        output += String(chunk);
        if (/^\d+\n/.test(output)) {
          clearTimeout(timer);
          resolveDisplay(output.trim());
        }
      });
    });
    const driverPort = await availablePort();
    webdriverOrigin = `http://127.0.0.1:${driverPort}`;
    webkitDriver = launch(
      'WebKitWebDriver',
      [`--port=${driverPort}`, '--host=127.0.0.1'],
      'supporter guide WebKitGTK WebDriver',
      {
        ...process.env,
        DISPLAY: `:${displayNumber}`,
        WEBKIT_DISABLE_DMABUF_RENDERER: '1',
        LIBGL_ALWAYS_SOFTWARE: '1',
        __EGL_VENDOR_LIBRARY_FILENAMES:
          `${mesaLibrary}/../share/glvnd/egl_vendor.d/50_mesa.json`,
        LIBGL_DRIVERS_PATH: `${mesaLibrary}/dri`,
      },
    );
    await waitForUrl(`${webdriverOrigin}/status`, 15_000, webkitDriver.monitor);
    const session = await webDriverCommand<{
      sessionId: string;
      capabilities: { browserVersion: string };
    }>(webdriverOrigin, 'POST', '/session', {
      capabilities: { alwaysMatch: { browserName: 'MiniBrowser' } },
    });
    webkitSessionPath = `/session/${session.sessionId}`;
    console.log(
      `Linux WebKitGTK ${session.capabilities.browserVersion}: narrow viewport with guide print rules; not iPhone Safari`,
    );
    await webDriverCommand(
      webdriverOrigin,
      'POST',
      `${webkitSessionPath}/window/rect`,
      { width: 600, height: 1000 },
    );
    await webDriverCommand(webdriverOrigin, 'POST', `${webkitSessionPath}/url`, {
      url: `http://127.0.0.1:${port}/supporter-tools-guide-webkit-fixture-${process.pid}.html`,
    });
    const evaluate = <T,>(script: string) => webDriverCommand<T>(
      webdriverOrigin,
      'POST',
      `${webkitSessionPath}/execute/sync`,
      { script: `return (${script});`, args: [] },
    );
    const frame = await webDriverCommand<Record<string, string>>(
      webdriverOrigin,
      'POST',
      `${webkitSessionPath}/element`,
      { using: 'css selector', value: '#guide-viewport' },
    );
    await webDriverCommand(
      webdriverOrigin,
      'POST',
      `${webkitSessionPath}/frame`,
      { id: frame },
    );

    const readyDeadline = Date.now() + 20_000;
    let guideReady = false;
    while (Date.now() < readyDeadline) {
      guideReady = await evaluate<boolean>(
        'Boolean(document.querySelector("[data-testid=supporter-tools-guide]"))',
      );
      if (guideReady) break;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    }
    const activeDocument = await evaluate<{ url: string; title: string; body: string }>(`({
      url: location.href,
      title: document.title,
      body: document.body?.innerText?.slice(0, 600) || '',
    })`);
    assert.ok(
      guideReady,
      `WebKitGTK did not load the guide in its iframe: ${JSON.stringify(activeDocument)}`,
    );
    const rulesCopied = await evaluate<number>(`(() => {
      const probe = document.createElement('style');
      probe.dataset.testPrintRules = 'true';
      document.head.append(probe);
      let copied = 0;
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (!(rule instanceof CSSMediaRule) || !rule.conditionText.includes('print')) continue;
          for (const printRule of rule.cssRules) {
            if (printRule.type === CSSRule.PAGE_RULE) continue;
            probe.sheet.insertRule(printRule.cssText, probe.sheet.cssRules.length);
            copied++;
          }
        }
      }
      return copied;
    })()`);
    assert.ok(rulesCopied > 0, 'WebKitGTK reads and applies the guide print stylesheet');

    const layout = await evaluate<{
      viewport: number;
      innerWidth: number;
      guideWidth: number;
      columns: string;
      columnsShareRow: boolean;
      actionsHidden: boolean;
      liveTapsVisible: boolean;
      liveTapsInsideGuide: boolean;
      quickRuleVisible: boolean;
    }>(`(() => {
      const guide = document.querySelector('[data-testid="supporter-tools-guide"]');
      const columns = document.querySelector('.supporter-guide-columns');
      const toolColumns = [...document.querySelectorAll('.supporter-guide-column')];
      const first = toolColumns[0].getBoundingClientRect();
      const second = toolColumns[1].getBoundingClientRect();
      const guideBounds = guide.getBoundingClientRect();
      const liveTaps = document.querySelector('.supporter-guide-live-taps');
      const liveBounds = liveTaps.getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        innerWidth,
        guideWidth: guideBounds.width,
        columns: getComputedStyle(columns).gridTemplateColumns,
        columnsShareRow: Math.abs(first.top - second.top) < 1 && second.left > first.left,
        actionsHidden: getComputedStyle(document.querySelector('.supporter-guide-actions')).display === 'none',
        liveTapsVisible: liveBounds.width > 0 && liveBounds.height > 0,
        liveTapsInsideGuide: liveBounds.bottom <= guideBounds.bottom + 1,
        quickRuleVisible: document.querySelector('[data-testid="supporter-guide-quick-rule"]').getBoundingClientRect().height > 0,
      };
    })()`);
    assert.ok(
      layout.viewport === 390 && Math.abs(layout.innerWidth - 390) <= 1,
      `Expected a real 390px WebKitGTK iframe viewport: ${JSON.stringify(layout)}`,
    );
    assert.ok(
      Math.abs(layout.guideWidth - 7.74 * 96) < 2,
      `WebKitGTK applies the guide's print width: ${JSON.stringify(layout)}`,
    );
    assert.equal(layout.columnsShareRow, true, `Print tool columns remain side-by-side: ${JSON.stringify(layout)}`);
    assert.equal(layout.actionsHidden, true, 'WebKitGTK hides print-only actions');
    assert.equal(layout.liveTapsVisible, true, 'WebKitGTK keeps the Live Taps explanation laid out');
    assert.equal(layout.liveTapsInsideGuide, true, 'The Live Taps explanation stays inside the guide');
    assert.equal(layout.quickRuleVisible, true, 'WebKitGTK keeps the private-QR quick rule laid out');
    console.log(`WebKitGTK narrow-viewport print-rule layout: ${JSON.stringify(layout)}`);
  } finally {
    connection?.close();
    if (webkitSessionPath) {
      await webDriverCommand(webdriverOrigin, 'DELETE', webkitSessionPath).catch(() => undefined);
    }
    for (const process of [webkitDriver, display, chromium, vite]) {
      if (process) await stopProcess(process.child, process.monitor);
    }
    await rm(fixturePath, { force: true });
    await rm(componentFixturePath, { force: true });
    await rm(browserWorkdir, { recursive: true, force: true });
  }
});