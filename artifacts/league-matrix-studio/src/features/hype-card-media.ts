export const MEDIA_DB_NAME = 'leaguematrix-hype-media';
export const MEDIA_STORE_NAME = 'videos';

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
