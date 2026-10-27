import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const scope = 'https://pixl.example/studio-app/';
const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/sw.js');

class MemoryCache {
  private entries = new Map<string, Response>();

  async put(request: Request, response: Response) {
    this.entries.set(request.url, response.clone());
  }

  async match(request: Request) {
    return this.entries.get(request.url)?.clone();
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

async function createWorker() {
  const stores = new Map<string, MemoryCache>();
  const handlers = new Map<string, (event: unknown) => void>();
  let networkFetch: (request: Request) => Promise<Response> = async () => {
    throw new TypeError('offline');
  };
  const cacheStorage = {
    async open(name: string) {
      let cache = stores.get(name);
      if (!cache) {
        cache = new MemoryCache();
        stores.set(name, cache);
      }
      return cache;
    },
    async keys() { return [...stores.keys()]; },
    async delete(name: string) { return stores.delete(name); },
    async match(request: Request) {
      for (const cache of stores.values()) {
        const response = await cache.match(request);
        if (response) return response;
      }
      return undefined;
    },
  };
  const source = (await readFile(workerPath, 'utf8'))
    .replace('__PIXL_PRECACHE_MANIFEST__', '[]');

  runInNewContext(source, {
    URL,
    Headers,
    Response,
    setTimeout,
    caches: cacheStorage,
    fetch: (request: Request) => networkFetch(request),
    self: {
      location: new URL(`${scope}sw.js`),
      registration: { scope },
      clients: { claim: async () => undefined },
      addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    },
  });

  async function activate() {
    let completion: Promise<unknown> | undefined;
    handlers.get('activate')?.({ waitUntil: (promise: Promise<unknown>) => { completion = promise; } });
    assert.ok(completion);
    await completion;
  }

  async function request(request: Request) {
    let responsePromise: Promise<Response> | undefined;
    const backgroundWork: Promise<unknown>[] = [];
    handlers.get('fetch')?.({
      request,
      respondWith: (promise: Promise<Response>) => { responsePromise = promise; },
      waitUntil: (promise: Promise<unknown>) => backgroundWork.push(promise),
    });
    if (!responsePromise) return undefined;
    const response = await responsePromise;
    await Promise.all(backgroundWork);
    return response;
  }

  return {
    caches: cacheStorage,
    activate,
    request,
    setFetch: (fetcher: typeof networkFetch) => { networkFetch = fetcher; },
  };
}

test('shell updates preserve cached schedules and Clerk code without retaining optional tool assets', async () => {
  const worker = await createWorker();
  const oldCache = await worker.caches.open('pixl-sports-shell-v12');
  const schedule = new Request(`${scope}api/schedule-shares/saved-link`);
  const clerk = new Request(`${scope}api/__clerk/npm/clerk.browser.js`);
  const optionalTool = new Request(`${scope}assets/player-showcase-old.js`);
  const wasm = new Request(`${scope}assets/ort-old.wasm`);
  await oldCache.put(schedule, new Response('saved schedule'));
  await oldCache.put(clerk, new Response('public Clerk code'));
  await oldCache.put(optionalTool, new Response('optional tool'));
  await oldCache.put(wasm, new Response('large runtime'));

  await worker.activate();

  assert.deepEqual(await worker.caches.keys(), ['pixl-sports-shell-v17']);
  const currentCache = await worker.caches.open('pixl-sports-shell-v17');
  assert.equal(await (await currentCache.match(clerk))?.text(), 'public Clerk code');
  assert.equal(await currentCache.match(optionalTool), undefined);
  assert.equal(await currentCache.match(wasm), undefined);
  const offlineSchedule = await worker.request(schedule);
  assert.equal(await offlineSchedule?.text(), 'saved schedule');
  assert.equal(offlineSchedule?.headers.get('X-Pixl-Schedule-Cache'), 'offline');
});

test('optional scripts cache on use while retired WASM and private APIs remain uncached', async () => {
  const worker = await createWorker();
  const wasm = new Request(`${scope}assets/ort-runtime.wasm`);
  const currentCache = await worker.caches.open('pixl-sports-shell-v17');
  assert.equal(await currentCache.match(wasm), undefined);
  assert.equal(await worker.request(wasm), undefined);
  const script = new Request(`${scope}assets/player-showcase.js`);
  Object.defineProperty(script, 'destination', { value: 'script' });

  worker.setFetch(async () => new Response('optional script'));
  assert.equal(await (await worker.request(script))?.text(), 'optional script');
  assert.equal(await (await currentCache.match(script))?.text(), 'optional script');

  worker.setFetch(async () => { throw new TypeError('offline'); });
  assert.equal(await (await worker.request(script))?.text(), 'optional script');
  const privateApi = new Request(`${scope}api/profile`);
  assert.equal(await worker.request(privateApi), undefined);
  assert.equal(await currentCache.match(privateApi), undefined);
});
