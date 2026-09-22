import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  CalendarDays, Zap, MapPin, Trophy, ChevronRight, User, ClipboardCheck,
  Users, Activity, Image as ImageIcon,
  ArrowRight, PenSquare, Loader2, AlertTriangle, Camera, Trash2, X,
  ChevronDown, Home, PlusSquare, Check, Sparkles, Menu
} from 'lucide-react';
import { differenceInCalendarDays, format, parseISO, isValid } from 'date-fns';
import {
  getActiveSupporterGame,
  getSupporterGameStage,
  getSupporterWeekRecommendation,
  getSupporterStageAcknowledgmentKey,
  hasAcknowledgedSupporterGameStage,
  acknowledgeSupporterGameStage,
  parseSupporterStorageSyncEvent,
  readSupporterActiveGame,
  saveSupporterActiveGame,
  supporterToolRoutes,
  type SupporterGameStage,
} from './supporter-dashboard-model';
import type { ScheduleEventStatus } from './schedule-draft';
import { HypeCardThumbnail } from './hype-card-thumbnail';
import { HypeCardReplyInboxTrigger } from './hype-card-reply-inbox';
import type { Sport } from './stat-tracker';
import { NotificationSettings } from './notification-settings';
import { trackEvent } from '../lib/analytics';
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

interface AthleteCardPreviewProps {
  profile: SupporterProfile;
  athletePhotoUrl?: string;
  athletePhotoCrop?: AthletePhotoCrop;
  onClick?: () => void;
  ariaLabel?: string;
  testId?: string;
}

function AthleteCardPreview({
  profile,
  athletePhotoUrl,
  athletePhotoCrop = { x: 50, y: 50, zoom: 100 },
  onClick,
  ariaLabel = 'Change athlete',
  testId,
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
            <User className="h-6 w-6 opacity-20" />
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

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="athlete-card-preview" aria-label={ariaLabel} data-testid={testId}>
        {content}
      </button>
    );
  }

  return (
    <div className="athlete-card-preview" role="img" aria-label="Athlete card preview" data-testid={testId}>
      {content}
    </div>
  );
}

