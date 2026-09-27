import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useGetChecklistShare, useUpdateChecklistShare } from '@workspace/api-client-react';
import {
  normalizeChecklist,
  readEventChecklist,
  readGamedayChecklist,
  saveEventChecklist,
  saveGamedayChecklist,
  type LocalGamedayChecklist,
} from './gameday-checklist';

export type ChecklistSyncStatus = 'idle' | 'saving' | 'saved' | 'error';

export function readChecklistForEvent(
  storage: Storage,
  userStorageKey: string,
  userId: string,
  requestedId: string,
) {
  const globalChecklist = readGamedayChecklist(storage, userStorageKey);
  return requestedId
    ? readEventChecklist(storage, userId, requestedId)
      ?? (globalChecklist?.selectedGame?.id === requestedId ? globalChecklist : null)
    : globalChecklist;
}

type ChecklistSaveOptions = {
  shared: boolean;
  shareToken: string;
  activeShareToken: string | undefined;
  userId: string;
  userStorageKey: string;
  appOrigin: string;
  basePath: string;
  latestChecklist: MutableRefObject<LocalGamedayChecklist>;
  revisionRef: MutableRefObject<number>;
  setChecklist: Dispatch<SetStateAction<LocalGamedayChecklist>>;
  setRevision: Dispatch<SetStateAction<number>>;
  setHydrated: Dispatch<SetStateAction<boolean>>;
  setShareUrl: Dispatch<SetStateAction<string>>;
  setStorageUnavailable: Dispatch<SetStateAction<boolean>>;
  setSyncStatus: Dispatch<SetStateAction<ChecklistSyncStatus>>;
  onNotice: (message: string) => void;
};

/**
 * Keeps device saves, incoming shared updates, and the serialized save queue
 * together so remote snapshots cannot replace edits that are still pending.
 */
