import type { HypeCardProject } from './hype-card-types';
import { exportVideoCanvas } from './hype-card-export';

export const MAX_HOSTED_VIDEO_BYTES = 35 * 1024 * 1024;

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
    const cleanup = () => {
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
    video.currentTime = time;
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
  options: { signal?: AbortSignal } = {},
) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('The video is still loading. Try again in a moment.');
  if (options.signal?.aborted) throw abortError();
  const originalTime = video.currentTime;
  const wasPaused = video.paused;
  const longEdge = 960;
  const scale = Math.min(1, longEdge / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
  const height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not prepare the share video.');

  try {
    await seekVideo(video, project.trimStart, options.signal);
    drawContained(context, video, width, height);
    const poster = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create the poster image.')), 'image/jpeg', 0.88);
    });
    if (options.signal?.aborted) throw abortError();
    const clip = await exportVideoCanvas(
      canvas,
      video,
      24,
      onProgress,
      new AbortController().signal,
      true,
      project.trimStart,
      project.trimEnd,
      (ctx, frame) => drawContained(ctx, frame, width, height),
      {
        videoBitsPerSecond: 2_000_000,
        audioBitsPerSecond: 128_000,
      },
    );
    return { video: clip.blob, videoContentType: clip.mimeType, poster };
  } finally {
    video.currentTime = originalTime;
    if (wasPaused) video.pause();
    else void video.play().catch(() => undefined);
  }
}
