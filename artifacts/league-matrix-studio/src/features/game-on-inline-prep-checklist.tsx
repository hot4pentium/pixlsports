import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Check, ClipboardCheck } from 'lucide-react';
import {
  applyChecklistEventType,
  completedChecklistCount,
  createGamedayChecklist,
  gamedayChecklistStorageKey,
  getChecklistEventCopy,
  readEventChecklist,
  saveEventChecklist,
  saveGamedayChecklist,
  type LocalGamedayChecklist,
} from './gameday-checklist';
import { buildWorkspaceToolHref, type WorkspaceEventContext } from './workspace-context';

function loadEventChecklist(event: WorkspaceEventContext, userId: string): LocalGamedayChecklist {
  const stored = readEventChecklist(window.localStorage, userId, event.id);
  let checklist = stored ?? createGamedayChecklist(event.type);
  if (stored && (stored.selectedGame?.type ?? 'game') !== event.type) {
    checklist = applyChecklistEventType(stored, event.type);
  }
  const { shareToken: _shareToken, revision: _revision, ...privateChecklist } = checklist;
  return { ...privateChecklist, selectedGame: event };
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
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const eventCopy = getChecklistEventCopy(event.type);
  const completed = completedChecklistCount(checklist.items);
  const percent = checklist.items.length === 0 ? 0 : Math.round((completed / checklist.items.length) * 100);
  const eventTitle = event.type === 'practice'
    ? 'Practice prep'
    : event.opponent
      ? `Game vs ${event.opponent}`
      : 'Game day prep';
  const prepHref = buildWorkspaceToolHref('prep', event);

  useLayoutEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      saveEventChecklist(window.localStorage, resolvedUserId, event.id, checklist);
      // Keep the full Prep editor in sync unless its current draft is a shared checklist.
      const sharedDraft = window.localStorage.getItem(
        `${gamedayChecklistStorageKey}:${encodeURIComponent(resolvedUserId)}`,
      );
      if (!sharedDraft || !JSON.parse(sharedDraft)?.shareToken) {
        saveGamedayChecklist(
          window.localStorage,
          checklist,
          `${gamedayChecklistStorageKey}:${encodeURIComponent(resolvedUserId)}`,
        );
      }
      setStorageUnavailable(false);
    } catch {
      setStorageUnavailable(true);
    }
  }, [checklist, event.id, resolvedUserId]);

  return (
    <section className="game-on-prep" aria-labelledby={`${id}-heading`} data-testid={`game-on-inline-prep-${event.id}`}>
      <button
        type="button"
        className="game-on-collection__back-button"
        onClick={onClose}
        data-testid={`button-close-card-prep-${event.id}`}
      >
        <ArrowLeft size={15} aria-hidden="true" /> Back to Game On card
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

      <div className="game-on-prep__items" role="group" aria-label={`${eventCopy.hubLabel} items`}>
        {checklist.items.map((item) => (
          <label key={item.id} className={`game-on-prep__item${item.completed ? ' is-complete' : ''}`}>
            <input
              type="checkbox"
              checked={item.completed}
              onChange={() => setChecklist((current) => ({
                ...current,
                items: current.items.map((candidate) => candidate.id === item.id
                  ? { ...candidate, completed: !candidate.completed }
                  : candidate),
              }))}
              aria-label={`${item.completed ? 'Mark incomplete' : 'Mark complete'}: ${item.label}`}
              data-testid={`checkbox-card-prep-${event.id}-${item.id}`}
            />
            <span className="game-on-prep__check" aria-hidden="true"><Check size={14} /></span>
            <span className="game-on-prep__item-label">{item.label}</span>
          </label>
        ))}
        {checklist.items.length === 0 && (
          <p className="game-on-prep__empty">No prep items yet. Open the full checklist to add some.</p>
        )}
      </div>

      <p className="game-on-prep__save-status" role="status" aria-live="polite" aria-atomic="true">
        {storageUnavailable
          ? 'This browser is blocking storage. Prep changes will not be recovered after reload.'
          : `${completed} of ${checklist.items.length} items complete. Progress saves on this device.`}
      </p>

      <Link href={prepHref} className="game-on-prep__full-link" data-testid={`link-open-full-prep-${event.id}`}>
        Edit full Prep checklist
      </Link>
    </section>
  );
}