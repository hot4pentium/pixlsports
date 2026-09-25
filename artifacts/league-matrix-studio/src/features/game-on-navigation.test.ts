import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME_ON_COLLECTION_ID, navigateToGameOnSection } from './game-on-navigation';

test('Game On navigation opens Studio and scrolls to its visible section', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const scheduledFrames: FrameRequestCallback[] = [];
  let scrollOptions: ScrollIntoViewOptions | undefined;
  const target = {
    getClientRects: () => [{}],
    scrollIntoView: (options: ScrollIntoViewOptions) => {
      scrollOptions = options;
    },
  } as unknown as HTMLElement;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      },
    } as unknown as Window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      getElementById: (id: string) => id === GAME_ON_COLLECTION_ID ? target : null,
    } as unknown as Document,
  });

  try {
    const destinations: string[] = [];
    navigateToGameOnSection((path) => destinations.push(path));

    assert.deepEqual(destinations, ['/studio']);
    assert.equal(scheduledFrames.length, 1);
    scheduledFrames[0](0);
    assert.deepEqual(scrollOptions, { behavior: 'smooth', block: 'start' });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});