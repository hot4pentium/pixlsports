import {
  useCreateChecklistShare,
  useGetChecklistShare,
  useUpdateChecklistShare,
} from '@workspace/api-client-react';
import { useUser } from '@clerk/react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Check, ClipboardCheck, Plus, Trash2 } from 'lucide-react';
import {
  applyChecklistEventType,
  completedChecklistCount,
  createGamedayChecklist,
  gamedayChecklistStorageKey,
  getChecklistEventCopy,
  normalizeChecklist,
  eventChecklistStorageKey,
  readEventChecklist,
  readGamedayChecklist,
  saveEventChecklist,
  saveGamedayChecklist,
  type LocalGamedayChecklist,
} from './gameday-checklist';
import { type WorkspaceEventContext } from './workspace-context';

type InlineSyncStatus = 'idle' | 'saving' | 'saved' | 'error';

type PendingSharedSync = {
  shareToken: string;
  revision: number;
  checklist: LocalGamedayChecklist;
};

function pendingSharedSyncStorageKey(userId: string, eventId: string) {
  return `${eventChecklistStorageKey(userId, eventId)}:pending-shared-sync`;
}

function readPendingSharedSync(userId: string, eventId: string): PendingSharedSync | null {
  try {
    const raw = window.localStorage.getItem(pendingSharedSyncStorageKey(userId, eventId));
    if (!raw) return null;
    const marker = JSON.parse(raw) as Partial<PendingSharedSync>;
    const checklist = normalizeChecklist(marker.checklist);
    if (
      typeof marker.shareToken !== 'string'
      || !marker.shareToken
      || !checklist?.shareToken
      || checklist.shareToken !== marker.shareToken
      || typeof marker.revision !== 'number'
    ) return null;
    return { shareToken: marker.shareToken, revision: marker.revision, checklist };
  } catch {
    return null;
  }
}

function loadEventChecklist(event: WorkspaceEventContext, userId: string): LocalGamedayChecklist {
  const eventChecklist = readEventChecklist(window.localStorage, userId, event.id);
  const pending = readPendingSharedSync(userId, event.id);
  const fullDraft = readGamedayChecklist(
    window.localStorage,
    `${gamedayChecklistStorageKey}:${encodeURIComponent(userId)}`,
  );
  const sharedEventDraft = fullDraft?.shareToken && fullDraft.selectedGame?.id === event.id
    ? fullDraft
    : null;
  const pendingChecklist = pending?.checklist.selectedGame?.id === event.id
    ? pending.checklist
    : null;
  const stored = pendingChecklist
    ?? sharedEventDraft
    ?? eventChecklist
    ?? (fullDraft?.selectedGame?.id === event.id ? fullDraft : null);
  let checklist = stored ?? createGamedayChecklist(event.type);
  if (stored && !stored.shareToken && (stored.selectedGame?.type ?? 'game') !== event.type) {
    checklist = applyChecklistEventType(stored, event.type);
  }
  return { ...checklist, selectedGame: event };
}

