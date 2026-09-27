const THUMBNAIL_TIMEOUT_MS = 10_000;

function aborted() {
  return new DOMException('Thumbnail preparation was cancelled.', 'AbortError');
}

function waitForMedia(video: HTMLVideoElement, eventName: 'loadedmetadata' | 'loadeddata' | 'seeked', signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('The video could not be opened for a thumbnail.')); };
    const onAbort = () => { cleanup(); reject(aborted()); };
    if (signal?.aborted) return onAbort();
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(`The video thumbnail took too long to prepare (${eventName}).`));
    }, THUMBNAIL_TIMEOUT_MS);
  });
}

export function isMostlyBlackImage(pixels: Uint8ClampedArray): boolean {
  const count = pixels.length / 4;
  if (!count) return true;
  let bright = 0;
  let brightness = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const value = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    brightness += value;
    if (value > 36) bright++;
  }
  return bright / count < 0.015 && brightness / count < 22;
}

export async function isBlankVideoPoster(url: string, signal?: AbortSignal): Promise<boolean> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); image.src = ''; reject(aborted()); };
    if (signal?.aborted) return onAbort();
    image.onload = () => { cleanup(); resolve(); };
    image.onerror = () => { cleanup(); reject(new Error('The video thumbnail is unavailable.')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanup();
      image.src = '';
      reject(new Error('The video thumbnail did not load.'));
    }, THUMBNAIL_TIMEOUT_MS);
    image.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 18;
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return isMostlyBlackImage(context.getImageData(0, 0, canvas.width, canvas.height).data);
}

function canvasToJpeg(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); reject(aborted()); };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('The video thumbnail could not be encoded.'));
    }, THUMBNAIL_TIMEOUT_MS);
    canvas.toBlob((blob) => {
      cleanup();
      if (signal?.aborted) reject(aborted());
      else if (blob) resolve(blob);
      else reject(new Error('The video thumbnail could not be encoded.'));
    }, 'image/jpeg', 0.88);
  });
}

export async function captureVideoThumbnail(url: string, signal?: AbortSignal): Promise<Blob> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  try {
    const metadata = waitForMedia(video, 'loadedmetadata', signal);
    video.src = url;
    video.load();
    await metadata;
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('The posted video has no playable thumbnail frame.');
    }
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot create video thumbnails.');
    const times = [Math.min(0.8, video.duration * 0.3), Math.min(2, video.duration * 0.65)];
    for (const time of times) {
      if (signal?.aborted) throw aborted();
      const seeked = waitForMedia(video, 'seeked', signal);
      video.currentTime = Math.max(0.01, time);
      await seeked;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await waitForMedia(video, 'loadeddata', signal);
      }
      context.fillStyle = '#05070a';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const sample = document.createElement('canvas');
      sample.width = 32;
      sample.height = 18;
      const sampleContext = sample.getContext('2d');
      if (!sampleContext) break;
      sampleContext.drawImage(canvas, 0, 0, sample.width, sample.height);
      if (!isMostlyBlackImage(sampleContext.getImageData(0, 0, sample.width, sample.height).data)) break;
    }
    return await canvasToJpeg(canvas, signal);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}