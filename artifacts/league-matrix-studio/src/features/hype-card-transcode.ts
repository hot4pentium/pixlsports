import { checkExportSupport } from './hype-card-media';

export type TranscodeProgressCallback = (progress: number) => void;

const MEDIA_READY_TIMEOUT_MS = 10_000;
const PLAYBACK_START_TIMEOUT_MS = 8_000;
const NO_PROGRESS_TIMEOUT_MS = 8_000;

export function preparedVideoDurationMatches(sourceDuration: number, preparedDuration: number): boolean {
  return Number.isFinite(sourceDuration) && sourceDuration > 0
    && Number.isFinite(preparedDuration) && preparedDuration > 0
    && Math.abs(preparedDuration - sourceDuration) <= Math.max(0.5, sourceDuration * 0.08);
}

export type VideoTranscodeOptions = {
  signal?: AbortSignal;
  longEdge?: number;
  videoBitsPerSecond?: number;
  mediaReadyTimeoutMs?: number;
  playbackStartTimeoutMs?: number;
  noProgressTimeoutMs?: number;
};

function abortError() {
  const error = new Error('Video preparation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function waitForMediaEvent(
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'seeked',
  errorMessage: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(errorMessage));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Video preparation stalled while reading the clip.'));
    }, timeoutMs);
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(message));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export async function transcodeVideoToMp4(
  source: Blob,
  onProgress: TranscodeProgressCallback,
  options: VideoTranscodeOptions = {},
): Promise<Blob> {
  const {
    signal,
    mediaReadyTimeoutMs = MEDIA_READY_TIMEOUT_MS,
    playbackStartTimeoutMs = PLAYBACK_START_TIMEOUT_MS,
    noProgressTimeoutMs = NO_PROGRESS_TIMEOUT_MS,
  } = options;
  const support = checkExportSupport();
  const mimeType = support.mp4Mime ?? support.webmMime;
  if (!mimeType) {
    throw new Error('This browser cannot create a smaller MP4 or WebM. The original clip will be kept locally.');
  }
  if (signal?.aborted) throw abortError();

  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  if (typeof canvas.captureStream !== 'function') {
    throw new Error('This browser cannot prepare video locally. The original clip will be kept locally.');
  }

  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('This browser cannot preserve audio during local preparation. The original clip will be kept locally.');
  }

  const sourceUrl = URL.createObjectURL(source);
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = sourceUrl;
  let stream: MediaStream | null = null;
  let audioStream: MediaStream | null = null;
  let audioElement: HTMLVideoElement | null = null;
  let audioContext: AudioContext | null = null;
  let recorder: MediaRecorder | null = null;
  let animationFrame = 0;
  let stallTimer = 0;

  const cleanup = () => {
    cancelAnimationFrame(animationFrame);
    window.clearTimeout(stallTimer);
    if (recorder?.state !== 'inactive') {
      try {
        recorder?.stop();
      } catch {
        // Some Safari versions throw when stopping a recorder whose stream failed.
      }
    }
    stream?.getTracks().forEach((track) => track.stop());
    audioStream?.getTracks().forEach((track) => track.stop());
    video.pause();
    video.removeAttribute('src');
    video.load();
    audioElement?.pause();
    audioElement?.removeAttribute('src');
    audioElement?.load();
    audioElement?.remove();
    void audioContext?.close().catch(() => undefined);
  };

  try {
    await waitForMediaEvent(
      video,
      'loadedmetadata',
      'This browser cannot decode that video.',
      mediaReadyTimeoutMs,
      signal,
    );

    const sourceDuration = video.duration;
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
      throw new Error('The original video has an invalid duration. The original clip will be kept locally.');
    }
    const scale = Math.min(1, (options.longEdge ?? 1280) / Math.max(video.videoWidth || 1280, video.videoHeight || 720));
    const width = Math.max(2, Math.floor((video.videoWidth || 1280) * scale / 2) * 2);
    const height = Math.max(2, Math.floor((video.videoHeight || 720) * scale / 2) * 2);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a video conversion canvas.');

    stream = canvas.captureStream(30);
    if (stream.getVideoTracks().length === 0) {
      throw new Error('This browser could not create a video conversion stream. The original clip will be kept locally.');
    }
    audioElement = document.createElement('video');
    audioElement.preload = 'auto';
    audioElement.playsInline = true;
    audioElement.muted = false;
    audioElement.src = sourceUrl;
    await waitForMediaEvent(
      audioElement,
      'loadedmetadata',
      'Audio could not be decoded.',
      mediaReadyTimeoutMs,
      signal,
    );
    audioContext = new AudioContextConstructor();
    await withTimeout(
      audioContext.resume(),
      playbackStartTimeoutMs,
      'Video preparation stalled while starting audio.',
      signal,
    );
    const audioSource = audioContext.createMediaElementSource(audioElement);
    const audioDestination = audioContext.createMediaStreamDestination();
    audioSource.connect(audioDestination);
    audioStream = audioDestination.stream;
    audioStream.getAudioTracks().forEach((track) => stream?.addTrack(track));

    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: options.videoBitsPerSecond ?? 2_500_000,
      audioBitsPerSecond: 128_000,
    });
    const activeRecorder = recorder;
    const chunks: Blob[] = [];

    const result = await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        cleanup();
        if (error) reject(error);
        else {
          const output = new Blob(chunks, { type: mimeType });
          if (output.size === 0) reject(new Error('The browser created an empty MP4.'));
          else resolve(output);
        }
      };

      activeRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      activeRecorder.onerror = () => finish(new Error('The browser could not create a smaller MP4.'));
      activeRecorder.onstop = () => finish();

      let lastCurrentTime = video.currentTime;
      const armStallWatchdog = () => {
        window.clearTimeout(stallTimer);
        stallTimer = window.setTimeout(() => {
          finish(new Error('Video preparation stalled. The original clip will be kept locally.'));
        }, noProgressTimeoutMs);
      };
      const draw = () => {
        if (settled) return;
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        if (video.ended || (duration > 0 && video.currentTime >= duration - 0.03)) {
          onProgress(1);
          video.pause();
          if (activeRecorder.state !== 'inactive') activeRecorder.stop();
          return;
        }
        try {
          context.drawImage(video, 0, 0, width, height);
        } catch {
          finish(new Error('The browser could not read video frames. The original clip will be kept locally.'));
          return;
        }
        if (video.currentTime > lastCurrentTime + 0.01) {
          lastCurrentTime = video.currentTime;
          armStallWatchdog();
        }
        onProgress(duration > 0 ? video.currentTime / duration : 0);
        animationFrame = requestAnimationFrame(draw);
      };

      const onAbort = () => finish(abortError());
      signal?.addEventListener('abort', onAbort, { once: true });

      void (async () => {
        try {
          if (video.currentTime > 0.01) {
            video.currentTime = 0;
            await waitForMediaEvent(
              video,
              'seeked',
              'The video could not be decoded.',
              mediaReadyTimeoutMs,
              signal,
            );
          }
          activeRecorder.start(1000);
          await withTimeout(
            Promise.all([video.play(), audioElement?.play()]),
            playbackStartTimeoutMs,
            'Video preparation stalled before playback started.',
            signal,
          );
          armStallWatchdog();
          draw();
        } catch (error) {
          finish(error instanceof Error ? error : new Error('The video could not be converted.'));
        }
      })();
    });

    const resultUrl = URL.createObjectURL(result);
    const preparedVideo = document.createElement('video');
    preparedVideo.preload = 'metadata';
    try {
      preparedVideo.src = resultUrl;
      await waitForMediaEvent(
        preparedVideo,
        'loadedmetadata',
        'The prepared video could not be played. The original clip will be kept locally.',
        mediaReadyTimeoutMs,
        signal,
      );
      if (!preparedVideoDurationMatches(sourceDuration, preparedVideo.duration)) {
        throw new Error('Video preparation changed the clip length. The original clip will be kept locally.');
      }
    } finally {
      preparedVideo.removeAttribute('src');
      preparedVideo.load();
      URL.revokeObjectURL(resultUrl);
    }
    onProgress(1);
    return result;
  } finally {
    cleanup();
    URL.revokeObjectURL(sourceUrl);
  }
}