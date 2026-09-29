import { useEffect, useState } from 'react';
import {
  getGetGameOnCardQueryKey,
  useGetGameOnCard,
  useCreateScheduleShare,
  useDeleteScheduleShare,
  useUpdateScheduleShare,
} from '@workspace/api-client-react';
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardCheck,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trophy,
  RotateCw,
} from 'lucide-react';
import { Link } from 'wouter';
import { format, isValid, parseISO } from 'date-fns';
import type { SupporterEvent } from './supporter-dashboard';
import { buildWorkspaceToolHref } from './workspace-context';
import { PublicGameOnCardFrontFace } from './public-game-on-card-front-face';
import {
  readSavedGameOnCard,
  readSavedGameOnCards,
  removeSavedGameOnCard,
  upsertSavedGameOnCard,
  type GameOnCardEvent as GameOnDraft,
  type SavedGameOnCard,
} from './game-on-card-storage';
import { getBrowserTimeZone, getGameOnTimeZoneOptions, resolveGameOnTimeZone } from './game-on-timezone';

type GameOnEventType = 'game' | 'practice';
type CardEvent = GameOnDraft & { type?: GameOnEventType; calendarProjectId?: string };
type LocalSavedGameOnCard = Omit<SavedGameOnCard, 'event'> & { event: CardEvent };

type GameOnCardPanelProps = {
  profile: {
    teamName: string;
    athleteName: string;
  };
  userId?: string | null;
  events: SupporterEvent[];
  selectedEvent?: SupporterEvent;
  selectedCard?: SavedGameOnCard | null;
  startFresh?: boolean;
  embedded?: boolean;
  initialDraft?: SupporterEvent;
  initialSourceEventId?: string;
  onDraftChange?: (event: SupporterEvent, sourceEventId: string) => void;
  onChanged?: (selectedId?: string) => void;
  onSaveCalendarEvent?: (event: SupporterEvent) => Promise<void>;
  existingCardTokensByEventId?: Record<string, string>;
};

function createEventId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `game-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function blankDraft(type: GameOnEventType = 'game'): CardEvent {
  return {
    id: createEventId(),
    date: '',
    time: '',
    timezone: getBrowserTimeZone(),
    location: '',
    opponent: '',
    status: 'upcoming',
    type,
  };
}

function draftFromEvent(event: SupporterEvent): CardEvent {
  const type = event.type === 'practice' ? 'practice' : 'game';
  return {
    id: event.id,
    ...(event.calendarProjectId ? { calendarProjectId: event.calendarProjectId } : {}),
    date: event.date,
    time: event.time,
    timezone: resolveGameOnTimeZone(event.timezone),
    location: event.location,
    opponent: type === 'practice' ? '' : event.opponent ?? '',
    status: event.status ?? 'upcoming',
    type,
  };
}

function eventFromSaved(saved: SavedGameOnCard): CardEvent {
  const event = saved.event as CardEvent;
  const type = event.type === 'practice' ? 'practice' : 'game';
  return {
    ...event,
    type,
    timezone: resolveGameOnTimeZone(event.timezone),
    opponent: type === 'practice' ? '' : event.opponent,
  };
}

function appAbsoluteUrl(path: string) {
  const origin = ['pixlsports.com', 'www.pixlsports.com'].includes(window.location.hostname.toLowerCase())
    ? 'https://pixlsports.com'
    : window.location.origin;
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${origin}${basePath}${path}`;
}

function publicCardUrl(shareToken: string) {
  return appAbsoluteUrl(`/game-on/${shareToken}`);
}

function prettyEventDate(value: string) {
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, 'EEEE, MMM d, yyyy') : value;
}

function publicEventPayload(event: CardEvent) {
  return {
    id: event.id,
    type: event.type ?? 'game',
    status: event.status,
    date: event.date,
    time: event.time,
    timezone: resolveGameOnTimeZone(event.timezone),
    location: event.location,
    opponent: event.type === 'practice' ? '' : event.opponent.trim(),
    snacks: '',
    drinks: '',
    notes: '',
  };
}

