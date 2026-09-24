import { checkExportSupport } from './hype-card-media';

export type ExportProgressCallback = (progress: number) => void;

export type ImageExportFormat = 'png' | 'jpeg';
export type VideoRecorderOptions = {
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  requireAudio?: boolean;
};

export const AUDIO_CAPTURE_UNAVAILABLE_MESSAGE =
  'This browser could not capture the clip audio, so the video was not posted. Your original video is still selected on this device. To post with sound, open the original video in a supported browser or on another device and try again.';

export function audioCaptureUnavailableError(): Error {
  const error = new Error(AUDIO_CAPTURE_UNAVAILABLE_MESSAGE);
  error.name = 'AudioCaptureUnavailable';
  return error;
}

const MEDIA_READY_TIMEOUT_MS = 10_000;
const PLAYBACK_START_TIMEOUT_MS = 8_000;
const NO_PROGRESS_TIMEOUT_MS = 8_000;

function abortError() {
  const error = new Error('Export cancelled');
  error.name = 'AbortError';
  return error;
}

function stalledError(message: string) {
  const error = new Error(message);
  error.name = 'PreparationStalled';
  return error;
}

function waitForMediaEvent(
  video: HTMLVideoElement,
  eventName: 'loadedmetadata' | 'seeked',
  errorMessage: string,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
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
    if (signal.aborted) {
      onAbort();
      return;
    }
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(stalledError('Video preparation stalled while reading the clip.'));
    }, MEDIA_READY_TIMEOUT_MS);
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function withTimeout<T>(promise: Promise<T>, message: string, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(stalledError(message));
    }, PLAYBACK_START_TIMEOUT_MS);
    signal.addEventListener('abort', onAbort, { once: true });
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

