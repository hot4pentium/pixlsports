import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const chromiumPath = process.env.CHROMIUM_PATH || "chromium";
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type ChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
  section: string | null;
};

type ChecklistResponse = {
  shareToken: string;
  title: string;
  mode: "gameday" | "tournament";
  items: ChecklistItem[];
  selectedGame?: {
    id: string;
    type: "game" | "practice" | "meeting";
    date: string;
    time: string;
    location: string;
    opponent: string;
  } | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
};

function listen(server: Server) {
  return new Promise<{ address: string; port: number }>((resolveAddress, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected a TCP server address"));
        return;
      }
      resolveAddress({ address: `http://127.0.0.1:${address.port}`, port: address.port });
    });
  });
}

function waitForExit(process: ChildProcess) {
  return new Promise<void>((resolveExit) => process.once("exit", () => resolveExit()));
}

async function waitForUrl(url: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
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
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "DevTools command failed"));
      else pending.resolve(message.result);
    });
  }

  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolveOpen, reject) => {
      socket.addEventListener("open", () => resolveOpen());
      socket.addEventListener("error", () => reject(new Error("Could not connect to Chromium DevTools")));
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
      exceptionDetails?: {
        text?: string;
        exception?: { description?: string };
      };
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || "Browser evaluation failed",
      );
    }
    return result.result?.value as T;
  }

  close() {
    this.socket.close();
  }
}

async function waitFor<T>(
  page: DevToolsConnection,
  sessionId: string,
  expression: string,
  predicate: (value: T) => boolean,
  timeoutMs = 8_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await page.evaluate<T>(expression, sessionId);
    if (predicate(value)) return value;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  const diagnostic = await page.evaluate<{
    href: string;
    title: string;
    body: string;
  }>("({ href: location.href, title: document.title, body: document.body?.innerText ?? '' })", sessionId).catch(() => ({
    href: "unavailable",
    title: "unavailable",
    body: "unavailable",
  }));
  throw new Error(`Timed out waiting for browser condition: ${expression} (${diagnostic.href}; ${diagnostic.title}; ${diagnostic.body.slice(0, 240)})`);
}

