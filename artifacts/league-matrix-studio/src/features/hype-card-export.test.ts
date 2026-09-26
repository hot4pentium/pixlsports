import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPositionBadgeMarkup, getPositionBadgeLayout } from './position-badge';
import {
  audioSamplesContainSignal,
  createAudioCaptureSession,
  exportVideoCanvas,
  rasterizeSvgForDownload,
} from './hype-card-export';

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

test('required clip audio fails before recording when Web Audio capture is unavailable', async () => {
  const previousWindow = globalThis.window;
  const previousRecorder = globalThis.MediaRecorder;
  let recorderStarted = false;
  let trackStopped = false;
  const videoTrack = { stop: () => { trackStopped = true; } };
  const stream = {
    getVideoTracks: () => [videoTrack],
    getTracks: () => [videoTrack],
  };
  class FakeRecorder {
    static isTypeSupported = () => true;
    constructor() { recorderStarted = true; }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeRecorder });

  try {
    await assert.rejects(
      exportVideoCanvas(
        { captureStream: () => stream } as unknown as HTMLCanvasElement,
        { duration: 10, currentSrc: 'blob:original-video' } as HTMLVideoElement,
        24,
        () => {},
        new AbortController().signal,
        true,
        0,
        10,
        () => {},
        { requireAudio: true },
      ),
      (error: unknown) => error instanceof Error && error.name === 'AudioCaptureUnavailable',
    );
    assert.equal(recorderStarted, false);
    assert.equal(trackStopped, true);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    else delete (globalThis as { window?: unknown }).window;
    if (previousRecorder) Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: previousRecorder });
    else delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  }
});

