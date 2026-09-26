import type { HypeCardProject } from './hype-card-types';
import { audioCaptureUnavailableError, exportVideoCanvas } from './hype-card-export';

export const MAX_HOSTED_VIDEO_BYTES = 35 * 1024 * 1024;
const VIDEO_PREPARATION_STEP_TIMEOUT_MS = 10_000;
export type HypeCardShareQuality = 'standard' | 'compact';

export function monotonicProgress(previous: number, next: number): number {
  const bounded = Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : previous;
  return Math.max(previous, bounded);
}

export function hostedVideoBudgetBytes(duration: number): number {
  return Math.min(10 * 1024 * 1024, Math.max(3 * 1024 * 1024, Math.ceil(duration * 750_000)));
}

export function isUsableHostedVideo(actualDuration: number, expectedDuration: number, size: number): boolean {
  return Number.isFinite(actualDuration)
    && actualDuration > 0
    && Math.abs(actualDuration - expectedDuration) <= Math.max(0.75, expectedDuration * 0.08)
    && size > 0
    && size <= hostedVideoBudgetBytes(expectedDuration);
}

function readVideoDuration(blob: Blob, signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const probe = document.createElement('video');
    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      probe.onloadedmetadata = null;
      probe.onerror = null;
      probe.removeAttribute('src');
      probe.load();
      URL.revokeObjectURL(url);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const duration = probe.duration;
      const playable = probe.videoWidth > 0 && probe.videoHeight > 0;
      cleanup();
      if (playable) resolve(duration);
      else reject(new Error('The prepared clip does not contain playable video.'));
    };
    probe.onerror = () => {
      cleanup();
      reject(new Error('The prepared clip could not be played by this browser.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('The prepared clip could not be checked before upload.'));
    }, 15_000);
    probe.src = url;
    probe.load();
  });
}

function abortError() {
  const error = new Error('Athlete Hype Page video preparation was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function uploadHypeCardShareMedia(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
  signal: AbortSignal | undefined,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      request.abort();
      settle(() => reject(abortError()));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        settle(resolve);
      } else {
        settle(() => reject(new Error('The prepared media could not be uploaded.')));
      }
    });
    request.addEventListener('error', () => {
      settle(() => reject(new Error('The prepared media could not be uploaded.')));
    });
    request.addEventListener('abort', () => {
      settle(() => reject(abortError()));
    });
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      request.open('PUT', uploadUrl);
      request.setRequestHeader('Content-Type', contentType);
      request.send(blob);
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error('The prepared media could not be uploaded.')));
    }
  });
}

function seekVideo(video: HTMLVideoElement, time: number, signal?: AbortSignal) {
  if (Math.abs(video.currentTime - time) < 0.02) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('The video could not be prepared.'));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Video preparation stalled while opening the selected segment.'));
    }, VIDEO_PREPARATION_STEP_TIMEOUT_MS);
    try {
      video.currentTime = time;
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error('The selected video segment could not be opened.'));
    }
  });
}

function createPosterBlob(canvas: HTMLCanvasElement, signal?: AbortSignal) {
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => settle(() => reject(abortError()));

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      settle(() => reject(new Error('Video preparation stalled while creating the preview image.')));
    }, VIDEO_PREPARATION_STEP_TIMEOUT_MS);

    try {
      canvas.toBlob((blob) => {
        if (blob) settle(() => resolve(blob));
        else settle(() => reject(new Error('Could not create the poster image.')));
      }, 'image/jpeg', 0.88);
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error('Could not create the poster image.')));
    }
  });
}

function drawContained(context: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number) {
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = video.videoWidth * scale;
  const drawHeight = video.videoHeight * scale;
  context.fillStyle = '#05070a';
  context.fillRect(0, 0, width, height);
  context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

export async function prepareHypeCardShareMedia(
  video: HTMLVideoElement,
  project: Pick<HypeCardProject, 'trimStart' | 'trimEnd'>,
  onProgress: (progress: number) => void,
  options: {
    signal?: AbortSignal;
    quality?: HypeCardShareQuality;
    onAudioCheck?: () => void;
  } = {},
) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('The video is still loading. Try again in a moment.');
  if (options.signal?.aborted) throw abortError();
  const originalTime = video.currentTime;
  const wasPaused = video.paused;
  const quality = options.quality ?? 'standard';
  let reportedProgress = 0;
  const reportProgress = (value: number) => {
    const next = monotonicProgress(reportedProgress, value);
    if (next === reportedProgress) return;
    reportedProgress = next;
    onProgress(next);
  };
  const expectedDuration = project.trimEnd - project.trimStart;
  if (!Number.isFinite(expectedDuration) || expectedDuration <= 0 || expectedDuration > 15.1) {
    throw new Error('Choose a video segment of up to 15 seconds before posting.');
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not prepare the share video.');

  try {
    reportProgress(0.01);
    video.pause();
    await seekVideo(video, project.trimStart, options.signal);
    const levels = quality === 'compact'
      ? [{ longEdge: 640, bitrate: 800_000 }, { longEdge: 480, bitrate: 550_000 }, { longEdge: 360, bitrate: 400_000 }]
      : [{ longEdge: 960, bitrate: 2_000_000 }, { longEdge: 640, bitrate: 800_000 }, { longEdge: 480, bitrate: 550_000 }];
    const firstScale = Math.min(1, levels[0].longEdge / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(2, Math.round(video.videoWidth * firstScale / 2) * 2);
    canvas.height = Math.max(2, Math.round(video.videoHeight * firstScale / 2) * 2);
    drawContained(context, video, canvas.width, canvas.height);
    const poster = await createPosterBlob(canvas, options.signal);
    if (options.signal?.aborted) throw abortError();
    for (const [index, level] of levels.entries()) {
      if (options.signal?.aborted) throw abortError();
      reportProgress(index / levels.length + 0.01);
      const scale = Math.min(1, level.longEdge / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
      const height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
      canvas.width = width;
      canvas.height = height;
      try {
        const clip = await exportVideoCanvas(
          canvas,
          video,
          24,
          (progress) => reportProgress((index + progress) / levels.length),
          options.signal ?? new AbortController().signal,
          true,
          project.trimStart,
          project.trimEnd,
          (ctx, frame) => drawContained(ctx, frame, width, height),
          {
            videoBitsPerSecond: level.bitrate,
            audioBitsPerSecond: quality === 'compact' ? 64_000 : 128_000,
            requireAudio: true,
            onAudioCheck: options.onAudioCheck,
          },
        );
        if (!clip.audioIncluded) {
          throw audioCaptureUnavailableError();
        }
        const actualDuration = await readVideoDuration(clip.blob, options.signal);
        if (isUsableHostedVideo(actualDuration, expectedDuration, clip.blob.size)) {
          reportProgress(1);
          return { video: clip.blob, videoContentType: clip.mimeType, poster, duration: actualDuration };
        }
      } catch (error) {
        if (options.signal?.aborted || (error instanceof Error && (
          error.name === 'AbortError'
          || error.name === 'AudioCaptureUnavailable'
          || error.name === 'PreparationStalled'
        ))) throw error;
        if (index === levels.length - 1) throw error;
      }
    }
    throw new Error('This browser could not make a small, correctly timed video. Your original stays on this device; try a shorter segment or another device.');
  } finally {
    video.currentTime = originalTime;
    if (wasPaused) video.pause();
    else void video.play().catch(() => undefined);
  }
}
