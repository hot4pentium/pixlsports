import { useEffect, useRef, useState } from 'react';
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
  MapPin,
  ShieldCheck,
  Sparkles,
  Trophy,
  Zap,
} from 'lucide-react';
import { Link } from 'wouter';
import { format, isValid, parseISO } from 'date-fns';
import type { SupporterEvent } from './supporter-dashboard';
import { buildWorkspaceToolHref } from './workspace-context';

type GameOnDraft = {
  id: string;
  date: string;
  time: string;
  location: string;
  opponent: string;
  status: 'upcoming' | 'live' | 'final';
};

type SavedGameOnCard = {
  shareToken: string;
  event: GameOnDraft;
  title: string;
  savedAt: string;
};

type GameOnCardPanelProps = {
  profile: {
    teamName: string;
    athleteName: string;
  };
  userId?: string | null;
  events: SupporterEvent[];
  selectedEvent?: SupporterEvent;
};

function createEventId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `game-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function blankDraft(): GameOnDraft {
  const suggestedDate = new Date();
  suggestedDate.setDate(suggestedDate.getDate() + 7);
  return {
    id: createEventId(),
    date: dateInputValue(suggestedDate),
    time: '',
    location: '',
    opponent: '',
    status: 'upcoming',
  };
}

function draftFromEvent(event: SupporterEvent): GameOnDraft {
  return {
    id: event.id,
    date: event.date,
    time: event.time,
    location: event.location,
    opponent: event.opponent ?? '',
    status: event.status ?? 'upcoming',
  };
}

function gameOnStorageKey(userId: string) {
  return `pixlsports-game-on-card:${userId}`;
}

function readSavedGameOnCard(userId: string): SavedGameOnCard | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(gameOnStorageKey(userId)) ?? 'null') as Partial<SavedGameOnCard> | null;
    if (
      !parsed
      || typeof parsed.shareToken !== 'string'
      || typeof parsed.title !== 'string'
      || typeof parsed.savedAt !== 'string'
      || !parsed.event
      || typeof parsed.event.id !== 'string'
      || typeof parsed.event.date !== 'string'
      || typeof parsed.event.time !== 'string'
      || typeof parsed.event.location !== 'string'
      || typeof parsed.event.opponent !== 'string'
    ) return null;
    const status = parsed.event.status === 'live' || parsed.event.status === 'final'
      ? parsed.event.status
      : 'upcoming';
    return {
      shareToken: parsed.shareToken,
      title: parsed.title,
      savedAt: parsed.savedAt,
      event: { ...parsed.event, status },
    };
  } catch {
    return null;
  }
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

function publicEventPayload(event: GameOnDraft) {
  return {
    id: event.id,
    type: 'game' as const,
    status: event.status,
    date: event.date,
    time: event.time,
    location: event.location,
    opponent: event.opponent.trim(),
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
}: GameOnCardPanelProps) {
  const games = events.filter((event) => event.type === 'game');
  const createShare = useCreateScheduleShare();
  const updateShare = useUpdateScheduleShare();
  const deleteShare = useDeleteScheduleShare();
  const [saved, setSaved] = useState<SavedGameOnCard | null>(() => (
    userId && typeof window !== 'undefined' ? readSavedGameOnCard(userId) : null
  ));
  const [draft, setDraft] = useState<GameOnDraft>(() => (
    selectedEvent?.type === 'game' ? draftFromEvent(selectedEvent) : blankDraft()
  ));
  const [sourceEventId, setSourceEventId] = useState(selectedEvent?.type === 'game' ? selectedEvent.id : 'new');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const lastPrefillRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setSaved(null);
      setDraft(blankDraft());
      setSourceEventId('new');
      lastPrefillRef.current = null;
      return;
    }
    const stored = readSavedGameOnCard(userId);
    setSaved(stored);
    if (stored) {
      setDraft(stored.event);
      setSourceEventId(games.some((game) => game.id === stored.event.id) ? stored.event.id : 'new');
      lastPrefillRef.current = `saved:${stored.shareToken}`;
    } else {
      setDraft(blankDraft());
      setSourceEventId('new');
      lastPrefillRef.current = null;
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || saved || !selectedEvent || selectedEvent.type !== 'game') return;
    if (lastPrefillRef.current === selectedEvent.id) return;
    setDraft(draftFromEvent(selectedEvent));
    setSourceEventId(selectedEvent.id);
    lastPrefillRef.current = selectedEvent.id;
  }, [saved, selectedEvent, userId]);

  const publicCard = useGetGameOnCard(saved?.shareToken ?? '', {
    query: {
      queryKey: getGetGameOnCardQueryKey(saved?.shareToken ?? ''),
      enabled: Boolean(saved?.shareToken),
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  });

  function saveCard(next: SavedGameOnCard) {
    if (!userId) throw new Error('Sign in to save a Game On Card.');
    window.localStorage.setItem(gameOnStorageKey(userId), JSON.stringify(next));
    setSaved(next);
    setIsEditing(false);
  }

  function buildShareData(event: GameOnDraft) {
    return {
      title: profile.teamName.trim() || 'Game On',
      teamSeason: '',
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
    if (!draft.date || !draft.opponent.trim()) {
      setError('Add a game date and opponent to continue.');
      return;
    }

    setBusy(true);
    try {
      const event = {
        ...draft,
        id: draft.id || createEventId(),
        opponent: draft.opponent.trim(),
        location: draft.location.trim(),
        time: draft.time.trim(),
      };
      const data = buildShareData(event);
      const share = saved
        ? await updateShare.mutateAsync({ shareToken: saved.shareToken, data })
        : await createShare.mutateAsync({ data });
      const next: SavedGameOnCard = {
        shareToken: share.shareToken,
        event,
        title: data.title,
        savedAt: new Date().toISOString(),
      };
      saveCard(next);
      setDraft(event);
      await copyShareLink(share.shareToken);
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
      window.localStorage.removeItem(gameOnStorageKey(userId));
      setSaved(null);
      setDraft(selectedEvent?.type === 'game' ? draftFromEvent(selectedEvent) : blankDraft());
      setSourceEventId(selectedEvent?.type === 'game' ? selectedEvent.id : 'new');
      setNotice('Game On Card link revoked.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to revoke the Game On Card. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function chooseScheduleGame(value: string) {
    setSourceEventId(value);
    if (value === 'new') {
      setDraft(blankDraft());
      return;
    }
    const event = games.find((game) => game.id === value);
    if (event) setDraft(draftFromEvent(event));
  }

  const selectedPublicEvent = publicCard.data?.event;
  const canCreate = Boolean(draft.date && draft.opponent.trim()) && !busy;
  const workspaceEvent = {
    id: draft.id,
    type: 'game' as const,
    date: draft.date,
    time: draft.time,
    location: draft.location,
    opponent: draft.opponent,
  };
  const prepDetails = new URLSearchParams();
  for (const [key, value] of Object.entries({
    date: draft.date,
    time: draft.time,
    location: draft.location,
    opponent: draft.opponent,
  })) {
    if (value) prepDetails.set(key, value);
  }
  const prepToolHref = `${buildWorkspaceToolHref('prep', workspaceEvent)}&${prepDetails.toString()}&view=share`;
  const statsToolHref = buildWorkspaceToolHref('stats', workspaceEvent);
  const hypeToolHref = buildWorkspaceToolHref('hype', workspaceEvent);

  return (
    <section
      id="game-on-card-panel"
      className="mx-auto w-full max-w-[1400px] px-4 pb-5 sm:px-8"
      aria-labelledby="game-on-card-heading"
      data-testid="game-on-card-panel"
    >
      <div className="overflow-hidden rounded-[24px] border border-[#55A4FF]/25 bg-[#0B1F3A] text-white shadow-[0_18px_36px_rgba(11,31,58,.18)]">
        <div className="h-[7px] bg-[linear-gradient(90deg,#2474F5_0%,#55A4FF_58%,#FF6433_100%)]" />
        <div className="p-5 sm:p-7 lg:p-8">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#55A4FF]/40 bg-[#2878F5]/10 text-[#55A4FF]">
              <Trophy className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.18em] text-[#55A4FF]">Your next best step</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[.16em] text-white/40">Game On Card</p>
            </div>
          </div>
          <h2 id="game-on-card-heading" className="mt-6 font-display text-4xl font-black leading-[.95] tracking-tight sm:text-5xl">
            Share the game day.
          </h2>
          <p className="mt-3 max-w-3xl text-base font-medium leading-relaxed text-white/65 sm:text-[17px]">
            One simple link for event details. Prep and stats appear only when you choose to share them.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider text-white/65">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[.04] px-3 py-2">
              <ShieldCheck className="h-3.5 w-3.5 text-[#55A4FF]" /> Private prep by default
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[.04] px-3 py-2">
              <Activity className="h-3.5 w-3.5 text-[#55A4FF]" /> Stats appear when shared
            </span>
          </div>

          <div className="mt-7">
            {saved && !isEditing && (
              <div className="rounded-[18px] border border-[#55A4FF]/30 bg-white/[.05] p-4 sm:p-5" data-testid="game-on-card-saved">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                      <Check className="h-3.5 w-3.5" /> Link is active
                    </p>
                    <p className="mt-2 truncate font-display text-xl uppercase">
                      {saved.title}{saved.event.opponent ? ` vs ${saved.event.opponent}` : ''}
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
                {selectedPublicEvent && (
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
                  <Link href={statsToolHref} className="inline-flex min-h-10 items-center justify-center gap-2 border border-white/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:border-primary" data-testid="link-game-on-open-stats">
                    <Activity className="h-3.5 w-3.5" /> Track this game
                  </Link>
                  <Link href={hypeToolHref} className="inline-flex min-h-10 items-center justify-center gap-2 border border-white/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider hover:border-primary" data-testid="link-game-on-create-hype">
                    <Zap className="h-3.5 w-3.5" /> Make a Hype Card
                  </Link>
                </div>
                <div className="mt-4 flex flex-wrap gap-4 border-t border-white/10 pt-3">
                  <button type="button" onClick={() => setIsEditing(true)} className="text-[10px] font-bold uppercase tracking-widest text-white/65 hover:text-white" data-testid="button-edit-game-on-card">Update event details</button>
                  <button type="button" onClick={() => void handleRevoke()} disabled={busy} className="text-[10px] font-bold uppercase tracking-widest text-red-200 hover:text-red-100 disabled:opacity-50" data-testid="button-revoke-game-on-card">{busy ? 'Working…' : 'Revoke link'}</button>
                </div>
              </div>
            )}
          </div>

          {(!saved || isEditing) && (
            <div className="mt-7 rounded-[18px] border border-white/12 bg-[#07172b]/70 p-4 sm:p-6" data-testid="game-on-card-form">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">
                    {saved ? 'Edit this card' : 'Start with one game'}
                  </p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-white/55">
                    {profile.athleteName ? `For ${profile.athleteName}. ` : ''}
                    Only event details are public on this card.
                  </p>
                </div>
                {saved && (
                  <button type="button" onClick={() => { setIsEditing(false); setDraft(saved.event); }} className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/55 hover:text-white">Cancel</button>
                )}
              </div>
              {games.length > 0 && (
                <label className="mb-3 block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/55">Start from a scheduled game</span>
                  <select
                    value={sourceEventId}
                    onChange={(event) => chooseScheduleGame(event.target.value)}
                    className="min-h-11 w-full rounded-[10px] border border-white/20 bg-[#0B1F3A] px-3 text-sm font-semibold text-white outline-none focus:border-[#55A4FF]"
                    data-testid="select-game-on-source-event"
                  >
                    <option value="new">Create one event card</option>
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>
                        {game.date || 'Date TBD'}{game.opponent ? ` · vs ${game.opponent}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/55">Opponent <span className="text-primary">*</span></span>
                  <input
                    value={draft.opponent}
                    onChange={(event) => setDraft((current) => ({ ...current, opponent: event.target.value }))}
                    maxLength={200}
                    placeholder="Who are they playing?"
                    className="min-h-11 w-full rounded-[10px] border border-white/20 bg-white/5 px-3 text-sm font-semibold text-white placeholder:text-white/30 outline-none focus:border-[#55A4FF]"
                    data-testid="input-game-on-opponent"
                  />
                </label>
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
                Checklist notes and private prep are not copied. Share a checklist from Prep only when you choose.
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
                {busy ? 'Saving…' : saved ? 'Update Game On Card' : 'Create and share Game On Card'}
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
  const dateLabel = prettyEventDate(data.event.date);
  const stageLabel = data.stage === 'final' ? 'Game complete' : data.stage === 'live' ? 'Game in progress' : 'Upcoming game';
  const prepHref = data.prepShareToken ? `/checklist/${data.prepShareToken}` : undefined;
  const statsHref = data.statsShareToken ? `/live/${data.statsShareToken}` : undefined;
  const athletePageHref = data.athletePageToken ? `/player/${data.athletePageToken}` : undefined;

  return (
    <div className="noise min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="font-display text-2xl uppercase tracking-wide text-foreground">Pixl Sports</Link>
          <span className="text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Shared game day</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-8 sm:py-12" data-testid="public-game-on-card">
        <section className="relative overflow-hidden border border-[#173a62] bg-[#0B1F3A] p-6 text-white shadow-xl sm:p-10">
          <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(135deg,transparent_0_47%,rgba(0,124,248,.5)_48%_50%,transparent_51%_100%)] [background-size:36px_36px]" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 border border-primary/50 bg-primary/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.2em] text-primary">
              <Zap className="h-3.5 w-3.5" /> Game On
            </div>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[.22em] text-white/50">{stageLabel}</p>
            <h1 className="mt-2 font-display text-4xl uppercase leading-[.9] tracking-wide sm:text-6xl">{data.title}</h1>
            {data.athleteName && <p className="mt-3 text-sm font-semibold text-white/70">Following {data.athleteName}</p>}
            <div className="mt-7 grid gap-5 border-t border-white/15 pt-6 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Next up</p>
                <p className="mt-2 font-display text-3xl uppercase sm:text-4xl">
                  {data.event.opponent ? `vs ${data.event.opponent}` : 'Game day'}
                </p>
                <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-white/70">
                  <CalendarDays className="h-4 w-4 text-primary" /> {dateLabel}
                </p>
                {data.event.time && <p className="mt-1 text-sm font-semibold text-white/60">{data.event.time}</p>}
              </div>
              {data.event.location && (
                <div className="sm:border-l sm:border-white/15 sm:pl-6">
                  <p className="text-[10px] font-bold uppercase tracking-[.18em] text-primary">Where</p>
                  <p className="mt-2 flex items-start gap-2 text-base font-semibold leading-relaxed text-white/85">
                    <MapPin className="mt-1 h-4 w-4 shrink-0 text-primary" /> {data.event.location}
                  </p>
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(data.event.location)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-primary hover:text-white"
                  >
                    Open map <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mt-8" aria-labelledby="game-on-destinations-heading">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Follow the event</p>
              <h2 id="game-on-destinations-heading" className="mt-1 font-display text-2xl uppercase tracking-wide text-foreground">Game day links</h2>
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
            <PublicDestination
              icon={Activity}
              title={data.stage === 'final' ? 'Game stats' : 'Live stats'}
              detail={data.statsState === 'expired'
                ? 'The temporary stats link has expired. The event remains on this card.'
                : data.statsState === 'live'
                ? 'Follow the shared game stats as they update.'
                : data.statsState === 'final'
                  ? 'Review the completed game stats.'
                  : 'Stats will appear here when the owner starts and shares the event-specific tracker.'}
              href={statsHref}
              action={data.statsState === 'final' ? 'View final stats' : 'Follow live stats'}
              testId="game-on-stats-destination"
            />
            <PublicDestination
              icon={Sparkles}
              title={data.athleteName ? `${data.athleteName}’s Athlete Page` : 'Athlete Hype Page'}
              detail={data.athletePageState === 'published'
                ? 'See the athlete’s latest published updates.'
                : data.athletePageState === 'paused'
                  ? 'The athlete’s page is currently paused by its owner.'
                  : 'The owner has not published an Athlete Hype Page yet.'}
              href={athletePageHref}
              action="Visit Athlete Page"
              testId="game-on-athlete-page-destination"
            />
          </div>
        </section>
        <p className="mt-8 text-center text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Shared from Pixl Sports</p>
      </main>
    </div>
  );
}