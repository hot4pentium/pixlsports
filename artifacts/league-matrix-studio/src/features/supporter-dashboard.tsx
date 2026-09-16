import { type ReactNode, type FormEvent } from 'react';
import { Link } from 'wouter';
import {
  CalendarDays, Zap, MapPin, Clock, Trophy, ChevronRight, User,
  Users, Activity, Image as ImageIcon, Unlink, ShieldCheck,
  CalendarX2, ArrowRight, PenSquare, Lock, Loader2, AlertTriangle, AlertCircle, Camera, Trash2
} from 'lucide-react';
import { differenceInCalendarDays, format, parseISO, isValid } from 'date-fns';
import { getCalendarViewState } from './supporter-dashboard-model';

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

export interface SupporterDashboardViewProps {
  profile: SupporterProfile;
  events: SupporterEvent[];
  projects: SupporterProject[];
  connected: boolean;
  connectionLabel: string;
  loadingCalendar: boolean;
  calendarError: boolean;
  guestRemaining?: {
    hypeCards: number;
    scheduleEvents: number;
    lineups: number;
  };
  onOpenProfile: () => void;
  onDisconnect: () => void;
  connectionPanel: ReactNode;
  athletePhotoUrl?: string;
}

function formatDateDisplay(dateStr: string) {
  try {
    const d = parseISO(dateStr);
    if (isValid(d)) {
      return format(d, 'MMM d, yyyy');
    }
  } catch (e) {
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

export function SupporterDashboardView({
  profile,
  events,
  projects,
  connected,
  connectionLabel,
  loadingCalendar,
  calendarError,
  guestRemaining,
  onOpenProfile,
  onDisconnect,
  connectionPanel,
  athletePhotoUrl,
}: SupporterDashboardViewProps) {
  const hasAthlete = Boolean(profile.athleteName);
  const calendarState = getCalendarViewState({
    calendarCode: connected || loadingCalendar || calendarError ? 'connected-calendar' : '',
    loading: loadingCalendar,
    failed: calendarError,
    calendar: connected ? { events } : undefined,
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
      <section className="animate-slide-up delay-100 relative bg-foreground text-background overflow-hidden clip-angled shadow-2xl p-1 border border-border/20">
        <div className="absolute inset-0 bg-tech-grid-dark opacity-20 pointer-events-none" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[100px] mix-blend-screen pointer-events-none" />
        
        <div className="relative bg-[#111316] clip-angled p-6 sm:p-10 flex flex-col md:flex-row items-center md:items-start gap-8">
          {/* Avatar Circle */}
          <div className="shrink-0 relative">
            <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-full border-4 border-primary bg-background text-foreground flex items-center justify-center shadow-[0_0_30px_rgba(22,163,74,0.3)]">
              {athletePhotoUrl ? (
                <img src={athletePhotoUrl} alt={`${profile.athleteName || 'Athlete'} profile`} className="h-full w-full rounded-full object-cover" />
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
          <div className="flex-1 text-center md:text-left w-full">
            <div className="text-primary text-xs font-bold uppercase tracking-widest mb-2 flex flex-col sm:flex-row items-center justify-center md:justify-start gap-2">
              <span className="flex items-center gap-2">My Athlete</span>
              {profile.accessMode === 'guest' && (
                <span className="bg-white/10 text-white px-2 py-0.5 rounded text-[10px] flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Guest
                </span>
              )}
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
          <div className="hidden lg:flex flex-col gap-3 min-w-[240px]">
            <button onClick={onOpenProfile} className="flex items-center justify-between px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors group" data-testid="btn-edit-profile-side">
              <span className="text-sm font-bold uppercase tracking-widest text-white/80 group-hover:text-white">Profile Details</span>
              <ChevronRight className="w-4 h-4 text-primary transition-transform group-hover:translate-x-1" />
            </button>
            <div className={`px-5 py-3 border flex items-center gap-3 ${connected ? 'bg-primary/10 text-primary border-primary/30' : 'bg-white/5 text-white/50 border-white/10'}`}>
              {connected ? <ShieldCheck className="w-5 h-5" /> : <CalendarX2 className="w-5 h-5" />}
              <span className="min-w-0 text-sm font-bold uppercase tracking-widest">
                {connected ? (
                  <>
                    <span className="block">Team Connected</span>
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
                {nextGame ? formatDaysUntil(nextGame.date) : 'Game Day'}
              </p>
              <h4 className="mt-1 font-display text-2xl uppercase tracking-wide group-hover:text-primary transition-colors">Game Day</h4>
              {nextGame ? (
                <p className="mt-1 truncate text-sm font-medium text-muted-foreground">
                  {formatDateDisplay(nextGame.date)} · {formatTimeDisplay(nextGame.time)}
                </p>
              ) : (
                <p className="mt-1 text-sm font-medium text-muted-foreground">
                  {connected ? 'No upcoming game scheduled.' : 'Connect your team schedule.'}
                </p>
              )}
            </div>
            <ArrowRight className="h-6 w-6 shrink-0 opacity-40 transition-all group-hover:translate-x-1 group-hover:opacity-100" />
          </Link>
        </div>
      </section>

      {/* TWO COLUMNS: UPCOMING & RECENT */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-12 lg:gap-8 animate-slide-up delay-300">
        
        {/* UPCOMING */}
        <section>
          <div className="flex items-center justify-between mb-6 border-b border-border pb-4">
            <h3 className="font-display text-2xl text-primary uppercase tracking-wide">Upcoming</h3>
            {connected && (
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <CalendarDays className="w-4 h-4" /> Team Calendar
              </span>
            )}
          </div>

          <div className="bg-card border border-border relative min-h-[300px] flex flex-col clip-angled-sm">
            <div className="absolute inset-0 bg-tech-grid opacity-30 pointer-events-none" />
            <div className="relative p-6 flex-1 flex flex-col">
              {calendarState === 'loading' ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-sm font-bold uppercase tracking-widest">Loading Calendar...</p>
                </div>
              ) : calendarState === 'failed' ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <AlertCircle className="w-10 h-10 text-destructive mb-3" />
                  <p className="font-bold text-destructive uppercase tracking-widest">Calendar Sync Failed</p>
                  <p className="text-sm text-muted-foreground mt-2 max-w-xs">There was a problem reaching the team schedule. Please try again later or disconnect.</p>
                  <button onClick={onDisconnect} className="mt-4 text-xs font-bold uppercase tracking-widest bg-muted px-4 py-2 hover:bg-destructive hover:text-destructive-foreground transition-colors clip-angled-sm">
                    Disconnect
                  </button>
                </div>
              ) : calendarState === 'disconnected' ? (
                <div className="flex-1 flex flex-col justify-center py-4 relative z-10">
                  {connectionPanel}
                </div>
              ) : calendarState === 'empty' ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 text-center">
                  <CalendarX2 className="w-10 h-10 opacity-50" />
                  <p className="font-bold uppercase tracking-widest">No Upcoming Events</p>
                  <p className="text-sm max-w-xs text-balance">The coach hasn't scheduled any upcoming events right now.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {events.slice(0, 4).map((event, idx) => (
                    <div key={event.id} className={`flex items-stretch gap-4 p-4 border transition-colors ${idx === 0 ? 'bg-primary/5 border-primary/30' : 'bg-background border-border hover:border-foreground/30'}`}>
                      {/* Date block */}
                      <div className="flex flex-col items-center justify-center text-center shrink-0 w-16 border-r border-border/50 pr-4">
                        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">
                          {formatDateDisplay(event.date).split(' ')[0]}
                        </span>
                        <span className="font-display text-2xl leading-none">
                          {formatDateDisplay(event.date).split(' ')[1]?.replace(',', '') || '--'}
                        </span>
                      </div>
                      
                      {/* Details */}
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-sm ${event.type === 'game' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                            {event.type}
                          </span>
                          {idx === 0 && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-1">
                              <Activity className="w-3 h-3" /> Up Next
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-sm sm:text-base truncate">
                          {event.opponent ? `${profile.teamName || 'Team'} vs ${event.opponent}` : (event.notes || 'Team Event')}
                        </h4>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {event.time}</span>
                          <span className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3" /> {event.location}</span>
                        </div>
                      </div>
                      
                      {/* Action */}
                      <div className="hidden sm:flex items-center shrink-0">
                        <Link href={`/studio/schedule`} className="w-10 h-10 flex items-center justify-center bg-muted hover:bg-foreground hover:text-background transition-colors clip-angled-sm group" title="Create graphic">
                           <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                      </div>
                    </div>
                  ))}
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

          <div className="grid grid-cols-2 gap-4">
            {projects.length === 0 ? (
              <div className="col-span-2 py-12 border border-border bg-card flex flex-col items-center justify-center text-muted-foreground gap-3 clip-angled-sm min-h-[300px]">
                <ImageIcon className="w-10 h-10 opacity-50" />
                <p className="font-bold uppercase tracking-widest text-sm">No Designs Yet</p>
                <p className="text-xs max-w-xs text-center text-balance">Your saved graphics will appear here for quick access.</p>
              </div>
            ) : (
              projects.slice(0, 4).map(project => (
                <Link key={project.id} href={project.href} className="group flex flex-col" data-testid={`link-project-${project.id}`}>
                  <div className="aspect-[4/3] bg-muted border border-border mb-3 relative overflow-hidden group-hover:border-primary transition-colors flex items-center justify-center clip-angled-sm">
                    <div className="absolute inset-0 bg-tech-grid opacity-30 pointer-events-none" />
                    {project.kind === 'hype-card' ? (
                      <Zap className="w-8 h-8 text-muted-foreground group-hover:text-primary transition-colors group-hover:scale-110 duration-300" />
                    ) : (
                      <CalendarDays className="w-8 h-8 text-muted-foreground group-hover:text-primary transition-colors group-hover:scale-110 duration-300" />
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
  photoBusy: boolean;
  photoError: string;
  onPhotoChange: (file: File) => void;
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
  photoBusy,
  photoError,
  onPhotoChange,
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
                {athletePhotoUrl ? <img src={athletePhotoUrl} alt="Athlete profile" className="h-full w-full object-cover" /> : <User className="h-12 w-12 text-muted-foreground/40" />}
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
                  {athletePhotoUrl && <button type="button" disabled={photoBusy} onClick={onPhotoRemove} className="border border-destructive px-5 py-3 text-xs font-bold uppercase tracking-widest text-destructive disabled:opacity-50" data-testid="btn-remove-athlete-photo"><Trash2 className="mr-2 inline h-4 w-4" />Remove</button>}
                </div>
              </div>
            </div>
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
