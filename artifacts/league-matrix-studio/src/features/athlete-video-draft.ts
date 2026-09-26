export const ATHLETE_VIDEO_DRAFT_DB = 'leaguematrix-athlete-video-drafts';
export const ATHLETE_VIDEO_DRAFT_SOURCE_STORE = 'sources';
export const ATHLETE_VIDEO_DRAFT_DETAILS_STORE = 'details';

export type AthleteVideoDraftDetails = {
  fileName: string;
  fileType: string;
  lastModified: number;
  trimStart: number;
  trimEnd: number;
  mediaName: string;
};

export type AthleteVideoDraft = AthleteVideoDraftDetails & { blob: Blob };

export function saveAthleteVideoDraft(key: string, draft: AthleteVideoDraft): Promise<void> {
  return withDraftStore(ATHLETE_VIDEO_DRAFT_SOURCE_STORE, 'readwrite', (store) => store.put(draft.blob, key))
    .then(() => saveAthleteVideoDraftDetails(key, draft));
}

export function saveAthleteVideoDraftDetails(key: string, details: AthleteVideoDraftDetails): Promise<void> {
  return withDraftStore(ATHLETE_VIDEO_DRAFT_DETAILS_STORE, 'readwrite', (store) => store.put(details, key))
    .then(() => undefined);
}

export async function loadAthleteVideoDraft(key: string): Promise<AthleteVideoDraft | undefined> {
  const [blob, details] = await Promise.all([
    withDraftStore(ATHLETE_VIDEO_DRAFT_SOURCE_STORE, 'readonly', (store) => store.get(key)),
    withDraftStore(ATHLETE_VIDEO_DRAFT_DETAILS_STORE, 'readonly', (store) => store.get(key)),
  ]);
  return blob instanceof Blob && details ? { ...details, blob } : undefined;
}

export async function deleteAthleteVideoDraft(key: string): Promise<void> {
  await Promise.all([
    withDraftStore(ATHLETE_VIDEO_DRAFT_SOURCE_STORE, 'readwrite', (store) => store.delete(key)),
    withDraftStore(ATHLETE_VIDEO_DRAFT_DETAILS_STORE, 'readwrite', (store) => store.delete(key)),
  ]);
}

function withDraftStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  requestFor: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not support on-device video drafts.'));
      return;
    }
    const openRequest = indexedDB.open(ATHLETE_VIDEO_DRAFT_DB, 1);
    openRequest.onerror = () => reject(openRequest.error ?? new Error('The on-device video draft could not be opened.'));
    openRequest.onupgradeneeded = () => {
      if (!openRequest.result.objectStoreNames.contains(ATHLETE_VIDEO_DRAFT_SOURCE_STORE)) {
        openRequest.result.createObjectStore(ATHLETE_VIDEO_DRAFT_SOURCE_STORE);
      }
      if (!openRequest.result.objectStoreNames.contains(ATHLETE_VIDEO_DRAFT_DETAILS_STORE)) {
        openRequest.result.createObjectStore(ATHLETE_VIDEO_DRAFT_DETAILS_STORE);
      }
    };
    openRequest.onsuccess = () => {
      const db = openRequest.result;
      let request: IDBRequest<T>;
      try {
        const transaction = db.transaction(storeName, mode);
        request = requestFor(transaction.objectStore(storeName));
        request.onsuccess = () => {
          const result = request.result;
          transaction.oncomplete = () => {
            db.close();
            resolve(result);
          };
        };
        request.onerror = () => {
          db.close();
          reject(request.error ?? new Error('The on-device video draft could not be read.'));
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error ?? new Error('The on-device video draft could not be saved.'));
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error('The on-device video draft could not be saved.'));
        };
      } catch (error) {
        db.close();
        reject(error instanceof Error ? error : new Error('The on-device video draft could not be saved.'));
      }
    };
  });
}