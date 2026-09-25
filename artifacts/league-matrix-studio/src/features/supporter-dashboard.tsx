import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetSupporterActiveGameQueryKey,
  getListOwnedGameOnCardsQueryKey,
  useGetSupporterActiveGame,
  useListOwnedGameOnCards,
  useUpdateSupporterActiveGame,
} from '@workspace/api-client-react';
import {
  CalendarDays, Zap, MapPin, Trophy, ChevronRight, User, ClipboardCheck,
  Users, Activity, Image as ImageIcon,
  ArrowRight, PenSquare, Loader2, AlertTriangle, Camera, Trash2, X,
  Home, Menu, RotateCcw
} from 'lucide-react';
import { differenceInCalendarDays, format, parseISO, isValid } from 'date-fns';
import {
  getActiveSupporterGame,
  getSupporterGameStage,
  getSupporterPreparationContext,
  getSupporterPreparationCopy,
  getSupporterWeekRecommendation,
  getSupporterStageAcknowledgmentKey,
  hasAcknowledgedSupporterGameStage,
  acknowledgeSupporterGameStage,
  parseSupporterStorageSyncEvent,
  readSupporterActiveGame,
  saveSupporterActiveGame,
  supporterActiveGameStorageKey,
  supporterToolRoutes,
  type SupporterGameStage,
} from './supporter-dashboard-model';
import type { ScheduleEventStatus } from './schedule-draft';
import { HypeCardThumbnail } from './hype-card-thumbnail';
import { HypeCardReplyInboxTrigger } from './hype-card-reply-inbox';
import { GameOnCardPanel } from './game-on-card';
import { GameOnInlineEditor } from './game-on-inline-editor';
import {
  GAME_ON_STATUS_FILTERS,
  GameOnDashboardCollection,
  type GameOnCardRenderOptions,
  type GameOnStatusFilter,
} from './game-on-dashboard-collection';
import { buildGameOnDashboardEntries, type OwnedGameOnShare } from './game-on-dashboard-model';
import { readSavedGameOnCards, type SavedGameOnCard } from './game-on-card-storage';
import { readStoredTrackerData, type Sport } from './stat-tracker';
import { NotificationSettings } from './notification-settings';
import { trackEvent } from '../lib/analytics';
import {
  buildWorkspaceToolHref,
  readWorkspaceEventContext,
  saveWorkspaceEventContext,
  workspaceEventContextStorageKey,
  type WorkspaceEventContext,
} from './workspace-context';
import './supporter-dashboard-pixl.css';

export interface SupporterProfile {
  displayName: string;
  teamName: string;
  athleteName: string;
  jerseyNumber: string;
  position: string;
  relationship: string;
  accessMode: 'full' | 'guest' | null;
  sport: Sport | null;
}

export interface SupporterEvent {
  id: string;
  type: 'game' | 'practice' | 'meeting';
  date: string;
  time: string;
  status?: ScheduleEventStatus;
  completedAt?: string;
  location: string;
  opponent?: string;
  notes?: string;
}

export interface SupporterProject {
  id: string;
  name: string;
  kind: 'hype-card' | 'schedule';
  updatedAt: string | Date;
  href: string;
  thumbnailProject?: unknown;
}

export interface SupporterScheduleOption {
  id: string;
  label: string;
  name?: string;
  teamName: string;
  season: string;
  revision?: number;
  updatedAt: string | Date;
  eventCount: number;
}

export interface AthletePhotoCrop {
  x: number;
  y: number;
  zoom: number;
}

function athleteInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return initials || 'A';
}

interface AthleteCardPreviewProps {
  profile: SupporterProfile;
  athletePhotoUrl?: string;
  athletePhotoCrop?: AthletePhotoCrop;
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
  testId?: string;
  className?: string;
}

function AthleteCardPreview({
  profile,
  athletePhotoUrl,
  athletePhotoCrop = { x: 50, y: 50, zoom: 100 },
  href,
  onClick,
  ariaLabel = 'Change athlete',
  testId,
  className,
}: AthleteCardPreviewProps) {
  const hasAthlete = Boolean(profile.athleteName);
  const content = (
    <>
      <div className="mobile-athlete-lockup flex min-w-0 flex-1 items-center gap-3">
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-white shadow-sm">
          {athletePhotoUrl ? (
            <div className="h-full w-full overflow-hidden rounded-full">
              <AthletePhoto url={athletePhotoUrl} crop={athletePhotoCrop} alt={`${profile.athleteName || 'Athlete'} profile`} />
            </div>
          ) : hasAthlete ? (
            <span className="font-display text-xl font-bold text-primary" aria-label={`${athleteInitials(profile.athleteName)} initials`}>
              {athleteInitials(profile.athleteName)}
            </span>
          ) : (
            <Users className="h-6 w-6 opacity-20" />
          )}
        </div>
        <div className="mobile-athlete-copy text-lg font-bold text-[#12213A] flex min-w-0 items-center flex-wrap gap-1.5 leading-none">
          <span className="truncate">{hasAthlete ? profile.athleteName : 'Unassigned'}</span>
          {profile.jerseyNumber && <><span className="text-black/30 text-sm shrink-0">•</span><span className="text-black/50 font-semibold shrink-0">#{profile.jerseyNumber}</span></>}
          {profile.teamName && <><span className="text-black/30 text-sm shrink-0">•</span><span className="text-black/50 font-semibold break-words">{profile.teamName}</span></>}
        </div>
      </div>
      <ChevronRight className="w-6 h-6 text-black/30 shrink-0" aria-hidden="true" />
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`athlete-card-preview${className ? ` ${className}` : ''}`} aria-label={ariaLabel} data-testid={testId}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`athlete-card-preview${className ? ` ${className}` : ''}`} aria-label={ariaLabel} data-testid={testId}>
        {content}
      </button>
    );
  }

  return (
    <div className={`athlete-card-preview${className ? ` ${className}` : ''}`} role="img" aria-label="Athlete card preview" data-testid={testId}>
      {content}
    </div>
  );
}

export interface SupporterDashboardViewProps {
  profile: SupporterProfile;
  userId?: string | null;
  prepUserId?: string | null;
  events: SupporterEvent[];
  onSaveCalendarEvent?: (event: SupporterEvent) => Promise<void>;
  onCompleteScheduledGame?: (eventId: string, completedAt: string) => Promise<void>;
  nextGameIsUpcoming: boolean;
  projects: SupporterProject[];
  scheduleSource: 'custom' | null;
  connectionLabel: string;
  selectionSyncReady?: boolean;
  athletePhotoUrl?: string;
  athletePhotoCrop?: AthletePhotoCrop;
  onSignOut?: () => void;
}

function gameOnStatusFilterStorageKey(userId: string) {
  return `pixlsports-game-on-status-filter:${encodeURIComponent(userId)}`;
}

function readGameOnStatusFilter(userId?: string | null): GameOnStatusFilter {
  if (!userId || typeof window === 'undefined') return 'All statuses';
  try {
    const storedFilter = window.sessionStorage.getItem(gameOnStatusFilterStorageKey(userId));
    return GAME_ON_STATUS_FILTERS.includes(storedFilter as GameOnStatusFilter)
      ? storedFilter as GameOnStatusFilter
      : 'All statuses';
  } catch {
    return 'All statuses';
  }
}

function formatDateDisplay(dateStr: string) {
  try {
    const d = parseISO(dateStr);
    if (isValid(d)) {
      return format(d, 'MMM d, yyyy');
    }
  } catch {
    // ignore
  }
  return dateStr;
}

