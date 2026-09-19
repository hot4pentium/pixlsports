import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  CalendarDays, Zap, MapPin, Trophy, ChevronRight, User, ClipboardCheck,
  Users, Activity, Image as ImageIcon,
  CalendarX2, ArrowRight, PenSquare, Loader2, AlertTriangle, AlertCircle, Camera, Trash2, RotateCcw, X,
  Video, CheckCircle2, ChevronDown
} from 'lucide-react';
import { differenceInCalendarDays, format, parseISO, isValid } from 'date-fns';
import {
  getActiveSupporterGame,
  getCalendarViewState,
  getSupporterGameStage,
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
export interface SupporterDashboardViewProps {
  profile: SupporterProfile;
  events: SupporterEvent[];
  nextGameIsUpcoming: boolean;
  projects: SupporterProject[];
  scheduleSource: 'team' | 'custom' | null;
  connected: boolean;
  connectionLabel: string;
  loadingCalendar: boolean;
  calendarError: boolean;
  calendarConnectionInvalid: boolean;
  onOpenProfile: () => void;
  onRetryCalendar: () => void;
  onReconnectCalendar: () => void;
  onDisconnect: () => void;
  athletePhotoUrl?: string;
  athletePhotoCrop?: AthletePhotoCrop;
  onOpenStatTracker: () => void;
  onOpenChecklist: () => void;
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
  if (!isValid(date)) return 'Next game';
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
  connected,
  connectionLabel,
  loadingCalendar,
  calendarError,
  calendarConnectionInvalid,
  onOpenProfile,
  onRetryCalendar,
  onReconnectCalendar,
  onDisconnect,
  athletePhotoUrl,
  athletePhotoCrop = { x: 50, y: 50, zoom: 100 },
  onOpenStatTracker,
  onOpenChecklist,
}: SupporterDashboardViewProps) {
  const [, setLocation] = useLocation();
  const [captureNotice, setCaptureNotice] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : readSupporterActiveGame(window.localStorage)
  ));
  const hasAthlete = Boolean(profile.athleteName);
  const calendarState = getCalendarViewState({
    calendarCode: connected || loadingCalendar || calendarError || calendarConnectionInvalid ? 'connected-calendar' : '',
    loading: loadingCalendar,
    invalid: calendarConnectionInvalid,
    failed: calendarError,
    calendar: connected ? { events } : undefined,
    customSchedule: scheduleSource === 'custom' ? { events } : undefined,
  });
  const gameEvents = events.filter((event) => event.type === 'game');
  const nextGame = getActiveSupporterGame(gameEvents, selectedGameId);
  const gameStage: SupporterGameStage = nextGame
    ? getSupporterGameStage(nextGame)
    : nextGameIsUpcoming ? 'upcoming' : 'upcoming';
  const currentStage = stageCopy[gameStage];
  const stageReminderKey = nextGame
    ? getSupporterStageAcknowledgmentKey(nextGame.id, gameStage)
    : null;
  const [, setReminderVersion] = useState(0);
  const showStageReminder = Boolean(
    nextGame
    && stageReminderKey
    && typeof window !== 'undefined'
    && !hasAcknowledgedSupporterGameStage(window.localStorage, nextGame.id, gameStage),
  );
  const gameTitle = nextGame
    ? `${profile.teamName || 'Your team'}${nextGame.opponent ? ` vs ${nextGame.opponent}` : ''}`
    : 'Your next game';
  const statTrackerHref = nextGame
    ? `${supporterToolRoutes.statTracker}?date=${encodeURIComponent(nextGame.date)}&opponent=${encodeURIComponent(nextGame.opponent || '')}`
    : supporterToolRoutes.statTracker;
  const checklistHref = nextGame
    ? `/studio/checklist?gameId=${encodeURIComponent(nextGame.id)}`
    : supporterToolRoutes.checklist;
  const hypeCardHref = nextGame
    ? `/studio/hype-card?source=game-day&gameId=${encodeURIComponent(nextGame.id)}&date=${encodeURIComponent(nextGame.date)}&opponent=${encodeURIComponent(nextGame.opponent || '')}`
    : supporterToolRoutes.hypeCard;
  const weeklyPath = [
    {
      id: 'plan',
      number: '01',
      label: 'Plan the week',
      Icon: CalendarDays,
      href: supporterToolRoutes.schedule,
      active: !nextGame,
    },
    {
      id: 'upcoming',
      number: '02',
      label: 'Get ready',
      Icon: ClipboardCheck,
      href: checklistHref,
      active: Boolean(nextGame && gameStage === 'upcoming'),
    },
    {
      id: 'live',
      number: '03',
      label: 'Capture the game',
      Icon: Activity,
      href: statTrackerHref,
      active: Boolean(nextGame && gameStage === 'live'),
    },
    {
      id: 'completed',
      number: '04',
      label: 'Send the hype',
      Icon: Zap,
      href: hypeCardHref,
      active: Boolean(nextGame && gameStage === 'completed'),
    },
  ] as const;

  useEffect(() => {
    if (!showStageReminder || !nextGame || !stageReminderKey) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      acknowledgeSupporterGameStage(window.localStorage, nextGame.id, gameStage);
      setReminderVersion((version) => version + 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameStage, nextGame, showStageReminder, stageReminderKey]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      const syncEvent = parseSupporterStorageSyncEvent(event);
      if (!syncEvent) return;

      if (syncEvent.type === 'active-game') {
        if (!gameEvents.some((game) => game.id === syncEvent.gameId)) return;
        setSelectedGameId(syncEvent.gameId);
        setCaptureNotice('');
        return;
      }

      if (syncEvent.key === stageReminderKey) {
        setReminderVersion((version) => version + 1);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [gameEvents, stageReminderKey]);

  const dismissStageReminder = () => {
    if (!nextGame) return;
    acknowledgeSupporterGameStage(window.localStorage, nextGame.id, gameStage);
    setReminderVersion((version) => version + 1);
  };

  const selectGame = (gameId: string) => {
    setSelectedGameId(gameId);
    try {
      saveSupporterActiveGame(window.localStorage, gameId);
    } catch {
      // The selection still works for this session when storage is unavailable.
    }
    setCaptureNotice('');
  };

  const handleCapture = (kind: 'photo' | 'video', file?: File) => {
    if (!file) {
      setCaptureNotice('No media selected. You can try again whenever you are ready.');
      return;
    }
    setCaptureNotice(
      `${kind === 'photo' ? 'Photo' : 'Video'} ready for ${gameTitle}. It stays in your camera roll; Pixl Sports does not upload or store it here.`,
    );
  };

  const focusFirstTool = () => {
    document.getElementById('all-tools-panel')?.querySelector<HTMLElement>('a, button')?.focus();
  };

  const openTools = () => {
    setToolsOpen(true);
    window.requestAnimationFrame(() => {
      document.getElementById('all-tools')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      focusFirstTool();
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

  return (
    <div className="w-full max-w-[1400px] mx-auto px-5 py-8 sm:px-8 space-y-12">
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
      {/* HEADER */}
      <header className="animate-slide-up grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)] lg:gap-12">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted text-xs font-bold uppercase tracking-widest text-foreground clip-angled-sm mb-4">
            <Activity className="w-4 h-4 text-primary" />
            {profile.displayName ? `WELCOME, ${profile.displayName}` : 'YOUR SPORTS HOME'}
          </div>
          <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl leading-[0.9] tracking-tight uppercase">
            GAME DAY <span className="text-primary studio-textured-accent">HUB.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg font-medium text-muted-foreground">
            Plan the week, get ready for game day, capture what happens, and send the moment around.
          </p>
          <button
            type="button"
            onClick={toggleTools}
            aria-controls="all-tools-panel"
            aria-expanded={toolsOpen}
            className="mt-6 inline-flex min-h-11 items-center gap-2 border border-border bg-card px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors hover:border-primary hover:text-primary clip-angled-sm"
            data-testid="button-choose-task"
            ref={toolsTriggerRef}
          >
            Choose a task / all tools <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <section className="athlete-hero-depth relative overflow-hidden border border-border/20 bg-foreground text-background clip-angled" aria-labelledby="athlete-summary-heading" data-testid="athlete-summary">
          <div className="absolute inset-0 bg-tech-grid-dark opacity-20 pointer-events-none" />
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-[80px] mix-blend-screen pointer-events-none" />
          <div className="relative flex items-center gap-4 bg-[#111316] p-4 sm:gap-5 sm:p-5">
            <div className="relative shrink-0">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-primary bg-background text-foreground shadow-[0_0_26px_rgba(22,232,120,0.25)] sm:h-20 sm:w-20">
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
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">My athlete</p>
              <h2 id="athlete-summary-heading" className="mt-1 break-words font-display text-2xl uppercase leading-none tracking-wide text-white sm:text-3xl">
                {hasAthlete ? profile.athleteName : 'Unassigned'}
              </h2>
              {hasAthlete ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-widest text-white/65 sm:text-xs">
                  {profile.jerseyNumber && <span><span className="text-primary">#</span>{profile.jerseyNumber}</span>}
                  {profile.jerseyNumber && profile.position && <span className="opacity-40">•</span>}
                  {profile.position && <span>{profile.position}</span>}
                  {profile.relationship && <><span className="opacity-40">•</span><span>{profile.relationship}</span></>}
                </div>
              ) : (
                <button type="button" onClick={onOpenProfile} className="mt-2 text-left text-xs font-medium text-white/65 underline decoration-primary underline-offset-4 hover:text-white" data-testid="btn-setup-athlete">
                  Set up athlete details
                </button>
              )}
              {profile.teamName && (
                <div className="mt-3 inline-flex max-w-full items-center gap-2 border border-white/10 bg-white/5 px-2.5 py-1 text-white/80 clip-angled-sm">
                  <Trophy className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 whitespace-normal break-words text-[10px] font-bold uppercase tracking-widest" data-testid="athlete-team-name">{profile.teamName}</span>
                </div>
              )}
            </div>
            <div className="relative z-10 shrink-0">
              <HypeCardReplyInboxTrigger variant="coach" className="!px-2.5 !py-2" />
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
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              {currentStage.kicker}
              {scheduleSource && <span className="text-white/45">· {scheduleSource === 'team' ? 'Team calendar' : 'Your schedule'}</span>}
            </div>
            <h2 id="next-game-heading" className="mt-3 max-w-2xl font-display text-4xl leading-[0.92] tracking-tight sm:text-6xl">
              {nextGame ? gameTitle : 'Make the next game count.'}
            </h2>
            {nextGame ? (
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-white/65">
                <span>{formatDateDisplay(nextGame.date)}</span>
                <span className="text-white/30">·</span>
                <span>{formatTimeDisplay(nextGame.time)}</span>
                {nextGame.location && <><span className="text-white/30">·</span><span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-primary" />{nextGame.location}</span></>}
              </div>
            ) : (
              <p className="mt-5 max-w-lg text-sm font-medium leading-relaxed text-white/65">
                Add a game to the schedule and Pixl Sports will put the right action front and center.
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
              {gameStage === 'upcoming' && nextGame && <button type="button" onClick={() => setLocation(checklistHref)} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 clip-angled-sm" data-testid="button-context-checklist"><ClipboardCheck className="h-4 w-4" /> Open checklist</button>}
              {gameStage === 'live' && <button type="button" onClick={() => setLocation(statTrackerHref)} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 clip-angled-sm" data-testid="button-context-stat-tracker"><Activity className="h-4 w-4" /> Track the game</button>}
              {gameStage === 'completed' && <Link href={hypeCardHref} className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 clip-angled-sm" data-testid="link-context-hype-card"><Zap className="h-4 w-4" /> Make a Hype Card</Link>}
              {!nextGame && <Link href="/studio/schedule" className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground clip-angled-sm" data-testid="link-context-schedule"><CalendarDays className="h-4 w-4" /> Add a game</Link>}
            </div>
          </div>
          <div className="flex flex-col justify-end">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Your week path</p>
            <p className="mt-2 max-w-sm text-xs font-medium leading-relaxed text-white/50">Start with the schedule, then follow the next step as game day moves.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {weeklyPath.map(({ id, number, label, Icon, href, active }) => (
                <Link
                  key={id}
                  href={href}
                  aria-current={active ? 'step' : undefined}
                  className={`flex items-center gap-3 border px-3 py-3 transition-colors hover:border-primary/60 hover:text-white ${active ? 'border-primary/60 bg-primary/10 text-white' : 'border-white/10 bg-white/[0.03] text-white/45'}`}
                  data-testid={`stage-${id}`}
                >
                  <span className={`grid h-8 w-8 shrink-0 place-items-center text-xs font-bold ${active ? 'bg-primary text-primary-foreground' : 'bg-white/10 text-white/60'}`}>{number}</span>
                  <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-white/35'}`} />
                  <span className="min-w-0 text-xs font-bold uppercase tracking-widest">{label}</span>
                  {active && <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {nextGame && (
        <section className="animate-slide-up delay-200 border border-primary/30 bg-primary/5 p-5 clip-angled-sm sm:p-7" data-testid="section-capture-moment" aria-labelledby="capture-heading">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="studio-textured-accent flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary"><Camera className="h-4 w-4" /> Capture from this game</div>
              <h2 id="capture-heading" className="mt-2 font-display text-3xl uppercase tracking-wide sm:text-4xl">{gameStage === 'live' ? 'Keep the moment close.' : gameStage === 'completed' ? 'Pick the moment to send.' : 'Be ready to capture.'}</h2>
              <p className="mt-2 max-w-xl text-sm font-medium leading-relaxed text-muted-foreground">Use your device camera or media picker. Nothing is uploaded, stored, or turned into a media record here.</p>
               {captureNotice && <p className="studio-textured-accent mt-3 text-sm font-bold text-primary" role="status" data-testid="status-capture-notice">{captureNotice}</p>}
            </div>
            <div className="grid w-full gap-3 sm:grid-cols-3 lg:max-w-2xl">
              <label className="group flex min-h-14 cursor-pointer items-center justify-center gap-3 border border-border bg-card px-4 py-3 text-xs font-bold uppercase tracking-widest transition-colors hover:border-primary hover:text-primary clip-angled-sm" data-testid="label-capture-photo">
                <Camera className="h-5 w-5" /> Take a photo
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { handleCapture('photo', event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} aria-label="Take a photo of this game" data-testid="input-capture-photo" />
              </label>
              <label className="group flex min-h-14 cursor-pointer items-center justify-center gap-3 border border-border bg-card px-4 py-3 text-xs font-bold uppercase tracking-widest transition-colors hover:border-primary hover:text-primary clip-angled-sm" data-testid="label-capture-video">
                <Video className="h-5 w-5" /> Record a video
                <input type="file" accept="video/*" capture="environment" className="sr-only" onChange={(event) => { handleCapture('video', event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} aria-label="Record a video of this game" data-testid="input-capture-video" />
              </label>
              <label className="group flex min-h-14 cursor-pointer items-center justify-center gap-3 border border-border bg-card px-4 py-3 text-xs font-bold uppercase tracking-widest transition-colors hover:border-primary hover:text-primary clip-angled-sm" data-testid="label-choose-existing-media">
                <ImageIcon className="h-5 w-5" /> Choose existing
                <input type="file" accept="image/*,video/*" className="sr-only" onChange={(event) => { const file = event.currentTarget.files?.[0]; handleCapture(file?.type.startsWith('video/') ? 'video' : 'photo', file); event.currentTarget.value = ''; }} aria-label="Choose an existing photo or video" data-testid="input-choose-existing-media" />
              </label>
              <p className="col-span-full text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">If camera capture is unavailable, your device picker can still choose a file.</p>
            </div>
          </div>
        </section>
      )}

      {/* TOOL CHOOSER */}
      <section id="all-tools" className="animate-slide-up delay-200">
        <div className="border-b border-border pb-4">
          <button
            type="button"
            onClick={toggleTools}
            aria-controls="all-tools-panel"
            aria-expanded={toolsOpen}
            className="flex w-full items-center justify-between gap-4 text-left"
            data-testid="button-all-tools-toggle"
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
                  <span className="block font-display text-xl uppercase tracking-wide">Game Day</span>
                  <span className="block truncate text-xs font-medium text-muted-foreground">{nextGame ? `${formatDateDisplay(nextGame.date)} · ${formatTimeDisplay(nextGame.time)}` : scheduleSource ? 'No upcoming game scheduled.' : 'Connect your team schedule.'}</span>
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

      {/* TWO COLUMNS: UPCOMING & RECENT */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-12 lg:gap-8 animate-slide-up delay-300">
        
        {/* TEAM SCHEDULE */}
        <section>
          <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
            <div className="flex items-center gap-3">
              <h3 className="studio-textured-accent font-display text-2xl text-primary uppercase tracking-wide">Upcoming</h3>
              {scheduleSource && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hidden sm:flex items-center gap-1.5 border-l border-border/50 pl-3">
                  <CalendarDays className="w-3 h-3" /> {scheduleSource === 'team' ? 'Team Calendar' : 'Custom Schedule'}
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
              {calendarState === 'loading' ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-sm font-bold uppercase tracking-widest">Loading Calendar...</p>
                </div>
              ) : calendarState === 'invalid' ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <AlertTriangle className="w-10 h-10 text-destructive mb-3" />
                  <p className="font-bold text-destructive uppercase tracking-widest">Calendar Link No Longer Valid</p>
                  <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                    This saved coach calendar link has expired or was revoked. Connect a new calendar to keep seeing team events.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={onReconnectCalendar}
                      className="inline-flex items-center gap-2 bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90 clip-angled-sm"
                      data-testid="button-reconnect-calendar"
                    >
                      Connect a new calendar <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={onDisconnect}
                      className="bg-muted px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors hover:bg-destructive hover:text-destructive-foreground clip-angled-sm"
                      data-testid="button-disconnect-invalid-calendar"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              ) : calendarState === 'failed' ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <AlertCircle className="w-10 h-10 text-destructive mb-3" />
                  <p className="font-bold text-destructive uppercase tracking-widest">Calendar Sync Failed</p>
                  <p className="text-sm text-muted-foreground mt-2 max-w-xs">There was a problem reaching the team schedule. Your saved connection is still here. Try again or disconnect.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={onRetryCalendar}
                      className="inline-flex items-center gap-2 bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90 clip-angled-sm"
                      data-testid="button-retry-calendar"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Try again
                    </button>
                    <button
                      type="button"
                      onClick={onDisconnect}
                      className="bg-muted px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors hover:bg-destructive hover:text-destructive-foreground clip-angled-sm"
                      data-testid="button-disconnect-calendar-error"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              ) : calendarState === 'disconnected' ? (
                <div className="relative z-10 flex flex-1 flex-col items-center justify-center py-4 text-center">
                  <CalendarX2 className="h-10 w-10 text-muted-foreground/60" />
                  <p className="mt-3 font-bold uppercase tracking-widest">No Team Calendar Connected</p>
                  <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                    Open Team Calendar to connect your coach’s schedule.
                  </p>
                  <Link
                    href="/studio/schedule"
                    className="mt-4 inline-flex items-center gap-2 bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90 clip-angled-sm"
                    data-testid="link-open-team-calendar"
                  >
                    Open Team Calendar <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : calendarState === 'empty' ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 text-center">
                  <CalendarX2 className="w-10 h-10 opacity-50" />
                  <p className="font-bold uppercase tracking-widest">No Scheduled Events</p>
                  <p className="text-sm max-w-xs text-balance">The coach hasn’t added any events to the team schedule right now.</p>
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
        <section>
          <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
            <h3 className="studio-textured-accent font-display text-2xl text-primary uppercase tracking-wide">Recent Designs</h3>
            <Link href="/studio" className="text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1" data-testid="link-view-all-designs">
              View All <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,136px))] gap-4">
            {projects.length === 0 ? (
              <div className="col-span-full w-full py-10 border border-border bg-card flex flex-col items-center justify-center text-muted-foreground gap-3 clip-angled-sm min-h-[180px]">
                <ImageIcon className="w-10 h-10 opacity-50" />
                <p className="font-bold uppercase tracking-widest text-sm">No Designs Yet</p>
                <p className="text-xs max-w-xs text-center text-balance">Your saved graphics will appear here for quick access.</p>
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
              <div className="h-28 w-28 shrink-0 overflow-hidden rounded-full border-4 border-primary bg-background grid place-items-center">
                {athletePhotoUrl ? <AthletePhoto url={athletePhotoUrl} crop={athletePhotoCrop} alt="Athlete profile" /> : <User className="h-12 w-12 text-muted-foreground/40" />}
              </div>
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
                <div className="grid gap-5 sm:grid-cols-[180px_1fr] sm:items-center">
                  <div className="mx-auto h-44 w-44 overflow-hidden rounded-full border-4 border-primary bg-muted touch-none">
                    <AthletePhoto url={pendingPhotoUrl} crop={pendingPhotoCrop} alt="New athlete photo crop preview" />
                  </div>
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
                  placeholder="e.g. Parent, Fan, Coach"
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