export function useChecklistSave({
  shared,
  shareToken,
  activeShareToken,
  userId,
  userStorageKey,
  appOrigin,
  basePath,
  latestChecklist,
  revisionRef,
  setChecklist,
  setRevision,
  setHydrated,
  setShareUrl,
  setStorageUnavailable,
  setSyncStatus,
  onNotice,
}: ChecklistSaveOptions) {
  const updateShare = useUpdateChecklistShare();
  const saveTimer = useRef<number | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const pendingChanges = useRef(false);
  const changeNumber = useRef(0);
  const [liveStatus, setLiveStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const {
    data: sharedChecklist,
    isLoading: sharedLoading,
    isError: sharedError,
    refetch: refetchSharedChecklist,
  } = useGetChecklistShare(activeShareToken ?? '', {
    query: {
      enabled: Boolean(activeShareToken),
      retry: false,
      queryKey: ['/api/checklist-shares', activeShareToken],
    },
  });

  useEffect(() => {
    if (!sharedChecklist) return;
    if (pendingChanges.current) return;
    const normalized = normalizeChecklist(sharedChecklist);
    if (!normalized) return;
    if (sharedChecklist.revision < revisionRef.current) return;
    const next = { ...normalized, shareToken: sharedChecklist.shareToken, revision: sharedChecklist.revision };
    latestChecklist.current = next;
    setChecklist(next);
    if (!shared) {
      try {
        saveGamedayChecklist(window.localStorage, next, userStorageKey);
        setStorageUnavailable(false);
      } catch {
        setStorageUnavailable(true);
      }
    }
    setRevision(sharedChecklist.revision);
    revisionRef.current = sharedChecklist.revision;
    setShareUrl(`${appOrigin}${basePath}/checklist/${sharedChecklist.shareToken}`);
    setHydrated(true);
  }, [sharedChecklist, shared, userStorageKey]);

  useEffect(() => {
    if (!activeShareToken) return;
    setLiveStatus('connecting');
    if (typeof window.EventSource === 'undefined') {
      setLiveStatus('reconnecting');
      return;
    }

    let active = true;
    const source = new EventSource(`${basePath}/api/checklist-shares/${encodeURIComponent(activeShareToken)}/events`);
    const applyLiveChecklist = (raw: unknown) => {
      if (typeof raw !== 'object' || raw === null) return;
      if (pendingChanges.current) return;
      const payload = raw as { revision?: unknown };
      if (typeof payload.revision !== 'number' || !Number.isInteger(payload.revision) || payload.revision <= revisionRef.current) return;
      const normalized = normalizeChecklist(raw);
      if (!normalized) return;
      const next = { ...normalized, shareToken: activeShareToken, revision: payload.revision };
      latestChecklist.current = next;
      setChecklist(next);
      if (!shared) {
        try {
          saveGamedayChecklist(window.localStorage, next, userStorageKey);
          setStorageUnavailable(false);
        } catch {
          setStorageUnavailable(true);
        }
      }
      setRevision(payload.revision);
      revisionRef.current = payload.revision;
      setHydrated(true);
    };

    source.onopen = () => {
      if (!active) return;
      setLiveStatus('connected');
      void refetchSharedChecklist();
    };
    const handleChecklistEvent = (event: Event) => {
      try {
        applyLiveChecklist(JSON.parse((event as MessageEvent<string>).data));
      } catch {
        // Ignore malformed events; the next reconnect rehydrates from the API.
      }
    };
    source.addEventListener('checklist', handleChecklistEvent);
    source.addEventListener('revoked', () => {
      source.close();
      void refetchSharedChecklist();
    });
    source.onerror = () => {
      if (!active) return;
      setLiveStatus('reconnecting');
    };

    return () => {
      active = false;
      source.removeEventListener('checklist', handleChecklistEvent);
      source.close();
    };
  }, [shared, activeShareToken, refetchSharedChecklist, userStorageKey]);

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
  }, []);

  const persistLocal = (next: LocalGamedayChecklist) => {
    if (shared) return;
    try {
      saveGamedayChecklist(window.localStorage, next, userStorageKey);
      if (next.selectedGame?.id && !next.shareToken) {
        saveEventChecklist(window.localStorage, userId, next.selectedGame.id, next);
      }
      setStorageUnavailable(false);
    } catch {
      setStorageUnavailable(true);
    }
  };

  const persistShared = (next: LocalGamedayChecklist) => {
    const token = shared ? shareToken : next.shareToken;
    if (!token) return;
    const savedChangeNumber = changeNumber.current;
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const savedShare = await updateShare.mutateAsync({ shareToken: token, data: {
          title: next.title.trim() || 'Gameday Checklist',
          notes: next.notes ?? '',
          mode: next.mode,
          items: next.items,
          selectedGame: next.selectedGame ?? null,
          expectedRevision: revisionRef.current,
        } });
        setRevision(savedShare.revision);
        revisionRef.current = savedShare.revision;
        setChecklist((current) => ({ ...current, revision: savedShare.revision }));
        latestChecklist.current = { ...latestChecklist.current, revision: savedShare.revision };
        if (!shared) persistLocal(latestChecklist.current);
        pendingChanges.current = changeNumber.current !== savedChangeNumber;
        if (!pendingChanges.current) setSyncStatus('saved');
      } catch (error: any) {
        pendingChanges.current = true;
        setSyncStatus('error');
        if (error?.status === 409 && error?.data?.current) {
          setRevision(error.data.current.revision);
          revisionRef.current = error.data.current.revision;
          onNotice('ANOTHER EDIT WAS SAVED FIRST — YOUR CHANGES ARE HERE; RETRY WILL REPLACE THE SHARED VERSION');
        } else if (error?.status === 404) {
          onNotice('THIS EDIT LINK WAS REVOKED — ASK THE OWNER FOR A NEW LINK');
        } else {
          onNotice('SHARED SAVE FAILED — YOUR CHANGES ARE STILL VISIBLE HERE; TRY AGAIN');
        }
      }
    });
  };

  const updateChecklist = (next: LocalGamedayChecklist) => {
    latestChecklist.current = next;
    setChecklist(next);
    persistLocal(next);
    if (shared || next.shareToken) {
      changeNumber.current += 1;
      pendingChanges.current = true;
      setSyncStatus('saving');
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => persistShared(latestChecklist.current), 350);
    }
  };

  const retrySharedSave = () => {
    setSyncStatus('saving');
    pendingChanges.current = true;
    persistShared(latestChecklist.current);
  };

  return {
    updateShare,
    sharedChecklist,
    sharedLoading,
    sharedError,
    liveStatus,
    persistLocal,
    updateChecklist,
    retrySharedSave,
  };
}