test('required clip audio rejects a Safari-style silent prepared blob after recording', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousRecorder = globalThis.MediaRecorder;
  const previousHtmlMediaElement = globalThis.HTMLMediaElement;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const previousUrl = globalThis.URL;
  const previousDateNow = Date.now;
  let clock = 0;
  let nextTimerId = 0;
  let audioCheckStarted = false;
  let audioContextCount = 0;
  let resumeCallCount = 0;
  let mediaElementSourceCount = 0;
  let contextCloseCount = 0;
  const timers = new Map<number, true>();
  const schedule = (callback: () => void, delay = 0) => {
    const timerId = ++nextTimerId;
    timers.set(timerId, true);
    if (delay < 1_000) {
      queueMicrotask(() => {
        if (!timers.delete(timerId)) return;
        clock += Math.max(50, delay);
        callback();
      });
    }
    return timerId;
  };
  const clearScheduled = (timerId: number) => {
    timers.delete(timerId);
  };
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  const addListener = (name: string, callback: (event?: unknown) => void) => {
    const callbacks = listeners.get(name) ?? new Set();
    callbacks.add(callback);
    listeners.set(name, callbacks);
  };
  const removeListener = (name: string, callback: (event?: unknown) => void) => {
    listeners.get(name)?.delete(callback);
  };
  const dispatch = (name: string, event?: unknown) => {
    for (const callback of [...(listeners.get(name) ?? [])]) callback(event);
  };
  class FakeAudioContext {
    state: AudioContextState = 'running';
    destination = {};
    constructor() {
      audioContextCount += 1;
    }
    resume() {
      resumeCallCount += 1;
      return Promise.resolve();
    }
    close() {
      contextCloseCount += 1;
      return Promise.resolve();
    }
    createMediaElementSource() {
      mediaElementSourceCount += 1;
      return { connect() {}, disconnect() {} };
    }
    createMediaStreamDestination() {
      return { stream: { getAudioTracks: () => [{ stop() {} }] } };
    }
    createAnalyser() {
      return {
        fftSize: 0,
        smoothingTimeConstant: 0,
        connect() {},
        disconnect() {},
        getFloatTimeDomainData(samples: Float32Array) {
          samples.fill(0);
        },
      };
    }
    createGain() {
      return { gain: { value: 0 }, connect() {}, disconnect() {} };
    }
  }
  class FakeRecorder {
    static isTypeSupported = () => true;
    state: 'inactive' | 'recording' = 'inactive';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    constructor(_stream: unknown, _options: unknown) {}
    start() {
      this.state = 'recording';
    }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['silent'], { type: 'video/mp4' }) });
      queueMicrotask(() => this.onstop?.());
    }
  }
  const videoTrack = { stop() {} };
  const stream = {
    getVideoTracks: () => [videoTrack],
    getTracks: () => [videoTrack],
    addTrack() {},
  };
  const sourceVideo = {
    duration: 0.2,
    currentTime: 0,
    currentSrc: 'blob:original-video',
    src: 'blob:original-video',
    videoWidth: 640,
    videoHeight: 360,
    readyState: 4,
    paused: false,
    ended: false,
    muted: false,
    loop: false,
    play: () => Promise.resolve(),
    pause() {},
  };
  const canvas = {
    captureStream: () => stream,
    getContext: () => ({}) as CanvasRenderingContext2D,
  };
  const fakeDocument = {
    createElement(tagName: string) {
      assert.equal(tagName, 'video');
      const element = {
        src: '',
        currentTime: 0,
        muted: true,
        preload: 'auto',
        playsInline: true,
        addEventListener: addListener,
        removeEventListener: removeListener,
        load() {
          queueMicrotask(() => dispatch('loadedmetadata'));
        },
        play: () => Promise.resolve(),
        pause() {},
        removeAttribute() {},
        remove() {},
      };
      Object.defineProperty(element, 'src', {
        configurable: true,
        get: () => elementSource,
        set: (value: string) => {
          elementSource = value;
          queueMicrotask(() => dispatch('loadedmetadata'));
        },
      });
      let elementSource = '';
      return element;
    },
  };
  const fakeUrl = {
    createObjectURL: () => 'blob:silent-prepared',
    revokeObjectURL() {},
  };
  const fakeWindow = {
    AudioContext: FakeAudioContext,
    setTimeout: schedule,
    clearTimeout: clearScheduled,
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeRecorder });
  Object.defineProperty(globalThis, 'HTMLMediaElement', { configurable: true, value: { HAVE_CURRENT_DATA: 2 } });
  Object.defineProperty(globalThis, 'URL', { configurable: true, value: fakeUrl });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      queueMicrotask(() => {
        sourceVideo.currentTime = sourceVideo.duration;
        callback(clock);
      });
      return 1;
    },
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} });
  Object.defineProperty(Date, 'now', { configurable: true, value: () => clock });

  const audioSession = createAudioCaptureSession();
  try {
    assert.equal(audioContextCount, 1);
    assert.equal(resumeCallCount, 1);
    await assert.rejects(
      exportVideoCanvas(
        canvas as unknown as HTMLCanvasElement,
        sourceVideo as unknown as HTMLVideoElement,
        24,
        () => {},
        new AbortController().signal,
        true,
        0,
        0.2,
        () => {},
        {
          requireAudio: true,
          onAudioCheck: () => {
            audioCheckStarted = true;
          },
          audioSession,
        },
      ),
      (error: unknown) => error instanceof Error && error.name === 'AudioCaptureUnavailable',
    );
    assert.equal(audioCheckStarted, true);
    assert.equal(audioContextCount, 1, 'recording and blob verification reuse the click-activated context');
    assert.equal(resumeCallCount, 1, 'verification does not resume a new context after recording');
    assert.equal(mediaElementSourceCount, 2, 'capture and recorded-blob verification both use the session');
    assert.equal(contextCloseCount, 0, 'the exporter leaves a caller-owned session open');
    assert.equal(sourceVideo.src, 'blob:original-video');
    assert.equal(sourceVideo.currentTime, sourceVideo.duration);
  } finally {
    await audioSession.context.close();
    if (previousWindow) Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    else delete (globalThis as { window?: unknown }).window;
    if (previousDocument) Object.defineProperty(globalThis, 'document', { configurable: true, value: previousDocument });
    else delete (globalThis as { document?: unknown }).document;
    if (previousRecorder) Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: previousRecorder });
    else delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
    if (previousHtmlMediaElement) Object.defineProperty(globalThis, 'HTMLMediaElement', { configurable: true, value: previousHtmlMediaElement });
    else delete (globalThis as { HTMLMediaElement?: unknown }).HTMLMediaElement;
    if (previousRequestAnimationFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: previousRequestAnimationFrame });
    else delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    if (previousCancelAnimationFrame) Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: previousCancelAnimationFrame });
    else delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
    Object.defineProperty(globalThis, 'URL', { configurable: true, value: previousUrl });
    Object.defineProperty(Date, 'now', { configurable: true, value: previousDateNow });
  }
});

test('audio sample verification distinguishes Safari-style silent tracks from real samples', () => {
  assert.equal(audioSamplesContainSignal(new Float32Array(2048)), false);
  assert.equal(audioSamplesContainSignal(Float32Array.from([0, 0, 0.00002, 0])), true);
  assert.equal(audioSamplesContainSignal(Float32Array.from([0, -0.00002, 0])), true);
});