export interface SupporterDashboardViewProps {
  profile: SupporterProfile;
  events: SupporterEvent[];
  nextGameIsUpcoming: boolean;
  projects: SupporterProject[];
  scheduleSource: 'custom' | null;
  connectionLabel: string;
  onOpenProfile: () => void;
  athletePhotoUrl?: string;
  athletePhotoCrop?: AthletePhotoCrop;
  onOpenStatTracker: () => void;
  onOpenChecklist: () => void;
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
    description: 'Pack the details now so game day feels easy.',
    accent: 'Preparation',
  },
  live: {
    label: 'Capture the game',
    kicker: 'Happening now',
    description: 'Keep the game moving and save the moments worth replaying.',
    accent: 'Live',
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
  events,
  nextGameIsUpcoming,
  projects,
  scheduleSource,
  connectionLabel,
  onOpenProfile,
  athletePhotoUrl,
  athletePhotoCrop = { x: 50, y: 50, zoom: 100 },
  onOpenStatTracker,
  onOpenChecklist,
  onSignOut,
}: SupporterDashboardViewProps) {
  const [, setLocation] = useLocation();
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : readSupporterActiveGame(window.localStorage)
  ));
  const hasAthlete = Boolean(profile.athleteName);
  const gameEvents = events.filter((event) => event.type === 'game');
  const recommendedGame = getActiveSupporterGame(gameEvents, null);
  const weekRecommendation = getSupporterWeekRecommendation(events);
  const recommendedPractice = weekRecommendation?.kind === 'practice'
    ? weekRecommendation.event
    : undefined;
  const nextGame = getActiveSupporterGame(gameEvents, selectedGameId);
  const showPracticeContext = Boolean(
    recommendedPractice
    && (!selectedGameId || !gameEvents.some((game) => game.id === selectedGameId))
    && (!nextGame || (!selectedGameId && recommendedGame && getSupporterGameStage(recommendedGame) === 'completed')),
  );
  const contextEvent = showPracticeContext ? recommendedPractice : nextGame;
  const gameStage: SupporterGameStage = contextEvent
    ? getSupporterGameStage(contextEvent)
    : nextGameIsUpcoming ? 'upcoming' : 'upcoming';
  const recommendedGameStage = recommendedGame
    ? getSupporterGameStage(recommendedGame)
    : null;
  const isViewingPastGame = Boolean(
    nextGame
    && contextEvent === nextGame
    && recommendedGame
    && nextGame.id !== recommendedGame.id
    && gameStage === 'completed',
  );
  const currentStage = contextEvent?.type === 'practice' && gameStage === 'upcoming'
    ? {
      ...stageCopy[gameStage],
      kicker: 'Practice next',
      description: 'Pack the essentials now so practice feels easy.',
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
  const contextDateParts = contextEvent ? getEventDateParts(contextEvent.date) : null;
  const statTrackerHrefForGame = (game: SupporterEvent | undefined) => game
    ? `${supporterToolRoutes.statTracker}?date=${encodeURIComponent(game.date)}&opponent=${encodeURIComponent(game.opponent || '')}`
    : supporterToolRoutes.statTracker;
  const checklistHrefForGame = (game: SupporterEvent | undefined) => game
    ? `/studio/checklist?gameId=${encodeURIComponent(game.id)}`
    : supporterToolRoutes.checklist;
  const hypeCardHrefForGame = (game: SupporterEvent | undefined) => game
    ? `/studio/hype-card?source=game-day&gameId=${encodeURIComponent(game.id)}&date=${encodeURIComponent(game.date)}&opponent=${encodeURIComponent(game.opponent || '')}`
    : supporterToolRoutes.hypeCard;
  const statTrackerHref = statTrackerHrefForGame(nextGame);
  const contextChecklistHref = checklistHrefForGame(contextEvent);
  const hypeCardHref = hypeCardHrefForGame(nextGame);
  const recommendedStatTrackerHref = statTrackerHrefForGame(recommendedGame);
  const recommendedChecklistHref = checklistHrefForGame(weekRecommendation?.event);
  const weeklyPath = [
    {
      id: 'plan',
      number: '01',
      label: 'Plan the week',
      Icon: CalendarDays,
      href: supporterToolRoutes.schedule,
      active: !weekRecommendation,
    },
    {
      id: 'upcoming',
      number: '02',
      label: 'Prep',
      Icon: ClipboardCheck,
      href: recommendedChecklistHref,
      active: Boolean(weekRecommendation && weekRecommendation.stage === 'upcoming'),
    },
    {
      id: 'live',
      number: '03',
      label: 'Capture the game',
      Icon: Activity,
      href: recommendedStatTrackerHref,
      active: Boolean(weekRecommendation && weekRecommendation.stage === 'live'),
    },
    {
      id: 'completed',
      number: '04',
      label: 'Send the hype',
      Icon: Zap,
      href: hypeCardHref,
      active: Boolean(weekRecommendation && weekRecommendation.stage === 'completed'),
    },
  ] as const;
  type WeeklyPathId = typeof weeklyPath[number]['id'];
  const weeklyPathThemes: Record<WeeklyPathId, {
    accent: string;
    border: string;
    activeBorder: string;
    surface: string;
    number: string;
    icon: string;
    contentBorder: string;
    contentSurface: string;
    action: string;
  }> = {
    plan: {
      accent: 'text-sky-300',
      border: 'border-sky-300/70',
      activeBorder: 'border-sky-300/35',
      surface: 'bg-sky-300/10',
      number: 'bg-sky-300 text-slate-950',
      icon: 'text-sky-300',
      contentBorder: 'border-sky-300/60',
      contentSurface: 'bg-sky-300/[0.04]',
      action: 'bg-sky-300 text-slate-950 hover:bg-sky-200',
    },
    upcoming: {
      accent: 'text-amber-300',
      border: 'border-amber-300/70',
      activeBorder: 'border-amber-300/35',
      surface: 'bg-amber-300/10',
      number: 'bg-amber-300 text-slate-950',
      icon: 'text-amber-300',
      contentBorder: 'border-amber-300/60',
      contentSurface: 'bg-amber-300/[0.04]',
      action: 'bg-amber-300 text-slate-950 hover:bg-amber-200',
    },
    live: {
      accent: 'text-emerald-300',
      border: 'border-emerald-300/70',
      activeBorder: 'border-emerald-300/35',
      surface: 'bg-emerald-300/10',
      number: 'bg-emerald-300 text-slate-950',
      icon: 'text-emerald-300',
      contentBorder: 'border-emerald-300/60',
      contentSurface: 'bg-emerald-300/[0.04]',
      action: 'bg-emerald-300 text-slate-950 hover:bg-emerald-200',
    },
    completed: {
      accent: 'text-fuchsia-300',
      border: 'border-fuchsia-300/70',
      activeBorder: 'border-fuchsia-300/35',
      surface: 'bg-fuchsia-300/10',
      number: 'bg-fuchsia-300 text-slate-950',
      icon: 'text-fuchsia-300',
      contentBorder: 'border-fuchsia-300/60',
      contentSurface: 'bg-fuchsia-300/[0.04]',
      action: 'bg-fuchsia-300 text-slate-950 hover:bg-fuchsia-200',
    },
  };
  const [selectedPathId, setSelectedPathId] = useState<WeeklyPathId | null>(null);
  const activePath = weeklyPath.find((step) => step.active) ?? weeklyPath[0];
  const activePathIndex = weeklyPath.findIndex((step) => step.id === activePath.id);
  const [pathCelebration, setPathCelebration] = useState('');
  const previousActivePathIndex = useRef(activePathIndex);
  const pathCelebrationTimer = useRef<number | null>(null);
  const selectedPath = weeklyPath.find(({ id }) => id === selectedPathId)
    ?? weeklyPath.find(({ active }) => active)
    ?? weeklyPath[0];
  const weeklyPathDetails: Record<WeeklyPathId, {
    eyebrow: string;
    title: string;
    description: string;
    action: string;
  }> = {
    plan: {
      eyebrow: '01 / Schedule',
      title: 'Put the week in motion.',
      description: 'Add or confirm your next event so Pixl can guide what comes next.',
      action: 'Open schedule',
    },
    upcoming: {
      eyebrow: '02 / Preparation',
      title: weekRecommendation?.kind === 'practice' ? 'Get ready for practice.' : 'Get ready for game day.',
      description: weekRecommendation?.kind === 'practice'
        ? 'Practice is coming up. Check what you need before you leave.'
        : 'Game day is coming up. Check what you need before you leave.',
      action: 'Open checklist',
    },
    live: {
      eyebrow: '03 / Live game',
      title: 'Capture today’s game.',
      description: 'The event is here. Track the action and save the moments that matter.',
      action: 'Start game day',
    },
    completed: {
      eyebrow: '04 / Celebration',
      title: 'Celebrate the moment.',
      description: 'Turn the game’s highlights into something your athlete can share.',
      action: 'Create hype card',
    },
  };
  const selectedPathDetails = weeklyPathDetails[selectedPath.id];
  const activePathDetails = weeklyPathDetails[activePath.id];

  useEffect(() => {
    const previousIndex = previousActivePathIndex.current;
    previousActivePathIndex.current = activePathIndex;
    if (activePathIndex <= previousIndex || previousIndex < 0) return;
    const completedStep = weeklyPath[activePathIndex - 1];
    if (!completedStep) return;
    trackEvent('weekly_path_advanced', {
      source: 'supporter_dashboard',
      from_stage: completedStep.id,
      to_stage: activePath.id,
      progress_count: activePathIndex,
    });
    if (pathCelebrationTimer.current !== null) window.clearTimeout(pathCelebrationTimer.current);
    setPathCelebration(`${completedStep.label} complete. Next up: ${activePath.label}.`);
    pathCelebrationTimer.current = window.setTimeout(() => setPathCelebration(''), 4200);
  }, [activePath.id, activePathIndex]);

  useEffect(() => () => {
    if (pathCelebrationTimer.current !== null) window.clearTimeout(pathCelebrationTimer.current);
  }, []);

  useEffect(() => {
    if (!weekRecommendation && selectedPathId !== null) {
      setSelectedPathId(null);
    }
  }, [selectedPathId, weekRecommendation]);

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
  }, [gameEvents, stageReminderKey]);

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

  const selectGame = (gameId: string) => {
    setSelectedGameId(gameId);
    try {
      saveSupporterActiveGame(window.localStorage, gameId);
    } catch {
      // The selection still works for this session when storage is unavailable.
    }
  };

  const focusFirstTool = () => {
    document.getElementById('all-tools-panel')?.querySelector<HTMLElement>('a, button')?.focus();
  };

  const openTools = () => {
    setToolsOpen(true);
    window.requestAnimationFrame(() => {
      document.getElementById('all-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.requestAnimationFrame(focusFirstTool);
    });
  };

  const closeTools = () => {
    setToolsOpen(false);
    window.requestAnimationFrame(() => toolsTriggerRef.current?.focus());
  };

  const toggleTools = () => {
    if (toolsOpen) {
      closeTools();
    } else {
      openTools();
    }
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const firstName = profile.displayName ? profile.displayName.split(' ')[0] : 'Supporter';
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const mobileFeaturedEvent = weekRecommendation?.event ?? getActiveSupporterGame(gameEvents, null) ?? events[0];
  const mobileFeaturedTitle = mobileFeaturedEvent?.type === 'practice'
    ? `${profile.teamName || 'Your team'} practice`
    : `${profile.teamName || 'Your team'}${mobileFeaturedEvent?.opponent ? ` vs ${mobileFeaturedEvent.opponent}` : ''}`;

  return (
    <>
      {/* MOBILE VIEW */}
      <div className="supporter-dashboard-mobile-shell fixed inset-0 z-0 pixl-dashboard-mobile overflow-y-auto overflow-x-hidden pb-[calc(7rem+env(safe-area-inset-bottom))] flex-col">
        {/* Mobile Header */}
        <header className="bg-white flex items-center justify-between px-4 h-16 shrink-0 border-b border-black/5 relative z-10" data-testid="mobile-header">
          <div className="flex items-center gap-2">
            <img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-6 w-auto object-contain" />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-11 h-11 flex items-center justify-center">
              <HypeCardReplyInboxTrigger className="mobile-notification-trigger !absolute inset-0 w-full h-full p-0 flex items-center justify-center bg-transparent border-none text-[#12213A] shadow-none hover:bg-transparent" />
            </div>
            <button type="button" onClick={onOpenProfile} className="w-11 h-11 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center border border-black/10 text-lg font-bold text-slate-700" aria-label="Supporter profile" data-testid="btn-mobile-open-profile">
               {profile.displayName ? profile.displayName.charAt(0).toUpperCase() : 'S'}
            </button>
             <button
               ref={mobileMenuButtonRef}
               type="button"
               onClick={() => setMobileMenuOpen((open) => !open)}
               className="grid h-11 w-11 place-items-center rounded-full border border-black/10 text-[#12213A] transition-colors hover:bg-black/5"
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
                <Link href="/help" className="flex items-center justify-between bg-black/5 p-4 text-lg font-display tracking-wide text-[#12213A]" onClick={() => setMobileMenuOpen(false)} data-testid="link-mobile-dashboard-help">
                  HELP <ArrowRight className="h-5 w-5 text-[#2474F5]" />
                </Link>
                <Link href="/privacy" className="flex items-center justify-between bg-black/5 p-4 text-lg font-display tracking-wide text-[#12213A]" onClick={() => setMobileMenuOpen(false)} data-testid="link-mobile-dashboard-privacy">
                  PRIVACY <ArrowRight className="h-5 w-5 text-[#2474F5]" />
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
            onClick={onOpenProfile}
            testId="btn-mobile-athlete-switcher"
          />

          {/* Next Event Card */}
          <div className="bg-white rounded-[20px] p-5 shadow-sm border border-black/5" data-testid="card-mobile-featured-event">
            <div className="flex items-center gap-2 mb-3 text-[11px] font-bold uppercase tracking-widest text-black/40">
              <span>NEXT EVENT</span>
            </div>
            {mobileFeaturedEvent ? (
              <div className="flex items-start gap-4">
                <CalendarDays className="w-7 h-7 text-[#2474F5] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[22px] font-bold font-display tracking-tight text-[#12213A] leading-tight mb-1.5 break-words">{mobileFeaturedTitle}</h2>
                  <div className="text-[15px] font-medium text-black/60 flex items-center gap-1.5 flex-wrap mb-1">
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
          </div>
          </div>
          </section>

          {/* Four-Step Weekly Path */}
           <section className="mt-2 px-1" data-testid="section-mobile-weekly-path" aria-label="Weekly progress">
              <div className="mobile-week-path-intro">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Your week path</p>
                <p className="mt-2 max-w-sm text-xs font-medium leading-relaxed text-white/55">Start with the schedule, then follow the next step as the week moves. The calendar marks what comes next.</p>
              </div>

              <ol className="mobile-week-path-steps m-0 grid list-none p-0">
                {weeklyPath.map((step, index) => {
                  const isActive = activePath.id === step.id;
                  const isCompleted = index < activePathIndex;
                  const isSelected = selectedPath.id === step.id;
                  const StepIcon = step.Icon;

                  return (
                    <li key={step.id} aria-current={isActive ? 'step' : undefined}>
                      <button
                        type="button"
                        onClick={() => setSelectedPathId(step.id)}
                        aria-current={isActive ? 'step' : undefined}
                        aria-pressed={isSelected}
                        className={`mobile-week-path-step ${isSelected ? 'is-selected' : ''} ${isActive ? 'is-active' : ''} ${isCompleted ? 'is-completed' : ''}`}
                        data-testid={`mobile-stage-${step.id}`}
                      >
                        <span className="mobile-week-path-number" aria-hidden="true">
                          {isCompleted ? <Check className="h-4 w-4" strokeWidth={3} /> : index + 1}
                        </span>
                        <span className="mobile-week-path-label">
                          <span className="sr-only">Step {index + 1}: </span>
                          {step.id === 'plan' ? 'Plan' : step.id === 'upcoming' ? 'Prep' : step.id === 'live' ? 'Capture' : 'Send'}
                        </span>
                        <StepIcon className="mobile-week-path-icon h-4 w-4" aria-hidden="true" />
                        <span className="mobile-week-path-state">
                          {isActive ? 'Next' : isCompleted ? 'Done' : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
          </section>

          {pathCelebration && (
            <div className="mx-1 mt-3 flex items-center gap-3 rounded-[16px] border border-[#17A673]/20 bg-[#EAF8F2] px-4 py-3 text-[#0B6548] motion-safe:animate-pulse" role="status" aria-live="polite" data-testid="mobile-week-path-celebration">
              <Sparkles className="h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="text-sm font-bold">{pathCelebration}</p>
            </div>
          )}

          {/* Recommendation Card */}
          <section className="bg-white rounded-[24px] overflow-hidden shadow-sm border border-black/5 mt-3" data-testid="card-mobile-recommendation" aria-labelledby="mobile-recommendation-heading">
             <div className="p-6">
                <div className="mb-4 flex items-center gap-3">
                  <span className="mobile-recommendation-icon grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#55A4FF]/40 bg-[#2878F5]/10 text-[#55A4FF]" aria-hidden="true">
                    <selectedPath.Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-[#2474F5]">YOUR NEXT BEST STEP</p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-black/40">{selectedPath.id === activePath.id ? 'UP NEXT' : 'STAGE DETAILS'}</p>
                  </div>
                </div>
                <h2 id="mobile-recommendation-heading" className="text-5xl font-display font-black tracking-tight text-[#12213A] leading-[0.95] mb-4 break-words">{selectedPathDetails.title}</h2>
                <p className="text-[17px] text-black/60 font-medium leading-relaxed mb-6">{selectedPathDetails.description}</p>

               <button
                 type="button"
                 onClick={() => {
                   trackEvent('completion_next_action_clicked', {
                     source: 'weekly_path_mobile',
                      stage: selectedPath.id,
                     progress_count: activePathIndex,
                   });
                    setLocation(selectedPath.href);
                 }}
                 className="w-full bg-[#2474F5] hover:bg-[#2474F5]/90 text-white font-bold text-base py-4 rounded-[14px] flex items-center justify-center gap-2 transition-colors shadow-sm"
                 data-testid="btn-mobile-recommendation-action"
               >
                  <selectedPath.Icon className="w-5 h-5" />
                  {selectedPathDetails.action}
               </button>

               <p className="text-center text-[13px] font-medium text-black/40 mt-4">{mobileFeaturedEvent ? "Suggested from your next event" : "Add an event to get a recommendation"}</p>
             </div>
          </section>

          {/* Upcoming Section */}
          {(() => {
             const futureEvents = events
                .filter(e => mobileFeaturedEvent && e.id !== mobileFeaturedEvent.id && e.date >= mobileFeaturedEvent.date)
                .sort((a,b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
             if (futureEvents.length === 0) return null;
             const nextUp = futureEvents[0];
             return (
              <section className="mt-2 mb-4" data-testid="section-mobile-coming-up" aria-labelledby="mobile-coming-up-heading">
                <div className="flex items-center justify-between mb-4 px-1">
                  <h3 id="mobile-coming-up-heading" className="text-[28px] font-display font-black tracking-tight text-[#12213A]">Coming up</h3>
                  <button type="button" onClick={() => setLocation(supporterToolRoutes.schedule)} className="text-[#2474F5] text-[15px] font-bold flex items-center gap-1" data-testid="btn-mobile-view-schedule">View schedule <ArrowRight className="w-4 h-4" /></button>
                </div>

                <button type="button" onClick={() => setLocation(supporterToolRoutes.schedule)} className="w-full text-left bg-white rounded-[20px] p-5 shadow-sm border border-black/5 flex items-center justify-between" aria-label="View upcoming event details" data-testid="btn-mobile-coming-up-action">
                   <div className="flex items-center gap-4 min-w-0">
                     <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-black/40 shrink-0 border border-black/5">
                       <CalendarDays className="w-6 h-6" />
                     </div>
                     <div className="min-w-0 flex-1">
                       <div className="text-[17px] font-bold text-[#12213A] break-words">{nextUp.type === 'game' ? `${profile.teamName || 'Team'} vs ${nextUp.opponent || 'TBD'}` : `${profile.teamName || 'Team'} ${nextUp.type}`}</div>
                       <div className="text-[13px] font-medium text-black/50 flex items-center gap-1.5 flex-wrap mt-1">
                         <span className="whitespace-nowrap">{formatDateDisplay(nextUp.date)}</span>
                         <span className="text-black/30">•</span>
                         <span className="whitespace-nowrap">{formatTimeDisplay(nextUp.time)}</span>
                       </div>
                       {nextUp.location && (
                          <div className="text-[13px] font-medium text-black/50 flex items-start gap-1.5 mt-1">
                            <MapPin className="w-3.5 h-3.5 text-black/30 shrink-0 mt-0.5" />
                            <span className="break-words min-w-0">{nextUp.location}</span>
                          </div>
                       )}
                     </div>
                   </div>
                   <ChevronRight className="w-6 h-6 text-black/20 shrink-0 ml-2" />
                </button>
              </section>
             );
          })()}
        </div>

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
           <button type="button" onClick={() => setLocation(supporterToolRoutes.schedule)} className="flex min-w-0 max-w-20 flex-1 flex-col items-center justify-center h-[52px] gap-1 text-black/40 hover:text-[#12213A] transition-colors" aria-label="Schedule" data-testid="btn-mobile-nav-schedule">
             <div className="w-8 h-8 rounded-full flex items-center justify-center">
               <CalendarDays className="w-[20px] h-[20px]" />
             </div>
             <span className="text-[10px] font-bold">Schedule</span>
           </button>
           <button type="button" onClick={() => setLocation(supporterToolRoutes.statTracker)} className="flex min-w-0 max-w-20 flex-1 flex-col items-center justify-center h-[52px] gap-1 text-black/40 hover:text-[#12213A] transition-colors" aria-label="Game Day" data-testid="btn-mobile-nav-stat-tracker">
             <div className="w-8 h-8 rounded-full flex items-center justify-center">
               <Users className="w-[20px] h-[20px]" />
             </div>
             <span className="text-[10px] font-bold">Game Day</span>
           </button>
            <button type="button" onClick={() => setLocation('/studio/athlete-page')} className="flex min-w-0 max-w-20 flex-1 flex-col items-center justify-center h-[52px] gap-1 text-black/40 hover:text-[#12213A] transition-colors" aria-label="Create" data-testid="btn-mobile-nav-create">
             <div className="w-8 h-8 rounded-full flex items-center justify-center">
               <PlusSquare className="w-[20px] h-[20px]" />
             </div>
             <span className="text-[10px] font-bold">Create</span>
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
                <div className="dashboard-athlete-avatar flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary bg-background text-foreground shadow-[0_0_26px_rgba(22,232,120,0.25)] sm:h-20 sm:w-20">
                  {athletePhotoUrl ? (
                    <div className="h-full w-full overflow-hidden rounded-full">
                      <AthletePhoto url={athletePhotoUrl} crop={athletePhotoCrop} alt={`${profile.athleteName || 'Athlete'} profile`} />
                    </div>
                  ) : hasAthlete ? (
                    <User className="h-8 w-8 opacity-20 sm:h-10 sm:w-10" />
                  ) : (
                    <Users className="h-8 w-8 opacity-20 sm:h-10 sm:w-10" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-foreground text-background transition-transform hover:scale-110 sm:h-7 sm:w-7"
                  aria-label="Edit athlete profile"
                  title="Edit athlete profile"
                  data-testid="btn-edit-athlete-avatar"
                >
                  <PenSquare className="h-3 w-3" />
                </button>
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
                  <button type="button" onClick={onOpenProfile} className="mt-2 text-left text-xs font-medium text-white/65 underline decoration-primary underline-offset-4 hover:text-white" data-testid="btn-setup-athlete">
                    Set up athlete details
                  </button>
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
            <p className="mt-6 max-w-lg text-base font-medium leading-relaxed text-white/70">{currentStage.description}</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {gameStage === 'upcoming' && contextEvent && <button type="button" onClick={() => setLocation(contextChecklistHref)} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 clip-angled-sm" data-testid="button-context-checklist"><ClipboardCheck className="h-4 w-4" /> Open checklist</button>}
              {gameStage === 'live' && <button type="button" onClick={() => setLocation(statTrackerHref)} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 clip-angled-sm" data-testid="button-context-stat-tracker"><Activity className="h-4 w-4" /> Track the game</button>}
              {gameStage === 'completed' && <Link href={hypeCardHref} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 clip-angled-sm" data-testid="link-context-hype-card"><Zap className="h-4 w-4" /> Make a Hype Card</Link>}
              {!contextEvent && <Link href="/studio/schedule" className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground clip-angled-sm" data-testid="link-context-schedule"><CalendarDays className="h-4 w-4" /> Add an event</Link>}
            </div>
          </div>
        </div>
        </section>
      </div>

      <section className="dashboard-week-path-panel animate-slide-up delay-200">
          <div className="dashboard-week-path-tabs flex flex-col justify-end">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Your week path</p>
            <p className="mt-2 max-w-sm text-xs font-medium leading-relaxed text-white/50">Start with the schedule, then follow the next step as the week moves. The calendar marks what comes next.</p>
            {pathCelebration && (
              <div className="mt-4 flex items-start gap-2 border border-emerald-300/35 bg-emerald-300/10 px-3 py-3 text-emerald-200 motion-safe:animate-pulse" role="status" aria-live="polite" data-testid="desktop-week-path-celebration">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="text-xs font-bold leading-relaxed">{pathCelebration}</p>
              </div>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {weeklyPath.map(({ id, number, label, Icon, active }, index) => {
                const theme = weeklyPathThemes[id];
                const selected = selectedPath.id === id;
                const completed = index < activePathIndex;
                return (
                  <button
                    type="button"
                    key={id}
                    aria-current={active ? 'step' : undefined}
                    aria-pressed={selected}
                    onClick={() => setSelectedPathId(id)}
                    className={`flex items-center gap-3 border px-3 py-3 text-left transition-all motion-reduce:transition-none hover:border-white/50 hover:text-white ${selected ? `${theme.border} ${theme.surface} text-white` : active ? `${theme.activeBorder} ${theme.surface} text-white/80` : completed ? 'border-emerald-300/25 bg-emerald-300/[0.06] text-white/70' : 'border-white/10 bg-white/[0.03] text-white/45'}`}
                    data-testid={`stage-${id}`}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center text-xs font-bold ${selected ? theme.number : active ? `${theme.activeBorder} ${theme.surface} ${theme.accent} border` : completed ? 'bg-emerald-300 text-slate-950' : 'bg-white/10 text-white/60'}`}>{completed ? <Check className="h-4 w-4" /> : number}</span>
                    <span className="min-w-0 text-xs font-bold uppercase tracking-widest">{label}</span>
                    <Icon className={`h-4 w-4 shrink-0 ${selected || active ? theme.icon : 'text-white/35'}`} />
                    {active && (
                      <span className={`dashboard-stage-next ml-auto inline-flex shrink-0 items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] ${theme.accent}`} data-testid={`stage-${id}-next`}>
                        UP NEXT
                      </span>
                    )}
                    {completed && !active && (
                      <span className="ml-auto text-[9px] font-bold uppercase tracking-[0.16em] text-sky-300">Complete</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        <div
          id="week-path-content"
          className="dashboard-week-path-recommendation"
          data-testid="week-path-content"
          data-selected-path={selectedPath.id}
          aria-labelledby="desktop-recommendation-heading"
        >
          <div className="dashboard-week-path-recommendation-inner">
            <div className="dashboard-week-path-recommendation-header">
              <span className="dashboard-week-path-recommendation-icon" aria-hidden="true">
                <selectedPath.Icon />
              </span>
              <div className="min-w-0">
                <p className="dashboard-week-path-recommendation-eyebrow">Your next best step</p>
                <p className="dashboard-week-path-recommendation-status">
                  {selectedPath.id === activePath.id ? 'Up next' : 'Stage details'}
                </p>
              </div>
            </div>
            <h3 id="desktop-recommendation-heading" className="dashboard-week-path-recommendation-title">
              {selectedPathDetails.title}
            </h3>
            <p className="dashboard-week-path-recommendation-description">{selectedPathDetails.description}</p>
            <button
              type="button"
              onClick={() => {
                trackEvent('completion_next_action_clicked', {
                  source: 'weekly_path_desktop',
                  stage: selectedPath.id,
                  progress_count: activePathIndex,
                });
                setLocation(selectedPath.href);
              }}
              className="dashboard-week-path-recommendation-action"
              data-testid="btn-desktop-recommendation-action"
            >
              <selectedPath.Icon aria-hidden="true" />
              {selectedPathDetails.action}
            </button>
            <p className="dashboard-week-path-recommendation-note">
              {mobileFeaturedEvent ? 'Suggested from your next event' : 'Add an event to get a recommendation'}
            </p>
          </div>
        </div>
        </section>

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

      {/* TOOL CHOOSER */}
      <section id="all-tools" className="animate-slide-up delay-200">
        <div className="border-b border-border pb-4">
          <button
            type="button"
            onClick={toggleTools}
            aria-controls="all-tools-panel"
            aria-expanded={toolsOpen}
            className="flex w-full items-center justify-between gap-4 text-left"
            data-testid="button-choose-task"
            ref={toolsTriggerRef}
          >
            <span id="all-tools-heading">
              <span className="studio-textured-accent mb-1 block text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Choose a task</span>
              <span className="font-display text-3xl uppercase tracking-wide">All tools</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-2 border border-border bg-card px-4 py-3 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary hover:text-primary clip-angled-sm">
              {toolsOpen ? 'Hide tools' : 'View tools'}
              <ChevronDown className={`h-4 w-4 transition-transform ${toolsOpen ? 'rotate-180' : ''}`} />
            </span>
          </button>
          <p className="mt-3 text-sm font-medium text-muted-foreground">The next best move is always close.</p>
        </div>
        {toolsOpen && (
          <div
            id="all-tools-panel"
            className="mt-4 grid gap-2 sm:grid-cols-2"
            data-testid="all-tools-panel"
            aria-labelledby="all-tools-heading"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeTools();
            }}
          >
            <Link href={supporterToolRoutes.hypeCard} className="group flex items-center justify-between border border-border bg-card px-4 py-4 transition-colors hover:border-primary hover:bg-primary/5 clip-angled-sm" data-testid="link-quick-hype">
              <span className="flex min-w-0 items-center gap-3">
                <Zap className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block font-display text-xl uppercase tracking-wide">Hype Card</span>
                  <span className="block text-xs font-medium text-muted-foreground">Celebrate a big moment.</span>
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
            <Link href={supporterToolRoutes.schedule} className="group flex items-center justify-between border border-border bg-card px-4 py-4 transition-colors hover:border-primary hover:bg-primary/5 clip-angled-sm" data-testid="link-quick-schedule">
              <span className="flex min-w-0 items-center gap-3">
                <CalendarDays className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block font-display text-xl uppercase tracking-wide">{recommendedPractice && !nextGame ? 'Practice' : 'Game Day'}</span>
                  <span className="block truncate text-xs font-medium text-muted-foreground">{nextGame ? `${formatDateDisplay(nextGame.date)} · ${formatTimeDisplay(nextGame.time)}` : recommendedPractice ? `${formatDateDisplay(recommendedPractice.date)} · Practice` : scheduleSource ? 'No upcoming game scheduled.' : 'Create or open a saved schedule.'}</span>
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
            <button type="button" onClick={onOpenStatTracker} className="group flex items-center justify-between border border-border bg-card px-4 py-4 text-left transition-colors hover:border-primary hover:bg-primary/5 clip-angled-sm" data-testid="link-quick-stat-tracker">
              <span className="flex min-w-0 items-center gap-3">
                <Activity className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block font-display text-xl uppercase tracking-wide">Stat Tracker</span>
                  <span className="block text-xs font-medium text-muted-foreground">Track the game as it happens.</span>
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </button>
            <button type="button" onClick={onOpenChecklist} className="group flex items-center justify-between border border-border bg-card px-4 py-4 text-left transition-colors hover:border-primary hover:bg-primary/5 clip-angled-sm" data-testid="link-quick-checklist">
              <span className="flex min-w-0 items-center gap-3">
                <ClipboardCheck className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block font-display text-xl uppercase tracking-wide">Checklist</span>
                  <span className="block text-xs font-medium text-muted-foreground">Prepare with the whole team.</span>
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </button>
          </div>
        )}
      </section>
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

function AthletePhotoCardPreview({
  url,
  crop,
  athleteName,
  jerseyNumber,
  teamName,
  alt,
  dataTestId,
}: {
  url?: string;
  crop?: AthletePhotoCrop;
  athleteName: string;
  jerseyNumber: string;
  teamName: string;
  alt: string;
  dataTestId?: string;
}) {
  return (
    <div className="athlete-photo-settings-preview" data-testid={dataTestId}>
      {url ? (
        <AthletePhoto url={url} crop={crop ?? { x: 50, y: 50, zoom: 100 }} alt={alt} />
      ) : (
        <div className="athlete-photo-settings-preview-placeholder" aria-hidden="true">
          <User className="h-12 w-12" />
        </div>
      )}
      <div className="athlete-photo-settings-preview-scrim" aria-hidden="true" />
      <div className="athlete-photo-settings-preview-copy">
        <span>{athleteName || 'Athlete name'}</span>
        <span className="athlete-photo-settings-preview-meta">
          {jerseyNumber ? `#${jerseyNumber}` : '#00'}
          {teamName ? `  ·  ${teamName}` : ''}
        </span>
      </div>
      <ChevronRight className="athlete-photo-settings-preview-arrow" aria-hidden="true" />
    </div>
  );
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
              <AthletePhotoCardPreview
                url={athletePhotoUrl}
                crop={athletePhotoCrop}
                athleteName={profile.athleteName}
                jerseyNumber={profile.jerseyNumber}
                teamName={profile.teamName}
                alt="Athlete profile"
                dataTestId="athlete-photo-settings-preview"
              />
              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Private to your signed-in account. JPG, PNG, or WebP, up to 5 MB.</p>
                {photoError && <p className="text-sm font-bold text-destructive" role="alert">{photoError}</p>}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="cursor-pointer bg-foreground text-background px-5 py-3 text-center text-xs font-bold uppercase tracking-widest disabled:opacity-50">
                    {photoBusy ? 'Uploading…' : athletePhotoUrl ? 'Replace Photo' : 'Add Photo'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={photoBusy} onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onPhotoChange(file);
                      event.currentTarget.value = '';
                    }} data-testid="input-athlete-photo" />
                  </label>
                  {athletePhotoUrl && !pendingPhotoUrl && <button type="button" disabled={photoBusy} onClick={onPhotoRemove} className="border border-destructive px-5 py-3 text-xs font-bold uppercase tracking-widest text-destructive disabled:opacity-50" data-testid="btn-remove-athlete-photo"><Trash2 className="mr-2 inline h-4 w-4" />Remove</button>}
                </div>
              </div>
            </div>
            {pendingPhotoUrl && (
              <div className="rounded-sm border border-border bg-background p-4 sm:p-5" data-testid="athlete-photo-crop-editor">
                <div className="grid gap-5 sm:grid-cols-[minmax(220px,1fr)_1fr] sm:items-center">
                  <AthletePhotoCardPreview
                    url={pendingPhotoUrl}
                    crop={pendingPhotoCrop}
                    athleteName={profile.athleteName}
                    jerseyNumber={profile.jerseyNumber}
                    teamName={profile.teamName}
                    alt="New athlete photo crop preview"
                    dataTestId="athlete-photo-crop-preview"
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
                    <p className="text-xs text-muted-foreground">Your replacement starts centered. Adjust it here before uploading.</p>
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