function formatTimeDisplay(time: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return time;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return time;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${match[2]} ${suffix}`;
}

function formatDaysUntil(dateStr: string) {
  const date = parseISO(dateStr);
  if (!isValid(date)) return 'Next event';
  const days = differenceInCalendarDays(date, new Date());
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}

function formatRelativeTime(date: string | Date) {
  try {
    const d = typeof date === 'string' ? parseISO(date) : date;
    if (isValid(d)) {
      return format(d, 'MMM d, yyyy');
    }
  } catch (e) {
    // ignore
  }
  return String(date);
}

function getEventDateParts(dateStr: string) {
  try {
    const d = parseISO(dateStr);
    if (isValid(d)) {
      return {
        month: format(d, 'MMM'),
        day: format(d, 'd'),
        dayOfWeek: format(d, 'EEE')
      };
    }
  } catch (e) {
    // ignore
  }
  return { month: 'TBD', day: '-', dayOfWeek: '' };
}

const stageCopy: Record<SupporterGameStage, {
  label: string;
  kicker: string;
  description: string;
  accent: string;
}> = {
  upcoming: {
    label: 'Get ready',
    kicker: 'Next up',
    description: 'Pack the details now so your next event feels easy.',
    accent: 'Preparation',
  },
  live: {
    label: 'Capture the game',
    kicker: 'Capture window open',
    description: 'Your capture window is open. Start game day and save the moments worth replaying.',
    accent: 'Capture',
  },
  completed: {
    label: 'Send the hype',
    kicker: 'After the whistle',
    description: 'Turn the best part of the game into something worth sharing.',
    accent: 'Celebrate',
  },
};

export function SupporterDashboardView({
  profile,
  userId,
  prepUserId,
  events,
  onSaveCalendarEvent,
  onCompleteScheduledGame,
  nextGameIsUpcoming,
  projects,
  scheduleSource,
  connectionLabel,
  selectionSyncReady = true,
  athletePhotoUrl,
  athletePhotoCrop = { x: 50, y: 50, zoom: 100 },
  onSignOut,
}: SupporterDashboardViewProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const activeGameSelectionQueryKey = [...getGetSupporterActiveGameQueryKey(), userId ?? null];
  const activeGameSelectionQuery = useGetSupporterActiveGame({
    query: {
      enabled: Boolean(userId && selectionSyncReady),
      queryKey: activeGameSelectionQueryKey,
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
    },
  });
  const updateActiveGameSelection = useUpdateSupporterActiveGame();
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activeFilterUserId = userId ?? null;
  const [gameOnFilterSelection, setGameOnFilterSelection] = useState<{
    userId: string | null;
    filter: GameOnStatusFilter;
  }>(() => ({
    userId: activeFilterUserId,
    filter: readGameOnStatusFilter(activeFilterUserId),
  }));
  const gameOnStatusFilter = gameOnFilterSelection.userId === activeFilterUserId
    ? gameOnFilterSelection.filter
    : readGameOnStatusFilter(activeFilterUserId);
  const updateGameOnStatusFilter = (filter: GameOnStatusFilter) => {
    if (userId) {
      try {
        window.sessionStorage.setItem(gameOnStatusFilterStorageKey(userId), filter);
      } catch {
        // Keep the filter usable for this mounted dashboard when session storage is unavailable.
      }
    }
    setGameOnFilterSelection({ userId: activeFilterUserId, filter });
  };
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const ownedGameOnCardsQuery = useListOwnedGameOnCards({
    query: {
      enabled: Boolean(userId),
      queryKey: [...getListOwnedGameOnCardsQueryKey(), userId ?? null],
      refetchOnWindowFocus: true,
    },
  });
  const [localGameOnCards, setLocalGameOnCards] = useState<SavedGameOnCard[]>(() => userId ? readSavedGameOnCards(userId) : []);
  const [cardSelection, setCardSelection] = useState<{ kind: 'event' | 'share'; id: string; nonce: number } | null>(null);
  const [newCardDraft, setNewCardDraft] = useState<{
    id: string;
    nonce: number;
    event: SupporterEvent;
    sourceEventId: string;
    editing: boolean;
  } | null>(null);
  const [cardLayoutIds, setCardLayoutIds] = useState<Record<string, string>>({});
  const nextNewCardNonce = useRef(0);
  const [isDesktopDashboard, setIsDesktopDashboard] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  ));
  useEffect(() => {
    setCardSelection(null);
    setNewCardDraft(null);
    setCardLayoutIds({});
    setLocalGameOnCards(userId ? readSavedGameOnCards(userId) : []);
    if (!userId) return;
    const syncCards = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key && event.key !== `pixlsports-game-on-card:${userId}` && event.key !== `pixlsports-game-on-cards:${userId}`) return;
      setLocalGameOnCards(readSavedGameOnCards(userId));
      void queryClient.invalidateQueries({ queryKey: getListOwnedGameOnCardsQueryKey() });
    };
    window.addEventListener('storage', syncCards);
    return () => window.removeEventListener('storage', syncCards);
  }, [userId, queryClient]);
  const selectionTouchedForUserRef = useRef<string | null>(null);
  const lastReconciledRemoteSelectionRef = useRef<{ userId: string; gameId: string | null } | null>(null);
  const [selectionSyncError, setSelectionSyncError] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return readWorkspaceEventContext(window.localStorage)?.id
      ?? readSupporterActiveGame(window.localStorage);
  });
  const [selectedThisSessionGameId, setSelectedThisSessionGameId] = useState<string | null>(null);
  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const updateViewport = () => setIsDesktopDashboard(desktop.matches);
    updateViewport();
    desktop.addEventListener('change', updateViewport);
    return () => desktop.removeEventListener('change', updateViewport);
  }, []);

  const hasAthlete = Boolean(profile.athleteName);
  const gameEvents = events.filter((event) => event.type === 'game');
  const recommendedGame = getActiveSupporterGame(gameEvents, null, currentTime);
  const activeJourneyEvents = events.filter((event) => event.type !== 'meeting');
  const selectedWorkspaceEvent = activeJourneyEvents.find((event) => event.id === selectedGameId);
  const weekRecommendation = getSupporterWeekRecommendation(
    activeJourneyEvents,
    currentTime,
  );
  const recommendedPreparationEvent = selectedWorkspaceEvent ?? getSupporterPreparationContext(
    weekRecommendation,
    gameEvents,
    selectedGameId,
    selectedThisSessionGameId === selectedGameId,
    currentTime,
  );
  const nextGame = getActiveSupporterGame(gameEvents, selectedGameId, currentTime);
  const contextEvent = recommendedPreparationEvent ?? nextGame;
  const serverCardShares = ownedGameOnCardsQuery.data ?? [];
  const serverCardTokens = new Set(serverCardShares.map((share) => share.shareToken));
  const localCardShares: OwnedGameOnShare[] = localGameOnCards
    .filter((card) => !serverCardTokens.has(card.shareToken))
    .map((card) => ({
      shareToken: card.shareToken,
      title: card.title,
      createdAt: card.savedAt,
      events: [{ ...card.event, type: card.event.type ?? 'game' }],
    }));
  const ownedGameOnShares: OwnedGameOnShare[] = [...serverCardShares, ...localCardShares];
  const completedLocalGames = userId
    ? readStoredTrackerData(window.localStorage, userId).games.filter((game) => game.status === 'final')
    : [];
  const dashboardCards = buildGameOnDashboardEntries(events, ownedGameOnShares, profile.athleteName, currentTime, completedLocalGames);
  const newDraftCollectionCard = newCardDraft ? {
    id: newCardDraft.id,
    layoutId: newCardDraft.id,
    eventId: newCardDraft.event.id,
    type: newCardDraft?.event.type === 'practice' ? 'practice' as const : 'game' as const,
    athleteName: profile.athleteName || 'Your athlete',
    opponent: newCardDraft?.event.opponent ?? '',
    date: newCardDraft?.event.date ?? '',
    time: newCardDraft?.event.time ?? '',
    location: newCardDraft?.event.location ?? '',
    status: 'Draft' as const,
    isPublished: false,
    isUnsavedDraft: true,
  } : null;
  const replacedScheduleEventId = newCardDraft && newCardDraft.sourceEventId !== 'new'
    ? newCardDraft?.sourceEventId
    : undefined;
  const collectionCards = [
    ...dashboardCards
      .filter((card) => !replacedScheduleEventId || card.eventId !== replacedScheduleEventId)
      .map((card) => ({ ...card, layoutId: cardLayoutIds[card.id] ?? card.id })),
    ...(newDraftCollectionCard ? [newDraftCollectionCard] : []),
  ];
  const updateNewCardDraft = useCallback((event: SupporterEvent, sourceEventId: string) => {
    setNewCardDraft((previous) => {
      if (!previous) return previous;
      if (previous
        && previous.sourceEventId === sourceEventId
        && previous.event.id === event.id
        && previous.event.type === event.type
        && previous.event.date === event.date
        && previous.event.time === event.time
        && previous.event.location === event.location
        && previous.event.opponent === event.opponent) return previous;
      return { ...previous, event, sourceEventId };
    });
  }, []);
  const cancelNewCardDraft = useCallback(() => {
    setNewCardDraft(null);
  }, []);
  const openCardWorkspace = () => {
    if (newCardDraft) return;
    const nonce = ++nextNewCardNonce.current;
    const id = `new-card-${nonce}`;
    const eventId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `game-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const event: SupporterEvent = {
      id: eventId,
      type: 'game',
      date: '',
      time: '',
      location: '',
      opponent: '',
      status: 'upcoming',
    };
    setCardSelection(null);
    setNewCardDraft({ id, nonce, event, sourceEventId: 'new', editing: false });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector(`[data-testid="card-game-on-${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }));
  };
  const selectCard = (id: string) => {
    if (newCardDraft?.editing) {
      if (newCardDraft.id !== id) return;
      setNewCardDraft((previous) => previous ? { ...previous, editing: false } : previous);
      return;
    }
    if (newCardDraft?.id === id) {
      setCardSelection(null);
      setNewCardDraft((previous) => previous ? { ...previous, editing: true } : previous);
      return;
    }
    setCardSelection((previous) => previous?.id === id ? null : {
      kind: id.startsWith('share:') ? 'share' : 'event', id, nonce: (previous?.nonce ?? 0) + 1,
    });
  };
  const handleGameOnCardChanged = (selectedId?: string) => {
    if (userId) setLocalGameOnCards(readSavedGameOnCards(userId));
    void queryClient.invalidateQueries({ queryKey: getListOwnedGameOnCardsQueryKey() });
    if (newCardDraft?.editing) {
      if (selectedId) {
        setCardLayoutIds((previous) => ({ ...previous, [selectedId]: newCardDraft.id }));
      }
      setNewCardDraft(null);
    }
    setCardSelection(null);
  };
  const renderSelectedGameOnCard = (
    card: (typeof collectionCards)[number],
    surface: 'mobile' | 'desktop',
    options: GameOnCardRenderOptions,
  ) => {
    if (newCardDraft?.editing && card.id === newCardDraft.id) {
      if ((surface === 'desktop') !== isDesktopDashboard) return null;
      return <GameOnCardPanel
        key={`new:${newCardDraft.nonce}`}
        profile={profile}
        userId={userId}
        events={events}
        selectedCard={null}
        startFresh
        embedded
        initialDraft={newCardDraft.event}
        initialSourceEventId={newCardDraft.sourceEventId}
        onDraftChange={updateNewCardDraft}
        onSaveCalendarEvent={onSaveCalendarEvent}
        existingCardTokensByEventId={Object.fromEntries(dashboardCards.filter((entry) => entry.shareToken).map((entry) => [entry.eventId, entry.shareToken!]))}
        onChanged={handleGameOnCardChanged}
      />;
    }
    return userId ? (
      <GameOnInlineEditor
        card={card}
        scheduledEvent={events.find((event) => event.id === card.eventId)}
        teamName={profile.teamName}
        userId={userId}
        view={options.view}
        onOpenPrep={options.onOpenPrep}
        onOpenTracker={options.onOpenTracker}
        onSaveCalendarEvent={onSaveCalendarEvent ?? (async () => { throw new Error('Calendar editing is unavailable. Refresh and try again.'); })}
        onChanged={handleGameOnCardChanged}
      />
    ) : null;
  };
  const renderMobileSelectedGameOnCard = (card: (typeof collectionCards)[number], options: GameOnCardRenderOptions) => renderSelectedGameOnCard(card, 'mobile', options);
  const renderDesktopSelectedGameOnCard = (card: (typeof collectionCards)[number], options: GameOnCardRenderOptions) => renderSelectedGameOnCard(card, 'desktop', options);
  const gameStage: SupporterGameStage = contextEvent
      ? getSupporterGameStage(contextEvent, currentTime)
      : nextGameIsUpcoming ? 'upcoming' : 'upcoming';
  const recommendedGameStage = recommendedGame
    ? getSupporterGameStage(recommendedGame, currentTime)
    : null;
  const isViewingPastGame = Boolean(
    nextGame
    && contextEvent === nextGame
    && recommendedGame
    && nextGame.id !== recommendedGame.id
    && gameStage === 'completed',
  );
  const currentStage = contextEvent && gameStage === 'upcoming'
    ? {
      ...stageCopy[gameStage],
      kicker: contextEvent.type === 'practice' ? 'Practice next' : stageCopy[gameStage].kicker,
      description: contextEvent.type === 'practice'
        ? 'Pack the essentials now so practice feels easy.'
        : 'Pack the details now so game day feels easy.',
    }
    : stageCopy[gameStage];
  const stageReminderGame = contextEvent?.type === 'game' ? contextEvent : undefined;
  const stageReminderKey = stageReminderGame
    ? getSupporterStageAcknowledgmentKey(stageReminderGame.id, gameStage)
    : null;
  const [, setReminderVersion] = useState(0);
  const showStageReminder = Boolean(
    stageReminderGame
    && stageReminderKey
    && typeof window !== 'undefined'
    && !hasAcknowledgedSupporterGameStage(window.localStorage, stageReminderGame.id, gameStage),
  );
  const gameTitle = nextGame
    ? `${profile.teamName || 'Your team'}${nextGame.opponent ? ` vs ${nextGame.opponent}` : ''}`
    : 'Your next game';
  const contextTitle = contextEvent?.type === 'practice'
    ? `${profile.teamName || 'Your team'} practice`
    : gameTitle;
  const preparationCopy = getSupporterPreparationCopy(contextEvent?.type ?? null);
  const preparationSchedule = contextEvent
    ? [formatDateDisplay(contextEvent.date), formatTimeDisplay(contextEvent.time)].filter(Boolean).join(' · ')
    : '';
  const preparationTitle = preparationSchedule
    ? `${preparationCopy.title.replace(/\.$/, '')} — ${preparationSchedule}`
    : preparationCopy.title;
  const contextDateParts = contextEvent ? getEventDateParts(contextEvent.date) : null;
  const toToolContext = (event: SupporterEvent | undefined): WorkspaceEventContext | undefined => event
    ? {
      id: event.id,
      type: event.type,
      date: event.date,
      time: event.time,
      location: event.location,
      opponent: event.opponent ?? '',
    }
    : undefined;
  const statTrackerHrefForGame = (game: SupporterEvent | undefined) => (
    buildWorkspaceToolHref('stats', toToolContext(game))
  );
  const statTrackerHref = statTrackerHrefForGame(nextGame);
  const checklistHrefForGame = (event: SupporterEvent | undefined, view?: 'share' | 'review') => {
    const href = buildWorkspaceToolHref('prep', toToolContext(event));
    return view && event ? `${href}&view=${view}` : href;
  };
  const contextChecklistHref = checklistHrefForGame(contextEvent);
  const hypeCardHref = buildWorkspaceToolHref('hype', toToolContext(contextEvent));

  useEffect(() => {
    if (!showStageReminder || !stageReminderGame || !stageReminderKey) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      acknowledgeSupporterGameStage(window.localStorage, stageReminderGame.id, gameStage);
      setReminderVersion((version) => version + 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameStage, showStageReminder, stageReminderGame, stageReminderKey]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key === workspaceEventContextStorageKey) {
        const context = readWorkspaceEventContext(window.localStorage);
        if (context && activeJourneyEvents.some((item) => item.id === context.id)) {
          setSelectedGameId(context.id);
        }
        return;
      }
      const syncEvent = parseSupporterStorageSyncEvent(event);
      if (!syncEvent) return;

      if (syncEvent.type === 'active-game') {
        if (!gameEvents.some((game) => game.id === syncEvent.gameId)) return;
        setSelectedGameId(syncEvent.gameId);
        return;
      }

      if (syncEvent.type === 'stage-acknowledgment' && syncEvent.key === stageReminderKey) {
        setReminderVersion((version) => version + 1);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [activeJourneyEvents, gameEvents, stageReminderKey]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileMenuOpen(false);
      window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  const dismissStageReminder = () => {
    if (!stageReminderGame) return;
    acknowledgeSupporterGameStage(window.localStorage, stageReminderGame.id, gameStage);
    setReminderVersion((version) => version + 1);
  };

  const persistActiveGameSelection = (gameId: string | null) => {
    if (!userId || !selectionSyncReady) return;
    setSelectionSyncError(false);
    void updateActiveGameSelection.mutateAsync({ data: { gameId } })
      .then((selection) => {
        queryClient.setQueryData(activeGameSelectionQueryKey, selection);
      })
      .catch(() => setSelectionSyncError(true));
  };

  const remoteSelectedGameId = activeGameSelectionQuery.data?.gameId ?? null;
  useEffect(() => {
    if (!userId || !selectionSyncReady || !activeGameSelectionQuery.isSuccess) return;
    const previous = lastReconciledRemoteSelectionRef.current;
    if (previous && previous.userId === userId && previous.gameId === remoteSelectedGameId) return;
    lastReconciledRemoteSelectionRef.current = { userId, gameId: remoteSelectedGameId };
    if (selectionTouchedForUserRef.current === userId) return;

    if (remoteSelectedGameId) {
      const remoteGame = gameEvents.find((game) => game.id === remoteSelectedGameId);
      if (remoteGame) {
        setSelectedGameId(remoteGame.id);
        try {
          saveSupporterActiveGame(window.localStorage, remoteGame.id);
          saveWorkspaceEventContext(window.localStorage, {
            ...remoteGame,
            opponent: remoteGame.opponent ?? '',
            snacks: '',
            drinks: '',
            notes: '',
          });
        } catch {
          // The server remains authoritative when browser storage is unavailable.
        }
        return;
      }

      selectionTouchedForUserRef.current = userId;
      setSelectedGameId(null);
      setSelectedThisSessionGameId(null);
      try {
        window.localStorage.removeItem(supporterActiveGameStorageKey);
        if (readWorkspaceEventContext(window.localStorage)?.id === remoteSelectedGameId) {
          window.localStorage.removeItem(workspaceEventContextStorageKey);
        }
      } catch {
        // A missing local cache does not prevent the server selection from clearing.
      }
      persistActiveGameSelection(null);
      return;
    }

    const cachedGameId = readSupporterActiveGame(window.localStorage)
      ?? readWorkspaceEventContext(window.localStorage)?.id
      ?? null;
    const cachedGame = gameEvents.find((game) => game.id === cachedGameId);
    if (cachedGame) {
      selectionTouchedForUserRef.current = userId;
      setSelectedGameId(cachedGame.id);
      persistActiveGameSelection(cachedGame.id);
    }
  }, [
    activeGameSelectionQuery.isSuccess,
    gameEvents,
    persistActiveGameSelection,
    remoteSelectedGameId,
    selectionSyncReady,
    userId,
  ]);

  const selectGame = (gameId: string) => {
    setSelectedGameId(gameId);
    setSelectedThisSessionGameId(gameId);
    const selectedEvent = activeJourneyEvents.find((event) => event.id === gameId);
    if (userId) selectionTouchedForUserRef.current = userId;
    try {
      if (selectedEvent) {
        saveWorkspaceEventContext(window.localStorage, {
          ...selectedEvent,
          opponent: selectedEvent.opponent ?? '',
          snacks: '',
          drinks: '',
          notes: '',
        });
      }
      if (selectedEvent?.type === 'game') {
        saveSupporterActiveGame(window.localStorage, gameId);
        persistActiveGameSelection(gameId);
      }
    } catch {
      // The selection still works for this session when storage is unavailable.
    }
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const firstName = profile.displayName ? profile.displayName.split(' ')[0] : 'Supporter';
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const mobileFeaturedEvent = weekRecommendation?.event ?? getActiveSupporterGame(gameEvents, null) ?? activeJourneyEvents[0];
  const mobileFeaturedTitle = mobileFeaturedEvent?.type === 'practice'
    ? `${profile.teamName || 'Your team'} practice`
    : `${profile.teamName || 'Your team'}${mobileFeaturedEvent?.opponent ? ` vs ${mobileFeaturedEvent.opponent}` : ''}`;
  const mobileFeaturedDateParts = mobileFeaturedEvent ? getEventDateParts(mobileFeaturedEvent.date) : null;

  return (
    <>
      {/* MOBILE VIEW */}
      <div className="supporter-dashboard-mobile-shell relative z-0 min-h-dvh w-full pixl-dashboard-mobile pb-[calc(7rem+env(safe-area-inset-bottom))] flex-col">
        {/* Mobile Header */}
        <header className="bg-white flex items-center justify-between px-4 h-16 shrink-0 border-b border-black/5 relative z-10" data-testid="mobile-header">
          <div className="flex items-center gap-2">
            <img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-6 w-auto object-contain" />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-11 h-11 flex items-center justify-center">
              <HypeCardReplyInboxTrigger className="mobile-notification-trigger !absolute inset-0 w-full h-full p-0 flex items-center justify-center bg-transparent border-none text-white shadow-none hover:bg-white/10" />
            </div>
            <Link href={supporterToolRoutes.profile} className="w-11 h-11 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center border border-black/10 text-lg font-bold text-slate-700" aria-label="Supporter profile" data-testid="btn-mobile-open-profile">
               {profile.displayName ? profile.displayName.charAt(0).toUpperCase() : 'S'}
            </Link>
             <button
               ref={mobileMenuButtonRef}
               type="button"
               onClick={() => setMobileMenuOpen((open) => !open)}
               className="grid h-11 w-11 place-items-center rounded-full border border-white/20 text-white transition-colors hover:border-white/40 hover:bg-white/10"
               aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
               aria-expanded={mobileMenuOpen}
               aria-controls="mobile-dashboard-menu"
               data-testid="button-mobile-dashboard-menu"
             >
               {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
             </button>
          </div>
          {mobileMenuOpen && (
            <nav
              id="mobile-dashboard-menu"
              className="absolute inset-x-0 top-full border-b border-black/10 bg-white p-4 shadow-xl"
              aria-label="Mobile dashboard navigation"
              data-testid="mobile-dashboard-menu"
            >
              <div className="flex flex-col gap-2">
                <Link href="/studio" className="flex items-center justify-between bg-[#12213A] p-4 text-lg font-display tracking-wide text-white" onClick={() => setMobileMenuOpen(false)} data-testid="link-mobile-dashboard-home">
                  GAME DAY HUB <ArrowRight className="h-5 w-5 text-[#55A4FF]" />
                </Link>
                {onSignOut && (
                  <button type="button" onClick={() => { setMobileMenuOpen(false); onSignOut(); }} className="flex w-full items-center justify-between bg-black/5 p-4 text-left text-lg font-display tracking-wide text-destructive" data-testid="btn-mobile-dashboard-sign-out">
                    SIGN OUT <ArrowRight className="h-5 w-5" />
                  </button>
                )}
              </div>
            </nav>
          )}
        </header>

        {/* Content */}
        <div className="px-4 py-6 flex flex-col gap-6 flex-1">
          <section className="mobile-hero-banner" data-testid="mobile-hero-banner" aria-label="Athlete and next event">
          {/* Greeting */}
          <div>
            <h1 className="text-[34px] font-black font-display tracking-tight text-[#12213A] leading-none" data-testid="text-mobile-greeting">Good {greeting}, {firstName}.</h1>
          </div>

          <div className="mobile-hero-columns">
          {/* Athlete Switcher Row */}
          <AthleteCardPreview
            profile={profile}
            athletePhotoUrl={athletePhotoUrl}
            athletePhotoCrop={athletePhotoCrop}
            href={supporterToolRoutes.profile}
            testId="btn-mobile-athlete-switcher"
          />

          {/* Next Event Card */}
          <div className="bg-white rounded-[20px] p-5 shadow-sm border border-black/5" data-testid="card-mobile-featured-event">
            <div className="mobile-featured-event-header">
              <div className="mobile-featured-event-kicker" data-testid="mobile-featured-event-kicker">
                <span className="mobile-featured-event-kicker-dot" aria-hidden="true" />
                <span>{currentStage.kicker}</span>
                {scheduleSource && <><span className="mobile-featured-event-divider" aria-hidden="true">·</span><span className="mobile-featured-event-schedule">Your schedule</span></>}
              </div>
              {mobileFeaturedEvent && (
                <span className="mobile-featured-event-badge">
                  {gameStage === 'live' ? 'Live' : gameStage === 'completed' ? 'Final' : 'Next'}
                </span>
              )}
            </div>
            {mobileFeaturedEvent ? (
              <div className="flex items-start gap-4">
                <div className="mobile-featured-event-date" aria-hidden="true">
                  <span>{mobileFeaturedDateParts?.month}</span>
                  <strong>{mobileFeaturedDateParts?.day}</strong>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[22px] font-bold font-display tracking-tight text-[#12213A] leading-tight mb-1.5 break-words">{mobileFeaturedTitle}</h2>
                  <div className="text-[15px] font-medium text-black/60 flex items-center gap-1.5 flex-wrap mb-1">
                    <CalendarDays className="mobile-featured-event-meta-icon" aria-hidden="true" />
                    <span className="whitespace-nowrap">{formatDateDisplay(mobileFeaturedEvent.date)}</span>
                    <span className="text-black/30 font-bold">•</span>
                    <span className="whitespace-nowrap">{formatTimeDisplay(mobileFeaturedEvent.time)}</span>
                  </div>
                  {mobileFeaturedEvent.location && (
                    <div className="text-[15px] font-medium text-black/60 flex items-start gap-1.5 mt-1.5">
                      <MapPin className="w-4 h-4 text-black/40 shrink-0 mt-0.5" />
                      <span className="break-words min-w-0">{mobileFeaturedEvent.location}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
               <p className="text-sm font-medium text-black/60">No upcoming events. Add a game to get recommendations.</p>
            )}
            <Link
              href={supporterToolRoutes.profile}
              className="mobile-athlete-details"
              aria-label="View or change athlete"
              data-testid="btn-mobile-athlete-details"
            >
              <span className="mobile-athlete-details-name">{hasAthlete ? profile.athleteName : 'Unassigned'}</span>
              {hasAthlete && (profile.jerseyNumber || profile.teamName) && (
                <span className="mobile-athlete-details-meta">
                  {profile.jerseyNumber && <span>#{profile.jerseyNumber}</span>}
                  {profile.jerseyNumber && profile.teamName && <span aria-hidden="true">•</span>}
                  {profile.teamName && <span>{profile.teamName}</span>}
                </span>
              )}
              <ChevronRight className="mobile-athlete-details-arrow" aria-hidden="true" />
            </Link>
          </div>
          </div>
          </section>
          <GameOnDashboardCollection
            cards={collectionCards}
            statusFilter={gameOnStatusFilter}
            onStatusFilterChange={updateGameOnStatusFilter}
            onCreate={openCardWorkspace}
            createDisabled={Boolean(newCardDraft)}
            onOpen={selectCard}
            onCancelDraft={cancelNewCardDraft}
            selectedId={newCardDraft?.editing ? newCardDraft.id : cardSelection?.id}
            isActiveShell={!isDesktopDashboard}
            upNextEventId={gameStage === 'upcoming' ? contextEvent?.id : undefined}
            renderSelectedCard={renderMobileSelectedGameOnCard}
            statTrackerUserId={userId}
            prepUserId={prepUserId ?? userId}
            statTrackerSport={profile.sport}
            statTrackerAthleteName={profile.athleteName}
            statTrackerTeamName={profile.teamName}
            onCompleteScheduledGame={onCompleteScheduledGame}
          />
          <Link href={hypeCardHref} className="inline-flex min-h-11 self-start items-center gap-2 rounded-md border border-[#2474F5]/30 bg-white px-4 py-2 text-xs font-bold text-[#17467b]" data-testid="link-mobile-independent-hype">
            <Zap size={16} aria-hidden="true" /> Make a Hype Card
          </Link>
          {ownedGameOnCardsQuery.isError && userId && (
            <p role="alert" className="text-sm text-red-700">Published cards could not be refreshed. Showing cards saved on this device.</p>
          )}

        </div>

        <footer className="mx-4 mt-8 flex items-center justify-center gap-6 border-t border-[#12213A]/15 pt-5 text-xs font-bold uppercase tracking-wider text-[#334969]">
          <Link href="/help" className="hover:text-[#2474F5]" data-testid="link-mobile-dashboard-footer-help">Help / FAQ</Link>
          <Link href="/privacy" className="hover:text-[#2474F5]" data-testid="link-mobile-dashboard-footer-privacy">Privacy</Link>
        </footer>

        {/* Bottom Navigation */}
        <nav
          className="fixed inset-x-0 bottom-0 z-[60] box-border flex h-[calc(88px+env(safe-area-inset-bottom))] items-start justify-around border-t border-black/5 bg-white px-2 pb-[env(safe-area-inset-bottom)] pt-2 shadow-[0_-8px_30px_rgba(0,0,0,0.04)]"
          data-testid="mobile-bottom-nav"
        >
           <button type="button" onClick={() => setLocation('/studio')} className="flex min-w-0 max-w-20 flex-1 flex-col items-center justify-center h-[52px] gap-1 text-[#2474F5]" aria-label="Home" data-testid="btn-mobile-nav-home">
             <div className="w-8 h-8 rounded-full bg-[#2474F5]/10 flex items-center justify-center">
               <Home className="w-[20px] h-[20px] fill-current" />
             </div>
             <span className="text-[10px] font-bold">Home</span>
           </button>
            <Link href={buildWorkspaceToolHref('calendar', toToolContext(contextEvent))} className="flex min-w-0 max-w-20 flex-1 flex-col items-center justify-center h-[52px] gap-1 text-white/75 hover:text-white transition-colors" aria-label="Schedule" data-testid="btn-mobile-nav-schedule">
             <div className="w-8 h-8 rounded-full flex items-center justify-center">
               <CalendarDays className="w-[20px] h-[20px]" />
             </div>
             <span className="text-[10px] font-bold">Calendar</span>
           </Link>
            <button type="button" onClick={() => setLocation(contextChecklistHref)} className="flex min-w-0 max-w-20 flex-1 flex-col items-center justify-center h-[52px] gap-1 text-white/75 hover:text-white transition-colors" aria-label="Prep" data-testid="btn-mobile-nav-prep">
             <div className="w-8 h-8 rounded-full flex items-center justify-center">
               <ClipboardCheck className="w-[20px] h-[20px]" />
             </div>
             <span className="text-[10px] font-bold">Prep</span>
           </button>
            <button type="button" onClick={() => setLocation(statTrackerHrefForGame(contextEvent?.type === 'game' ? contextEvent : undefined))} className="flex min-w-0 max-w-20 flex-1 flex-col items-center justify-center h-[52px] gap-1 text-white/75 hover:text-white transition-colors" aria-label="Stats" data-testid="btn-mobile-nav-stat-tracker">
             <div className="w-8 h-8 rounded-full flex items-center justify-center">
               <Activity className="w-[20px] h-[20px]" />
             </div>
             <span className="text-[10px] font-bold">Stats</span>
           </button>
            <button type="button" onClick={() => setLocation(hypeCardHref)} className="flex min-w-0 max-w-20 flex-1 flex-col items-center justify-center h-[52px] gap-1 text-white/75 hover:text-white transition-colors" aria-label="Hype" data-testid="btn-mobile-nav-hype">
             <div className="w-8 h-8 rounded-full flex items-center justify-center">
               <Zap className="w-[20px] h-[20px]" />
             </div>
             <span className="text-[10px] font-bold">Hype</span>
           </button>
        </nav>
      </div>

      {/* DESKTOP VIEW (hidden on mobile) */}
      <div className="supporter-dashboard-desktop-shell w-full">
    <div className="pixl-dashboard w-full max-w-[1400px] mx-auto px-5 py-8 sm:px-8 space-y-12">
      {showStageReminder && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stage-reminder-heading"
          data-testid="stage-reminder-dialog"
        >
          <div className="relative w-full max-w-lg border border-primary/40 bg-card p-6 shadow-2xl clip-angled sm:p-8">
            <button
              type="button"
              onClick={dismissStageReminder}
              className="absolute right-4 top-4 grid h-10 w-10 place-items-center border border-border bg-muted text-foreground transition-colors hover:border-primary hover:text-primary"
              aria-label="Close stage reminder"
              data-testid="stage-reminder-close"
            >
              <X className="h-5 w-5" />
            </button>
            <p className="pr-12 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">{currentStage.kicker}</p>
            <h2 id="stage-reminder-heading" className="mt-3 pr-12 font-display text-4xl uppercase tracking-wide">{currentStage.label}</h2>
            <p className="mt-4 text-base font-medium leading-relaxed text-muted-foreground">{currentStage.description}</p>
            <p className="mt-4 border-l-2 border-primary pl-3 text-sm font-bold uppercase tracking-wide">{gameTitle}</p>
            <button
              type="button"
              onClick={dismissStageReminder}
              className="mt-7 inline-flex min-h-12 w-full items-center justify-center bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90 clip-angled-sm"
              data-testid="stage-reminder-got-it"
            >
              Got it
            </button>
          </div>
        </div>
      )}
      <div className="dashboard-hero-banner">
        {/* HEADER */}
        <header className="dashboard-header animate-slide-up">
          <section className="athlete-hero-depth relative overflow-hidden border border-border/20 bg-foreground text-background clip-angled" aria-labelledby="athlete-summary-heading" data-testid="athlete-summary">
            <div className="absolute inset-0 bg-tech-grid-dark opacity-20 pointer-events-none" />
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-[80px] mix-blend-screen pointer-events-none" />
            <div className="relative flex items-center gap-4 bg-[#111316] p-4 sm:gap-5 sm:p-5">
              <div className="relative shrink-0">
                <div className="dashboard-athlete-avatar flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary bg-background text-foreground shadow-[0_0_26px_rgba(22,232,120,0.25)] sm:h-20 sm:w-20" data-testid="desktop-athlete-photo">
                  {athletePhotoUrl ? (
                    <div className="h-full w-full overflow-hidden rounded-full">
                      <AthletePhoto url={athletePhotoUrl} crop={athletePhotoCrop} alt={`${profile.athleteName || 'Athlete'} profile`} />
                    </div>
                  ) : hasAthlete ? (
                    <span className="font-display text-2xl font-bold text-primary sm:text-3xl" aria-label={`${athleteInitials(profile.athleteName)} initials`}>
                      {athleteInitials(profile.athleteName)}
                    </span>
                  ) : (
                    <Users className="h-8 w-8 opacity-20 sm:h-10 sm:w-10" />
                  )}
                </div>
                <Link
                  href={supporterToolRoutes.profile}
                  className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-foreground text-background transition-transform hover:scale-110 sm:h-7 sm:w-7"
                  aria-label="Edit athlete profile"
                  title="Edit athlete profile"
                  data-testid="btn-edit-athlete-avatar"
                >
                  <PenSquare className="h-3 w-3" />
                </Link>
              </div>
              <div className="min-w-0 flex-1">
                <div className="dashboard-welcome mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/65">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                  {profile.displayName ? `GOOD ${greeting.toUpperCase()}, ${firstName.toUpperCase()}` : 'YOUR SPORTS HOME'}
                </div>
                <h2 id="athlete-summary-heading" className="mt-1 break-words font-display text-2xl uppercase leading-none tracking-wide text-white sm:text-3xl">
                  {hasAthlete ? profile.athleteName : 'Unassigned'}
                </h2>
                {hasAthlete ? (
                  <div className="dashboard-athlete-meta mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-white/65 sm:text-xs">
                    {profile.jerseyNumber && <span><span className="text-primary">#</span>{profile.jerseyNumber}</span>}
                    {profile.jerseyNumber && profile.teamName && <span className="opacity-40">•</span>}
                    {profile.teamName && <span data-testid="athlete-team-name">{profile.teamName}</span>}
                    {(profile.position || profile.relationship) && <span className="basis-full pt-1 text-[9px] tracking-[0.16em] text-white/45">{[profile.position, profile.relationship].filter(Boolean).join(' · ')}</span>}
                  </div>
                ) : (
                  <Link href={supporterToolRoutes.profile} className="mt-2 inline-block text-left text-xs font-medium text-white/65 underline decoration-primary underline-offset-4 hover:text-white" data-testid="btn-setup-athlete">
                    Set up athlete details
                  </Link>
                )}
              </div>
              <div className="relative z-10 shrink-0">
                <HypeCardReplyInboxTrigger className="!px-2.5 !py-2" />
              </div>
            </div>
          </section>
        </header>

        <section
          className="animate-slide-up delay-100 relative overflow-hidden border border-foreground/10 bg-[#111316] text-white clip-angled"
          data-testid="section-next-game-context"
          aria-labelledby="next-game-heading"
        >
        <div className="pointer-events-none absolute inset-0 bg-tech-grid-dark opacity-25" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative grid gap-8 p-5 sm:p-8 lg:grid-cols-[1.2fr_.8fr] lg:gap-12 lg:p-10">
          <div className="dashboard-event-primary">
            <div className="dashboard-event-top">
            {contextDateParts && (
              <div className="dashboard-event-date-row flex shrink-0 flex-wrap items-end gap-3" data-testid="next-event-date">
                <div className="dashboard-event-date flex flex-col items-center justify-center border border-white/20 bg-white/10 px-4 py-2 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">{contextDateParts.month}</span>
                  <span className="font-display text-4xl leading-none text-white">{contextDateParts.day}</span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/45">{contextDateParts.dayOfWeek}</span>
                </div>
              </div>
            )}
              <div className="dashboard-event-copy min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                  {currentStage.kicker}
                  {scheduleSource && <span className="text-white/45">· Your schedule</span>}
                </div>
                <div className="dashboard-event-title-row mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
                  <h2 id="next-game-heading" className="max-w-2xl break-words font-display text-4xl leading-[0.92] tracking-tight sm:text-6xl" data-testid="next-game-heading">
                    {contextEvent ? contextTitle : 'Make the next game count.'}
                  </h2>
                  {contextEvent && (
                    <span className="dashboard-event-badge inline-flex items-center bg-[#FF6433] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
                      {gameStage === 'live' ? 'Live now' : gameStage === 'completed' ? 'Final' : 'Up next'}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {isViewingPastGame && (
              <div
                className="mt-5 max-w-2xl break-words border-l-2 border-fuchsia-300 bg-fuchsia-300/[0.08] px-4 py-3"
                data-testid="past-game-notice"
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-200">Completed game</p>
                <p className="mt-1 break-words text-sm font-medium leading-relaxed text-white/70">
                  You&apos;re viewing a past game. The newer game marked Next in your week path is still your recommended next step.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (recommendedGame) selectGame(recommendedGame.id);
                  }}
                  className="mt-4 inline-flex min-h-10 max-w-full flex-wrap items-center justify-center gap-2 border border-fuchsia-200/50 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-fuchsia-100 transition-colors hover:border-fuchsia-100 hover:bg-fuchsia-200/10"
                  data-testid="button-return-to-recommended-game"
                >
                  Return to recommended game <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {contextEvent ? (
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-white/65">
                <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-primary" />{formatDateDisplay(contextEvent.date)}</span>
                <span className="text-white/30">·</span>
                <span>{formatTimeDisplay(contextEvent.time)}</span>
                {contextEvent.location && <><span className="text-white/30">·</span><span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-primary" />{contextEvent.location}</span></>}
              </div>
            ) : (
              <p className="mt-5 max-w-lg text-sm font-medium leading-relaxed text-white/65">
                Add a game or practice to the schedule and Pixl Sports will put the right action front and center.
              </p>
            )}
            {gameEvents.length > 1 && (
              <label className="mt-5 block max-w-md">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Active game</span>
                <select
                  value={nextGame?.id ?? ''}
                  onChange={(event) => selectGame(event.target.value)}
                  className="mt-2 w-full border border-white/20 bg-[#111316] px-3 py-3 text-sm font-bold uppercase tracking-wide text-white outline-none focus:border-primary"
                  aria-label="Choose the active game"
                  data-testid="select-active-supporter-game"
                >
                  {gameEvents.map((game) => (
                    <option key={game.id} value={game.id}>
                      {formatDateDisplay(game.date)} · {game.opponent || 'Opponent TBD'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectionSyncError && (
              <p className="mt-2 text-sm font-medium text-amber-100" role="status" data-testid="active-game-sync-error">
                Your game is saved on this device, but could not sync to your account.
              </p>
            )}
            <p className="mt-6 max-w-lg text-base font-medium leading-relaxed text-white/70">{currentStage.description}</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {gameStage === 'upcoming' && contextEvent && <button type="button" onClick={() => setLocation(contextChecklistHref)} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 clip-angled-sm" data-testid="button-context-checklist"><ClipboardCheck className="h-4 w-4" /> Open checklist</button>}
              {gameStage === 'live' && contextEvent?.type === 'game' && <button type="button" onClick={() => setLocation(statTrackerHref)} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 clip-angled-sm" data-testid="button-context-stat-tracker"><Activity className="h-4 w-4" /> Track the game</button>}
              {gameStage === 'live' && contextEvent?.type === 'practice' && <button type="button" onClick={() => setLocation(contextChecklistHref)} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 clip-angled-sm" data-testid="button-context-checklist"><ClipboardCheck className="h-4 w-4" /> Open checklist</button>}
              {gameStage === 'completed' && <Link href={hypeCardHref} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 clip-angled-sm" data-testid="link-context-hype-card"><Zap className="h-4 w-4" /> Make a Hype Card</Link>}
              {!contextEvent && <Link href="/studio/schedule" className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground clip-angled-sm" data-testid="link-context-schedule"><CalendarDays className="h-4 w-4" /> Add an event</Link>}
            </div>
          </div>
        </div>
        </section>
      </div>
      <GameOnDashboardCollection
        cards={collectionCards}
        statusFilter={gameOnStatusFilter}
        onStatusFilterChange={updateGameOnStatusFilter}
        onCreate={openCardWorkspace}
        createDisabled={Boolean(newCardDraft)}
        onOpen={selectCard}
        onCancelDraft={cancelNewCardDraft}
        selectedId={newCardDraft?.editing ? newCardDraft.id : cardSelection?.id}
        isActiveShell={isDesktopDashboard}
        upNextEventId={gameStage === 'upcoming' ? contextEvent?.id : undefined}
        renderSelectedCard={renderDesktopSelectedGameOnCard}
        statTrackerUserId={userId}
        prepUserId={prepUserId ?? userId}
        statTrackerSport={profile.sport}
        statTrackerAthleteName={profile.athleteName}
        statTrackerTeamName={profile.teamName}
        onCompleteScheduledGame={onCompleteScheduledGame}
      />
      <Link href={hypeCardHref} className="inline-flex min-h-11 self-start items-center gap-2 rounded-md border border-[#55A4FF]/30 bg-[#0B1F3A] px-4 py-2 text-xs font-bold text-white" data-testid="link-desktop-independent-hype">
        <Zap size={16} aria-hidden="true" /> Make a Hype Card
      </Link>
      {ownedGameOnCardsQuery.isError && userId && (
        <p role="alert" className="text-sm text-red-300">Published cards could not be refreshed. Showing cards saved on this device.</p>
      )}

      {/* TWO COLUMNS: UPCOMING & RECENT */}
      <div hidden>
        
        {/* TEAM SCHEDULE */}
        <section data-testid="section-upcoming">
          <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
            <div className="flex items-center gap-3">
              <h3 className="studio-textured-accent font-display text-2xl text-primary uppercase tracking-wide">Upcoming</h3>
              {scheduleSource && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hidden sm:flex items-center gap-1.5 border-l border-border/50 pl-3">
                  <CalendarDays className="w-3 h-3" /> Custom Schedule
                </span>
              )}
            </div>
            <Link href="/studio/schedule" className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/70 hover:text-foreground transition-colors flex items-center gap-1.5">
              View Calendar <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="bg-card border border-border relative min-h-[220px] flex flex-col clip-angled-sm">
            <div className="absolute inset-0 bg-tech-grid opacity-30 pointer-events-none" />
            <div className="relative p-3 sm:p-4 flex-1 flex flex-col">
              {events.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 text-center">
                  <p className="font-bold uppercase tracking-widest">No saved schedule yet</p>
                  <p className="text-sm max-w-xs text-balance">Create or open a schedule to see upcoming events here.</p>
                  <Link
                    href="/studio/schedule"
                    className="mt-2 inline-flex items-center gap-2 bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90 clip-angled-sm"
                  >
                    Open Schedule Maker <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {events.slice(0, 3).map((event, idx) => {
                    const isFirst = idx === 0;
                    const dateParts = getEventDateParts(event.date);
                    const title = event.opponent ? `${profile.teamName || 'Team'} vs ${event.opponent}` : (event.notes || 'Team Event');

                    if (isFirst) {
                      return (
                        <div key={event.id} className="group relative mb-2.5 grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 border border-primary/40 bg-primary/5 p-3 transition-colors hover:border-primary/60 sm:grid-cols-[4rem_minmax(0,1fr)_auto] clip-angled-sm">
                          {/* Date Block */}
                          <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-sm border border-border/50 bg-background shadow-sm sm:h-16 sm:w-16">
                            <span className="text-[11px] font-bold uppercase tracking-widest text-foreground/60 leading-none mb-1">{dateParts.month}</span>
                            <span className="font-display text-2xl leading-none text-foreground sm:text-3xl">{dateParts.day}</span>
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <div className="text-[10px] font-bold text-primary uppercase tracking-widest mb-0.5">
                              Next {event.type}
                            </div>
                            <div className="font-display text-xl uppercase tracking-wide leading-none truncate mb-1.5 group-hover:text-primary transition-colors">
                              {title}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground">
                              <span className="uppercase">{dateParts.dayOfWeek} · {formatTimeDisplay(event.time)}</span>
                              {event.location && (
                                <>
                                  <span className="opacity-50">•</span>
                                  <span className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{event.location}</span></span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Badges and Actions */}
                          <div className="col-span-2 mt-0.5 flex w-full shrink-0 flex-row items-center justify-between gap-2 border-t border-border/30 pt-2 sm:col-span-1 sm:mt-0 sm:w-auto sm:flex-col sm:items-end sm:justify-center sm:border-0 sm:pt-0">
                            <div className="bg-primary/20 text-primary text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-sm flex items-center justify-center min-w-[70px]">
                              {formatDaysUntil(event.date)}
                            </div>
                            <div className="flex items-center gap-2">
                              {event.location && (
                                <a href={`https://maps.google.com/?q=${encodeURIComponent(event.location)}`} target="_blank" rel="noreferrer" className="bg-muted text-foreground text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-sm flex items-center gap-1.5 hover:bg-foreground hover:text-background transition-colors clip-angled-sm">
                                  <MapPin className="w-3.5 h-3.5" /> Map
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={event.id} className="group relative flex items-center gap-3 sm:gap-4 py-2.5 px-2 hover:bg-muted/30 transition-colors border-b border-border/40 last:border-0 rounded-sm">
                        {/* Link overlay */}
                        <Link href={`/studio/schedule`} className="absolute inset-0 z-10">
                          <span className="sr-only">View event</span>
                        </Link>

                        {/* Date Block */}
                        <div className="flex flex-col items-center justify-center bg-muted/40 rounded-sm w-12 h-14 shrink-0 border border-border/30">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-foreground/60 leading-none mb-1">{dateParts.month}</span>
                          <span className="font-display text-xl leading-none text-foreground">{dateParts.day}</span>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0 flex flex-col justify-center pointer-events-none relative z-20">
                          <div className="font-display text-lg uppercase tracking-wide leading-none truncate mb-1 group-hover:text-primary transition-colors">
                            {title}
                          </div>
                          <div className="flex items-center text-xs text-muted-foreground truncate font-medium">
                            <span className="uppercase">{dateParts.dayOfWeek}, {formatTimeDisplay(event.time)}</span>
                            {event.location && (
                              <>
                                <span className="mx-1.5 opacity-50">•</span>
                                <span className="truncate">{event.location}</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 text-muted-foreground opacity-30 group-hover:opacity-100 group-hover:text-foreground transition-all group-hover:translate-x-1 relative z-20 pointer-events-none">
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* RECENT DESIGNS */}
        <section id="recent-hype-cards" data-testid="section-recent-hype-cards">
          <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
            <div>
              <h3 className="studio-textured-accent font-display text-2xl text-primary uppercase tracking-wide">Recent Hype Cards</h3>
              <p className="mt-1 text-xs font-medium text-muted-foreground">Open a saved template to keep editing.</p>
            </div>
            <Link href="/studio" className="text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1" data-testid="link-view-all-designs">
              View All <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,136px))] gap-4">
            {projects.length === 0 ? (
              <div className="col-span-full w-full py-10 border border-border bg-card flex flex-col items-center justify-center text-muted-foreground gap-3 clip-angled-sm min-h-[180px]">
                <ImageIcon className="w-10 h-10 opacity-50" />
                <p className="font-bold uppercase tracking-widest text-sm">No Hype Cards Yet</p>
                <p className="text-xs max-w-xs text-center text-balance">Your saved Hype Card templates will appear here for quick access.</p>
              </div>
            ) : (
              projects.slice(0, 4).map(project => (
                <Link key={project.id} href={project.href} className="group flex min-w-0 flex-col" data-testid={`link-project-${project.id}`}>
                  <div className="aspect-square w-full bg-muted border border-border mb-2.5 relative overflow-hidden group-hover:border-primary transition-colors flex items-center justify-center clip-angled-sm">
                    {project.thumbnailProject ? (
                      <HypeCardThumbnail project={project.thumbnailProject} name={project.name} />
                    ) : (
                      <>
                        <div className="absolute inset-0 bg-tech-grid opacity-30 pointer-events-none" />
                        <Zap className="w-7 h-7 text-muted-foreground group-hover:text-primary transition-colors group-hover:scale-110 duration-300" />
                      </>
                    )}
                  </div>
                  <h4 className="font-bold text-sm truncate group-hover:text-primary transition-colors">{project.name}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatRelativeTime(project.updatedAt)}</p>
                </Link>
              ))
            )}
          </div>
        </section>

      </div>

    </div>
      </div>
    </>
  );
}

