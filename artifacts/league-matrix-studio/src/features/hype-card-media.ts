export const MEDIA_DB_NAME = 'leaguematrix-hype-media';
export const MEDIA_STORE_NAME = 'videos';

export type MediaUploadProgress = (loaded: number, total: number) => void;

function mediaUploadAbortError() {
  const error = new Error('The media upload was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function uploadMediaBlob(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
  options: {
    signal?: AbortSignal;
    onProgress?: MediaUploadProgress;
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      request.abort();
      settle(() => reject(mediaUploadAbortError()));
    };

    if (options.signal?.aborted) {
      settle(() => reject(mediaUploadAbortError()));
      return;
    }

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(Math.min(blob.size, event.loaded), blob.size);
      }
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.(blob.size, blob.size);
        settle(resolve);
      } else {
        settle(() => reject(new Error('The media upload could not be completed.')));
      }
    });
    request.addEventListener('error', () => {
      settle(() => reject(new Error('The media upload could not be completed.')));
    });
    request.addEventListener('abort', () => {
      settle(() => reject(mediaUploadAbortError()));
    });
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      request.open('PUT', uploadUrl);
      request.setRequestHeader('Content-Type', contentType);
      request.send(blob);
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error('The media upload could not be completed.')));
    }
  });
}

export async function saveMediaBlob(id: string, blob: Blob): Promise<void> {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE_NAME, 'readwrite');
    const store = tx.objectStore(MEDIA_STORE_NAME);
    store.put(blob, id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('Media save was aborted.'));
    };
  });
}

export async function loadMediaBlob(id: string): Promise<Blob | undefined> {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE_NAME, 'readonly');
    const store = tx.objectStore(MEDIA_STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      const result = request.result;
      db.close();
      resolve(result);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function deleteMediaBlob(id: string): Promise<void> {
  const db = await openMediaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE_NAME, 'readwrite');
    const store = tx.objectStore(MEDIA_STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('Media deletion was aborted.'));
    };
  });
}

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(MEDIA_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function checkVideoSupport(): boolean {
  if (typeof document === 'undefined') return false;
  const v = document.createElement('video');
  return v.canPlayType('video/mp4') !== '' || v.canPlayType('video/webm') !== '';
}

export function checkExportSupport(): { mp4Mime: string | null; webmMime: string | null } {
  if (typeof MediaRecorder === 'undefined') {
    return { mp4Mime: null, webmMime: null };
  }
  const mp4Candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ];
  const webmCandidates = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
  return {
    mp4Mime: mp4Candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null,
    webmMime: webmCandidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null,
  };
}