async function openPage(
  connection: DevToolsConnection,
  url: string,
  apiOrigin: string,
  viewport: { width: number; height: number; mobile: boolean },
) {
  const target = await connection.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const attached = await connection.send<{ sessionId: string }>("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  const { sessionId } = attached;
  await connection.send("Page.enable", {}, sessionId);
  await connection.send("Runtime.enable", {}, sessionId);
  await connection.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      (() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const requestUrl = typeof input === "string" ? input : input.url;
          if (!requestUrl.startsWith("/api/checklist-shares/")) {
            return originalFetch(input, init);
          }
          return originalFetch(${JSON.stringify(apiOrigin)} + requestUrl, init);
        };
      })();
    `,
  }, sessionId);
  await connection.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  }, sessionId);
  await connection.send("Page.navigate", { url }, sessionId);
  return { sessionId, targetId: target.targetId };
}

test("two checklist collaborators recover a stale revision and keep it after reload", async () => {
  const shareToken = "11111111-1111-4111-8111-111111111111";
  const practiceShareToken = "22222222-2222-4222-8222-222222222222";
  const meetingShareToken = "33333333-3333-4333-8333-333333333333";
  const now = new Date().toISOString();
  let share: ChecklistResponse = {
    shareToken,
    title: "Saturday tournament",
    mode: "gameday",
    items: [
      {
        id: "uniform",
        label: "Pack the uniform and game shoes",
        completed: false,
        section: "Before leaving",
      },
    ],
    revision: 1,
    createdAt: now,
    updatedAt: now,
    canManage: false,
  };
  const shares = new Map<string, ChecklistResponse>([
    [shareToken, share],
    [practiceShareToken, {
      shareToken: practiceShareToken,
      title: "Wednesday practice",
      mode: "gameday",
      items: [{
        id: "practice-gear",
        label: "Pack practice gear and shoes",
        completed: false,
        section: "Before practice",
      }],
      selectedGame: {
        id: "practice-1",
        type: "practice",
        date: "2026-09-23",
        time: "17:00",
        location: "Eastside Field",
        opponent: "",
      },
      revision: 1,
      createdAt: now,
      updatedAt: now,
      canManage: false,
    }],
    [meetingShareToken, {
      shareToken: meetingShareToken,
      title: "Thursday meeting",
      mode: "gameday",
      items: [{
        id: "meeting-notes",
        label: "Bring a notebook and pen",
        completed: false,
        section: "Before meeting",
      }],
      selectedGame: {
        id: "meeting-1",
        type: "meeting",
        date: "2026-09-24",
        time: "18:00",
        location: "Clubhouse",
        opponent: "",
      },
      revision: 1,
      createdAt: now,
      updatedAt: now,
      canManage: false,
    }],
  ]);
  const requests: Array<{ method: string; expectedRevision?: number; status: number }> = [];
  const apiServer = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "content-type");
    response.setHeader("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const requestedToken = request.url?.match(/^\/api\/checklist-shares\/([^/]+)$/)?.[1];
    const requestedShare = requestedToken ? shares.get(requestedToken) : undefined;
    if (!requestedShare) {
      response.writeHead(404).end();
      return;
    }
    if (request.method === "GET") {
      requests.push({ method: "GET", status: 200 });
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(requestedShare));
      return;
    }
    if (request.method === "PATCH") {
      const body = JSON.parse(await new Promise<string>((resolveBody) => {
        let raw = "";
        request.on("data", (chunk) => { raw += chunk; });
        request.on("end", () => resolveBody(raw));
      })) as ChecklistResponse & { expectedRevision: number };
      if (body.expectedRevision !== requestedShare.revision) {
        requests.push({ method: "PATCH", expectedRevision: body.expectedRevision, status: 409 });
        response.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({
          error: "Checklist revision is stale",
          current: requestedShare,
        }));
        return;
      }
      share = {
        shareToken: requestedShare.shareToken,
        title: body.title,
        mode: body.mode,
        items: body.items,
        selectedGame: body.selectedGame,
        revision: requestedShare.revision + 1,
        createdAt: requestedShare.createdAt,
        updatedAt: new Date().toISOString(),
        canManage: false,
      };
      shares.set(requestedShare.shareToken, share);
      requests.push({ method: "PATCH", expectedRevision: body.expectedRevision, status: 200 });
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(share));
      return;
    }
    response.writeHead(405).end();
  });
  const api = await listen(apiServer);
  const vitePort = await (async () => {
    const probe = createServer();
    const result = await listen(probe);
    await new Promise<void>((resolveClose, rejectClose) => probe.close((error) => error ? rejectClose(error) : resolveClose()));
    return result.port;
  })();
  const devServer = spawn("pnpm", ["exec", "vite", "--config", "vite.config.ts", "--host", "127.0.0.1"], {
    cwd: appDirectory,
    env: {
      ...process.env,
      PORT: String(vitePort),
      BASE_PATH: "/",
      VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || "pk_test_ZXhhbXBsZS5jb20k",
    },
    stdio: "ignore",
  });
  let browser: ChildProcess | undefined;
  let connection: DevToolsConnection | undefined;
  let tempDirectory: string | undefined;
  const pageSessions: Array<{ sessionId: string; targetId: string }> = [];
  try {
    await waitForUrl(`http://127.0.0.1:${vitePort}/`);
    tempDirectory = await mkdtemp(resolve(tmpdir(), "pixl-checklist-browser-"));
    const debugPort = await (async () => {
      const probe = createServer();
      const result = await listen(probe);
      await new Promise<void>((resolveClose, rejectClose) => probe.close((error) => error ? rejectClose(error) : resolveClose()));
      return result.port;
    })();
    browser = spawn(chromiumPath, [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${tempDirectory}`,
      "about:blank",
    ], { stdio: "ignore" });
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`);
    const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>);
    connection = await DevToolsConnection.connect(version.webSocketDebuggerUrl);

    const first = await openPage(
      connection,
      `http://127.0.0.1:${vitePort}/checklist/${shareToken}`,
      api.address,
      { width: 390, height: 844, mobile: true },
    );
    const second = await openPage(
      connection,
      `http://127.0.0.1:${vitePort}/checklist/${shareToken}`,
      api.address,
      { width: 1280, height: 900, mobile: false },
    );
    const practice = await openPage(
      connection,
      `http://127.0.0.1:${vitePort}/checklist/${practiceShareToken}`,
      api.address,
      { width: 390, height: 844, mobile: true },
    );
    const meeting = await openPage(
      connection,
      `http://127.0.0.1:${vitePort}/checklist/${meetingShareToken}`,
      api.address,
      { width: 390, height: 844, mobile: true },
    );
    pageSessions.push(first, second, practice, meeting);
    await Promise.all(pageSessions.map(({ sessionId }) => waitFor(
      connection!,
      sessionId,
      "document.body?.innerText ?? ''",
      (body) => body.includes("SHARED WORKSPACE"),
      30_000,
    )));
    for (const [page, eventType] of [
      [practice, "PRACTICE"],
      [meeting, "MEETING"],
    ] as const) {
      await waitFor(
        connection,
        page.sessionId,
        "({ heading: document.querySelector('[data-testid=\"checklist-heading\"]')?.textContent ?? '', summary: document.querySelector('[data-testid=\"checklist-selected-event-summary\"]')?.textContent ?? '', body: document.body?.innerText ?? '' })",
        ({ heading, summary, body }) => heading.replace(/\s/g, '').includes(`${eventType}CHECKLIST.`)
          && summary.trim().length > 0
          && body.includes("EVENT CARD DETAILS"),
      );
    }

    for (const { sessionId } of pageSessions) {
      const layout = await connection.evaluate<{
        toolbarVisible: boolean;
        firstItemTop: number;
        scrollWidth: number;
        viewportWidth: number;
        viewportHeight: number;
        checklistBackground: string;
        backBottom: number;
        headingTop: number;
        headingWidth: number;
        headingRight: number;
        progressLeft: number;
      }>(`(() => {
        const firstItem = document.querySelector('[data-testid="checklist-items"] [data-completed]');
        const back = document.querySelector('[data-testid="button-back-checklist"]')?.getBoundingClientRect();
        const heading = document.querySelector('[data-testid="checklist-heading"]')?.getBoundingClientRect();
        const progress = document.querySelector('[data-testid="checklist-progress"]')?.getBoundingClientRect();
        const checklistSurface = document.querySelector('.studio-editor-page-background');
        return {
          toolbarVisible: Boolean(document.querySelector('[data-testid="studio-tool-toolbar"]')),
          firstItemTop: firstItem?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          checklistBackground: getComputedStyle(checklistSurface).getPropertyValue('--background').trim(),
          backBottom: back?.bottom ?? Number.POSITIVE_INFINITY,
          headingTop: heading?.top ?? Number.NEGATIVE_INFINITY,
          headingWidth: heading?.width ?? 0,
          headingRight: heading?.right ?? Number.POSITIVE_INFINITY,
          progressLeft: progress?.left ?? Number.NEGATIVE_INFINITY,
        };
      })()`, sessionId);
      assert.equal(layout.toolbarVisible, false);
      assert.ok(layout.firstItemTop < layout.viewportHeight - 120, `First checklist item should be near the opening viewport: ${JSON.stringify(layout)}`);
      assert.ok(layout.scrollWidth <= layout.viewportWidth, `Checklist page should not overflow horizontally: ${JSON.stringify(layout)}`);
      assert.equal(layout.checklistBackground, '43 100% 96%', 'Checklist pages should use the selected warm-paper palette.');
      if (layout.viewportWidth < 768) {
        assert.ok(layout.headingWidth > 170, `Checklist heading should have room to wrap naturally on phones: ${JSON.stringify(layout)}`);
        assert.ok(layout.headingRight <= layout.progressLeft, `Checklist heading should not collide with the progress badge: ${JSON.stringify(layout)}`);
        assert.ok(layout.headingTop >= layout.backBottom, `The back link should sit above the heading on phones: ${JSON.stringify(layout)}`);
      }
    }

    await connection.evaluate(
      "document.querySelector('[data-testid=\"button-checklist-toggle-uniform\"]').click()",
      first.sessionId,
    );
    await waitFor(
      connection,
      first.sessionId,
      "({ feedback: document.querySelector('[data-testid=\"checklist-completion-feedback\"]')?.textContent ?? '', ready: document.querySelector('[data-testid=\"checklist-ready-celebration\"]')?.textContent ?? '' })",
      ({ feedback, ready }) => feedback.includes("Game day ready")
        && ready.includes("Game day ready")
        && ready.includes("Open Stat Tracker"),
    );
    await waitFor(
      connection,
      first.sessionId,
      "document.body?.innerText ?? ''",
      (body) => body.includes("Saving latest changes…") || share.revision === 2,
      2_000,
    ).catch(() => undefined);
    await waitFor(
      connection,
      second.sessionId,
      "document.body?.innerText ?? ''",
      (body) => body.includes("SHARED WORKSPACE") && requests.some((request) => request.method === "PATCH" && request.status === 200),
    );

    await connection.evaluate(
      "document.querySelector('[data-testid=\"button-checklist-toggle-uniform\"]').click()",
      second.sessionId,
    );
    await waitFor(
      connection,
      second.sessionId,
      "document.body?.innerText ?? ''",
      (body) => body.includes("ANOTHER EDIT WAS SAVED FIRST"),
    );
    assert.deepEqual(
      requests.filter((request) => request.method === "PATCH").map((request) => [request.expectedRevision, request.status]),
      [[1, 200], [1, 409]],
    );
    assert.equal(share.revision, 2);
    assert.equal(share.items[0]?.completed, true);
    await connection.evaluate(
      "document.querySelector('[data-testid=\"button-retry-checklist-sync\"]')?.click()",
      second.sessionId,
    );
    await waitFor(
      connection,
      second.sessionId,
      "document.body?.innerText ?? ''",
      (body) => body.includes("Saved to shared checklist") && share.revision === 3,
    );
    assert.equal(share.items[0]?.completed, true);

    const readsBeforeReload = requests.filter((request) => request.method === "GET").length;
    await connection.send("Page.reload", {}, second.sessionId);
    await waitFor(
      connection,
      second.sessionId,
      "document.querySelector('[data-testid=\"button-checklist-toggle-uniform\"]')?.getAttribute('aria-label')",
      (label) => label === "Uncheck Pack the uniform and game shoes"
        && requests.filter((request) => request.method === "GET").length > readsBeforeReload,
    );
    assert.equal(
      await connection.evaluate<string>(
        "document.querySelector('[data-testid=\"button-checklist-toggle-uniform\"]')?.getAttribute('aria-label')",
        second.sessionId,
      ),
      "Uncheck Pack the uniform and game shoes",
    );

    for (const [page, eventType] of [
      [practice, "PRACTICE"],
      [meeting, "MEETING"],
    ] as const) {
      await connection.send("Page.reload", {}, page.sessionId);
      await waitFor(
        connection,
        page.sessionId,
        "({ heading: document.querySelector('[data-testid=\"checklist-heading\"]')?.textContent ?? '', summary: document.querySelector('[data-testid=\"checklist-selected-event-summary\"]')?.textContent ?? '', body: document.body?.innerText ?? '' })",
        ({ heading, summary, body }) => heading.replace(/\s/g, '').includes(`${eventType}CHECKLIST.`)
          && summary.trim().length > 0
          && body.includes("EVENT CARD DETAILS"),
      );
    }
  } finally {
    for (const { targetId } of pageSessions) {
      await connection?.send("Target.closeTarget", { targetId }).catch(() => undefined);
    }
    connection?.close();
    browser?.kill("SIGTERM");
    if (browser) await waitForExit(browser);
    await rm(tempDirectory || "", { recursive: true, force: true }).catch(() => undefined);
    devServer.kill("SIGTERM");
    await waitForExit(devServer);
    await new Promise<void>((resolveClose, rejectClose) => apiServer.close((error) => error ? rejectClose(error) : resolveClose()));
  }
});