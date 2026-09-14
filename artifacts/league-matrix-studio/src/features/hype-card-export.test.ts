import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPositionBadgeMarkup, getPositionBadgeLayout } from './position-badge';
import { rasterizeSvgForDownload } from './hype-card-export';

type CanvasCall = {
  width: number;
  height: number;
  drawImageArgs: unknown[] | null;
  toDataUrlArgs: unknown[] | null;
};

test('rasterizes long position badges correctly for PNG and JPG downloads', async () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL;
  const blobs = new Map<string, Blob>();
  const revokedUrls: string[] = [];
  const canvasCalls: CanvasCall[] = [];
  let imageCount = 0;

  class FakeImage {
    crossOrigin = '';
    width = 0;
    height = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(value: string) {
      const blob = blobs.get(value);
      if (!blob) {
        this.onerror?.();
        return;
      }
      imageCount += 1;
      queueMicrotask(() => this.onload?.());
    }
  }

  const fakeUrl = {
    createObjectURL(blob: Blob) {
      const url = `blob:export-${blobs.size}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL(url: string) {
      revokedUrls.push(url);
    },
  };

  const fakeDocument = {
    createElement(tagName: string) {
      assert.equal(tagName, 'canvas');
      const call: CanvasCall = {
        width: 0,
        height: 0,
        drawImageArgs: null,
        toDataUrlArgs: null,
      };
      canvasCalls.push(call);
      return {
        get width() {
          return call.width;
        },
        set width(value: number) {
          call.width = value;
        },
        get height() {
          return call.height;
        },
        set height(value: number) {
          call.height = value;
        },
        getContext(contextId: string) {
          assert.equal(contextId, '2d');
          return {
            drawImage(...args: unknown[]) {
              call.drawImageArgs = args;
            },
          };
        },
        toDataURL(...args: unknown[]) {
          call.toDataUrlArgs = args;
          return `data:${args[0]};base64,rasterized-${canvasCalls.length}`;
        },
      };
    },
  };

  Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, 'URL', { configurable: true, value: fakeUrl });

  try {
    const position = 'CENTER BACK DEFENSIVE MIDFIELDER EXTRAORDINARY';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400" viewBox="0 0 1000 1400"><g aria-label="Player number and position">${buildPositionBadgeMarkup(position, '#123456', '#abcdef')}</g></svg>`;
    const layout = getPositionBadgeLayout(position);

    assert.match(svg, new RegExp(`<path d="M${layout.x} 46 H${layout.right} V114`));
    assert.match(svg, new RegExp(`textLength="${layout.maxTextWidth}" lengthAdjust="spacingAndGlyphs"`));

    for (const [format, mimeType, extension] of [
      ['png', 'image/png', 'png'],
      ['jpeg', 'image/jpeg', 'jpg'],
    ] as const) {
      const result = await rasterizeSvgForDownload(svg, 1000, 1400, format);
      const call = canvasCalls.at(-1);

      assert.ok(call);
      assert.equal(call.width, 1000);
      assert.equal(call.height, 1400);
      assert.deepEqual(call.drawImageArgs?.slice(1), [0, 0, 1000, 1400]);
      assert.deepEqual(call.toDataUrlArgs, [mimeType, format === 'jpeg' ? 0.95 : undefined]);
      assert.equal(result.mimeType, mimeType);
      assert.equal(result.extension, extension);
      assert.equal(result.dataUrl, `data:${mimeType};base64,rasterized-${canvasCalls.length}`);
    }

    assert.equal(imageCount, 2);
    assert.equal(revokedUrls.length, 2);
  } finally {
    if (originalImage) {
      Object.defineProperty(globalThis, 'Image', { configurable: true, value: originalImage });
    } else {
      delete (globalThis as { Image?: unknown }).Image;
    }
    if (originalDocument) {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    } else {
      delete (globalThis as { document?: unknown }).document;
    }
    Object.defineProperty(globalThis, 'URL', { configurable: true, value: originalUrl });
  }
});