export function svgToImage(svg: string, width: number, height: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.width = width;
    img.height = height;
    img.onload = () => {
      resolve(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error('Failed to load SVG into image'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export async function rasterizeSvgForDownload(
  svg: string,
  width: number,
  height: number,
  format: ImageExportFormat,
): Promise<{ dataUrl: string; mimeType: string; extension: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create canvas context');
  }

  const image = await svgToImage(svg, width, height);
  context.drawImage(image, 0, 0, width, height);

  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
  return {
    dataUrl: canvas.toDataURL(mimeType, format === 'jpeg' ? 0.95 : undefined),
    mimeType,
    extension: format === 'png' ? 'png' : 'jpg',
  };
}

export async function exportVideoCanvas(
  canvas: HTMLCanvasElement,
  videoElement: HTMLVideoElement,
  fps: number,
  onProgress: ExportProgressCallback,
  signal: AbortSignal,
  includeAudio: boolean,
  trimStart: number,
  trimEnd: number,
  onDrawFrame: (ctx: CanvasRenderingContext2D, videoFrame: HTMLVideoElement) => void,
  recorderOptions: VideoRecorderOptions = {},
): Promise<{ blob: Blob; mimeType: string; ext: string; audioIncluded: boolean }> {
  const { requireAudio = false, ...mediaRecorderOptions } = recorderOptions;
  const support = checkExportSupport();
  
  let mimeType = '';
  let ext = '';
  if (support.mp4Mime) {
    mimeType = support.mp4Mime;
    ext = 'mp4';
  } else if (support.webmMime) {
    mimeType = support.webmMime;
    ext = 'webm';
  } else {
    throw new Error('No supported video export format found in this browser.');
  }

  const stream = canvas.captureStream(fps);
  if (stream.getVideoTracks().length === 0) {
    throw new Error('This browser could not create a video preparation stream.');
  }
  let audioIncluded = false;
  const sourceDuration = videoElement.duration && isFinite(videoElement.duration) ? videoElement.duration : 15;
  const startTime = Math.max(0, Math.min(trimStart, sourceDuration));
  const endTime = Math.max(startTime + 0.1, Math.min(trimEnd, sourceDuration));
  let audioElement: HTMLVideoElement | null = null;
  let audioContext: AudioContext | null = null;
  let audioDecoding = false;
  
  // Add audio track if requested and available
  if (includeAudio) {
    try {
      // Safari often omits audio from HTMLMediaElement.captureStream(). Use a
      // separate local media element and Web Audio to create a capturable track.
      const AudioContextConstructor = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const sourceUrl = videoElement.currentSrc || videoElement.src;
      if (!AudioContextConstructor || !sourceUrl) throw new Error('Web Audio is unavailable.');

      audioElement = document.createElement('video');
      audioElement.preload = 'auto';
      audioElement.playsInline = true;
      audioElement.muted = false;
      audioElement.src = sourceUrl;
      audioDecoding = true;
      await waitForMediaEvent(audioElement, 'loadedmetadata', 'Audio could not be decoded.', signal);
      audioElement.currentTime = startTime;
      if (startTime > 0.01) {
        await waitForMediaEvent(audioElement, 'seeked', 'Audio could not be decoded.', signal);
      }
      audioDecoding = false;
      audioContext = new AudioContextConstructor();
      await withTimeout(audioContext.resume(), 'Video preparation stalled while starting audio.', signal);
      const audioSource = audioContext.createMediaElementSource(audioElement);
      const audioDestination = audioContext.createMediaStreamDestination();
      audioSource.connect(audioDestination);
      const audioTrack = audioDestination.stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('Web Audio did not create an audio track.');
      stream.addTrack(audioTrack);
      audioIncluded = true;
    } catch (err) {
      console.warn('Could not capture clip audio with Web Audio', err);
      audioElement?.remove();
      audioElement = null;
      await audioContext?.close().catch(() => undefined);
      audioContext = null;
      if (signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        throw abortError();
      }
      if (requireAudio) {
        stream.getTracks().forEach((track) => track.stop());
        throw audioDecoding ? err : audioCaptureUnavailableError();
      }
    }
  }

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, ...mediaRecorderOptions });
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    audioElement?.remove();
    void audioContext?.close().catch(() => undefined);
    throw new Error('This browser could not start video preparation.');
  }
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  return new Promise((resolve, reject) => {
    let animationFrameId: number;
    let recordingTimeoutId: number | undefined;
    let stallTimerId: number | undefined;
    const duration = endTime - startTime;
    const originalLoop = videoElement.loop;
    const wasPaused = videoElement.paused;
    const originalMuted = videoElement.muted;
    let cancelled = false;

    const cleanup = () => {
      cancelAnimationFrame(animationFrameId);
      window.clearTimeout(recordingTimeoutId);
      window.clearTimeout(stallTimerId);
      signal.removeEventListener('abort', onAbort);
      videoElement.loop = originalLoop;
      videoElement.muted = originalMuted;
      if (wasPaused) videoElement.pause();
      audioElement?.pause();
      audioElement?.remove();
      void audioContext?.close().catch(() => undefined);
      stream.getTracks().forEach((track) => track.stop());
    };
    
    recorder.onstop = () => {
      cleanup();
      if (cancelled) return;
      const blob = new Blob(chunks, { type: mimeType });
      resolve({ blob, mimeType, ext, audioIncluded });
    };

    recorder.onerror = (e) => {
      cleanup();
      reject(e);
    };

    const onAbort = () => {
      cancelled = true;
      cleanup();
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      reject(new Error('Export cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const drawLoop = () => {
      if (signal.aborted) return;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        onDrawFrame(ctx, videoElement);
      }

      const progress = Math.min(1, Math.max(0, (videoElement.currentTime - startTime) / duration));
      onProgress(progress);

      if (videoElement.ended || videoElement.currentTime >= endTime - 0.03) {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      } else {
        window.clearTimeout(stallTimerId);
        stallTimerId = window.setTimeout(() => {
          cancelled = true;
          cleanup();
          if (recorder.state !== 'inactive') recorder.stop();
          reject(stalledError('Video preparation stalled while reading frames.'));
        }, NO_PROGRESS_TIMEOUT_MS);
        animationFrameId = requestAnimationFrame(drawLoop);
      }
    };

    const start = async () => {
      try {
        videoElement.loop = false;
        if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          await new Promise<void>((res, rej) => {
            videoElement.addEventListener('loadeddata', () => res(), { once: true });
            videoElement.addEventListener('error', () => rej(new Error('The video could not be decoded.')), { once: true });
          });
        }
        if (Math.abs(videoElement.currentTime - startTime) > 0.01) {
          videoElement.currentTime = startTime;
          await waitForMediaEvent(videoElement, 'seeked', 'The video could not be decoded.', signal);
        }
        recorder.start(1000);
        recordingTimeoutId = window.setTimeout(() => {
          cancelled = true;
          cleanup();
          if (recorder.state !== 'inactive') recorder.stop();
          reject(new Error('Video recording took too long for the selected segment.'));
        }, Math.ceil(duration * 1600 + 3000));
        videoElement.muted = true;
        const audioPlayback = audioIncluded && audioElement
          ? (() => {
            audioElement.muted = true;
            return audioElement.play().then(() => {
              if (audioElement) audioElement.muted = false;
            });
          })()
          : Promise.resolve();
        await withTimeout(
          Promise.all([videoElement.play(), audioPlayback]).then(() => undefined),
          'Video preparation stalled before playback started.',
          signal,
        );
        stallTimerId = window.setTimeout(() => {
          cancelled = true;
          cleanup();
          if (recorder.state !== 'inactive') recorder.stop();
          reject(stalledError('Video preparation stalled while reading frames.'));
        }, NO_PROGRESS_TIMEOUT_MS);
        drawLoop();
      } catch (error) {
        cancelled = true;
        cleanup();
        if (recorder.state !== 'inactive') recorder.stop();
        reject(error);
      }
    };
    void start();
  });
}
