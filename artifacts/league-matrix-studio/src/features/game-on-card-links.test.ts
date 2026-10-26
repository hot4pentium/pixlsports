import assert from 'node:assert/strict';
import test from 'node:test';
import { sharePublicCardLink } from './game-on-card-links';

test('HYPE Card sharing sends the athlete page URL, with clipboard fallback and cancellation', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const url = 'https://example.com/player/athlete-token';
  const title = "Casey's HYPE Card";
  const shares: unknown[] = [];
  const copies: string[] = [];
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        share: async (data: unknown) => { shares.push(data); },
        clipboard: { writeText: async (text: string) => { copies.push(text); } },
      },
    });
    assert.equal(await sharePublicCardLink(url, title), 'shared');
    assert.deepEqual(shares, [{ title, url }]);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => { throw new DOMException('Cancelled', 'AbortError'); },
    });
    assert.equal(await sharePublicCardLink(url, title), 'cancelled');
    assert.deepEqual(copies, []);
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    assert.equal(await sharePublicCardLink(url, title), 'copied');
    assert.deepEqual(copies, [url]);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    assert.equal(await sharePublicCardLink(url, title), 'failed');
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
