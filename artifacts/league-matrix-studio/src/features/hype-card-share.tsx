import type { HypeCardProject } from './hype-card-types';
import { exportVideoCanvas } from './hype-card-export';

function seekVideo(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.02) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    video.addEventListener('seeked', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('The video could not be prepared.')), { once: true });
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
) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('The video is still loading. Try again in a moment.');
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
    await seekVideo(video, project.trimStart);
    drawContained(context, video, width, height);
    const poster = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create the poster image.')), 'image/jpeg', 0.88);
    });
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
    );
    return { video: clip.blob, videoContentType: clip.mimeType, poster };
  } finally {
    video.currentTime = originalTime;
    if (wasPaused) video.pause();
    else void video.play().catch(() => undefined);
  }
}
