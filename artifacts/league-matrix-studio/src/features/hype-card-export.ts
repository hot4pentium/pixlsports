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

export function audioCaptureUnavailableError(message = AUDIO_CAPTURE_UNAVAILABLE_MESSAGE): Error {
  const error = new Error(message);
  error.name = 'AudioCaptureUnavailable';
  return error;
}

const MEDIA_READY_TIMEOUT_MS = 10_000;
const PLAYBACK_START_TIMEOUT_MS = 8_000;
const NO_PROGRESS_TIMEOUT_MS = 8_000;
const AUDIO_SAMPLE_CHECK_TIMEOUT_MS = 2_500;
const AUDIO_SAMPLE_THRESHOLD = 0.00001;

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

export function audioSamplesContainSignal(samples: ArrayLike<number>): boolean {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0));
  }
  return peak > AUDIO_SAMPLE_THRESHOLD;
}

/**
 * Checks the recorded blob itself rather than trusting MediaStreamTrack presence.
 * Safari can expose an audio track while its MediaRecorder output contains only
 * zero-valued samples.
 */
export async function hasAudibleAudioSamples(blob: Blob, signal?: AbortSignal): Promise<boolean> {
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Web Audio is unavailable.');
  const checkSignal = signal ?? new AbortController().signal;

  const url = URL.createObjectURL(blob);
  const audio = document.createElement('video');
  audio.preload = 'auto';
  audio.playsInline = true;
  audio.muted = true;
  audio.src = url;
  audio.load();
  let audioContext: AudioContext | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let gain: GainNode | null = null;

  try {
    await waitForMediaEvent(audio, 'loadedmetadata', 'Audio could not be checked.', checkSignal);
    audioContext = new AudioContextConstructor();
    await withTimeout(
      audioContext.resume(),
      'Video preparation stalled while checking audio.',
      checkSignal,
    );
    source = audioContext.createMediaElementSource(audio);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    gain = audioContext.createGain();
    gain.gain.value = 0;
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(audioContext.destination);

    // Start muted to satisfy Safari's media policy, then inspect the decoded
    // stream after unmuting. The analyser is routed through a zero-gain node,
    // so this never plays the check clip aloud.
    await withTimeout(audio.play(), 'Video preparation stalled while checking audio.', checkSignal);
    audio.muted = false;
    const samples = new Float32Array(analyser.fftSize);
    const deadline = Date.now() + AUDIO_SAMPLE_CHECK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw abortError();
      analyser.getFloatTimeDomainData(samples);
      if (audioSamplesContainSignal(samples)) return true;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
    return false;
  } finally {
    source?.disconnect();
    analyser?.disconnect();
    gain?.disconnect();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio.remove();
    void audioContext?.close().catch(() => undefined);
    URL.revokeObjectURL(url);
  }
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
      void (async () => {
        let verifiedAudio = audioIncluded;
        if (includeAudio) {
          try {
            verifiedAudio = await hasAudibleAudioSamples(blob, signal);
          } catch (error) {
            if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
              reject(error);
              return;
            }
            verifiedAudio = false;
          }
        }
        if (requireAudio && !verifiedAudio) {
          reject(audioCaptureUnavailableError());
          return;
        }
        resolve({ blob, mimeType, ext, audioIncluded: verifiedAudio });
      })();
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