// ----------------------------------------------------------------------
// PROFILE VIEW
// ----------------------------------------------------------------------

export interface SupporterProfileViewProps {
  profile: SupporterProfile;
  saving: boolean;
  error: string;
  onChange: (field: keyof SupporterProfile, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  athletePhotoUrl?: string;
  athletePhotoCrop?: AthletePhotoCrop;
  pendingPhotoUrl?: string;
  pendingPhotoCrop: AthletePhotoCrop;
  photoBusy: boolean;
  photoError: string;
  onPhotoChange: (file: File) => void;
  onPhotoCropChange: (crop: AthletePhotoCrop) => void;
  onPhotoUpload: () => void;
  onPhotoCancel: () => void;
  onPhotoRemove: () => void;
}

export function SupporterProfileView({
  profile,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
  athletePhotoUrl,
  athletePhotoCrop = { x: 50, y: 50, zoom: 100 },
  pendingPhotoUrl,
  pendingPhotoCrop,
  photoBusy,
  photoError,
  onPhotoChange,
  onPhotoCropChange,
  onPhotoUpload,
  onPhotoCancel,
  onPhotoRemove,
}: SupporterProfileViewProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave();
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-5 py-8 sm:px-8 sm:py-12 animate-slide-up">
      <div className="mb-8">
        <button onClick={onCancel} className="text-sm font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 mb-6" data-testid="btn-back">
          <ChevronRight className="w-4 h-4 rotate-180" /> Back to Dashboard
        </button>
        <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-wide">
          Supporter <span className="text-primary studio-textured-accent">Profile.</span>
        </h1>
        <p className="text-muted-foreground mt-2 text-sm sm:text-base">
          Personalize your dashboard and pre-fill graphics with your athlete's details.
        </p>
      </div>

      <div className="bg-card border border-border p-6 sm:p-8 clip-angled-tl relative">
        <div className="absolute inset-0 bg-tech-grid opacity-30 pointer-events-none" />

        <form onSubmit={handleSubmit} className="relative space-y-8">
          {error && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 text-sm font-medium flex items-start gap-3 clip-angled-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2 border-b border-border/50 pb-2">
              <Camera className="w-4 h-4" /> Athlete Photo
            </h3>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <AthleteCardPreview
                profile={profile}
                athletePhotoUrl={athletePhotoUrl}
                athletePhotoCrop={athletePhotoCrop}
                className="athlete-card-preview-settings"
                testId="athlete-photo-settings-preview"
              />
              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Private to your signed-in account. JPG, PNG, or WebP, up to 5 MB.</p>
                {photoError && <p className="text-sm font-bold text-destructive" role="alert">{photoError}</p>}
                {!pendingPhotoUrl && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label className="cursor-pointer bg-foreground text-background px-5 py-3 text-center text-xs font-bold uppercase tracking-widest disabled:opacity-50">
                      {photoBusy ? 'Uploading…' : athletePhotoUrl ? 'Replace Photo' : 'Add Photo'}
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={photoBusy} onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onPhotoChange(file);
                        event.currentTarget.value = '';
                      }} data-testid="input-athlete-photo" />
                    </label>
                    {athletePhotoUrl && <button type="button" disabled={photoBusy} onClick={onPhotoRemove} className="border border-destructive px-5 py-3 text-xs font-bold uppercase tracking-widest text-destructive disabled:opacity-50" data-testid="btn-remove-athlete-photo"><Trash2 className="mr-2 inline h-4 w-4" />Remove</button>}
                  </div>
                )}
              </div>
            </div>
            {pendingPhotoUrl && (
              <div className="rounded-sm border border-border bg-background p-4 sm:p-5" data-testid="athlete-photo-crop-editor">
                <div className="grid gap-5 sm:grid-cols-[minmax(220px,1fr)_1fr] sm:items-center">
                  <AthleteCardPreview
                    profile={profile}
                    athletePhotoUrl={pendingPhotoUrl}
                    athletePhotoCrop={pendingPhotoCrop}
                    className="athlete-card-preview-settings"
                    testId="athlete-photo-crop-preview"
                  />
                  <div className="space-y-4">
                    {([
                      ['Horizontal position', 'x', 0, 100],
                      ['Vertical position', 'y', 0, 100],
                      ['Zoom', 'zoom', 100, 250],
                    ] as const).map(([label, key, min, max]) => (
                      <label key={key} className="block text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        <span className="flex justify-between"><span>{label}</span><span>{pendingPhotoCrop[key]}{key === 'zoom' ? '%' : ''}</span></span>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          value={pendingPhotoCrop[key]}
                          disabled={photoBusy}
                          onChange={(event) => onPhotoCropChange({ ...pendingPhotoCrop, [key]: Number(event.target.value) })}
                          className="mt-2 h-10 w-full accent-primary disabled:opacity-50"
                          aria-label={label}
                        />
                      </label>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">Your replacement starts centered. Adjust it here before uploading.</p>
                      <button
                        type="button"
                        disabled={photoBusy}
                        onClick={() => onPhotoCropChange({ x: 50, y: 50, zoom: 100 })}
                        className="athlete-photo-crop-reset inline-flex min-h-11 shrink-0 items-center gap-2 border px-3 py-2 text-xs font-bold uppercase tracking-widest disabled:opacity-50"
                        aria-label="Reset photo crop"
                        data-testid="btn-reset-athlete-photo-crop"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset crop
                      </button>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button type="button" disabled={photoBusy} onClick={onPhotoUpload} className="bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-50" data-testid="btn-upload-cropped-photo">
                        {photoBusy ? 'Uploading…' : 'Upload Photo'}
                      </button>
                      <button type="button" disabled={photoBusy} onClick={onPhotoCancel} className="border border-border px-5 py-3 text-xs font-bold uppercase tracking-widest disabled:opacity-50">Cancel</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2 border-b border-border/50 pb-2">
              <User className="w-4 h-4" /> Your Details
            </h3>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="displayName" className="text-xs font-bold uppercase tracking-widest text-muted-foreground block">
                  Your Name
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={profile.displayName}
                  onChange={(e) => onChange('displayName', e.target.value)}
                  className="w-full bg-background border border-border px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="e.g. Brian"
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The person managing this account. Your athlete’s name is entered separately below.
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor="sport" className="text-xs font-bold uppercase tracking-widest text-muted-foreground block">Athlete Sport</label>
                <select id="sport" value={profile.sport ?? ''} onChange={(e) => onChange('sport', e.target.value as Sport)} className="w-full bg-background border border-border px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all">
                  <option value="">Choose a sport</option>
                  <option value="baseball">Baseball</option>
                  <option value="basketball">Basketball</option>
                  <option value="football">Football</option>
                  <option value="soccer">Soccer</option>
                  <option value="softball">Softball</option>
                  <option value="volleyball">Volleyball</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="relationship" className="text-xs font-bold uppercase tracking-widest text-muted-foreground block">
                  Relationship to Athlete
                </label>
                <input
                  id="relationship"
                  type="text"
                  value={profile.relationship}
                  onChange={(e) => onChange('relationship', e.target.value)}
                  className="w-full bg-background border border-border px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="e.g. Parent, Fan, Supporter"
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-primary flex items-center gap-2 border-b border-border/50 pb-2">
              <Trophy className="w-4 h-4" /> Athlete & Team
            </h3>

            <div className="space-y-2">
              <label htmlFor="athleteName" className="text-xs font-bold uppercase tracking-widest text-muted-foreground block">
                Athlete Name
              </label>
              <input
                id="athleteName"
                type="text"
                value={profile.athleteName}
                onChange={(e) => onChange('athleteName', e.target.value)}
                className="w-full bg-background border border-border px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-bold"
                placeholder="e.g. Mason Carter"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                This is the name shown on the athlete card and in sports content.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="teamName" className="text-xs font-bold uppercase tracking-widest text-muted-foreground block">
                  Team Name
                </label>
                <input
                  id="teamName"
                  type="text"
                  value={profile.teamName}
                  onChange={(e) => onChange('teamName', e.target.value)}
                  className="w-full bg-background border border-border px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="e.g. Tigers"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="jerseyNumber" className="text-xs font-bold uppercase tracking-widest text-muted-foreground block">
                    Number
                  </label>
                  <input
                    id="jerseyNumber"
                    type="text"
                    value={profile.jerseyNumber}
                    onChange={(e) => onChange('jerseyNumber', e.target.value)}
                    className="w-full bg-background border border-border px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-center"
                    placeholder="#12"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="position" className="text-xs font-bold uppercase tracking-widest text-muted-foreground block">
                    Position
                  </label>
                  <input
                    id="position"
                    type="text"
                    value={profile.position}
                    onChange={(e) => onChange('position', e.target.value)}
                    className="w-full bg-background border border-border px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                    placeholder="e.g. PG"
                  />
                </div>
              </div>
            </div>
          </div>

          <NotificationSettings />

          <div className="pt-6 border-t border-border flex flex-col-reverse sm:flex-row items-center justify-end gap-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="w-full sm:w-auto px-6 py-3 text-sm font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              data-testid="btn-profile-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="w-full sm:w-auto bg-primary text-primary-foreground px-8 py-3 text-sm font-bold uppercase tracking-widest clip-angled-sm hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              data-testid="btn-profile-save"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                </>
              ) : (
                'Save Profile'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AthletePhoto({
  url,
  crop,
  alt,
}: {
  url: string;
  crop: AthletePhotoCrop;
  alt: string;
}) {
  const x = Math.max(0, Math.min(100, Number.isFinite(crop.x) ? crop.x : 50));
  const y = Math.max(0, Math.min(100, Number.isFinite(crop.y) ? crop.y : 50));
  const zoom = Math.max(100, Math.min(250, Number.isFinite(crop.zoom) ? crop.zoom : 100));

  return (
    <span className="relative block h-full w-full overflow-hidden">
      <img
        src={url}
        alt={alt}
        className="absolute inset-0 block h-full w-full max-w-none object-cover"
        style={{
          objectPosition: `${x}% ${y}%`,
          transform: `scale(${zoom / 100})`,
          transformOrigin: `${x}% ${y}%`,
        }}
      />
    </span>
  );
}
