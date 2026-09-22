import type { ChildProcess } from 'node:child_process';

export type ProcessMonitor = {
  hasExited: () => boolean;
  diagnostics: () => string;
  waitForExit: () => Promise<void>;
};

export function monitorProcess(child: ChildProcess, label: string): ProcessMonitor {
  let output = '';
  let exitDescription = '';
  let resolveExit!: () => void;
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const appendOutput = (chunk: Buffer | string) => {
    output = `${output}${String(chunk)}`.slice(-4_000);
  };
  child.stdout?.on('data', appendOutput);
  child.stderr?.on('data', appendOutput);
  child.once('error', (error) => {
    exitDescription = `${label} emitted an error: ${error.message}`;
    resolveExit();
  });
  child.once('exit', (code, signal) => {
    exitDescription = `${label} exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}`;
    resolveExit();
  });

  return {
    hasExited: () => child.exitCode !== null || child.signalCode !== null || Boolean(exitDescription),
    diagnostics: () => [
      exitDescription || `${label} is still running`,
      output.trim() ? `${label} output:\n${output.trim()}` : `${label} produced no captured output`,
    ].join('; '),
    waitForExit: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await exitPromise;
    },
  };
}

export function processFailure(monitor: ProcessMonitor | undefined, description: string) {
  return `${description}${monitor ? `; ${monitor.diagnostics()}` : ''}`;
}

type PendingCommand = {
  resolve: (value: any) => void;
  reject: (reason: unknown) => void;
  sessionId?: string;
};

type DevToolsMessage = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
  params?: Record<string, any>;
  sessionId?: string;
};

export type BrowserPage = {
  sessionId: string;
  targetId: string;
};

