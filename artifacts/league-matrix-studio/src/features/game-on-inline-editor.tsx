import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateScheduleShare,
  useUpdateScheduleShare,
} from '@workspace/api-client-react';
import { Activity, CalendarDays, ClipboardCheck, Plus, Trash2 } from 'lucide-react';
import type { SupporterEvent } from './supporter-dashboard';
import type { GameOnDashboardEntry } from './game-on-dashboard-model';
import {
  createGamedayChecklist,
  gamedayChecklistStorageKey,
  readEventChecklist,
  readGamedayChecklist,
  saveEventChecklist,
  type LocalGamedayChecklist,
} from './gameday-checklist';
import { upsertSavedGameOnCard } from './game-on-card-storage';
import { getBrowserTimeZone, getGameOnTimeZoneOptions, resolveGameOnTimeZone } from './game-on-timezone';
import { invalidateHypeCardEvents } from './game-on-hype-event-sync';

type EventFields = Pick<SupporterEvent, 'date' | 'time' | 'timezone' | 'location' | 'opponent'>;

type Props = {
  card: GameOnDashboardEntry;
  scheduledEvent?: SupporterEvent;
  teamName: string;
  userId: string;
  view?: 'details' | 'calendar';
  onOpenPrep: (trigger: HTMLButtonElement) => void;
  onOpenTracker: (trigger: HTMLButtonElement) => void;
  onSaveCalendarEvent: (event: SupporterEvent) => Promise<void>;
  onChanged: (selectedId?: string) => void;
};

function initialChecklist(userId: string, card: GameOnDashboardEntry): LocalGamedayChecklist {
  const local = window.localStorage;
  const stored = readEventChecklist(local, userId, card.eventId);
  const legacy = readGamedayChecklist(local, `${gamedayChecklistStorageKey}:${encodeURIComponent(userId)}`);
  const checklist = stored ?? (
    legacy?.selectedGame?.id === card.eventId && !legacy.shareToken ? legacy : null
  ) ?? createGamedayChecklist(card.type);
  return { ...checklist, shareToken: undefined, revision: undefined };
}

