import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { monitorProcess, waitForUrl } from './browser-test-diagnostics';

export interface VideoBrowser {
  evaluate<T>(expression: string): Promise<T>;
  click(selector: string): Promise<void>;
  navigate(url: string): Promise<void>;
  close(): Promise<void>;
  diagnostics?(): string;
}

export async function freeVideoTestPort() {
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(done => server.close(() => done()));
  return address.port;
}

/** WebKitGTK is engine coverage, not Apple's iOS Safari app or hardware. */
export async function videoWebKitBrowser(): Promise<VideoBrowser> {
  const children: ChildProcess[] = [];
  const diagnostics: Array<ReturnType<typeof monitorProcess>> = [];
  let driverGroup: number | undefined;
  let session = '';
  const origin = `http://127.0.0.1:${await freeVideoTestPort()}`;
  async function command<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(origin + path, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    assert.ok(response.ok && !result.value?.error, `${JSON.stringify(result)}; ${diagnostics.map(item => item.diagnostics()).join('; ')}`);
    return result.value;
  }
  const close = async () => {
    if (session) await command('DELETE', session).catch(() => {});
    // PRoot can outlive its driver, and descendants inherit the output pipes.
    // Close the whole test-owned process group, even if its leader has exited.
    if (driverGroup) {
      try { process.kill(-driverGroup, 'SIGTERM'); } catch {}
    }
    for (const child of children.reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exited = new Promise(done => child.once('exit', done));
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise(done => setTimeout(done, 1500))]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    if (driverGroup) {
      try { process.kill(-driverGroup, 'SIGKILL'); } catch {}
    }
  };
  try {
    const mesa = [...(process.env.NIX_LDFLAGS || '').matchAll(/-L(\S*mesa-\S*\/lib)(?:\s|$)/g)]
      .map(match => match[1]).find(path => existsSync(`${path}/../share/glvnd/egl_vendor.d/50_mesa.json`));
    assert.ok(mesa, 'WebKit requires the installed Mesa graphics provider');
    const gstPlugins = [...(process.env.NIX_LDFLAGS || '').matchAll(/-L(\S+\/lib)(?:\s|$)/g)]
      .map(match => `${match[1]}/gstreamer-1.0`).filter(path => existsSync(path));
    assert.ok(gstPlugins.length, 'Install GStreamer base/good/bad/libav for actual WebKit media decoding');
    const display = spawn('Xvfb', ['-displayfd', '1', '-screen', '0', '1280x1024x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(display);
    const displayMonitor = monitorProcess(display, 'Video Xvfb');
    diagnostics.push(displayMonitor);
    const number = await new Promise<string>((done, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error(displayMonitor.diagnostics())), 10_000);
      display.once('error', error => { clearTimeout(timer); reject(error); });
      display.stdout!.on('data', chunk => {
        output += String(chunk);
        if (/^\d+\n/.test(output)) { clearTimeout(timer); done(output.trim()); }
      });
    });
    // GTK 2.48 hardcodes /var/tmp for media buffering. This workspace mounts it
    // read-only; a test-only user-space bind provides writable storage without
    // disabling browser sandboxing or changing the app/media source.
    const driver = spawn('proot', ['-b', '/tmp:/var/tmp', 'WebKitWebDriver', `--port=${new URL(origin).port}`, '--host=127.0.0.1'], {
      env: {
        ...process.env, DISPLAY: `:${number}`, WEBKIT_DISABLE_DMABUF_RENDERER: '1', LIBGL_ALWAYS_SOFTWARE: '1',
        TMPDIR: '/tmp',
        GST_PLUGIN_SYSTEM_PATH_1_0: gstPlugins.join(':'),
        __EGL_VENDOR_LIBRARY_FILENAMES: `${mesa}/../share/glvnd/egl_vendor.d/50_mesa.json`,
        LIBGL_DRIVERS_PATH: `${mesa}/dri`,
      }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    driverGroup = driver.pid;
    children.push(driver);
    const driverMonitor = monitorProcess(driver, 'Video WebKit');
    diagnostics.push(driverMonitor);
    await waitForUrl(`${origin}/status`, 15_000, driverMonitor);
    const created = await command<{ sessionId: string }>('POST', '/session', {
      capabilities: { alwaysMatch: { browserName: 'MiniBrowser' } },
    });
    session = `/session/${created.sessionId}`;
    await command('POST', `${session}/window/rect`, { width: 600, height: 1000 });
    return {
      evaluate: expression => command('POST', `${session}/execute/sync`, { script: `return (${expression});`, args: [] }),
      click: async selector => {
        const element = await command<Record<string, string>>('POST', `${session}/element`, { using: 'css selector', value: selector });
        // GTK's mouse click in a scrolled narrow iframe can miss. WebDriver's
        // native Space activation is also a real user gesture for media policy.
        await command('POST', `${session}/execute/sync`, {
          script: 'arguments[0].scrollIntoView({block:"center"});arguments[0].focus();return true;', args: [element],
        });
        await command('POST', `${session}/element/${element['element-6066-11e4-a52e-4f735466cecf']}/value`, { text: ' ' });
      },
      navigate: async url => {
        // GTK's minimum window width is wider than a phone. Use an actual 390px CSS viewport.
        await command('POST', `${session}/frame`, { id: null });
        await command('POST', `${session}/url`, { url: new URL('phone-frame.html', url).href + `?url=${encodeURIComponent(url)}` });
        const frame = await command('POST', `${session}/element`, { using: 'css selector', value: '#phone' });
        await command('POST', `${session}/frame`, { id: frame });
      },
      close,
      diagnostics: () => diagnostics.map(item => item.diagnostics()).join('; '),
    };
  } catch (error) { await close(); throw error; }
}
