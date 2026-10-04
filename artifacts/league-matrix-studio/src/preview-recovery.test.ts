import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((source) => source.includes('app-boot-retry'))!;

function harness(mode = 'development') {
  const elements: Record<string, any> = {
    'app-boot-fallback': {},
    'app-boot-message': { textContent: '' },
    'app-boot-retry': { hidden: true, addEventListener: (_: string, fn: () => Promise<void>) => { click = fn; } },
  };
  let click!: () => Promise<void>;
  const unregistered: string[] = [];
  const deleted: string[] = [];
  const timers: { fn: () => void; delay: number }[] = [];
  const destinations: string[] = [];
  const reports: any[] = [];
  const listeners: Record<string, (event: any) => void> = {};
  const window = {
    location: {
      href: 'https://example.com/studio/fan/card?keep=1',
      replace: (url: string) => destinations.push(url),
      reload: () => destinations.push('reload'),
    },
    caches: {
      keys: async () => ['pixl-sports-shell-v1', 'other-app-cache'],
      delete: async (name: string) => { deleted.push(name); return true; },
    },
    addEventListener: (name: string, fn: (event: any) => void) => { listeners[name] = fn; },
    fetch: async (_url: string, options: any) => { reports.push(JSON.parse(options.body)); },
    clearTimeout: () => {},
    setTimeout: (fn: () => void, delay: number) => { timers.push({ fn, delay }); return timers.length; },
  };
  vm.runInNewContext(script.replaceAll('%MODE%', mode).replaceAll('%BASE_URL%', '/studio/'), {
    window, document: { getElementById: (id: string) => elements[id] },
    navigator: { serviceWorker: { getRegistrations: async () =>
      ['https://example.com/studio/', 'https://example.com/other/', 'https://other.example/studio/']
        .map((scope) => ({ scope, unregister: async () => { unregistered.push(scope); return true; } })) } },
    URL, Date, console,
  });
  return { click: () => click(), elements, timers, destinations, unregistered, deleted, reports, listeners };
}

test('dev reconnect recovers before the app module without deleting unrelated caches or workers', async () => {
  const state = harness();
  await state.click();
  assert.deepEqual(state.unregistered, ['https://example.com/studio/']);
  assert.deepEqual(state.deleted, ['pixl-sports-shell-v1']);
  const destination = new URL(state.destinations[0]);
  assert.equal(destination.pathname, '/studio/fan/card');
  assert.equal(destination.searchParams.get('keep'), '1');
  assert.ok(destination.searchParams.has('_pixlReconnect'));
});

test('slow startup offers recovery without declaring failure after only seven seconds', () => {
  const state = harness();
  state.timers.find((timer) => timer.delay === 7000)!.fn();
  assert.match(state.elements['app-boot-message'].textContent, /keep waiting/);
  assert.equal(state.elements['app-boot-retry'].hidden, false);
  assert.ok(state.timers.some((timer) => timer.delay === 30000));
});

test('production reconnect preserves the installed offline shell', async () => {
  const state = harness('production');
  await state.click();
  assert.deepEqual(state.unregistered, []);
  assert.deepEqual(state.deleted, []);
  assert.deepEqual(state.destinations, ['reload']);
});

test('startup import failures are visible and reported without page or module URLs', () => {
  const state = harness();
  state.listeners['leagueMatrix:starting']({});
  state.listeners['leagueMatrix:boot-error']({ detail: 'TypeError: Failed to load https://example.com/src/main.tsx?private=token' });
  assert.match(state.elements['app-boot-message'].textContent, /TypeError: Failed to load/);
  assert.equal(state.reports[0].phase, 'app');
  assert.equal(state.reports[0].detail, 'TypeError: Failed to load [module URL]');
  assert.equal(JSON.stringify(state.reports).includes('keep=1'), false);
});

test('production boot failures are not sent to dev diagnostics', () => {
  const state = harness('production');
  state.listeners['leagueMatrix:boot-error']({ detail: 'Could not import app' });
  assert.equal(state.reports.length, 0);
});