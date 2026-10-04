import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { BackNavigationLink } from '@/components/back-navigation-link';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetSupporterActiveGameQueryKey,
  getGetAthleteFanCardQueryKey,
  getListAthleteInvitesQueryKey,
  getListProjectsQueryKey,
  getListOwnedGameOnCardsQueryKey,
  useGetSupporterActiveGame,
  useListAthleteInvites,
  useUpdateAthleteInvite,
  useListProjects,
  useListOwnedGameOnCards,
  useDeleteOwnedGameOnCard,
  useUpdateSupporterActiveGame,
  type OwnedAthleteInvite,
} from '@workspace/api-client-react';
import {
  CalendarDays, Zap, MapPin, Trophy, ChevronRight, User,
  Users, ArrowLeft, ArrowRight, PenSquare, Loader2, AlertTriangle, Camera, X,
  Menu, RotateCcw, Bell, ShieldCheck, BookOpen
} from 'lucide-react';
import { differenceInCalendarDays, format, parseISO, isValid } from 'date-fns';
import {
  getActiveSupporterGame,
  getVisibleSupporterSelection,
  getSupporterGameStage,
  getSupporterFanCardHref,
  getSupporterFanCard,
  getSupporterFanCardReconnectionCandidates,
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
import { HypeCardReplyInboxTrigger } from './hype-card-reply-inbox';
import {
  SupporterDashboardChecklist,
  SupporterDashboardChecklistCompletionDialog,
  type SupporterDashboardChecklistProps,
} from './supporter-dashboard-checklist';
import {
  isDashboardChecklistComplete,
  type DashboardChecklistItemId,
} from './supporter-dashboard-checklist-state';
import { GameOnCardPanel } from './game-on-card';
import { GameOnInlineEditor } from './game-on-inline-editor';
import {
  GameOnDashboardCollection,
  type GameOnCardRenderOptions,
  type DashboardGameOnCard,
} from './game-on-dashboard-collection';
import { buildGameOnDashboardEntries, getFeaturedGameOnCardId, getNextGameOnDashboardEntry, sortGameOnCardsByDate, type OwnedGameOnShare } from './game-on-dashboard-model';
import { readSavedGameOnCards, removeSavedGameOnCard, type SavedGameOnCard } from './game-on-card-storage';
import { getBrowserTimeZone } from './game-on-timezone';
import { combineTrackerReviewHistory, getTrackerStorageKeys, readStoredTrackerData, type GameSession, type Sport } from './stat-tracker';
import { consumeCompletionHandoff, trackerCompletionHandoffEvent } from './tracker-completion-handoff';
import { TrackerCompletionDialog } from './tracker-completion-dialog';
import { buildSupporterGameRecord } from './supporter-game-record-model';
import { SupporterGameOnSummary } from './supporter-game-on-summary';
import { SupporterHypeCardPreview } from './supporter-hype-card-preview';
import { NotificationSettings } from './notification-settings';
import {
  DashboardInstallInstructionsDialog,
  DashboardInstallReminder,
} from './dashboard-install-reminder';
import { useAppInstallPrompt } from './app-install-prompt';
import { HypeManagerTaskCard } from './hype-manager-wallet';
import {
  dismissEventDaySharing,
  eventDaySharingDismissalPrefix,
  getOwnerEventDayReminders,
  hasDismissedEventDaySharing,
} from './event-day-sharing-model';
import { trackEvent } from '../lib/analytics';
import {
  readWorkspaceEventContext,
  saveWorkspaceEventContext,
  workspaceEventContextStorageKey,
} from './workspace-context';
import './supporter-dashboard-pixl.css';
import './supporter-game-on-summary.css';
import './supporter-profile-wallet.css';

export interface SupporterProfile {
  displayName: string;
  teamName: string;
  seasonName?: string;
  athleteName: string;
  jerseyNumber: string;
  position: string;
  relationship: string;
  accessMode: 'full' | 'guest' | null;
  sport: Sport | null;
}

export interface SupporterEvent {
  id: string;
  calendarProjectId?: string;
  type: 'game' | 'practice' | 'meeting';
  date: string;
  time: string;
  timezone?: string;
  status?: ScheduleEventStatus;
  completedAt?: string;
  location: string;
  opponent?: string;
  notes?: string;
}

function readRecordedScoreGameIds(storage: Storage, accountId: string) {
  try {
    const stored = JSON.parse(storage.getItem(getTrackerStorageKeys(accountId).history) ?? '{}') as {
      games?: unknown;
    };
    if (!Array.isArray(stored.games)) return new Set<string>();
    return new Set(
      stored.games.flatMap((entry): string[] => {
        if (typeof entry !== 'object' || entry === null) return [];
        const game = entry as Record<string, unknown>;
        if (typeof game.scoreRecorded === 'boolean') {
          return typeof game.id === 'string' && game.scoreRecorded ? [game.id] : [];
        }
        return typeof game.id === 'string'
          && typeof game.score === 'number'
          && Number.isFinite(game.score)
          && typeof game.opponentScore === 'number'
          && Number.isFinite(game.opponentScore)
          ? [game.id]
          : [];
      }),
    );
  } catch {
    return new Set<string>();
  }
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
  showDashboardChecklist?: boolean;
  dashboardChecklistCheckedItemIds?: DashboardChecklistItemId[];
  onSaveDashboardChecklistProgress?: (checkedItemIds: DashboardChecklistItemId[]) => Promise<void>;
  onDismissDashboardChecklist?: (checkedItemIds: DashboardChecklistItemId[]) => Promise<void>;
  prepUserId?: string | null;
  events: SupporterEvent[];
  onSaveCalendarEvent?: (event: SupporterEvent) => Promise<void>;
  onCompleteScheduledGame?: (eventId: string, completedAt: string) => Promise<void>;
  selectionSyncReady?: boolean;
  athletePhotoUrl?: string;
  athletePhotoCrop?: AthletePhotoCrop;
  onSignOut?: () => void;
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
  showDashboardChecklist = false,
  dashboardChecklistCheckedItemIds = [],
  onSaveDashboardChecklistProgress,
  onDismissDashboardChecklist,
  prepUserId,
  events,
  onSaveCalendarEvent,
  onCompleteScheduledGame,
  selectionSyncReady = true,
  athletePhotoUrl,
  athletePhotoCrop = { x: 50, y: 50, zoom: 100 },
  onSignOut,
}: SupporterDashboardViewProps) {
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
  const athleteInvitesQuery = useListAthleteInvites({
    query: {
      enabled: Boolean(userId),
      queryKey: [...getListAthleteInvitesQueryKey(), userId ?? null],
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      retry: false,
    },
  });
  const fanCardHref = getSupporterFanCardHref(athleteInvitesQuery.data ?? [], profile);
  const savedFanCard = getSupporterFanCard(athleteInvitesQuery.data ?? [], profile);
  const fanCardReconnectionCandidates = getSupporterFanCardReconnectionCandidates(
    athleteInvitesQuery.data ?? [],
    profile,
  );
  const updateAthleteInvite = useUpdateAthleteInvite();
  const [reconnectingFanCardToken, setReconnectingFanCardToken] = useState<string | null>(null);
  const [fanCardReconnectError, setFanCardReconnectError] = useState('');
  const reconnectFanCard = useCallback(async (invite: OwnedAthleteInvite) => {
    if (!userId || !profile.athleteName.trim() || !profile.teamName.trim()) return;
    setReconnectingFanCardToken(invite.inviteToken);
    setFanCardReconnectError('');
    try {
      await updateAthleteInvite.mutateAsync({
        inviteToken: invite.inviteToken,
        data: {
          athleteName: profile.athleteName.trim(),
          teamName: profile.teamName.trim(),
          seasonName: invite.seasonName,
          seasonEndsAt: invite.seasonEndsAt,
          timezone: invite.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          sport: invite.sport,
          trackerProjectId: invite.trackerProjectId,
          scheduleProjectId: null,
          showHypeCard: invite.showHypeCard,
          showStats: invite.showStats,
          showSchedule: false,
          showEvents: invite.showEvents,
          hypesEnabled: invite.hypesEnabled,
          paused: invite.paused,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAthleteInvitesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAthleteFanCardQueryKey(invite.inviteToken) }),
      ]);
    } catch {
      setFanCardReconnectError('We couldn’t reconnect that card. Your saved design is unchanged; try again.');
    } finally {
      setReconnectingFanCardToken(null);
    }
  }, [profile.athleteName, profile.teamName, queryClient, updateAthleteInvite.mutateAsync, userId]);
  const updateActiveGameSelection = useUpdateSupporterActiveGame();
  const deleteOwnedGameOnCard = useDeleteOwnedGameOnCard();
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const {
    action: installAction,
    isIOS: installIsIOS,
    showInstructions: showInstallInstructions,
    handleInstall: handleInstallPrompt,
    dismissInstructions: dismissInstallInstructions,
  } = useAppInstallPrompt();
  const ownedGameOnCardsQuery = useListOwnedGameOnCards({
    query: {
      enabled: Boolean(userId),
      queryKey: [...getListOwnedGameOnCardsQueryKey(), userId ?? null],
      refetchOnWindowFocus: true,
    },
  });
  const trackerProjectsQuery = useListProjects({
    query: {
      enabled: Boolean(userId),
      queryKey: [...getListProjectsQueryKey(), userId ?? null],
      staleTime: 0,
      refetchOnMount: 'always',
    },
  });
  const [localGameOnCards, setLocalGameOnCards] = useState<SavedGameOnCard[]>(() => userId ? readSavedGameOnCards(userId) : []);
  const [cardSelection, setCardSelection] = useState<{ kind: 'event' | 'share'; id: string; nonce: number } | null>(null);
  const [gameOnCardOutcome, setGameOnCardOutcome] = useState('');
  const [newCardDraft, setNewCardDraft] = useState<{
    id: string;
    nonce: number;
    event: SupporterEvent;
    sourceEventId: string;
    editing: boolean;
  } | null>(null);
  const [cardLayoutIds, setCardLayoutIds] = useState<Record<string, string>>({});
  const [justCompleted, setJustCompleted] = useState<{ game: GameSession; saveStatus: 'cloud-saved' | 'local-saved' } | null>(null);
  const [dashboardChecklistCompletionOpen, setDashboardChecklistCompletionOpen] = useState(false);
  const [eventDayDismissalVersion, setEventDayDismissalVersion] = useState(0);
  const eventDayDialogRef = useRef<HTMLDivElement>(null);
  const eventDayReturnFocusRef = useRef<HTMLElement | null>(null);
  const eventDayWasOpenRef = useRef(false);
  const skipEventDayFocusReturnRef = useRef(false);
  useEffect(() => {
    setJustCompleted(null);
    if (!userId) return;
    const showCompletion = () => {
      const handoff = consumeCompletionHandoff(window.localStorage, userId);
      if (!handoff) return;
      const game = readStoredTrackerData(window.localStorage, userId).games.find(
        (item) => item.id === handoff.gameId && item.status === 'final',
      );
      if (game) setJustCompleted({ game, saveStatus: handoff.saveStatus });
    };
    showCompletion();
    window.addEventListener(trackerCompletionHandoffEvent, showCompletion);
    return () => window.removeEventListener(trackerCompletionHandoffEvent, showCompletion);
  }, [userId]);
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
  const summaryAthleteAvatar = athletePhotoUrl ? (
    <AthletePhoto url={athletePhotoUrl} crop={athletePhotoCrop} alt="" />
  ) : hasAthlete ? (
    <span>{athleteInitials(profile.athleteName)}</span>
  ) : (
    <Users className="h-5 w-5" aria-hidden="true" />
  );
  const gameEvents = events.filter((event) => event.type === 'game');
  const activeJourneyEvents = events.filter((event) => event.type !== 'meeting');
  const selectedWorkspaceEvent = getVisibleSupporterSelection(
    activeJourneyEvents,
    selectedGameId,
    currentTime,
  );
  const weekRecommendation = getSupporterWeekRecommendation(
    activeJourneyEvents,
    currentTime,
  );
  const recommendedPreparationEvent = selectedWorkspaceEvent ?? getSupporterPreparationContext(
    weekRecommendation,
    gameEvents,
    selectedGameId,
    false,
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
  const trackerData = userId ? readStoredTrackerData(window.localStorage, userId) : null;
  const cloudTrackerProject = [...(trackerProjectsQuery.data ?? [])]
    .filter((project) => project.project.tool === 'stat-tracker')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  const completedLocalGames = userId
    ? combineTrackerReviewHistory(trackerData, cloudTrackerProject?.project).games.filter((game) => game.status === 'final')
    : [];
  const recordedGameForCard = (card: { type: string; date: string; opponent: string; eventId?: string }) => {
    if (card.type !== 'game') return undefined;
    const exact = card.eventId && completedLocalGames.find((game) => game.sourceEventId === card.eventId);
    if (exact) return exact;
    const matchesLegacy = (date: string, opponent: string) => (
      date === card.date && opponent.trim().toLowerCase() === card.opponent.trim().toLowerCase()
    );
    const matchingCards = dashboardCards.filter((entry) => entry.type === 'game' && matchesLegacy(entry.date, entry.opponent));
    const matchingGames = completedLocalGames.filter((game) => !game.sourceEventId && matchesLegacy(game.date, game.opponent));
    return matchingCards.length === 1 && matchingGames.length === 1 ? matchingGames[0] : undefined;
  };
  const scoredGameIds = userId ? readRecordedScoreGameIds(window.localStorage, userId) : new Set<string>();
  const recordSport = profile.sport ?? trackerData?.games.find((game) => game.status === 'final')?.sport ?? null;
  const gameRecord = buildSupporterGameRecord(trackerData?.games ?? [], scoredGameIds, recordSport);
  const dashboardCards = buildGameOnDashboardEntries(events, ownedGameOnShares, profile.athleteName, currentTime, completedLocalGames);
  const recommendedGameCard = getNextGameOnDashboardEntry(dashboardCards, currentTime);
  const recommendedGame: SupporterEvent | undefined = recommendedGameCard ? {
    id: recommendedGameCard.eventId,
    type: 'game',
    date: recommendedGameCard.date,
    time: recommendedGameCard.time,
    timezone: recommendedGameCard.timezone,
    location: recommendedGameCard.location,
    opponent: recommendedGameCard.opponent,
    status: recommendedGameCard.status === 'Live' ? 'live' : 'upcoming',
  } : undefined;
  const newDraftCollectionCard = newCardDraft ? {
    id: newCardDraft.id,
    layoutId: newCardDraft.id,
    eventId: newCardDraft.event.id,
    type: newCardDraft?.event.type === 'practice' ? 'practice' as const : 'game' as const,
    athleteName: profile.athleteName || 'Your athlete',
    opponent: newCardDraft?.event.opponent ?? '',
    date: newCardDraft?.event.date ?? '',
    time: newCardDraft?.event.time ?? '',
    timezone: newCardDraft?.event.timezone,
    location: newCardDraft?.event.location ?? '',
    status: 'Draft' as const,
    isPublished: false,
    isUnsavedDraft: true,
  } : null;
  const replacedScheduleEventId = newCardDraft && newCardDraft.sourceEventId !== 'new'
    ? newCardDraft?.sourceEventId
    : undefined;
  const collectionCards = sortGameOnCardsByDate([
    ...dashboardCards
      .filter((card) => !replacedScheduleEventId || card.eventId !== replacedScheduleEventId)
       .map((card) => ({ ...card, layoutId: cardLayoutIds[card.id] ?? card.id, recordedGameId: recordedGameForCard(card)?.id })),
    ...(newDraftCollectionCard ? [newDraftCollectionCard] : []),
  ]);
  const featuredCardId = getFeaturedGameOnCardId(collectionCards, currentTime);
  const updateNewCardDraft = useCallback((event: SupporterEvent, sourceEventId: string) => {
    setNewCardDraft((previous) => {
      if (!previous) return previous;
      if (previous
        && previous.sourceEventId === sourceEventId
        && previous.event.id === event.id
        && previous.event.type === event.type
        && previous.event.date === event.date
        && previous.event.time === event.time
        && previous.event.timezone === event.timezone
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
      timezone: getBrowserTimeZone(),
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
  const handleGameOnCardChanged = (selectedId?: string, notice?: string) => {
    if (notice) {
      setGameOnCardOutcome(notice);
      window.setTimeout(() => {
        setGameOnCardOutcome((current) => current === notice ? '' : current);
      }, 8000);
    }
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
  const saveDashboardChecklistProgress = async (checkedItemIds: DashboardChecklistItemId[]) => {
    if (!onSaveDashboardChecklistProgress) return;
    await onSaveDashboardChecklistProgress(checkedItemIds);
    if (isDashboardChecklistComplete(checkedItemIds)) {
      setDashboardChecklistCompletionOpen(true);
    }
  };
  const dashboardChecklistProps: SupporterDashboardChecklistProps | undefined = showDashboardChecklist
    && userId
    && onSaveDashboardChecklistProgress
    && onDismissDashboardChecklist
    ? {
        userId,
        profileHref: supporterToolRoutes.profile,
        hypeCardHref: fanCardHref,
        checkedItemIds: dashboardChecklistCheckedItemIds,
        installAction,
        installInstructionsOpen: showInstallInstructions,
        installDeviceClass: isDesktopDashboard ? 'desktop' : 'mobile',
        onInstall: () => handleInstallPrompt(isDesktopDashboard ? 'desktop' : 'mobile'),
        onCreateEventCard: openCardWorkspace,
        onSaveProgress: saveDashboardChecklistProgress,
        onDismiss: onDismissDashboardChecklist,
      }
    : undefined;
  const dashboardChecklist = dashboardChecklistProps
    ? (
      <SupporterDashboardChecklist
        key={`${userId}-${isDesktopDashboard ? 'desktop' : 'mobile'}`}
        {...dashboardChecklistProps}
      />
    )
    : undefined;
  const deleteGameOnCard = useCallback(async (card: DashboardGameOnCard) => {
    if (!userId) throw new Error('Sign in to delete this Event Card.');
    if (!card.shareToken) throw new Error('This card is not saved yet.');

    const result = await deleteOwnedGameOnCard.mutateAsync({ shareToken: card.shareToken });
    removeSavedGameOnCard(userId, card.shareToken);
    setLocalGameOnCards((current) => current.filter((saved) => saved.shareToken !== card.shareToken));
    setCardSelection(null);
    void queryClient.invalidateQueries({ queryKey: getListOwnedGameOnCardsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    return result;
  }, [deleteOwnedGameOnCard, queryClient, userId]);
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
      ? getSupporterGameStage(contextEvent, currentTime, { includePregameCaptureWindow: false })
      : 'upcoming';
  const recommendedGameStage = recommendedGame
    ? getSupporterGameStage(recommendedGame, currentTime, { includePregameCaptureWindow: false })
    : null;
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
  const eventDayReminders = userId && athleteInvitesQuery.isSuccess && !athleteInvitesQuery.isFetching && !athleteInvitesQuery.isError
    ? getOwnerEventDayReminders({
      invites: athleteInvitesQuery.data ?? [],
      dashboardEvents: events,
      now: currentTime,
    })
    : [];
  // Keep the local-storage read reactive to this tab's own dismissal and to
  // storage events from other dashboard tabs.
  void eventDayDismissalVersion;
  const visibleEventDayReminders = userId
    ? eventDayReminders.filter((reminder) => !hasDismissedEventDaySharing(
      window.localStorage,
      userId,
      reminder.localDate,
    ))
    : [];
  const showEventDayReminder = Boolean(
    visibleEventDayReminders.length
    && !showStageReminder
    && !justCompleted
    && !mobileMenuOpen,
  );
  const gameTitle = nextGame
    ? `${profile.teamName || 'Your team'}${nextGame.opponent ? ` vs ${nextGame.opponent}` : ''}`
    : 'Your next game';
  const preparationCopy = getSupporterPreparationCopy(contextEvent?.type ?? null);
  const preparationSchedule = contextEvent
    ? [formatDateDisplay(contextEvent.date), formatTimeDisplay(contextEvent.time)].filter(Boolean).join(' · ')
    : '';
  const preparationTitle = preparationSchedule
    ? `${preparationCopy.title.replace(/\.$/, '')} — ${preparationSchedule}`
    : preparationCopy.title;
  const dashboardStatsHref = '/studio/season-stats';
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
    if (showEventDayReminder && !eventDayWasOpenRef.current) {
      eventDayReturnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      window.requestAnimationFrame(() => {
        const firstAction = eventDayDialogRef.current?.querySelector<HTMLElement>('[data-event-day-first-action]');
        firstAction?.focus();
      });
    } else if (!showEventDayReminder && eventDayWasOpenRef.current) {
      if (!skipEventDayFocusReturnRef.current) {
        window.requestAnimationFrame(() => eventDayReturnFocusRef.current?.focus());
      }
      skipEventDayFocusReturnRef.current = false;
    }
    eventDayWasOpenRef.current = showEventDayReminder;
  }, [showEventDayReminder]);

  useEffect(() => {
    const handleEventDayDismissalSync = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      if (event.key && !event.key.startsWith(`${eventDaySharingDismissalPrefix}:`)) return;
      setEventDayDismissalVersion((version) => version + 1);
    };
    window.addEventListener('storage', handleEventDayDismissalSync);
    return () => window.removeEventListener('storage', handleEventDayDismissalSync);
  }, []);

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

  const dismissEventDayReminder = (restoreFocus = true) => {
    if (!userId) return;
    skipEventDayFocusReturnRef.current = !restoreFocus;
    dismissEventDaySharing(
      window.localStorage,
      userId,
      eventDayReminders.map((reminder) => reminder.localDate),
    );
    setEventDayDismissalVersion((version) => version + 1);
  };

  const handleEventDayDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismissEventDayReminder();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = eventDayDialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const summaryGameStage = recommendedGameStage ?? 'upcoming';
  const recommendedGameTitle = recommendedGame
    ? `${profile.teamName || 'Your team'}${recommendedGame.opponent ? ` vs ${recommendedGame.opponent}` : ''}`
    : 'No upcoming game';

  const renderGameOnEventContent = (variant: 'mobile' | 'desktop') => (
    <>
      <div className="supporter-game-on-summary__event-top">
        <div className="supporter-game-on-summary__event-kicker">
          <span className="supporter-game-on-summary__event-dot" aria-hidden="true" />
          <span className="mobile-featured-event-kicker" data-testid="mobile-featured-event-kicker">{recommendedGame ? 'Next game' : 'No upcoming game'}</span>
        </div>
        {recommendedGame && (
          <span className="supporter-game-on-summary__event-badge">
            {summaryGameStage === 'live' ? 'Live now' : summaryGameStage === 'completed' ? 'Final' : 'Up next'}
          </span>
        )}
      </div>

      {recommendedGame ? (
        <div className="supporter-game-on-summary__event-main">
          <div className="supporter-game-on-summary__event-matchup">
            <p
              className="supporter-game-on-summary__event-date"
              data-testid={variant === 'desktop' ? 'next-event-date' : 'mobile-next-event-date'}
            >
              {formatDateDisplay(recommendedGame.date)}
            </p>
            <h2 id={variant === 'desktop' ? 'next-game-heading' : 'mobile-next-game-heading'} className="supporter-game-on-summary__event-title" data-testid={variant === 'desktop' ? 'next-game-heading' : 'mobile-featured-event-title'}>
              {recommendedGameTitle}
            </h2>
            <div className="supporter-game-on-summary__event-details">
              <span>{formatTimeDisplay(recommendedGame.time)}</span>
              {recommendedGame.location && (
                <span className="supporter-game-on-summary__event-location">
                  <MapPin size={14} aria-hidden="true" />
                  {recommendedGame.location}
                </span>
              )}
            </div>
          </div>
          {recommendedGameCard && (
            <div className="supporter-game-on-summary__event-utility">
              <div className="supporter-game-on-summary__event-utility-copy">
                <span>YOUR GAME-DAY CARD</span>
                <p>Prep, details and tracking in one place.</p>
              </div>
              <button type="button" onClick={() => selectCard(recommendedGameCard.id)} data-testid={`button-open-featured-game-card-${variant}`}>
                Open game card <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="supporter-game-on-summary__event-date">NEXT GAME</p>
          <h2 id={variant === 'desktop' ? 'next-game-heading' : 'mobile-next-game-heading'} className="supporter-game-on-summary__event-title" data-testid={variant === 'desktop' ? 'next-game-heading' : 'mobile-featured-event-title'}>
            {recommendedGameTitle}
          </h2>
          <p className="supporter-game-on-summary__event-empty">
             {dashboardCards.every((card) => card.type !== 'game') ? 'Add a game to see your next matchup here.' : 'No upcoming game is scheduled right now.'}
          </p>
        </>
      )}

    </>
  );

  const ownerDayEventRows = visibleEventDayReminders.flatMap((reminder) => (
    reminder.events.map((event) => ({
      ...event,
      localDate: reminder.localDate,
      timezone: reminder.timezone,
      inviteToken: reminder.inviteToken,
      athleteName: reminder.athleteName,
    }))
  ));
  const firstOwnerDayEvent = ownerDayEventRows[0];
  const ownerManageHref = firstOwnerDayEvent
    ? `/player/${encodeURIComponent(firstOwnerDayEvent.inviteToken)}/manage`
    : '';
  const ownerNotifyHref = firstOwnerDayEvent
    ? `${ownerManageHref}?shareToken=${encodeURIComponent(firstOwnerDayEvent.shareToken)}#owner-notify-followers`
    : '';

  return (
    <>
      {showEventDayReminder && firstOwnerDayEvent && (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-[#071426]/75 p-3 backdrop-blur-sm sm:items-center sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissEventDayReminder();
          }}
          data-testid="owner-event-day-sharing-backdrop"
        >
          <div
            ref={eventDayDialogRef}
            className="max-h-[min(90dvh,760px)] w-full max-w-xl overflow-y-auto border border-primary/40 bg-card p-5 shadow-2xl sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby="owner-event-day-sharing-heading"
            aria-describedby="owner-event-day-sharing-description"
            onKeyDown={handleEventDayDialogKeyDown}
            data-testid="owner-event-day-sharing-dialog"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Game day is here</p>
            <h2 id="owner-event-day-sharing-heading" className="mt-2 font-display text-3xl uppercase tracking-wide sm:text-4xl">
              Share the moment
            </h2>
            <p id="owner-event-day-sharing-description" className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {firstOwnerDayEvent.athleteName || 'Your athlete'} has {ownerDayEventRows.length === 1 ? 'a Game On event' : `${ownerDayEventRows.length} Game On events`} today. Share the Hype Card or open the follower notification tools when you’re ready.
            </p>
            <ul className="mt-5 space-y-3" aria-label="Today's shared games">
              {ownerDayEventRows.map((event) => (
                <li key={`${event.inviteToken}:${event.eventId}`} className="border border-border/70 bg-muted/40 p-3">
                  <p className="font-bold">{event.title || 'Game On'}{event.opponent ? ` vs ${event.opponent}` : ''}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.date}{event.time ? ` · ${formatTimeDisplay(event.time)}` : ''}
                    {event.location ? ` · ${event.location}` : ''}
                    {event.timezone ? ` · ${event.timezone}` : ''}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Link
                href={ownerManageHref}
                onClick={() => dismissEventDayReminder(false)}
                className="inline-flex min-h-12 flex-1 items-center justify-center bg-primary px-4 py-3 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90"
                data-event-day-first-action
                data-testid="owner-event-day-share-hype-card"
              >
                Share Hype Card
              </Link>
              <Link
                href={ownerNotifyHref}
                onClick={() => dismissEventDayReminder(false)}
                className="inline-flex min-h-12 flex-1 items-center justify-center border border-primary px-4 py-3 text-center text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary/10"
                data-testid="owner-event-day-notify-followers"
              >
                Notify followers
              </Link>
              <button
                type="button"
                onClick={() => dismissEventDayReminder()}
                className="inline-flex min-h-12 flex-1 items-center justify-center border border-border px-4 py-3 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary"
                data-testid="owner-event-day-not-now"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
      {gameOnCardOutcome && (
        <div
          className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-xl border border-[#55A4FF]/45 bg-[#0B1F3A] px-5 py-4 text-sm font-semibold text-white shadow-xl"
          role="status"
          aria-live="polite"
          data-testid="status-game-on-card-outcome"
        >
          {gameOnCardOutcome}
        </div>
      )}
      {/* MOBILE VIEW */}
      <div className="supporter-dashboard-mobile-shell relative z-0 min-h-dvh w-full pixl-dashboard-mobile flex-col">
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
          <SupporterGameOnSummary
            variant="mobile"
            athleteName={profile.athleteName}
            teamName={profile.teamName}
            jerseyNumber={profile.jerseyNumber}
            athleteAvatar={summaryAthleteAvatar}
            profileHref={supporterToolRoutes.profile}
            sport={recordSport}
            record={gameRecord}
            headerAction={!isDesktopDashboard ? dashboardChecklist : undefined}
            installReminder={<DashboardInstallReminder action={installAction} showInstructions={showInstallInstructions} onInstall={handleInstallPrompt} variant="mobile" />}
            mobileHypeCard={
              <SupporterHypeCardPreview
                key={`${userId ?? 'signed-out'}:${savedFanCard?.inviteToken ?? 'none'}`}
                card={savedFanCard}
                href={fanCardHref}
                reconnectionCandidates={fanCardReconnectionCandidates}
                onReconnect={reconnectFanCard}
                reconnectingToken={reconnectingFanCardToken}
                reconnectError={fanCardReconnectError}
                loading={Boolean(userId) && athleteInvitesQuery.isLoading}
                failed={Boolean(userId) && athleteInvitesQuery.isError}
                onRetry={() => { void athleteInvitesQuery.refetch(); }}
              />
            }
          >
            {renderGameOnEventContent('mobile')}
          </SupporterGameOnSummary>
          <GameOnDashboardCollection
            cards={collectionCards}
            onCreate={openCardWorkspace}
            createDisabled={Boolean(newCardDraft)}
            onOpen={selectCard}
            onCancelDraft={cancelNewCardDraft}
            onDeleteCard={deleteGameOnCard}
            selectedId={newCardDraft?.editing ? newCardDraft.id : cardSelection?.id}
            isActiveShell={!isDesktopDashboard}
            featuredCardId={featuredCardId}
            renderSelectedCard={renderMobileSelectedGameOnCard}
            statTrackerUserId={userId}
            prepUserId={prepUserId ?? userId}
            statTrackerSport={profile.sport}
            statTrackerAthleteName={profile.athleteName}
            statTrackerTeamName={profile.teamName}
            onCompleteScheduledGame={onCompleteScheduledGame}
          />
          <section className="combined-actions-card" aria-label="Quick links" data-testid="dashboard-primary-actions-mobile">
            <div className="combined-actions-card__heading">
              <span className="combined-actions-card__heading-mark" aria-hidden="true" />
              <span>Quick links</span>
            </div>
            <div className="combined-actions-card__grid combined-actions-card__grid--single" data-testid="dashboard-primary-actions-grid">
              <Link href={dashboardStatsHref} className="combined-actions-card__stats-link" data-testid="link-mobile-independent-stats">
                <ArrowLeft size={16} aria-hidden="true" />
                <span>View stats</span>
              </Link>
              <Link href="/supporter-guide" className="combined-actions-card__stats-link" data-testid="link-mobile-supporter-guide">
                <BookOpen size={16} aria-hidden="true" />
                <span>Family guide</span>
              </Link>
            </div>
          </section>
          {selectionSyncError && <p role="status" className="text-sm text-red-700" data-testid="active-game-sync-error">Your game is saved on this device, but could not sync to your account.</p>}
          {ownedGameOnCardsQuery.isError && userId && (
            <p role="alert" className="text-sm text-red-700">Published cards could not be refreshed. Showing cards saved on this device.</p>
          )}

        </div>

        <footer className="mx-4 mt-8 flex items-center justify-center gap-6 border-t border-[#12213A]/15 pt-5 text-xs font-bold uppercase tracking-wider text-[#334969]">
          <Link href="/help" className="hover:text-[#2474F5]" data-testid="link-mobile-dashboard-footer-help">Help / FAQ</Link>
          <Link href="/privacy" className="hover:text-[#2474F5]" data-testid="link-mobile-dashboard-footer-privacy">Privacy</Link>
        </footer>

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
      <SupporterGameOnSummary
        variant="desktop"
        athleteName={profile.athleteName}
        teamName={profile.teamName}
        jerseyNumber={profile.jerseyNumber}
        athleteAvatar={summaryAthleteAvatar}
        profileHref={supporterToolRoutes.profile}
        sport={recordSport}
        record={gameRecord}
        headerAction={isDesktopDashboard ? dashboardChecklist : undefined}
        installReminder={<DashboardInstallReminder action={installAction} showInstructions={showInstallInstructions} onInstall={handleInstallPrompt} variant="desktop" />}
      >
        {renderGameOnEventContent('desktop')}
      </SupporterGameOnSummary>
      <GameOnDashboardCollection
        cards={collectionCards}
        onCreate={openCardWorkspace}
        createDisabled={Boolean(newCardDraft)}
        onOpen={selectCard}
        onCancelDraft={cancelNewCardDraft}
        onDeleteCard={deleteGameOnCard}
        selectedId={newCardDraft?.editing ? newCardDraft.id : cardSelection?.id}
        isActiveShell={isDesktopDashboard}
        featuredCardId={featuredCardId}
        renderSelectedCard={renderDesktopSelectedGameOnCard}
        statTrackerUserId={userId}
        prepUserId={prepUserId ?? userId}
        statTrackerSport={profile.sport}
        statTrackerAthleteName={profile.athleteName}
        statTrackerTeamName={profile.teamName}
        onCompleteScheduledGame={onCompleteScheduledGame}
      />
      <section className="combined-actions-card" aria-label="Quick links" data-testid="dashboard-primary-actions-desktop">
        <div className="combined-actions-card__heading">
          <span className="combined-actions-card__heading-mark" aria-hidden="true" />
          <span>Quick links</span>
        </div>
        <div className="combined-actions-card__grid combined-actions-card__grid--single" data-testid="dashboard-primary-actions-grid">
          <Link href={dashboardStatsHref} className="combined-actions-card__stats-link" data-testid="link-desktop-independent-stats">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>View stats</span>
          </Link>
          <Link href="/supporter-guide" className="combined-actions-card__stats-link" data-testid="link-desktop-supporter-guide">
            <BookOpen size={16} aria-hidden="true" />
            <span>Family guide</span>
          </Link>
        </div>
      </section>
      {selectionSyncError && <p role="status" className="text-sm text-red-300" data-testid="active-game-sync-error">Your game is saved on this device, but could not sync to your account.</p>}
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
            </div>
          </div>

          <div className="bg-card border border-border relative min-h-[220px] flex flex-col clip-angled-sm">
            <div className="absolute inset-0 bg-tech-grid opacity-30 pointer-events-none" />
            <div className="relative p-3 sm:p-4 flex-1 flex flex-col">
              {events.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 text-center">
                  <p className="font-bold uppercase tracking-widest">Your Event Cards live here</p>
                  <p className="text-sm max-w-xs text-balance">Add an Event Card to keep game details close.</p>
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

        <section className="border border-border bg-card p-6 clip-angled-sm" data-testid="section-athlete-fan-card">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">HYPE Card</p>
          <h3 className="mt-2 font-display text-3xl uppercase tracking-wide">One story. One HYPE Card link.</h3>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Create or manage the evolving HYPE Card fans use to follow your athlete’s highlights and season.</p>
          <Link href="/studio/athlete-page" className="mt-5 inline-flex min-h-11 items-center bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground" data-testid="link-manage-athlete-fan-card">
            Manage HYPE Card
          </Link>
        </section>

      </div>

    </div>
      </div>
      <DashboardInstallInstructionsDialog
        open={showInstallInstructions}
        isIOS={installIsIOS}
        onOpenChange={(open) => {
          if (!open) dismissInstallInstructions();
        }}
      />
      <SupporterDashboardChecklistCompletionDialog
        open={dashboardChecklistCompletionOpen}
        onOpenChange={setDashboardChecklistCompletionOpen}
      />
      <TrackerCompletionDialog
        game={justCompleted?.game ?? null}
        open={Boolean(justCompleted)}
        onOpenChange={(open) => { if (!open) setJustCompleted(null); }}
        teamName={profile.teamName}
        saveStatus={justCompleted?.saveStatus}
        viewHref={justCompleted ? `/studio/season-stats?gameId=${encodeURIComponent(justCompleted.game.id)}` : undefined}
      />
    </>
  );
}

// ----------------------------------------------------------------------
// PROFILE VIEW
// ----------------------------------------------------------------------

export interface SupporterProfileViewProps {
  accountInformation?: ReactNode;
  initialSection?: 'athlete' | 'alerts' | 'account' | null;
  userId?: string | null;
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
}

export function SupporterProfileView({
  accountInformation,
  initialSection = null,
  userId,
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
}: SupporterProfileViewProps) {
  const [activeSection, setActiveSection] = useState<'athlete' | 'alerts' | 'account' | null>(initialSection);
  const toggleSection = (section: 'athlete' | 'alerts' | 'account') =>
    setActiveSection((current) => current === section ? null : section);
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave();
  };

  return (
    <div className="supporter-profile-wallet w-full max-w-[808px] mx-auto px-5 py-8 sm:px-8 sm:py-12 animate-slide-up">
      <div className="supporter-profile-heading mb-8">
        <div>
          <p className="supporter-profile-eyebrow">Your account</p>
          <h1 className="font-display text-4xl sm:text-5xl uppercase tracking-wide">Supporter Profile</h1>
          <p className="mt-2 text-sm sm:text-base">Everything for the athlete you follow, all in one place.</p>
        </div>
        <BackNavigationLink href="/studio" label="Back to Supporter Hub" testId="btn-back" />
      </div>

      <div className="supporter-profile-stack">
      <HypeManagerTaskCard id="athlete-profile" title="Athlete Profile" description="Photo, team and player details" Icon={User} active={activeSection === 'athlete'} onSelect={() => toggleSection('athlete')}>
      <div className="supporter-profile-content bg-card border border-border p-5 sm:p-8 relative">
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
                <p className="text-sm font-medium text-muted-foreground">The original is private to your signed-in account. Creating your first HYPE Card copies this photo to the public card; later changes here won’t replace its photo. JPG, PNG, or WebP, up to 5 MB.</p>
                {photoError && <p className="text-sm font-bold text-destructive" role="alert">{photoError}</p>}
                {!pendingPhotoUrl && (
                  <label className="inline-block cursor-pointer bg-foreground text-background px-5 py-3 text-center text-xs font-bold uppercase tracking-widest">
                    {photoBusy ? 'Uploading…' : athletePhotoUrl ? 'Replace Photo' : 'Add Photo'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={photoBusy} onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onPhotoChange(file);
                      event.currentTarget.value = '';
                    }} data-testid="input-athlete-photo" />
                  </label>
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
                  placeholder="e.g. Parent, Guardian, Family friend"
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

            <div className="space-y-2">
              <label htmlFor="seasonName" className="text-xs font-bold uppercase tracking-widest text-muted-foreground block">
                Season
              </label>
              <input
                id="seasonName"
                type="text"
                value={profile.seasonName ?? ''}
                onChange={(e) => onChange('seasonName', e.target.value)}
                className="w-full bg-background border border-border px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                placeholder="e.g. Fall 2026 or 2026–27"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Used to prepare new HYPE Card pages for this athlete.
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
      </HypeManagerTaskCard>
      <HypeManagerTaskCard id="phone-alerts" title="Phone Alerts" description="Stay ready for games and practices" Icon={Bell} active={activeSection === 'alerts'} onSelect={() => toggleSection('alerts')}>
        <div className="supporter-profile-content bg-card border border-border p-5 sm:p-8">
          <NotificationSettings userId={userId} />
        </div>
      </HypeManagerTaskCard>
      {accountInformation && (
        <HypeManagerTaskCard id="account-information" title="Account Information" description="Sign-in, plan and account access" Icon={ShieldCheck} active={activeSection === 'account'} onSelect={() => toggleSection('account')}>
          <div className="supporter-profile-content supporter-profile-account bg-card border border-border p-5 sm:p-8">
            {accountInformation}
          </div>
        </HypeManagerTaskCard>
      )}
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
