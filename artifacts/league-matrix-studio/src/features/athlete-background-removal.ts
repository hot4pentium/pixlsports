export function removeAthleteBackground(source: Blob, onStatus: (status: string) => void = () => {}): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./athlete-background-removal.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    const timeout = window.setTimeout(() => {
      finish(); reject(new Error('Background removal timed out. Your original photo is safe; retry or upload a transparent cutout.'));
    }, 180_000);
    worker.onmessage = (event: MessageEvent<{ status?: string; error?: string; blob?: Blob }>) => {
      if (event.data.status) onStatus(event.data.status);
      if (event.data.error) { finish(); reject(new Error(event.data.error)); }
      else if (event.data.blob) { finish(); resolve(event.data.blob); }
    };
    worker.onerror = () => { finish(); reject(new Error('Background removal is unavailable on this device. Retry or upload a transparent cutout.')); };
    worker.postMessage(source);
  });
}