export function GameOnCardPanel({
  profile,
  userId,
  events,
  selectedEvent,
  selectedCard,
  startFresh = false,
  embedded = false,
  initialDraft,
  initialSourceEventId,
  onDraftChange,
  onChanged,
  onSaveCalendarEvent,
  existingCardTokensByEventId,
}: GameOnCardPanelProps) {
  const scheduledEvents = events.filter((event) => event.type === 'game' || event.type === 'practice');
  const createShare = useCreateScheduleShare();
  const updateShare = useUpdateScheduleShare();
  const deleteShare = useDeleteScheduleShare();
  const selectionIdentity = startFresh
    ? 'fresh'
    : selectedCard === null
      ? `new:${selectedEvent?.type ?? 'game'}:${selectedEvent?.id ?? ''}`
      : selectedCard
        ? `card:${selectedCard.shareToken}`
        : `default:${selectedEvent?.type ?? ''}:${selectedEvent?.id ?? ''}`;
  const [saved, setSaved] = useState<LocalSavedGameOnCard | null>(() => {
    if (!userId || typeof window === 'undefined' || startFresh || selectedCard === null) return null;
    const initial = selectedCard ?? readSavedGameOnCard(userId) ?? readSavedGameOnCards(userId)[0] ?? null;
    return initial as LocalSavedGameOnCard | null;
  });
  const [draft, setDraft] = useState<CardEvent>(() => (
    startFresh && initialDraft
      ? draftFromEvent(initialDraft)
      : !startFresh && selectedCard
      ? eventFromSaved(selectedCard)
      : selectedEvent && selectedEvent.type !== 'meeting'
        ? draftFromEvent(selectedEvent)
        : blankDraft()
  ));
  const [sourceEventId, setSourceEventId] = useState(() => (
    startFresh && initialDraft
      ? initialSourceEventId ?? 'new'
      : !startFresh && selectedCard
      ? selectedCard.event.id
      : selectedEvent && selectedEvent.type !== 'meeting'
        ? selectedEvent.id
        : 'new'
  ));
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  useEffect(() => {
    if (!userId) {
      setSaved(null);
      setDraft(startFresh
        ? initialDraft ? draftFromEvent(initialDraft) : blankDraft(selectedEvent?.type === 'practice' ? 'practice' : 'game')
        : selectedEvent && selectedEvent.type !== 'meeting'
          ? draftFromEvent(selectedEvent)
          : blankDraft());
      setSourceEventId(startFresh
        ? initialDraft ? initialSourceEventId ?? 'new' : 'new'
        : selectedEvent && selectedEvent.type !== 'meeting' ? selectedEvent.id : 'new');
      return;
    }
    const selectedSaved = startFresh || selectedCard === null
      ? null
      : selectedCard ?? readSavedGameOnCard(userId) ?? readSavedGameOnCards(userId)[0] ?? null;
    const selectedDraft = startFresh
      ? initialDraft
        ? draftFromEvent(initialDraft)
        : blankDraft(selectedEvent?.type === 'practice' ? 'practice' : 'game')
      : selectedSaved
        ? eventFromSaved(selectedSaved)
        : selectedEvent && selectedEvent.type !== 'meeting'
          ? draftFromEvent(selectedEvent)
          : blankDraft();
    setSaved(selectedSaved as LocalSavedGameOnCard | null);
    setDraft(selectedDraft);
    setSourceEventId(selectedSaved?.event.id ?? (
      startFresh
        ? initialDraft ? initialSourceEventId ?? 'new' : 'new'
        : selectedEvent && selectedEvent.type !== 'meeting' ? selectedEvent.id : 'new'
    ));
    setIsEditing(false);
    setError('');
    setNotice('');
  }, [userId, selectionIdentity]);

  useEffect(() => {
    onDraftChange?.({
      ...draft,
      type: draft.type ?? 'game',
      opponent: draft.type === 'practice' ? '' : draft.opponent,
    }, sourceEventId);
  }, [draft, sourceEventId, onDraftChange]);

  const publicCard = useGetGameOnCard(saved?.shareToken ?? '', {
    query: {
      queryKey: getGetGameOnCardQueryKey(saved?.shareToken ?? ''),
      enabled: Boolean(saved?.shareToken),
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  });

  function saveCard(next: LocalSavedGameOnCard) {
    if (!userId) throw new Error('Sign in to save a Game On Card.');
    upsertSavedGameOnCard(userId, next);
    setSaved(next);
    setIsEditing(false);
  }

  function buildShareData(event: CardEvent) {
    return {
      title: profile.teamName.trim() || 'Game On',
      teamSeason: '',
      purpose: 'game-on-card' as const,
      ...(event.calendarProjectId ? { calendarProjectId: event.calendarProjectId } : {}),
      events: [publicEventPayload(event)],
    };
  }

  async function copyShareLink(shareToken: string) {
    const url = publicCardUrl(shareToken);
    if (!navigator.clipboard?.writeText) {
      setNotice(`Your Game On Card is ready: ${url}`);
      return;
    }
    await navigator.clipboard.writeText(url);
    setNotice('Game On Card link copied.');
  }

  async function handleCreateOrUpdate() {
    setError('');
    setNotice('');
    if (!userId) {
      setError('Sign in to create a shareable Game On Card.');
      return;
    }
    const isPractice = draft.type === 'practice';
    if (!draft.date || (!isPractice && !draft.opponent.trim())) {
      setError(isPractice ? 'Add a practice date to continue.' : 'Add a game date and opponent to continue.');
      return;
    }

    setBusy(true);
    try {
      const event = {
        ...draft,
        id: draft.id || createEventId(),
        opponent: isPractice ? '' : draft.opponent.trim(),
        location: draft.location.trim(),
        time: draft.time.trim(),
        timezone: resolveGameOnTimeZone(draft.timezone),
      };
      if (sourceEventId !== 'new' && scheduledEvents.some((scheduled) => scheduled.id === event.id)) {
        if (!onSaveCalendarEvent) throw new Error('Calendar editing is unavailable. Refresh and try again.');
        await onSaveCalendarEvent(event as SupporterEvent);
      }
      const data = buildShareData(event);
      const existingToken = saved?.shareToken ?? (sourceEventId !== 'new' ? existingCardTokensByEventId?.[event.id] : undefined);
      const share = existingToken
        ? await updateShare.mutateAsync({ shareToken: existingToken, data })
        : await createShare.mutateAsync({ data });
      const next: LocalSavedGameOnCard = {
        shareToken: share.shareToken,
        event,
        title: data.title,
        savedAt: new Date().toISOString(),
      };
      saveCard(next);
      setDraft(event);
      try {
        await copyShareLink(share.shareToken);
      } catch {
        setError('Game On Card saved, but the link could not be copied.');
      }
      onChanged?.(`share:${share.shareToken}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save the Game On Card. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    if (!saved || !userId) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await deleteShare.mutateAsync({ shareToken: saved.shareToken });
      removeSavedGameOnCard(userId, saved.shareToken);
      setSaved(null);
      onChanged?.();
      setDraft(selectedEvent && selectedEvent.type !== 'meeting' ? draftFromEvent(selectedEvent) : blankDraft());
      setSourceEventId(selectedEvent && selectedEvent.type !== 'meeting' ? selectedEvent.id : 'new');
      setNotice('Game On Card link revoked.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to revoke the Game On Card. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function chooseScheduleEvent(value: string) {
    setSourceEventId(value);
    if (value === 'new') {
      setDraft(blankDraft(draft.type ?? 'game'));
      return;
    }
    const event = scheduledEvents.find((scheduledEvent) => scheduledEvent.id === value);
    if (event) setDraft(draftFromEvent(event));
  }

  const selectedPublicEvent = publicCard.data?.event;
  const isPractice = draft.type === 'practice';
  const canCreate = Boolean(draft.date && (isPractice || draft.opponent.trim())) && !busy;
  const workspaceEvent = {
    id: draft.id,
    type: draft.type ?? 'game',
    date: draft.date,
    time: draft.time,
    location: draft.location,
    opponent: isPractice ? '' : draft.opponent,
  };
  const prepDetails = new URLSearchParams();
  for (const [key, value] of Object.entries({
    date: draft.date,
    time: draft.time,
    location: draft.location,
    opponent: isPractice ? '' : draft.opponent,
  })) {
    if (value) prepDetails.set(key, value);
  }
  const prepToolHref = `${buildWorkspaceToolHref('prep', workspaceEvent)}&${prepDetails.toString()}&view=share`;
  const statsToolHref = isPractice ? undefined : buildWorkspaceToolHref('stats', workspaceEvent);

  return (
    <section
      id={embedded ? undefined : 'game-on-card-panel'}
      className={embedded ? 'w-full' : 'mx-auto w-full max-w-[1400px] scroll-mt-6 px-4 pb-5 sm:px-8'}
      aria-label={embedded ? 'Create a Game On card' : undefined}
      aria-labelledby={embedded ? undefined : 'game-on-card-heading'}
      data-testid={embedded ? 'panel-game-on-card-draft' : 'game-on-card-panel'}
    >
      <div className="overflow-hidden rounded-[18px] border border-[#55A4FF]/25 bg-[#0B1F3A] text-white shadow-[0_18px_36px_rgba(11,31,58,.18)]">
        {!embedded && <div className="h-[7px] bg-[linear-gradient(90deg,#2474F5_0%,#55A4FF_58%,#FF6433_100%)]" />}
        <div className={embedded ? 'p-3 sm:p-4' : 'p-5 sm:p-7 lg:p-8'}>
          {!embedded && <>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#55A4FF]/40 bg-[#2878F5]/10 text-[#55A4FF]">
              <Trophy className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#55A4FF]">{isPractice ? 'On-demand practice sharing' : 'On-demand game day sharing'}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[.16em] text-white/40">Game On Card</p>
            </div>
          </div>
          <h2 id="game-on-card-heading" className="mt-6 font-display text-4xl font-black leading-[.95] tracking-tight sm:text-5xl">
            {isPractice ? 'Share the practice.' : 'Share the game day.'}
          </h2>
          <p className="mt-3 max-w-3xl text-base font-medium leading-relaxed text-white/65 sm:text-[17px]">
            {isPractice
              ? 'One simple link for practice details. Prep stays private unless you choose to share it.'
              : 'One simple link for event details. Prep and stats appear only when you choose to share them.'}
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider text-white/65">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[.04] px-3 py-2">
              <ShieldCheck className="h-3.5 w-3.5 text-[#55A4FF]" /> Private prep by default
            </span>
            {draft.type !== 'practice' && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[.04] px-3 py-2">
                <Activity className="h-3.5 w-3.5 text-[#55A4FF]" /> Stats appear when shared
              </span>
            )}
          </div>
          </>}

          {!embedded && <div className="mt-7">
            {!embedded && saved && !isEditing && (
              <div className="rounded-[18px] border border-[#55A4FF]/30 bg-white/[.05] p-4 sm:p-5" data-testid="game-on-card-saved">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                      <Check className="h-3.5 w-3.5" /> Link is active
                    </p>
                    <p className="mt-2 truncate font-display text-xl uppercase">
                      {saved.title}{saved.event.type !== 'practice' && saved.event.opponent ? ` vs ${saved.event.opponent}` : ''}
                    </p>
                    <p className="mt-1 text-xs font-medium text-white/55">
                      {prettyEventDate(saved.event.date)}{saved.event.time ? ` · ${saved.event.time}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void copyShareLink(saved.shareToken).catch(() => setError('Unable to copy the link. You can open the card and copy its address.'))}
                      className="inline-flex min-h-10 items-center justify-center gap-2 bg-primary px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-primary-foreground"
                      data-testid="button-copy-game-on-card"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy link
                    </button>
                    <a
                      href={publicCardUrl(saved.shareToken)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-10 items-center justify-center gap-2 border border-white/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:border-primary"
                      data-testid="link-open-game-on-card"
                    >
                      Open card <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
                {publicCard.isError && (
                  <p className="mt-3 text-xs font-medium text-amber-100" role="status">
                    This saved card link is no longer available. Revoke it or create a new card.
                  </p>
                )}
                {selectedPublicEvent && saved.event.type !== 'practice' && (
                  <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider text-white/55">
                    <span className={publicCard.data?.prepState === 'shared' ? 'text-primary' : ''}>
                      {publicCard.data?.prepState === 'shared' ? 'Prep shared' : 'Prep private'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{publicCard.data?.statsState === 'live' ? 'Live stats shared' : publicCard.data?.statsState === 'final' ? 'Final stats shared' : publicCard.data?.statsState === 'expired' ? 'Stats link expired' : 'Stats not shared yet'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{publicCard.data?.athletePageState === 'published' ? 'Athlete Page linked' : 'Athlete Page not published'}</span>
                  </div>
                )}
                {error && <p className="mt-3 text-xs font-semibold text-red-200" role="alert">{error}</p>}
                {notice && <p className="mt-3 text-xs font-semibold text-primary" role="status" aria-live="polite">{notice}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href={prepToolHref} className="inline-flex min-h-10 items-center justify-center gap-2 border border-white/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:border-primary" data-testid="link-game-on-open-prep">
                    <ClipboardCheck className="h-3.5 w-3.5" /> Prep / share if you choose
                  </Link>
                  {statsToolHref && (
                    <Link href={statsToolHref} className="inline-flex min-h-10 items-center justify-center gap-2 border border-white/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:border-primary" data-testid="link-game-on-open-stats">
                      <Activity className="h-3.5 w-3.5" /> Track this game
                    </Link>
                  )}
                  <Link href="/studio/athlete-page" className="inline-flex min-h-10 items-center justify-center gap-2 border border-white/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:border-primary" data-testid="link-game-on-athlete-page">
                    <Sparkles className="h-3.5 w-3.5" /> Athlete Hype Page
                  </Link>
                </div>
                <div className="mt-4 flex flex-wrap gap-4 border-t border-white/10 pt-3">
                  <button type="button" onClick={() => setIsEditing(true)} className="text-[10px] font-bold uppercase tracking-widest text-white/65 hover:text-white" data-testid="button-edit-game-on-card">Update event details</button>
                  <button type="button" onClick={() => void handleRevoke()} disabled={busy} className="text-[10px] font-bold uppercase tracking-widest text-red-200 hover:text-red-100 disabled:opacity-50" data-testid="button-revoke-game-on-card">{busy ? 'Working…' : 'Revoke link'}</button>
                </div>
              </div>
            )}
          </div>}

          {(!saved || isEditing) && (
            <div className={`${embedded ? '' : 'mt-7 rounded-[18px] border border-white/12 bg-[#07172b]/70 p-4 sm:p-6'}`} data-testid="game-on-card-form">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                    {saved ? 'Edit this card' : isPractice ? 'Start with a practice' : 'Start with one game'}
                  </p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-white/55">
                    {profile.athleteName ? `For ${profile.athleteName}. ` : ''}
                    Only event details are public on this card.
                  </p>
                </div>
                {saved && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setDraft(saved.event);
                    }}
                    className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/55 hover:text-white"
                    data-testid="button-cancel-game-on-card"
                  >
                    Cancel
                  </button>
                )}
              </div>
                <label className="mb-3 block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/55">Event type</span>
                  <select
                    value={draft.type ?? 'game'}
                    onChange={(event) => {
                      const type = event.target.value as GameOnEventType;
                      const wasScheduled = sourceEventId !== 'new';
                      setSourceEventId('new');
                      setDraft((current) => ({
                        ...current,
                        id: wasScheduled ? createEventId() : current.id,
                        type,
                        opponent: type === 'practice' ? '' : current.opponent,
                      }));
                    }}
                    className="min-h-11 w-full rounded-[10px] border border-white/20 bg-[#0B1F3A] px-3 text-sm font-semibold text-white outline-none focus:border-[#55A4FF]"
                    data-testid="select-game-on-type"
                  >
                    <option value="game">Game</option>
                    <option value="practice">Practice</option>
                  </select>
                </label>
                {scheduledEvents.length > 0 && (
                <label className="mb-3 block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/55">Start from a scheduled game or practice</span>
                  <select
                    value={sourceEventId}
                      onChange={(event) => chooseScheduleEvent(event.target.value)}
                    className="min-h-11 w-full rounded-[10px] border border-white/20 bg-[#0B1F3A] px-3 text-sm font-semibold text-white outline-none focus:border-[#55A4FF]"
                    data-testid="select-game-on-source-event"
                  >
                    <option value="new">Create an independent event card</option>
                    {scheduledEvents.map((scheduledEvent) => (
                      <option key={`${scheduledEvent.type}:${scheduledEvent.id}`} value={scheduledEvent.id}>
                        {scheduledEvent.type === 'practice' ? 'Practice' : 'Game'} · {scheduledEvent.date || 'Date TBD'}{scheduledEvent.type === 'game' && scheduledEvent.opponent ? ` · vs ${scheduledEvent.opponent}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {!isPractice && <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/55">Opponent <span className="text-primary">*</span></span>
                  <input
                    value={draft.opponent}
                    onChange={(event) => setDraft((current) => ({ ...current, opponent: event.target.value }))}
                    maxLength={200}
                    placeholder="Who are they playing?"
                    className="min-h-11 w-full rounded-[10px] border border-white/20 bg-white/5 px-3 text-sm font-semibold text-white placeholder:text-white/30 outline-none focus:border-[#55A4FF]"
                    data-testid="input-game-on-opponent"
                  />
                </label>}
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/55">Date <span className="text-primary">*</span></span>
                  <input
                    type="date"
                    value={draft.date}
                    onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
                    className="min-h-11 w-full rounded-[10px] border border-white/20 bg-white/5 px-3 text-sm font-semibold text-white outline-none focus:border-[#55A4FF]"
                    data-testid="input-game-on-date"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/55">Start time</span>
                  <input
                    type="time"
                    value={draft.time}
                    onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))}
                    className="min-h-11 w-full rounded-[10px] border border-white/20 bg-white/5 px-3 text-sm font-semibold text-white outline-none focus:border-[#55A4FF]"
                    data-testid="input-game-on-time"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/55">Time zone</span>
                  <select
                    value={draft.timezone ?? getBrowserTimeZone()}
                    onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}
                    className="min-h-11 w-full rounded-[10px] border border-white/20 bg-[#0B1F3A] px-3 text-sm font-semibold text-white outline-none focus:border-[#55A4FF]"
                    data-testid="select-game-on-timezone"
                  >
                    {getGameOnTimeZoneOptions(draft.timezone).map((timezone) => (
                      <option key={timezone} value={timezone}>{timezone}</option>
                    ))}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/55">Location</span>
                  <input
                    value={draft.location}
                    onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))}
                    maxLength={300}
                    placeholder="Field, gym, or address"
                    className="min-h-11 w-full rounded-[10px] border border-white/20 bg-white/5 px-3 text-sm font-semibold text-white placeholder:text-white/30 outline-none focus:border-[#55A4FF]"
                    data-testid="input-game-on-location"
                  />
                </label>
              </div>
              <p className="mt-3 flex items-start gap-2 text-[11px] font-medium leading-relaxed text-white/50">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                {isPractice ? 'Practice notes and private prep are not copied. Share a checklist from Prep only when you choose.' : 'Checklist notes and private prep are not copied. Share a checklist from Prep only when you choose.'}
              </p>
              {error && <p className="mt-3 text-xs font-semibold text-red-200" role="alert" data-testid="game-on-card-error">{error}</p>}
              {notice && <p className="mt-3 text-xs font-semibold text-primary" role="status" aria-live="polite">{notice}</p>}
              <button
                type="button"
                onClick={() => void handleCreateOrUpdate()}
                disabled={!canCreate}
                className="mt-5 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[14px] bg-[#2474F5] px-4 py-4 text-sm font-bold tracking-wide text-white shadow-[0_10px_20px_rgba(40,120,245,.2)] transition-colors hover:bg-[#2474F5]/90 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-save-game-on-card"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Trophy className="h-4 w-4" />}
                {busy ? 'Saving…' : saved ? 'Update Game On Card' : isPractice ? 'Create and share Practice Card' : 'Create and share Game On Card'}
                {!busy && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PublicDestination({
  icon: Icon,
  title,
  detail,
  href,
  action,
  testId,
}: {
  icon: typeof Activity;
  title: string;
  detail: string;
  href?: string;
  action?: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-4 border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between" data-testid={testId}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl uppercase tracking-wide text-foreground">{title}</h2>
          <p className="mt-1 text-sm font-medium leading-relaxed text-muted-foreground">{detail}</p>
        </div>
      </div>
      {href && action && (
        <Link href={href} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 bg-primary px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary/90">
          {action} <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

export function PublicGameOnCardPage({ params }: { params: { shareToken?: string } }) {
  const shareToken = params.shareToken ?? '';
  const [showStats, setShowStats] = useState(false);
  const card = useGetGameOnCard(shareToken, {
    query: {
      queryKey: getGetGameOnCardQueryKey(shareToken),
      enabled: Boolean(shareToken),
      retry: false,
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    },
  });

  if (card.isLoading) {
    return (
      <div className="noise min-h-dvh bg-background">
        <header className="border-b border-border bg-card px-5 py-4">
          <Link href="/" className="font-display text-2xl uppercase tracking-wide text-foreground">Pixl Sports</Link>
        </header>
        <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-5">
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground" role="status">Loading Game On Card…</p>
        </main>
      </div>
    );
  }

  if (card.isError || !card.data) {
    return (
      <div className="noise min-h-dvh bg-background">
        <header className="border-b border-border bg-card px-5 py-4">
          <Link href="/" className="font-display text-2xl uppercase tracking-wide text-foreground">Pixl Sports</Link>
        </header>
        <main className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-5 py-16 text-center">
          <CalendarDays className="h-10 w-10 text-primary" />
          <h1 className="mt-5 font-display text-4xl uppercase tracking-wide text-foreground">Game On Card unavailable</h1>
          <p className="mt-3 max-w-md text-sm font-medium leading-relaxed text-muted-foreground">
            This card may have been revoked, or the event details are no longer available.
          </p>
          <Link href="/" className="mt-7 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground">Go to Pixl Sports</Link>
        </main>
      </div>
    );
  }

  const data = card.data;
  const isPractice = data.event.type === 'practice';
  const showingStats = !isPractice && showStats;
  const dateLabel = prettyEventDate(data.event.date);
  const stageLabel = isPractice
    ? data.stage === 'final' ? 'Practice complete' : data.stage === 'live' ? 'Practice in progress' : 'Upcoming practice'
    : data.stage === 'final' ? 'Game complete' : data.stage === 'live' ? 'Game in progress' : 'Upcoming game';
  const prepHref = data.prepShareToken ? `/checklist/${data.prepShareToken}` : undefined;
  const statsHref = data.statsShareToken ? `/live/${data.statsShareToken}` : undefined;
  const statsUpdatedAt = statsHref && data.statsUpdatedAt ? new Date(data.statsUpdatedAt) : undefined;
  const statsUpdatedLabel = statsUpdatedAt && isValid(statsUpdatedAt)
    ? format(statsUpdatedAt, 'MMM d, yyyy · h:mm a')
    : undefined;
  const athletePageHref = data.athletePageToken ? `/player/${data.athletePageToken}` : undefined;
  const statsTitle = data.stage === 'final' ? 'Game stats' : 'Live stats';
  const statsDetail = data.statsState === 'expired'
    ? 'The temporary stats link has expired. The event details are still available on the front of this card.'
    : data.statsState === 'live'
      ? 'Follow the shared game stats as they update.'
      : data.statsState === 'final'
        ? 'Review the completed game stats.'
        : 'Stats are not being shared for this event. Only the card owner can start and share the event-specific tracker.';

  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-[#e6ebf2] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="font-display text-2xl uppercase tracking-wide text-[#0B1F3A]">Pixl Sports</Link>
          <span className="text-[10px] font-bold uppercase tracking-[.18em] text-[#52657a]">{isPractice ? 'Shared practice' : 'Shared game day'}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-1 pb-10 pt-4 sm:px-8 sm:pt-8" data-testid="public-game-on-card">
        <PublicGameOnCardFrontFace
          eventTitle={data.title}
          eventType={isPractice ? 'practice' : 'game'}
          stageLabel={stageLabel}
          opponent={data.event.opponent}
          dateLabel={dateLabel}
          time={data.event.time}
          location={data.event.location}
          athleteName={data.athleteName}
          athletePageStatus={athletePageHref ? 'published' : data.athletePageState === 'paused' ? 'paused' : 'unpublished'}
          athletePageHref={athletePageHref}
          showingAlternateFace={showingStats}
          alternateFace={
            <div className="flex flex-1 flex-col" data-testid="game-on-back-face">
              <p className="text-[9px] font-black uppercase tracking-[.2em] text-[#2474F5] sm:text-xs">{stageLabel}</p>
              <h1 className="mt-2 break-words font-display text-[clamp(1.8rem,6vw,3.6rem)] uppercase leading-[.95] tracking-wide">{statsTitle}</h1>
              <div className="mt-5 border-t-2 border-[#0B1F3A] pt-4 sm:mt-10 sm:pt-7">
                <p className="mt-4 text-sm font-medium leading-relaxed text-[#42546b] sm:text-lg">{statsDetail}</p>
                {statsUpdatedLabel && (data.statsState === 'live' || data.statsState === 'final') && (
                  <p className="mt-3 text-xs font-semibold text-[#52657a]" data-testid="game-on-stats-updated">
                    Stats last updated <time dateTime={data.statsUpdatedAt}>{statsUpdatedLabel}</time>
                  </p>
                )}
                {statsHref && (
                  <Link href={statsHref} className="mt-6 inline-flex min-h-12 max-w-full items-center gap-2 bg-[#2474F5] px-4 py-3 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-[#0B1F3A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2474F5] sm:text-xs" data-testid="game-on-stats-link">
                    {data.statsState === 'final' ? 'View final stats' : 'Follow live stats'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )}
              </div>
            </div>
          }
          controls={!isPractice && (
            <button
              type="button"
              onClick={() => setShowStats((current) => !current)}
              aria-pressed={showingStats}
              aria-controls="game-on-card-face"
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 border border-[#0B1F3A] bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[.16em] text-[#0B1F3A] transition hover:bg-[#0B1F3A] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2474F5] sm:mt-6 sm:text-xs"
              data-testid="game-on-flip-control"
            >
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              {showingStats ? 'Show event' : 'Show stats'}
            </button>
          )}
        />

        <section className="mx-auto mt-3 max-w-[600px] px-5 sm:mt-8 sm:px-0" aria-labelledby="game-on-destinations-heading">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Follow the event</p>
              <h2 id="game-on-destinations-heading" className="mt-1 font-display text-2xl uppercase tracking-wide text-[#0B1F3A]">{isPractice ? 'Practice links' : 'Game day links'}</h2>
            </div>
            <span className="hidden text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:block">Updates automatically</span>
          </div>
          <div className="space-y-3">
            <PublicDestination
              icon={ClipboardCheck}
              title="Prep with helpers"
              detail={data.prepState === 'shared'
                ? 'The owner chose to share this checklist with helpers.'
                : 'Prep is private. A checklist link will appear here only if the owner shares it.'}
              href={prepHref}
              action="Open checklist"
              testId="game-on-prep-destination"
            />
          </div>
        </section>
        <p className="mt-8 text-center text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Shared from Pixl Sports</p>
      </main>
    </div>
  );
}