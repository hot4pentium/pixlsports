import { checkExportSupport } from './hype-card-media';

export type ExportProgressCallback = (progress: number) => void;

export async function exportVideoCanvas(
  canvas: HTMLCanvasElement,
  videoElement: HTMLVideoElement,
  fps: number,
  onProgress: ExportProgressCallback,
  signal: AbortSignal,
  includeAudio: boolean,
  trimStart: number,
  trimEnd: number,
  onDrawFrame: (ctx: CanvasRenderingContext2D, videoFrame: HTMLVideoElement) => void
): Promise<{ blob: Blob; mimeType: string; ext: string; audioIncluded: boolean }> {
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
  let audioIncluded = false;
  const sourceDuration = videoElement.duration && isFinite(videoElement.duration) ? videoElement.duration : 15;
  const startTime = Math.max(0, Math.min(trimStart, sourceDuration));
  const endTime = Math.max(startTime + 0.1, Math.min(trimEnd, sourceDuration));
  let audioElement: HTMLVideoElement | null = null;
  let audioContext: AudioContext | null = null;
  
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
      await new Promise<void>((resolve, reject) => {
        audioElement?.addEventListener('loadedmetadata', () => resolve(), { once: true });
        audioElement?.addEventListener('error', () => reject(new Error('Audio could not be decoded.')), { once: true });
      });
      audioElement.currentTime = startTime;
      if (startTime > 0.01) {
        await new Promise<void>((resolve) => audioElement?.addEventListener('seeked', () => resolve(), { once: true }));
      }
      audioContext = new AudioContextConstructor();
      await audioContext.resume();
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
    }
  }

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  return new Promise((resolve, reject) => {
    let animationFrameId: number;
    const duration = endTime - startTime;
    const originalLoop = videoElement.loop;
    const wasPaused = videoElement.paused;
    let cancelled = false;

    const cleanup = () => {
      cancelAnimationFrame(animationFrameId);
      videoElement.loop = originalLoop;
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

    signal.addEventListener('abort', () => {
      cancelled = true;
      cleanup();
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      reject(new Error('Export cancelled'));
    });

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
          await new Promise<void>((res) => videoElement.addEventListener('seeked', () => res(), { once: true }));
        }
        recorder.start(1000);
        if (audioIncluded && audioElement) {
          await audioElement.play();
        }
        await videoElement.play();
        drawLoop();
      } catch (error) {
        cleanup();
        if (recorder.state !== 'inactive') recorder.stop();
        reject(error);
      }
    };
    void start();
  });
}