export function GameOnInlineEditor({
  card,
  scheduledEvent,
  teamName,
  userId,
  view = 'details',
  onOpenPrep,
  onOpenTracker,
  onSaveCalendarEvent,
  onChanged,
}: Props) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<EventFields>({
    date: card.date,
    time: card.time,
    timezone: resolveGameOnTimeZone(scheduledEvent?.timezone ?? card.timezone),
    location: card.location,
    opponent: card.opponent,
  });
  const [prep, setPrep] = useState(() => initialChecklist(userId, card));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const createShare = useCreateScheduleShare();
  const updateShare = useUpdateScheduleShare();
  const isPractice = card.type === 'practice';
  const event = {
    id: card.eventId,
    type: card.type,
    date: fields.date,
    time: fields.time,
    timezone: fields.timezone ?? getBrowserTimeZone(),
    location: fields.location.trim(),
    opponent: isPractice ? '' : (fields.opponent ?? '').trim(),
    status: scheduledEvent?.status ?? 'upcoming',
  } satisfies SupporterEvent;
  const shareData = {
    title: teamName.trim() || 'Game On',
    teamSeason: '',
    purpose: 'game-on-card' as const,
    ...(card.calendarProjectId ? { calendarProjectId: card.calendarProjectId } : {}),
    events: [{
      ...event, snacks: '', drinks: '', notes: '',
    }],
  };

  async function saveEvent() {
    setError('');
    setNotice('');
    if (!event.date || (!isPractice && !event.opponent)) {
      setError(isPractice ? 'Add a practice date.' : 'Add a game date and opponent.');
      return;
    }
    setBusy(true);
    let calendarSaved = false;
    try {
      if (scheduledEvent) {
        await onSaveCalendarEvent(event);
        calendarSaved = true;
      }
      let token = card.shareToken;
      if (token) {
        await updateShare.mutateAsync({ shareToken: token, data: shareData });
      } else if (view !== 'calendar' || !scheduledEvent) {
        const created = await createShare.mutateAsync({ data: shareData });
        token = created.shareToken;
      }
      if (token) {
        upsertSavedGameOnCard(userId, {
          shareToken: token, title: shareData.title, event, savedAt: new Date().toISOString(),
        });
        void invalidateHypeCardEvents(queryClient);
      }
      setNotice(token ? 'Event Card saved. Find it in your Hype Card’s Events section when Allow events is on.' : 'Calendar event saved.');
      onChanged(token ? `share:${token}` : `draft:${card.eventId}`);
    } catch (caught) {
      setError(calendarSaved
        ? 'Calendar saved, but the Event Card could not be saved. Try again.'
        : caught instanceof Error ? caught.message : 'Could not save this event. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function savePrep() {
    setError('');
    setNotice('');
    try {
      saveEventChecklist(window.localStorage, userId, card.eventId, {
        ...prep,
        title: prep.title.trim() || (isPractice ? 'Practice Checklist' : 'Gameday Checklist'),
        selectedGame: { ...event },
        shareToken: undefined,
        revision: undefined,
      });
      setNotice('Private Prep saved for this event.');
    } catch {
      setError('Private Prep could not be saved on this device. Try again.');
    }
  }

  const calendarSection = (
    <div className="game-on-inline__section">
      <h3 tabIndex={-1}><CalendarDays size={17} aria-hidden="true" /> Event details</h3>
      <p>{scheduledEvent ? 'Changes here also update the linked event snapshot.' : 'This card keeps its own event details.'}</p>
      <div className="game-on-inline__fields">
        {!isPractice && <label className="game-on-inline__wide">Opponent
          <input value={fields.opponent ?? ''} maxLength={200} onChange={(e) => setFields({ ...fields, opponent: e.target.value })} data-testid="input-inline-opponent" />
        </label>}
        <label>Date <input type="date" value={fields.date} onChange={(e) => setFields({ ...fields, date: e.target.value })} data-testid="input-inline-date" /></label>
        <label>Start time <input type="time" value={fields.time} onChange={(e) => setFields({ ...fields, time: e.target.value })} data-testid="input-inline-time" /></label>
        <label className="game-on-inline__wide">Time zone
          <select value={fields.timezone ?? getBrowserTimeZone()} onChange={(e) => setFields({ ...fields, timezone: e.target.value })} data-testid="select-inline-timezone">
            {getGameOnTimeZoneOptions(fields.timezone).map((timezone) => (
              <option key={timezone} value={timezone}>{timezone}</option>
            ))}
          </select>
        </label>
        <label className="game-on-inline__wide">Location
          <input value={fields.location} maxLength={300} onChange={(e) => setFields({ ...fields, location: e.target.value })} data-testid="input-inline-location" />
        </label>
      </div>
      <button type="button" className="game-on-inline__primary" disabled={busy} onClick={() => void saveEvent()} data-testid="button-save-inline-event">
        {busy ? 'Saving…' : view === 'calendar' ? 'Save Calendar details' : 'Save Event Card'}
      </button>
    </div>
  );

  if (view === 'calendar') {
    return (
      <div className="game-on-inline game-on-inline--calendar" data-testid={`game-on-inline-calendar-${card.id}`}>
        {calendarSection}
        {notice && <p className="game-on-inline__notice" role="status" aria-live="polite">{notice}</p>}
        {error && <p className="game-on-inline__error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="game-on-inline" data-testid={`game-on-inline-editor-${card.id}`}>
      {calendarSection}
      <div className="game-on-inline__section">
        <h3><ClipboardCheck size={17} aria-hidden="true" /> Private Prep</h3>
        <p>Only you can see these notes and items. Sharing from Prep is a separate choice.</p>
        <label>Notes
          <textarea value={prep.notes ?? ''} maxLength={2000} rows={3} onChange={(e) => setPrep({ ...prep, notes: e.target.value })} data-testid="input-inline-prep-notes" />
        </label>
        <div className="game-on-inline__items">
          {prep.items.map((item) => (
            <div className="game-on-inline__item" key={item.id}>
              <input type="checkbox" checked={item.completed} aria-label={`Completed: ${item.label}`} onChange={(e) => setPrep({ ...prep, items: prep.items.map((entry) => entry.id === item.id ? { ...entry, completed: e.target.checked } : entry) })} />
              <input aria-label="Prep item" value={item.label} maxLength={200} onChange={(e) => setPrep({ ...prep, items: prep.items.map((entry) => entry.id === item.id ? { ...entry, label: e.target.value } : entry) })} />
              <button type="button" aria-label={`Remove ${item.label}`} onClick={() => setPrep({ ...prep, items: prep.items.filter((entry) => entry.id !== item.id) })}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="game-on-inline__secondary" onClick={() => setPrep({ ...prep, items: [...prep.items, { id: `custom-${crypto.randomUUID()}`, label: '', completed: false }] })}><Plus size={14} /> Add item</button>
        <button type="button" className="game-on-inline__primary" onClick={savePrep} data-testid="button-save-inline-prep">Save private Prep</button>
        <button
          type="button"
          className="game-on-inline__text-link"
          onClick={(event) => onOpenPrep(event.currentTarget)}
          data-testid="button-inline-open-prep"
        >
          Open Prep on this card
        </button>
      </div>
      {!isPractice && (
        <button
          type="button"
          className="game-on-inline__tracker"
          onClick={(event) => onOpenTracker(event.currentTarget)}
          data-testid="button-inline-open-stat-tracker"
        >
          <Activity size={18} aria-hidden="true" /> Open Stat Tracker
        </button>
      )}
      {notice && <p className="game-on-inline__notice" role="status" aria-live="polite">{notice}</p>}
      {error && <p className="game-on-inline__error" role="alert">{error}</p>}
    </div>
  );
}