export class DevToolsConnection {
  private readonly socket: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly sessionErrors = new Map<string, Error>();
  private readonly targetSessions = new Map<string, string>();
  private readonly lifecycleDiagnostics: string[] = [];
  private readonly eventWaiters = new Set<{
    method: string;
    sessionId?: string;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  private constructor(
    socket: WebSocket,
    private readonly processDiagnostics?: () => string,
  ) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      let message: DevToolsMessage;
      try {
        message = JSON.parse(String(event.data)) as DevToolsMessage;
      } catch (error) {
        this.recordLifecycleDiagnostic(`Could not parse a Chromium DevTools message: ${String(error)}`);
        return;
      }
      this.handleLifecycleEvent(message);
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'DevTools command failed'));
      else pending.resolve(message.result);
    });
    socket.addEventListener('error', () => {
      this.rejectPending(this.connectionError('Chromium DevTools reported a socket error'));
    });
    socket.addEventListener('close', () => {
      this.rejectPending(this.connectionError('Chromium DevTools connection closed'));
    });
  }

  private connectionError(description: string) {
    return new Error(this.processDiagnostics
      ? `${description}; ${this.processDiagnostics()}`
      : description);
  }

  private recordLifecycleDiagnostic(description: string) {
    this.lifecycleDiagnostics.push(description);
    if (this.lifecycleDiagnostics.length > 8) this.lifecycleDiagnostics.shift();
  }

  private rejectPending(error: Error, sessionId?: string) {
    for (const [id, pending] of this.pending) {
      if (sessionId && pending.sessionId !== sessionId) continue;
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private failSession(sessionId: string | undefined, description: string) {
    if (!sessionId) return;
    const error = new Error(this.processDiagnostics
      ? `${description}; ${this.processDiagnostics()}`
      : description);
    this.sessionErrors.set(sessionId, error);
    this.rejectPending(error, sessionId);
  }

  private handleLifecycleEvent(message: DevToolsMessage) {
    if (message.method) {
      for (const waiter of this.eventWaiters) {
        if (waiter.method !== message.method || (waiter.sessionId && waiter.sessionId !== message.sessionId)) continue;
        clearTimeout(waiter.timer);
        this.eventWaiters.delete(waiter);
        waiter.resolve();
      }
    }
    if (message.method === 'Page.crash') {
      const reason = message.params?.reason || 'unknown reason';
      this.recordLifecycleDiagnostic(`Chromium page crashed: ${reason}`);
      this.failSession(message.sessionId, `Chromium page crashed (${reason})`);
    } else if (message.method === 'Target.targetCrashed') {
      const targetId = message.params?.targetId;
      const status = message.params?.status || 'unknown status';
      const errorCode = message.params?.errorCode;
      const sessionId = targetId ? this.targetSessions.get(targetId) : undefined;
      const description = `Chromium target crashed (${status}${errorCode === undefined ? '' : `, error code ${errorCode}`})`;
      this.recordLifecycleDiagnostic(description);
      this.failSession(sessionId, description);
    } else if (message.method === 'Target.detachedFromTarget') {
      const sessionId = message.params?.sessionId;
      const reason = message.params?.reason || 'unknown reason';
      const description = `Chromium detached the inspected target (${reason})`;
      this.recordLifecycleDiagnostic(description);
      this.failSession(sessionId, description);
    } else if (message.method === 'Inspector.detached') {
      const reason = message.params?.reason || 'unknown reason';
      const description = `Chromium inspector detached from the page (${reason})`;
      this.recordLifecycleDiagnostic(description);
      this.failSession(message.sessionId, description);
    }
  }

  static async connect(url: string, processDiagnostics?: () => string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolveOpen, reject) => {
      socket.addEventListener('open', () => resolveOpen());
      socket.addEventListener('error', () => reject(new Error('Could not connect to Chromium DevTools')));
    });
    return new DevToolsConnection(socket, processDiagnostics);
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const sessionError = sessionId ? this.sessionErrors.get(sessionId) : undefined;
    if (sessionError) return Promise.reject(sessionError);
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(this.connectionError('Cannot send a Chromium DevTools command because the socket is closed'));
    }
    const id = ++this.nextId;
    return new Promise<T>((resolveResult, rejectResult) => {
      this.pending.set(id, { resolve: resolveResult, reject: rejectResult, sessionId });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  registerTarget(targetId: string, sessionId: string) {
    this.targetSessions.set(targetId, sessionId);
  }

  waitForEvent(method: string, sessionId?: string, timeoutMs = 10_000) {
    return new Promise<void>((resolve, reject) => {
      let waiter!: {
        method: string;
        sessionId?: string;
        resolve: () => void;
        timer: ReturnType<typeof setTimeout>;
      };
      const timer = setTimeout(() => {
        this.eventWaiters.delete(waiter);
        reject(new Error(this.processDiagnostics
          ? `Timed out waiting for Chromium DevTools event ${method}; ${this.processDiagnostics()}`
          : `Timed out waiting for Chromium DevTools event ${method}`));
      }, timeoutMs);
      waiter = { method, sessionId, resolve, timer };
      this.eventWaiters.add(waiter);
    });
  }

  diagnostics() {
    return this.lifecycleDiagnostics.length > 0
      ? this.lifecycleDiagnostics.join(' | ')
      : 'no Chromium page lifecycle events were captured';
  }

  async evaluate<T>(expression: string, sessionId: string): Promise<T> {
    const result = await this.send<{
      result?: { value?: T; description?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'Browser evaluation failed',
      );
    }
    return result.result?.value as T;
  }

  close() {
    this.socket.close();
  }
}

export async function openPage(
  connection: DevToolsConnection,
  url: string,
  options: {
    offline?: boolean;
    viewport?: {
      width: number;
      height: number;
      deviceScaleFactor?: number;
      mobile?: boolean;
    };
  } = {},
): Promise<BrowserPage> {
  const target = await connection.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
  const attached = await connection.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const { sessionId } = attached;
  await connection.send('Page.enable', {}, sessionId);
  await connection.send('Runtime.enable', {}, sessionId);
  if (options.viewport) {
    await connection.send('Emulation.setDeviceMetricsOverride', {
      width: options.viewport.width,
      height: options.viewport.height,
      deviceScaleFactor: options.viewport.deviceScaleFactor ?? 1,
      mobile: options.viewport.mobile ?? true,
    }, sessionId);
  }
  if (options.offline) {
    await connection.send('Network.enable', {}, sessionId);
    await connection.send('Page.addScriptToEvaluateOnNewDocument', {
      source: "Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });",
    }, sessionId);
    await connection.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    }, sessionId);
  }
  connection.registerTarget(target.targetId, sessionId);
  await connection.send('Page.navigate', { url }, sessionId);
  return { sessionId, targetId: target.targetId };
}

export async function reloadPage(
  connection: DevToolsConnection,
  page: BrowserPage,
) {
  const loadEvent = connection.waitForEvent('Page.loadEventFired', page.sessionId);
  await connection.send('Page.reload', { ignoreCache: true }, page.sessionId);
  await loadEvent;
}

export async function waitForUrl(
  url: string,
  timeoutMs = 20_000,
  processMonitor?: ProcessMonitor,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processMonitor?.hasExited()) {
      throw new Error(processFailure(processMonitor, `Timed out waiting for ${url}`));
    }
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(processFailure(processMonitor, `Timed out waiting for ${url}`));
}

export async function waitFor<T>(
  page: DevToolsConnection,
  sessionId: string,
  expression: string,
  predicate: (value: T) => boolean,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let value: T;
    try {
      value = await page.evaluate<T>(expression, sessionId);
    } catch (error) {
      throw new Error(`Browser condition failed: ${expression}; ${error instanceof Error ? error.message : String(error)}; ${page.diagnostics()}`);
    }
    if (predicate(value)) return value;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  const diagnostic = await page.evaluate<{ href: string; body: string; testError?: string }>(
    '({ href: location.href, body: document.body?.innerText || "", testError: document.body?.dataset.testError })',
    sessionId,
  ).catch((error) => ({
    href: 'unavailable',
    body: `unavailable: ${error instanceof Error ? error.message : String(error)}`,
    testError: undefined,
  }));
  throw new Error(`Timed out waiting for browser condition: ${expression}; href=${diagnostic.href}; testError=${diagnostic.testError || 'none'}; body=${diagnostic.body.slice(0, 700)}; ${page.diagnostics()}`);
}