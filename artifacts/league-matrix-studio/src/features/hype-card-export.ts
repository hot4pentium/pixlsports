import { checkExportSupport } from './hype-card-media';

export type ExportProgressCallback = (progress: number) => void;

export async function exportVideoCanvas(
  canvas: HTMLCanvasElement,
  videoElement: HTMLVideoElement,
  fps: number,
  onProgress: ExportProgressCallback,
  signal: AbortSignal,
  includeAudio: boolean,
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
  
  // Add audio track if requested and available
  if (includeAudio) {
    try {
      // @ts-ignore
      const audioStream = videoElement.captureStream ? videoElement.captureStream() : (videoElement.mozCaptureStream ? videoElement.mozCaptureStream() : null);
      if (audioStream) {
        const audioTracks = audioStream.getAudioTracks();
        if (audioTracks.length > 0) {
          stream.addTrack(audioTracks[0]);
          audioIncluded = true;
        }
      }
    } catch (err) {
      console.warn('Could not capture audio stream from video element', err);
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
    const duration = videoElement.duration && isFinite(videoElement.duration) ? videoElement.duration : 15;
    const originalLoop = videoElement.loop;
    const wasPaused = videoElement.paused;
    let cancelled = false;

    const cleanup = () => {
      cancelAnimationFrame(animationFrameId);
      videoElement.loop = originalLoop;
      if (wasPaused) videoElement.pause();
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

      const progress = Math.min(1, videoElement.currentTime / duration);
      onProgress(progress);

      if (videoElement.ended || videoElement.currentTime >= duration - 0.03) {
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
        if (videoElement.currentTime > 0.01) {
          videoElement.currentTime = 0;
          await new Promise<void>((res) => videoElement.addEventListener('seeked', () => res(), { once: true }));
        } else {
          videoElement.currentTime = 0;
        }
        recorder.start(1000);
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
