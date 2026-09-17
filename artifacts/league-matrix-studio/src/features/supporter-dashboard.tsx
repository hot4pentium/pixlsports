import { type FormEvent } from 'react';
import { Link } from 'wouter';
import {
  CalendarDays, Zap, MapPin, Clock, Trophy, ChevronRight, User,
  Users, Activity, Image as ImageIcon, Unlink, ShieldCheck,
  CalendarX2, ArrowRight, PenSquare, Lock, Loader2, AlertTriangle, AlertCircle, Camera, Trash2, RotateCcw
} from 'lucide-react';
import { differenceInCalendarDays, format, parseISO, isValid } from 'date-fns';
import { getCalendarViewState } from './supporter-dashboard-model';
import { SupporterScheduleSelector } from './supporter-schedule-selector';
import heroBanner from '@/assets/hero-banner.png';

export interface SupporterProfile {
  displayName: string;
  teamName: string;
  athleteName: string;
  jerseyNumber: string;
  position: string;
  relationship: string;
  accessMode: 'full' | 'guest' | null;
}

export interface SupporterEvent {
  id: string;
  type: 'game' | 'practice' | 'meeting';
  date: string;
  time: string;
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
  savedCustomSchedules: SupporterScheduleOption[];
  selectedCustomScheduleId: string | null;
  onSelectCustomSchedule: (projectId: string) => void;
  onOpenCustomSchedule?: (projectId: string) => void;
  onRenameCustomSchedule?: (projectId: string, name: string) => void | Promise<void>;
  onRemoveCustomSchedule?: (projectId: string) => void | Promise<void>;
  scheduleActionPending?: boolean;
  scheduleActionError?: string;
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

export function SupporterDashboardView({
  profile,
  events,
  nextGameIsUpcoming,
  projects,
  savedCustomSchedules,
  selectedCustomScheduleId,
  onSelectCustomSchedule,
  onOpenCustomSchedule,
  onRenameCustomSchedule,
  onRemoveCustomSchedule,
  scheduleActionPending,
  scheduleActionError,
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
}: SupporterDashboardViewProps) {
  const hasAthlete = Boolean(profile.athleteName);
  const calendarState = getCalendarViewState({
    calendarCode: connected || loadingCalendar || calendarError || calendarConnectionInvalid ? 'connected-calendar' : '',
    loading: loadingCalendar,
    invalid: calendarConnectionInvalid,
    failed: calendarError,
    calendar: connected ? { events } : undefined,
    customSchedule: scheduleSource === 'custom' ? { events } : undefined,
  });
  const nextGame = events.find((event) => event.type === 'game');

  return (
    <div className="w-full max-w-[1400px] mx-auto px-5 py-8 sm:px-8 space-y-12">
      {/* HEADER */}
      <header className="animate-slide-up">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted text-xs font-bold uppercase tracking-widest text-foreground clip-angled-sm mb-4">
          <Activity className="w-4 h-4 text-primary" />
          YOUR SPORTS HOME
        </div>
        <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl leading-[0.9] tracking-tight uppercase">
          GAME DAY <span className="text-primary">HUB.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg font-medium text-muted-foreground">
          Everything you need to celebrate, prepare, and show up ready.
        </p>
      </header>

      {/* ATHLETE HERO */}
      <section className="athlete-hero-depth animate-slide-up delay-100 relative bg-foreground text-background overflow-hidden clip-angled p-1 border border-border/20">
        <div className="absolute inset-0 bg-tech-grid-dark opacity-20 pointer-events-none" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[100px] mix-blend-screen pointer-events-none" />
        
        <div className="athlete-hero-inner-depth relative bg-[#111316] clip-angled p-6 sm:p-10 flex flex-col md:flex-row items-center md:items-start gap-8">
          <img
            src={heroBanner}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-70"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0b0d0f]/85 via-[#0b0d0f]/45 to-[#0b0d0f]/25" />
          <div className="pointer-events-none absolute inset-0 bg-tech-grid-dark opacity-20" />
          <div className="pointer-events-none absolute inset-x-8 top-0 z-[2] h-px bg-gradient-to-r from-transparent via-white/55 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-24 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

          {/* Avatar Circle */}
          <div className="relative z-10 shrink-0">
            <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full border-4 border-primary bg-background text-foreground flex items-center justify-center shadow-[0_18px_34px_rgba(0,0,0,0.58),0_0_34px_rgba(22,232,120,0.3)]">
              {athletePhotoUrl ? (
                <div className="h-full w-full overflow-hidden rounded-full">
                  <AthletePhoto url={athletePhotoUrl} crop={athletePhotoCrop} alt={`${profile.athleteName || 'Athlete'} profile`} />
                </div>
              ) : hasAthlete ? (
                <User className="w-16 h-16 opacity-20" />
              ) : (
                <Users className="w-16 h-16 opacity-20" />
              )}
            </div>
            <button 
              onClick={onOpenProfile}
              className="absolute bottom-0 right-0 bg-foreground text-background border-2 border-primary w-10 h-10 rounded-full flex items-center justify-center hover:scale-110 transition-transform"
              aria-label="Edit Profile"
              title="Edit Profile"
              data-testid="btn-edit-athlete-avatar"
            >
              <PenSquare className="w-4 h-4" />
            </button>
          </div>

          {/* Info */}
          <div className="relative z-10 flex-1 text-center md:text-left w-full">
            <div className="text-primary text-xs font-bold uppercase tracking-widest mb-2 flex flex-col sm:flex-row items-center justify-center md:justify-start gap-2">
              <span className="flex items-center gap-2">My Athlete</span>
            </div>
            {hasAthlete ? (
              <>
                <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl tracking-wide uppercase text-white leading-none mb-3 break-words">
                  {profile.athleteName}
                </h2>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-4 gap-y-2 text-sm sm:text-base font-bold uppercase tracking-widest text-white/70">
                  {profile.jerseyNumber && (
                    <span className="text-white flex items-center gap-1">
                      <span className="text-primary">#</span>{profile.jerseyNumber}
                    </span>
                  )}
                  {profile.jerseyNumber && profile.position && <span className="opacity-50">•</span>}
                  {profile.position && <span>{profile.position}</span>}
                  {(profile.jerseyNumber || profile.position) && profile.relationship && <span className="opacity-50">•</span>}
                  {profile.relationship && <span>{profile.relationship}</span>}
                </div>

                {profile.teamName && (
                  <div className="mt-6 inline-flex items-center justify-center md:justify-start gap-3 bg-white/5 border border-white/10 px-4 py-2 clip-angled-sm">
                    <Trophy className="w-5 h-5 text-primary" />
                    <span className="font-display text-xl tracking-wide text-white uppercase">{profile.teamName}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl tracking-wide uppercase text-white/50 leading-none mb-3">
                  UNASSIGNED
                </h2>
                <p className="text-white/60 text-sm font-medium max-w-md mx-auto md:mx-0 mb-6">
                  Set up your athlete's details to personalize your graphics and dashboard.
                </p>
                <button
                  onClick={onOpenProfile}
                  className="bg-primary text-primary-foreground px-6 py-2.5 text-sm font-bold uppercase tracking-wider clip-angled-sm hover:brightness-110 transition-all inline-flex items-center gap-2"
                  data-testid="btn-setup-athlete"
                >
                  <PenSquare className="w-4 h-4" /> Setup Profile
                </button>
              </>
            )}
          </div>

          {/* Quick Actions (Desktop only) */}
          <div className="relative z-10 hidden lg:flex flex-col gap-3 min-w-[240px]">
            <button onClick={onOpenProfile} className="flex items-center justify-between px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors group" data-testid="btn-edit-profile-side">
              <span className="text-sm font-bold uppercase tracking-widest text-white/80 group-hover:text-white">Profile Details</span>
              <ChevronRight className="w-4 h-4 text-primary transition-transform group-hover:translate-x-1" />
            </button>
            <div className={`px-5 py-3 border flex items-center gap-3 ${scheduleSource ? 'bg-primary/10 text-primary border-primary/30' : 'bg-white/5 text-white/50 border-white/10'}`}>
              {scheduleSource === 'team' ? <ShieldCheck className="w-5 h-5" /> : scheduleSource === 'custom' ? <CalendarDays className="w-5 h-5" /> : <CalendarX2 className="w-5 h-5" />}
              <span className="min-w-0 text-sm font-bold uppercase tracking-widest">
                {scheduleSource ? (
                  <>
                    <span className="block">{scheduleSource === 'team' ? 'Team Connected' : 'Custom Schedule'}</span>
                    <span className="block truncate text-[10px] text-white/55">{connectionLabel || 'Live team calendar'}</span>
                  </>
                ) : 'No Schedule'}
              </span>
            </div>
            {connected && (
              <button onClick={onDisconnect} className="text-xs font-bold text-white/40 hover:text-destructive transition-colors text-right uppercase tracking-widest mt-1" data-testid="btn-disconnect">
                Disconnect
              </button>
            )}
          </div>
        </div>
      </section>

      {/* QUICK CREATE */}
      <section className="animate-slide-up delay-200">
        <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
          <h3 className="font-display text-3xl uppercase tracking-wide">Quick Create</h3>
          <span className="text-sm font-medium text-muted-foreground hidden sm:inline">Turn moments into lasting memories.</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          <Link href="/studio/hype-card" className="group grid min-h-[148px] grid-cols-[42%_1fr] overflow-hidden border border-border bg-card transition-all hover:border-foreground hover:bg-muted clip-angled-sm" data-testid="link-quick-hype">
            <div className="relative flex min-h-[148px] min-w-0 items-center justify-center overflow-hidden bg-[#0b0d0e] p-3">
              <div className="absolute inset-0 bg-tech-grid-dark opacity-40" />
              <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/20 blur-2xl transition-transform duration-500 group-hover:scale-125" />
              {profile.teamName ? (
                <span className="relative z-10 min-w-0 max-w-full break-all text-center font-display text-[clamp(1rem,2.7vw,1.875rem)] leading-[0.9] tracking-wide text-white uppercase drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                  {profile.teamName}
                </span>
              ) : (
                <img
                  src={`${import.meta.env.BASE_URL}pixlsports-logo.png`}
                  alt="Pixl Sports"
                  className="relative z-10 max-h-16 w-full object-contain opacity-90 transition-transform duration-500 group-hover:scale-105"
                  data-testid="img-quick-hype-placeholder"
                />
              )}
              <span className="absolute bottom-2 left-3 z-10 text-[9px] font-bold uppercase tracking-[0.18em] text-primary">
                {profile.teamName ? 'Team card' : 'Start with Pixl Sports'}
              </span>
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3 p-5">
              <div className="min-w-0">
                <h4 className="font-display text-2xl uppercase tracking-wide transition-colors group-hover:text-primary">Hype Card</h4>
                <p className="mt-1 text-sm font-medium text-muted-foreground">Celebrate a big moment.</p>
              </div>
              <ArrowRight className="h-6 w-6 shrink-0 opacity-40 transition-all group-hover:translate-x-1 group-hover:opacity-100" />
            </div>
          </Link>
          <Link href="/studio/schedule" className="group bg-card hover:bg-muted border border-border p-6 clip-angled-sm flex items-center justify-between transition-all hover:border-foreground" data-testid="link-quick-schedule">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                {nextGame ? (nextGameIsUpcoming ? formatDaysUntil(nextGame.date) : 'Scheduled') : 'Game Day'}
              </p>
              <h4 className="mt-1 font-display text-2xl uppercase tracking-wide group-hover:text-primary transition-colors">Game Day</h4>
              {nextGame ? (
                <p className="mt-1 truncate text-sm font-medium text-muted-foreground">
                  {formatDateDisplay(nextGame.date)} · {formatTimeDisplay(nextGame.time)}
                </p>
              ) : (
                <p className="mt-1 text-sm font-medium text-muted-foreground">
                  {scheduleSource ? 'No upcoming game scheduled.' : 'Connect your team schedule.'}
                </p>
              )}
            </div>
            <ArrowRight className="h-6 w-6 shrink-0 opacity-40 transition-all group-hover:translate-x-1 group-hover:opacity-100" />
          </Link>
        </div>
      </section>

      {/* TWO COLUMNS: UPCOMING & RECENT */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-12 lg:gap-8 animate-slide-up delay-300">
        
        {/* TEAM SCHEDULE */}
        <section>
          <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-display text-2xl text-primary uppercase tracking-wide">Upcoming</h3>
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

          <SupporterScheduleSelector
            schedules={savedCustomSchedules}
            selectedScheduleId={selectedCustomScheduleId}
            connected={connected}
            onSelect={onSelectCustomSchedule}
            onOpen={onOpenCustomSchedule}
            onRename={onRenameCustomSchedule}
            onRemove={onRemoveCustomSchedule}
            actionPending={scheduleActionPending}
            actionError={scheduleActionError}
          />

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
            <h3 className="font-display text-2xl text-primary uppercase tracking-wide">Recent Designs</h3>
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
                    <div className="absolute inset-0 bg-tech-grid opacity-30 pointer-events-none" />
                    <Zap className="w-7 h-7 text-muted-foreground group-hover:text-primary transition-colors group-hover:scale-110 duration-300" />
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
          Supporter <span className="text-primary">Profile.</span>
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
                  Display Name
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={profile.displayName}
                  onChange={(e) => onChange('displayName', e.target.value)}
                  className="w-full bg-background border border-border px-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="e.g. Brian"
                />
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
  return (
    <img
      src={url}
      alt={alt}
      className="h-full w-full object-cover"
      style={{
        objectPosition: `${crop.x}% ${crop.y}%`,
        transform: `scale(${crop.zoom / 100})`,
        transformOrigin: `${crop.x}% ${crop.y}%`,
      }}
    />
  );
}
