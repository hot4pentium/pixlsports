import { checkExportSupport } from './hype-card-media';

export type TranscodeProgressCallback = (progress: number) => void;

function waitForSeek(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error('The video could not be decoded.'));
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

export async function transcodeVideoToMp4(
  source: File,
  onProgress: TranscodeProgressCallback,
): Promise<Blob> {
  const support = checkExportSupport();
  if (!support.mp4Mime) {
    throw new Error('This browser cannot create a smaller MP4. The original clip will be kept locally.');
  }

  const sourceUrl = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = sourceUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('This browser cannot decode that video.')), { once: true });
    });

    const scale = Math.min(1, 1280 / Math.max(video.videoWidth || 1280, video.videoHeight || 720));
    const width = Math.max(2, Math.floor((video.videoWidth || 1280) * scale / 2) * 2);
    const height = Math.max(2, Math.floor((video.videoHeight || 720) * scale / 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a video conversion canvas.');

    const stream = canvas.captureStream(30);
    let audioStream: MediaStream | null = null;
    let audioElement: HTMLVideoElement | null = null;
    let audioContext: AudioContext | null = null;
    try {
      const AudioContextConstructor = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) throw new Error('Web Audio is unavailable.');
      audioElement = document.createElement('video');
      audioElement.preload = 'auto';
      audioElement.playsInline = true;
      audioElement.muted = false;
      audioElement.src = sourceUrl;
      await new Promise<void>((resolve, reject) => {
        audioElement?.addEventListener('loadedmetadata', () => resolve(), { once: true });
        audioElement?.addEventListener('error', () => reject(new Error('Audio could not be decoded.')), { once: true });
      });
      audioContext = new AudioContextConstructor();
      await audioContext.resume();
      const audioSource = audioContext.createMediaElementSource(audioElement);
      const audioDestination = audioContext.createMediaStreamDestination();
      audioSource.connect(audioDestination);
      audioStream = audioDestination.stream;
      audioStream.getAudioTracks().forEach((track) => stream.addTrack(track));
    } catch (error) {
      console.warn('Could not preserve clip audio while preparing MP4', error);
      audioStream = null;
      audioElement?.remove();
      audioElement = null;
      await audioContext?.close().catch(() => undefined);
      audioContext = null;
      throw error;
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: support.mp4Mime,
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks: Blob[] = [];

    const result = await new Promise<Blob>((resolve, reject) => {
      let animationFrame = 0;
      let settled = false;
      const cleanup = () => {
        cancelAnimationFrame(animationFrame);
        stream.getTracks().forEach((track) => track.stop());
        audioStream?.getTracks().forEach((track) => track.stop());
        audioElement?.pause();
        audioElement?.remove();
        void audioContext?.close().catch(() => undefined);
        video.pause();
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else {
          const output = new Blob(chunks, { type: support.mp4Mime ?? 'video/mp4' });
          if (output.size === 0) reject(new Error('The browser created an empty MP4.'));
          else resolve(output);
        }
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => finish(new Error('The browser could not create a smaller MP4.'));
      recorder.onstop = () => finish();

      const draw = () => {
        if (settled) return;
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        if (video.ended || (duration > 0 && video.currentTime >= duration - 0.03)) {
          onProgress(1);
          video.pause();
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        context.drawImage(video, 0, 0, width, height);
        onProgress(video.duration ? video.currentTime / video.duration : 0);
        animationFrame = requestAnimationFrame(draw);
      };

      void (async () => {
        try {
          if (video.currentTime > 0.01) {
            video.currentTime = 0;
            await waitForSeek(video);
          }
          recorder.start(1000);
          await Promise.all([
            video.play(),
            audioElement?.play(),
          ]);
          draw();
        } catch (error) {
          if (recorder.state !== 'inactive') recorder.stop();
          finish(error instanceof Error ? error : new Error('The video could not be converted.'));
        }
      })();
    });

    onProgress(1);
    return result;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}