export function GameOnInlinePrepChecklist({
  event,
  userId,
  onClose,
}: {
  event: WorkspaceEventContext;
  userId?: string | null;
  onClose: () => void;
}) {
  const id = useId();
  const resolvedUserId = userId ?? 'anonymous';
  const [checklist, setChecklist] = useState(() => loadEventChecklist(event, resolvedUserId));
  const [initialPendingMarker] = useState(() => readPendingSharedSync(resolvedUserId, event.id));
  const initialPendingSync = Boolean(
    initialPendingMarker
    && initialPendingMarker.shareToken === checklist.shareToken
    && initialPendingMarker.checklist.selectedGame?.id === event.id,
  );
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [syncStatus, setSyncStatus] = useState<InlineSyncStatus>(initialPendingSync ? 'error' : 'idle');
  const [notice, setNotice] = useState(initialPendingSync
    ? 'A previous edit is still waiting to sync. Your local changes are preserved; retry to send them.'
    : '');
  const [shareUrl, setShareUrl] = useState('');
  const initialRevision = initialPendingSync
    ? initialPendingMarker?.revision ?? checklist.revision ?? 1
    : checklist.revision ?? 1;
  const [, setRevision] = useState(initialRevision);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const latestChecklist = useRef(checklist);
  const revisionRef = useRef(initialRevision);
  const pendingChanges = useRef(initialPendingSync);
  const changeNumber = useRef(initialPendingSync ? 1 : 0);
  const saveQueue = useRef(Promise.resolve());
  const saveTimer = useRef<number | null>(null);
  const { isSignedIn } = useUser();
  const [, setLocation] = useLocation();
  const createShare = useCreateChecklistShare();
  const updateShare = useUpdateChecklistShare();
  const eventCopy = getChecklistEventCopy(event.type);
  const completed = completedChecklistCount(checklist.items);
  const percent = checklist.items.length === 0 ? 0 : Math.round((completed / checklist.items.length) * 100);
  const eventTitle = event.type === 'practice'
    ? 'Practice prep'
    : event.opponent
      ? `Game vs ${event.opponent}`
      : 'Game day prep';
  const userStorageKey = `${gamedayChecklistStorageKey}:${encodeURIComponent(resolvedUserId)}`;
  const pendingStorageKey = pendingSharedSyncStorageKey(resolvedUserId, event.id);
  const activeShareToken = checklist.shareToken;
  const {
    data: sharedChecklist,
    isError: sharedError,
    refetch: refetchSharedChecklist,
  } = useGetChecklistShare(activeShareToken ?? '', {
    query: {
      enabled: Boolean(activeShareToken),
      retry: false,
      queryKey: ['/api/checklist-shares', activeShareToken],
    },
  });
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const appOrigin = ['pixlsports.com', 'www.pixlsports.com'].includes(window.location.hostname.toLowerCase())
    ? 'https://pixlsports.com'
    : window.location.origin;

  useLayoutEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    latestChecklist.current = checklist;
  }, [checklist]);

  useEffect(() => {
    if (!activeShareToken || !sharedChecklist) return;
    if (pendingChanges.current) {
      // Rebase a deliberate retry on the latest server revision without replacing local edits.
      if (sharedChecklist.revision > revisionRef.current) {
        setRevision(sharedChecklist.revision);
        revisionRef.current = sharedChecklist.revision;
      }
      return;
    }
    const normalized = normalizeChecklist(sharedChecklist);
    if (!normalized || sharedChecklist.revision < revisionRef.current) return;
    const next = {
      ...normalized,
      shareToken: sharedChecklist.shareToken,
      revision: sharedChecklist.revision,
    };
    latestChecklist.current = next;
    setChecklist(next);
    setRevision(sharedChecklist.revision);
    revisionRef.current = sharedChecklist.revision;
  }, [activeShareToken, sharedChecklist]);

  useEffect(() => {
    if (!activeShareToken || typeof window.EventSource === 'undefined') return;
    let active = true;
    const source = new EventSource(`${basePath}/api/checklist-shares/${encodeURIComponent(activeShareToken)}/events`);
    const applyLiveChecklist = (raw: unknown) => {
      if (typeof raw !== 'object' || raw === null || pendingChanges.current) return;
      const payload = raw as { revision?: unknown; shareToken?: unknown };
      if (typeof payload.revision !== 'number' || !Number.isInteger(payload.revision) || payload.revision <= revisionRef.current) return;
      const normalized = normalizeChecklist(raw);
      if (!normalized) return;
      const next = {
        ...normalized,
        shareToken: activeShareToken,
        revision: payload.revision,
      };
      latestChecklist.current = next;
      setChecklist(next);
      setRevision(payload.revision);
      revisionRef.current = payload.revision;
    };
    const handleChecklistEvent = (event: Event) => {
      try {
        applyLiveChecklist(JSON.parse((event as MessageEvent<string>).data));
      } catch {
        // The next reconnect or fetch will rehydrate from the API.
      }
    };
    source.onopen = () => {
      if (active) void refetchSharedChecklist();
    };
    source.addEventListener('checklist', handleChecklistEvent);
    source.addEventListener('revoked', () => {
      source.close();
      void refetchSharedChecklist();
    });
    source.onerror = () => {
      if (active) setNotice('Live updates disconnected. The shared checklist will reconnect automatically.');
    };
    return () => {
      active = false;
      source.removeEventListener('checklist', handleChecklistEvent);
      source.close();
    };
  }, [activeShareToken, basePath, refetchSharedChecklist]);

  const persistLocal = (next: LocalGamedayChecklist) => {
    try {
      saveEventChecklist(window.localStorage, resolvedUserId, event.id, next);
      const sharedDraft = window.localStorage.getItem(userStorageKey);
      const parsedDraft = sharedDraft ? JSON.parse(sharedDraft) : null;
      if (next.shareToken) {
        // The per-event entry is authoritative; never replace another full-editor share.
        if (parsedDraft?.shareToken === next.shareToken) saveGamedayChecklist(window.localStorage, next, userStorageKey);
      } else if (!parsedDraft?.shareToken) {
        saveGamedayChecklist(window.localStorage, next, userStorageKey);
      }
      setStorageUnavailable(false);
    } catch {
      setStorageUnavailable(true);
    }
  };

  useEffect(() => {
    persistLocal(checklist);
  }, [checklist, event.id, resolvedUserId, userStorageKey]);

  useEffect(() => {
    if (checklist.shareToken) {
      setShareUrl(`${appOrigin}${basePath}/checklist/${checklist.shareToken}`);
    } else {
      setShareUrl('');
    }
  }, [checklist.shareToken, appOrigin, basePath]);

  const persistShared = (next: LocalGamedayChecklist) => {
    const token = next.shareToken;
    if (!token) return;
    const savedChangeNumber = changeNumber.current;
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const savedShare = await updateShare.mutateAsync({
          shareToken: token,
          data: {
            title: next.title.trim() || 'Gameday Checklist',
            notes: next.notes ?? '',
            mode: next.mode,
            items: next.items,
            selectedGame: next.selectedGame ?? null,
            expectedRevision: revisionRef.current,
          },
        });
        setRevision(savedShare.revision);
        revisionRef.current = savedShare.revision;
        latestChecklist.current = { ...latestChecklist.current, revision: savedShare.revision };
        setChecklist((current) => ({ ...current, revision: savedShare.revision }));
        pendingChanges.current = changeNumber.current !== savedChangeNumber;
        if (!pendingChanges.current) {
          try {
            window.localStorage.removeItem(pendingStorageKey);
          } catch {
            setStorageUnavailable(true);
          }
          setSyncStatus('saved');
        }
      } catch (error: any) {
        pendingChanges.current = true;
        setSyncStatus('error');
        if (error?.status === 409) {
          const currentRevision = error?.data?.current?.revision;
          if (typeof currentRevision === 'number') {
            setRevision(currentRevision);
            revisionRef.current = currentRevision;
          }
          setNotice('Another edit was saved first. Your changes are still here; retry to replace the shared version.');
        } else if (error?.status === 404) {
          setNotice('This edit link was revoked. Your changes remain here; ask the owner for a new link.');
        } else {
          setNotice('Shared save failed. Your changes remain visible here; retry to send them again.');
        }
      }
    });
  };

  const markPendingSharedSync = (next: LocalGamedayChecklist) => {
    if (!next.shareToken) return;
    try {
      window.localStorage.setItem(pendingStorageKey, JSON.stringify({
        shareToken: next.shareToken,
        revision: revisionRef.current,
        checklist: next,
      } satisfies PendingSharedSync));
    } catch {
      setStorageUnavailable(true);
    }
  };

  const updateChecklist = (next: LocalGamedayChecklist) => {
    latestChecklist.current = next;
    setChecklist(next);
    if (next.shareToken) {
      changeNumber.current += 1;
      pendingChanges.current = true;
      setSyncStatus('saving');
      // Persist the recovery snapshot synchronously so closing the card cannot lose queued edits.
      persistLocal(next);
      markPendingSharedSync(next);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        persistShared(latestChecklist.current);
      }, 350);
    }
  };

  const retrySharedSave = () => {
    if (!latestChecklist.current.shareToken) return;
    setSyncStatus('saving');
    pendingChanges.current = true;
    persistShared(latestChecklist.current);
  };

  useEffect(() => {
    return () => {
      const hasScheduledSave = saveTimer.current !== null;
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (hasScheduledSave && pendingChanges.current && latestChecklist.current.shareToken) {
        // Fire the queued owner update before the inline card unmounts.
        persistShared(latestChecklist.current);
      }
    };
  }, []);

  const updateItem = (itemId: string, patch: { label?: string; completed?: boolean }) => {
    updateChecklist({
      ...latestChecklist.current,
      items: latestChecklist.current.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
    });
  };

  const addItem = () => {
    if (latestChecklist.current.items.length >= 100) {
      setNotice('This checklist already has the maximum of 100 items.');
      return;
    }
    const item = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: 'New prep item',
      completed: false,
      section: null,
    };
    updateChecklist({ ...latestChecklist.current, items: [...latestChecklist.current.items, item] });
  };

  const createOrCopyEditLink = async () => {
    if (!isSignedIn) {
      setLocation(`/sign-in?redirect_url=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (latestChecklist.current.shareToken) {
      await copyEditLink();
      return;
    }
    try {
      const created = await createShare.mutateAsync({
        data: {
          title: latestChecklist.current.title.trim() || 'Gameday Checklist',
          notes: latestChecklist.current.notes ?? '',
          mode: latestChecklist.current.mode,
          items: latestChecklist.current.items,
          selectedGame: latestChecklist.current.selectedGame ?? null,
        },
      });
      const next = { ...latestChecklist.current, shareToken: created.shareToken, revision: created.revision };
      latestChecklist.current = next;
      revisionRef.current = created.revision;
      persistLocal(next);
      setChecklist(next);
      const url = `${appOrigin}${basePath}/checklist/${created.shareToken}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setNotice('Edit link created and copied. Checklist notes are shared with collaborators.');
      } catch {
        setNotice('Edit link created. Copy the link below to share; checklist notes are shared with collaborators.');
      }
    } catch {
      setNotice('Could not create the edit link. Sign in and try again.');
    }
  };

  const copyEditLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice('Edit link copied. Checklist notes are shared with collaborators.');
    } catch {
      setNotice('Clipboard unavailable. Select and copy the edit link below.');
    }
  };

  return (
    <section className="game-on-prep" aria-labelledby={`${id}-heading`} data-testid={`game-on-inline-prep-${event.id}`}>
      <button
        type="button"
        className="game-on-collection__back-button"
        onClick={onClose}
        disabled={createShare.isPending}
        data-testid={`button-close-card-prep-${event.id}`}
      >
        <ArrowLeft size={15} aria-hidden="true" /> Back to badge
      </button>
      <div className="game-on-prep__heading">
        <p className="game-on-prep__eyebrow"><ClipboardCheck size={14} aria-hidden="true" /> {event.type === 'practice' ? 'Practice Prep' : 'Game Day Prep'}</p>
        <h2 ref={headingRef} id={`${id}-heading`} tabIndex={-1} className="game-on-prep__title">{eventTitle}</h2>
        <p className="game-on-prep__event">
          {[event.date, event.time, event.location].filter(Boolean).join(' · ') || 'Event details to be determined'}
        </p>
      </div>

      <div className="game-on-prep__progress" role="group" aria-label={`${completed} of ${checklist.items.length} prep items complete`}>
        <div className="game-on-prep__progress-label">
          <span>Prep progress</span>
          <span>{completed}/{checklist.items.length}</span>
        </div>
        <div className="game-on-prep__progress-track" aria-hidden="true">
          <div className="game-on-prep__progress-value" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <label className="game-on-prep__field">
        <span>Checklist title</span>
        <input
          type="text"
          value={checklist.title}
          maxLength={120}
          disabled={createShare.isPending}
          onChange={(inputEvent) => updateChecklist({ ...latestChecklist.current, title: inputEvent.target.value })}
          aria-label="Checklist title"
          data-testid={`input-card-prep-title-${event.id}`}
        />
      </label>

      <div className="game-on-prep__items" role="group" aria-label={`${eventCopy.hubLabel} items`}>
        {checklist.items.map((item) => (
          <div key={item.id} className={`game-on-prep__item${item.completed ? ' is-complete' : ''}`}>
            <label className="game-on-prep__item-toggle">
              <input
                type="checkbox"
                checked={item.completed}
                disabled={createShare.isPending}
                onChange={() => updateItem(item.id, { completed: !item.completed })}
                aria-label={`${item.completed ? 'Mark incomplete' : 'Mark complete'}: ${item.label}`}
                data-testid={`checkbox-card-prep-${event.id}-${item.id}`}
              />
              <span className="game-on-prep__check" aria-hidden="true"><Check size={14} /></span>
            </label>
            <input
              className="game-on-prep__item-edit"
              type="text"
              value={item.label}
              maxLength={160}
              disabled={createShare.isPending}
              onChange={(inputEvent) => updateItem(item.id, { label: inputEvent.target.value })}
              aria-label={`Edit prep item: ${item.label}`}
              data-testid={`input-card-prep-item-${event.id}-${item.id}`}
            />
            <button
              type="button"
              className="game-on-prep__remove"
              disabled={createShare.isPending}
              onClick={() => updateChecklist({
                ...latestChecklist.current,
                items: latestChecklist.current.items.filter((candidate) => candidate.id !== item.id),
              })}
              aria-label={`Remove prep item: ${item.label}`}
              data-testid={`button-remove-card-prep-item-${event.id}-${item.id}`}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
        {checklist.items.length === 0 && (
          <p className="game-on-prep__empty">No prep items yet. Add one to get started.</p>
        )}
      </div>
      <button type="button" className="game-on-prep__add" onClick={addItem} disabled={createShare.isPending} data-testid={`button-add-card-prep-item-${event.id}`}>
        <Plus size={14} aria-hidden="true" /> Add prep item
      </button>

      <label className="game-on-prep__field">
        <span>
          {checklist.shareToken ? 'Notes shared with collaborators' : 'Private notes'}
          <small>{checklist.shareToken
            ? 'Edits to these notes sync to everyone using this edit link.'
            : 'Notes are shared only after you deliberately create an edit link.'}</small>
        </span>
        <textarea
          value={checklist.notes ?? ''}
          maxLength={2000}
          rows={3}
          disabled={createShare.isPending}
          onChange={(inputEvent) => updateChecklist({ ...latestChecklist.current, notes: inputEvent.target.value })}
          aria-label="Prep notes"
          data-testid={`textarea-card-prep-notes-${event.id}`}
        />
      </label>

      <p className="game-on-prep__save-status" role="status" aria-live="polite" aria-atomic="true">
        {storageUnavailable
          ? 'This browser is blocking storage. Prep changes will not be recovered after reload.'
          : syncStatus === 'saving'
            ? 'Saving checklist changes to collaborators…'
            : syncStatus === 'error'
              ? 'Shared checklist sync failed. Your edits remain here; retry to send them again.'
              : sharedError && checklist.shareToken
                ? 'Could not load the shared checklist. Local changes are not being used to replace it.'
                : syncStatus === 'saved'
                  ? 'Changes saved locally and synced to collaborators.'
                  : `${completed} of ${checklist.items.length} items complete. Progress saves on this device.`}
      </p>
      {syncStatus === 'error' && (
        <button type="button" className="game-on-prep__retry" onClick={retrySharedSave} data-testid={`button-retry-card-prep-sync-${event.id}`}>
          Retry shared sync
        </button>
      )}
      {notice && <p className="game-on-prep__notice" role="status">{notice}</p>}
      <button
        type="button"
        className="game-on-prep__share"
        onClick={() => { void createOrCopyEditLink(); }}
        disabled={createShare.isPending}
        data-testid={`button-card-prep-edit-link-${event.id}`}
      >
        {createShare.isPending ? 'Creating edit link…' : checklist.shareToken ? 'Copy edit link' : 'Create edit link'}
      </button>
      {shareUrl && (
        <label className="game-on-prep__share-url">
          <span>Collaborative edit link</span>
          <input type="url" readOnly value={shareUrl} onFocus={(inputEvent) => inputEvent.currentTarget.select()} aria-label="Collaborative edit link" />
        </label>
      )}

    </section>
  );
}