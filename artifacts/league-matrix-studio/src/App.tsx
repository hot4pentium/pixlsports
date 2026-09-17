import {
  useCreateScheduleShare,
  useDeleteScheduleShare,
  useDeleteProject,
  useCreateProject,
  useGetProject,
  useGetCoachCalendarCode,
  useCreateCoachCalendarSubscription,
  useDeleteCoachCalendarSubscription,
  useGetConnectedCoachCalendar,
  useGetConnectedCoachCalendarBySubscription,
  useConnectToCoachCalendar,
  getGetProjectQueryKey,
  useGetScheduleShare,
  useListProjects,
  useUpdateProject,
  useUpdateScheduleShare,
  getListProjectsQueryKey,
  useGetAccountAccess,
  useUpdateAccountAccess,
  useConsumeAccountUsage,
  getGetAccountAccessQueryKey,
  useGetAccountLifecycle,
  useCancelAccount,
  useReactivateAccount,
  getGetAccountLifecycleQueryKey,
  useGetSupporterPhoto,
  useRequestSupporterPhotoUploadUrl,
  useSaveSupporterPhoto,
  useDeleteSupporterPhoto,
  getGetSupporterPhotoQueryKey,
} from '@workspace/api-client-react';
import { formatDistanceToNow } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { type FormEvent, type PointerEvent, type ReactNode, useEffect, useState } from 'react';

import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, Clipboard,
  ChevronDown, ChevronUp, CircleHelp, CupSoda, FileImage, FolderOpen, Grid2X2,
  Heart, Layers3, Lightbulb, Menu, MessageCircleQuestion, Minus,
  MapPin, NotebookPen, Palette, Plus, RotateCcw, Save, Share2, CloudUpload, ShieldCheck, Sparkles,
  SquarePen, X, Zap, Maximize, Activity, Link2Off, UsersRound, GripVertical,
  Download, Star, Link2
} from 'lucide-react';
import { Utensils } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter, Redirect } from 'wouter';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HypeCardEditor } from '@/features/hype-card';
import { PublicHypeCardPage } from '@/features/public-hype-card';
import {
  SupporterDashboardView,
  SupporterProfileView,
  type SupporterProfile,
  type SupporterProject,
  type SupporterScheduleOption,
} from '@/features/supporter-dashboard';
import {
  createBlankScheduleEvent,
  clearSupporterScheduleSelection,
  defaultScheduleEvents,
  getCloudScheduleProjects,
  getDefaultScheduleEvents,
  getLatestCloudScheduleProject,
  getSelectedCloudScheduleProject,
  moveScheduleEvent,
  normalizeScheduleDraft,
  readScheduleDraft,
  readSupporterScheduleSelection,
  saveScheduleEvent,
  removeScheduleEvent,
  saveScheduleDraft,
  saveSupporterScheduleSelection,
  scheduleStorageKey,
  updateScheduleEvent,
  type ScheduleEvent,
  type ScheduleEventType,
} from '@/features/schedule-draft';
import { getGuestUsageKey } from '@/features/guest-access';
import { clearSupporterPhotoCache } from '@/features/supporter-photo-cache';
import {
  getCalendarConnectionErrorKind,
  getCoachCalendarHandoffToken,
  getCoachCalendarSubscriptionToken,
} from '@/features/calendar-connection';
import {
  cleanSupporterProfile,
  createSupporterProfileSavePlan,
  getSupporterScheduleSelection,
  getUserProfile,
  getUserRole,
  mapRecentSupporterProjects,
  supporterProfileFromUser,
  type AccessMode,
  type UserRole,
} from '@/features/supporter-dashboard-model';
import { StudioRoleBoundary } from '@/features/studio-role-boundary';
import {
  createBlankRosterPlayer,
  getBenchPlayers,
  getDefaultRoster,
  getPlayerInitials,
  getStarterPlayers,
  normalizeFormationPosition,
  normalizeRosterDraft,
  readRosterDraft,
  rosterBoardStyles,
  removeRosterPlayer,
  saveRosterDraft,
  updateRosterPlayer,
  type RosterDraft,
  type RosterBoardStyle,
  type RosterFormationPosition,
  type RosterPlayer,
} from '@/features/roster-draft';
import { createRosterBoardGeometrySvg, rosterBoardViewBox } from '@/features/roster-board';
import baseballFieldAsset from '@/assets/baseball-field.svg';
import baseballFieldSvg from '@/assets/baseball-field.svg?raw';
import basketballCourtAsset from '@/assets/basketball-court.svg';
import heroBanner from '@/assets/hero-banner.png';
import basketballCourtSvg from '@/assets/basketball-court.svg?raw';
import footballFieldAsset from '@/assets/football-field.svg';
import footballFieldSvg from '@/assets/football-field.svg?raw';
import soccerFieldAsset from '@/assets/soccer-field.svg';
import soccerFieldSvg from '@/assets/soccer-field.svg?raw';
import volleyballCourtAsset from '@/assets/volleyball-court.svg';
import volleyballCourtSvg from '@/assets/volleyball-court.svg?raw';

 const queryClient = new QueryClient();

 type CloudProjectPayload = Record<string, unknown>;

function isCloudToolProject(value: unknown, tool: 'schedule' | 'roster'): value is CloudProjectPayload {
  return typeof value === 'object'
    && value !== null
    && (value as { tool?: unknown }).tool === tool;
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const appOrigin = ['pixlsports.com', 'www.pixlsports.com'].includes(window.location.hostname.toLowerCase())
  ? 'https://pixlsports.com'
  : window.location.origin;
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

type ToolKind = 'hype' | 'schedule' | 'roster';
const roleToolKinds: Record<UserRole, ToolKind[]> = {
  coach: ['schedule', 'roster'],
  fan: ['hype', 'schedule'],
};

const connectedCoachCodeStorageKey = 'leaguematrix-connected-coach-code';
const connectedCoachSubscriptionStorageKey = 'leaguematrix-connected-coach-subscription-token';

type CalendarConnection =
  | { kind: 'code'; value: string }
  | { kind: 'subscription'; value: string };

function getStoredCalendarConnection(): CalendarConnection | null {
  const subscriptionToken = window.localStorage.getItem(connectedCoachSubscriptionStorageKey) ?? '';
  if (/^[A-Za-z0-9_-]{32,100}$/.test(subscriptionToken)) {
    return { kind: 'subscription', value: subscriptionToken };
  }
  const code = window.localStorage.getItem(connectedCoachCodeStorageKey) ?? '';
  return code ? { kind: 'code', value: code } : null;
}

function storeCalendarConnection(connection: CalendarConnection) {
  if (connection.kind === 'subscription') {
    window.localStorage.setItem(connectedCoachSubscriptionStorageKey, connection.value);
    window.localStorage.removeItem(connectedCoachCodeStorageKey);
  } else {
    window.localStorage.setItem(connectedCoachCodeStorageKey, connection.value);
    window.localStorage.removeItem(connectedCoachSubscriptionStorageKey);
  }
}

function clearStoredCalendarConnection() {
  window.localStorage.removeItem(connectedCoachCodeStorageKey);
  window.localStorage.removeItem(connectedCoachSubscriptionStorageKey);
}

const toolData: Record<ToolKind, {
  slug: string;
  label: string;
  kicker: string;
  description: string;
  icon: typeof Zap;
  accent: string;
  soft: string;
  templateNames: string[];
}> = {
  hype: {
    slug: 'hype-card',
    label: 'Hype Card Creator',
    kicker: 'Make the moment bigger.',
    description: 'Turn a photo or short video into a share-ready celebration of the play.',
    icon: Zap,
    accent: 'bg-primary text-primary-foreground',
    soft: 'bg-[#181a1f] text-white',
    templateNames: ['Slugger', 'All-Star', 'Rookie', 'Dugout'],
  },
  schedule: {
    slug: 'schedule',
    label: 'Schedule Maker',
    kicker: 'Put the season in motion.',
    description: 'Turn a messy fixture list into a clean graphic families can follow.',
    icon: CalendarDays,
    accent: 'bg-white text-foreground',
    soft: 'bg-[#22252a] text-white',
    templateNames: ['Clean Slate', 'Warm-Up', 'Fall Classic'],
  },
  roster: {
    slug: 'roster',
    label: 'Roster & Lineup Creator',
    kicker: 'Know who is ready to play.',
    description: 'Build a clear team board, mark the starters, and share game-day lineups with families.',
    icon: UsersRound,
    accent: 'bg-primary text-primary-foreground',
    soft: 'bg-[#253a39] text-white',
    templateNames: ['Full Roster', 'Game Day', 'Numbers Up'],
  },
};

function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="flex items-center" data-testid="brand-pixlsports">
      <img
        src={`${basePath}/pixlsports-logo.png`}
        alt="Pixl Sports"
        className="h-11 w-auto max-w-[176px] object-contain sm:h-12 sm:max-w-[190px]"
      />
    </span>
  );
}


function SiteNav({ dark = false }: { dark?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navText = dark ? 'text-white/70 hover:text-white' : 'text-muted-foreground hover:text-foreground';
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  return (
    <header className={`relative z-30 border-b ${dark ? 'bg-[#70757b] border-white/25' : 'bg-[#d9dcdf] border-black/10'}`}>
      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="shrink-0 transition-opacity hover:opacity-80 focus-visible:opacity-80" data-testid="link-logo-home">
          <BrandMark inverse={dark} />
        </Link>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
          <Link href="/studio" className={`text-sm font-bold uppercase tracking-wider transition-colors ${navText}`} data-testid="link-nav-studio">Studio</Link>
          <Link href="/help" className={`text-sm font-bold uppercase tracking-wider transition-colors ${navText}`} data-testid="link-nav-help">Help</Link>
          <Link href="/privacy" className={`text-sm font-bold uppercase tracking-wider transition-colors ${navText}`} data-testid="link-nav-privacy">Privacy</Link>

          {isSignedIn ? (
            <div className="flex items-center gap-4">
              <span className={`text-sm font-bold tracking-wider ${dark ? 'text-white/50' : 'text-muted-foreground'}`}>{user?.primaryEmailAddress?.emailAddress}</span>
              <button onClick={() => signOut({ redirectUrl: basePath || "/" })} className={`group flex items-center gap-2 clip-angled-sm px-5 py-2.5 text-sm font-bold uppercase tracking-wider transition-all hover:bg-destructive hover:text-destructive-foreground ${dark ? 'bg-white/10 text-white' : 'bg-muted text-foreground'}`} data-testid="btn-sign-out">
                Sign Out
              </button>
            </div>
          ) : (
            <Link href="/sign-in" className={`group flex items-center gap-2 clip-angled-sm px-5 py-2.5 text-sm font-bold uppercase tracking-wider transition-all hover:bg-primary/90 ${dark ? 'bg-primary text-primary-foreground' : 'bg-foreground text-background'}`} data-testid="link-nav-sign-in">
              Sign In <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          )}
        </nav>
        <button type="button" className={`grid h-10 w-10 place-items-center md:hidden ${dark ? 'text-white' : 'text-foreground'}`} onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} data-testid="button-mobile-menu">
          {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {menuOpen && (
        <div className={`absolute inset-x-0 top-[72px] border-b p-5 shadow-2xl md:hidden clip-angled-sm ${dark ? 'border-white/10 bg-[#1a1c23]' : 'border-border bg-card'}`} data-testid="menu-mobile">
          <nav className="flex flex-col gap-2">
            <Link href="/studio" className={`flex items-center justify-between p-4 text-lg font-display tracking-wide ${dark ? 'text-white bg-white/5' : 'text-foreground bg-muted'}`} onClick={() => setMenuOpen(false)} data-testid="link-mobile-studio">STUDIO <ArrowRight className="h-5 w-5 text-primary" /></Link>
            <Link href="/help" className={`flex items-center justify-between p-4 text-lg font-display tracking-wide ${dark ? 'text-white bg-white/5' : 'text-foreground bg-muted'}`} onClick={() => setMenuOpen(false)} data-testid="link-mobile-help">HELP <ArrowRight className="h-5 w-5 text-primary" /></Link>
            <Link href="/privacy" className={`flex items-center justify-between p-4 text-lg font-display tracking-wide ${dark ? 'text-white bg-white/5' : 'text-foreground bg-muted'}`} onClick={() => setMenuOpen(false)} data-testid="link-mobile-privacy">PRIVACY <ArrowRight className="h-5 w-5 text-primary" /></Link>
            {isSignedIn ? (
              <>
                <div className={`p-4 text-sm font-bold tracking-wider ${dark ? 'text-white/50' : 'text-muted-foreground'}`}>{user?.primaryEmailAddress?.emailAddress}</div>
                <button onClick={() => { setMenuOpen(false); signOut({ redirectUrl: basePath || "/" }); }} className={`flex w-full items-center justify-between p-4 text-lg font-display tracking-wide text-destructive ${dark ? 'bg-white/5' : 'bg-muted'}`} data-testid="btn-mobile-sign-out">SIGN OUT <ArrowRight className="h-5 w-5" /></button>
              </>
            ) : (
              <Link href="/sign-in" className={`flex items-center justify-between p-4 text-lg font-display tracking-wide text-primary ${dark ? 'bg-white/5' : 'bg-muted'}`} onClick={() => setMenuOpen(false)} data-testid="link-mobile-sign-in">SIGN IN <ArrowRight className="h-5 w-5" /></Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-background bg-tech-grid">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between bg-background/80 backdrop-blur-sm">
        <div className="space-y-4">
          <BrandMark />
          <p className="text-sm font-medium text-muted-foreground">Premium local-first sports graphics.<br/>Built for your team account.</p>
        </div>
        <div className="flex gap-8 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <Link href="/help" className="transition-colors hover:text-foreground" data-testid="link-footer-help">Help / FAQ</Link>
          <Link href="/privacy" className="transition-colors hover:text-foreground" data-testid="link-footer-privacy">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}

function HomePage() {
  return (
    <div className="noise min-h-dvh overflow-hidden bg-background">
      <SiteNav dark />
      <main>
        {/* HERO */}
        <section className="relative overflow-hidden bg-foreground text-background clip-angled pb-24 pt-16 sm:pb-32 sm:pt-24">
          <img
            src={heroBanner}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-70"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#070a0d]/95 via-[#070a0d]/75 to-[#070a0d]/45" />
          <div className="pointer-events-none absolute inset-0 bg-tech-grid-dark opacity-20" />
          <div className="pointer-events-none absolute inset-0 bg-primary/5 mix-blend-screen" />

          <div className="relative z-10 mx-auto grid max-w-[1400px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1.1fr_.9fr] lg:gap-20">
            <div>
              <div className="animate-slide-up mb-6 inline-flex items-center gap-2 bg-primary/20 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-primary clip-angled-sm">
                <Activity className="h-4 w-4" /> Live Broadcast Booth
              </div>
              <h1 className="animate-slide-up delay-100 font-display text-[clamp(4rem,9vw,9rem)] leading-[0.85] tracking-tight">
                MAKE YOUR<br /><span className="text-primary">MOMENT</span> COUNT.
              </h1>
              <p className="animate-slide-up delay-200 mt-8 max-w-xl text-lg font-medium leading-relaxed text-white/70 sm:text-xl">
                Pixl Sports turns the little wins, big games, and long Saturdays into graphics worth sharing. Professional sports aesthetic. Local privacy. Zero friction.
              </p>
              <div className="animate-slide-up delay-300 mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link href="/studio" className="group inline-flex items-center justify-center gap-3 bg-primary px-8 py-4 text-sm font-bold uppercase tracking-wider text-primary-foreground clip-angled-sm transition-transform hover:scale-105" data-testid="link-hero-open-studio">
                  Enter The Studio <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-[500px] animate-slide-up delay-200">
              <div className="absolute -left-6 -top-6 z-20 hidden bg-white text-foreground p-4 shadow-2xl clip-angled-sm sm:block border-l-4 border-primary">
                <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                  <span className="h-2 w-2 rounded-full bg-primary animate-pulse" /> Live Preview
                </div>
                <p className="font-display text-xl">NO RENDERING DELAY.</p>
              </div>

              <div className="relative -rotate-2 bg-primary p-1 shadow-2xl transition-transform duration-500 hover:rotate-0 clip-angled">
                <div className="relative flex aspect-[0.8] flex-col justify-between overflow-hidden bg-[#181a1f] p-6 text-white sm:p-8 clip-angled">
                  <div className="absolute inset-0 bg-tech-grid-dark opacity-10" />
                  <div className="absolute -right-20 -top-20 h-64 w-64 bg-primary/20 blur-3xl rounded-full" />

                  <div className="relative flex items-center justify-between text-xs font-bold uppercase tracking-widest text-white/60">
                    <span>Eastside Falcons</span>
                    <span className="bg-white text-foreground px-3 py-1 clip-angled-sm">Sat / 10.12</span>
                  </div>

                  <div className="relative mt-auto mb-10">
                    <p className="font-display text-7xl leading-[0.8] tracking-tight sm:text-8xl">
                      GAME<br /><span className="text-primary">DAY.</span>
                    </p>
                    <div className="mt-6 flex items-center gap-4">
                      <span className="h-1 w-12 bg-primary" />
                      <span className="text-sm font-bold uppercase tracking-widest text-white/80">Home court energy</span>
                    </div>
                  </div>

                  <div className="relative flex items-end justify-between border-t border-white/10 pt-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-primary">Falcons vs. Northside</p>
                      <p className="mt-1 font-display text-2xl tracking-wide">Tip-off 4:30 PM</p>
                    </div>
                    <Zap className="h-10 w-10 text-primary" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES GRID */}
        <section className="border-b border-border bg-background bg-tech-grid">
          <div className="mx-auto grid max-w-[1400px] gap-8 px-5 py-12 sm:grid-cols-3 sm:px-8 bg-background/90 backdrop-blur-sm">
            {[
              ['01', 'CHOOSE YOUR PLAY', 'Templates with enough technical personality to get you moving fast.'],
              ['02', 'RUN THE DRILL', 'Names, colors, stats — customize the details instantly in the browser.'],
              ['03', 'SECURE THE WIN', 'Local editing is the default. Account saves sync design settings only — never photos or videos.'],
            ].map(([number, title, body], index) => (
              <div key={number} className={`flex gap-5 ${index > 0 ? 'border-t border-border pt-8 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0' : ''}`} data-testid={`feature-step-${number}`}>
                <span className="font-display text-4xl text-muted-foreground/30 leading-none">{number}</span>
                <div>
                  <p className="font-display text-2xl tracking-wide text-foreground">{title}</p>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* TOOLS */}
        <section className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 border border-border bg-muted px-3 py-1 text-xs font-bold uppercase tracking-widest text-foreground clip-angled-sm">
              Creative Arsenal
            </div>
            <h2 className="mt-6 font-display text-5xl leading-[0.9] tracking-tight sm:text-7xl uppercase">
              Pro tools.<br />Local <span className="text-primary">Execution.</span>
            </h2>
          </div>

          <div className="mt-16 grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
            <ToolFeatureCard kind="hype" large />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
              <ToolFeatureCard kind="schedule" />
              <ToolFeatureCard kind="roster" />
            </div>
          </div>
        </section>

        {/* WORKFLOW */}
        <section className="bg-foreground text-background clip-angled py-24 sm:py-32 relative overflow-hidden">
          <div className="absolute inset-0 bg-tech-grid-green opacity-[0.03]" />
          <div className="relative mx-auto grid max-w-[1400px] items-center gap-16 px-5 sm:px-8 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <div className="mb-8 flex h-16 w-16 items-center justify-center bg-primary text-primary-foreground clip-angled-sm">
                <Activity className="h-8 w-8" />
              </div>
              <h2 className="font-display text-5xl leading-[0.9] tracking-tight sm:text-7xl uppercase">
                Zero Friction.<br />Max <span className="text-primary">Impact.</span>
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {[
                [Palette, 'No blank canvas', 'Start with a sharp point of view, then make the details yours.'],
                [ShieldCheck, 'Media stays local', 'Sign in to sync reusable designs. Your attached photos and videos stay on your device.'],
                [SquarePen, 'Made for real life', 'Fast enough between practice and pickup, polished enough to post.'],
                [Heart, 'Celebrate more', 'The good stuff deserves more than a group-chat text.'],
              ].map(([Icon, title, body]) => {
                const IconComponent = Icon as typeof Palette;
                return (
                  <div key={title as string} className="bg-white/5 border border-white/10 p-6 clip-angled-sm transition-colors hover:bg-white/10">
                    <IconComponent className="h-6 w-6 text-primary" />
                    <p className="mt-6 font-display text-2xl tracking-wide">{title as string}</p>
                    <p className="mt-2 text-sm font-medium leading-relaxed text-white/60">{body as string}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-primary bg-tech-grid-dark py-20 sm:py-28 clip-angled-tl mt-12 mb-12 mx-5 sm:mx-8 max-w-[1400px] xl:mx-auto">
          <div className="flex flex-col items-center justify-center text-center px-5">
            <h2 className="max-w-2xl font-display text-5xl leading-[0.9] tracking-tight text-primary-foreground sm:text-7xl uppercase">
              Ready To Make The Call?
            </h2>
            <Link href="/studio" className="mt-10 group inline-flex items-center gap-3 bg-foreground px-8 py-5 text-base font-bold uppercase tracking-wider text-background clip-angled-sm transition-transform hover:scale-105 shadow-2xl" data-testid="link-bottom-open-studio">
              Enter The Studio <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ToolFeatureCard({ kind, large = false }: { kind: ToolKind; large?: boolean }) {
  const tool = toolData[kind];
  const Icon = tool.icon;
  return (
    <Link href={`/studio/${tool.slug}`} className={`group relative overflow-hidden border border-border transition-all hover:border-foreground clip-angled-sm ${large ? 'min-h-[420px] bg-foreground text-background' : 'min-h-[200px] bg-card text-foreground'} p-6 sm:p-8 flex flex-col justify-between`} data-testid={`link-tool-${kind}`}>
      {large && <div className="absolute inset-0 bg-tech-grid-dark opacity-10" />}
      {!large && <div className="absolute inset-0 bg-tech-grid opacity-30" />}

      <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/20 blur-2xl transition-transform duration-700 group-hover:scale-150 group-hover:bg-primary/30" />

      <div className="relative flex items-start justify-between">
        <span className={`grid h-14 w-14 place-items-center clip-angled-sm ${large ? 'bg-primary text-primary-foreground' : 'bg-foreground text-background'}`}>
          <Icon className="h-6 w-6" />
        </span>
        <ArrowUpRight className="h-6 w-6 opacity-40 transition-transform duration-300 group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:opacity-100 group-hover:text-primary" />
      </div>

      <div className="relative mt-12 sm:mt-16">
        <p className={`text-xs font-bold uppercase tracking-widest ${large ? 'text-primary' : 'text-muted-foreground'}`}>{tool.kicker}</p>
        <h3 className={`mt-3 font-display uppercase tracking-wide ${large ? 'text-5xl sm:text-6xl' : 'text-3xl'}`}>{tool.label}</h3>
        <p className={`mt-4 max-w-md text-sm font-medium leading-relaxed ${large ? 'text-white/60' : 'text-muted-foreground'}`}>{tool.description}</p>
      </div>
    </Link>
  );
}

function StudioLayout({ children, role }: { children: ReactNode; role?: UserRole }) {
  const [location] = useLocation();
  const { user } = useUser();
  const activeRole = role ?? getUserRole(user) ?? 'coach';
  const visibleTools = roleToolKinds[activeRole];
  const homeLabel = activeRole === 'fan' ? 'Game Day Hub' : 'Command Center';
  return (
    <div className="noise min-h-dvh bg-background flex flex-col">
      <SiteNav dark />
      <div className="border-b border-border bg-background bg-tech-grid">
        <div className="mx-auto flex max-w-[1400px] items-center gap-8 overflow-x-auto px-5 sm:px-8 bg-background/90 backdrop-blur-sm no-scrollbar">
          <Link href="/studio" className={`shrink-0 border-b-4 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${location === '/studio' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid="link-studio-directory">{homeLabel}</Link>
          {visibleTools.map((key) => {
            const tool = toolData[key];
            return (
            <Link key={key} href={`/studio/${tool.slug}`} className={`shrink-0 border-b-4 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${location.includes(tool.slug) ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid={`link-toolbar-${key}`}>
              {tool.label.replace(' Creator', '').replace(' Graphic Maker', '')}
            </Link>
            );
          })}
          {activeRole === 'fan' && (
            <Link href="/studio/profile" className={`shrink-0 border-b-4 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${location === '/studio/profile' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid="link-toolbar-profile">
              My Athlete
            </Link>
          )}
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        {children}
      </div>
      <Footer />
    </div>
  );
}


function Studio({ role }: { role: UserRole }) {
  const [hasProject, setHasProject] = useState(false);
  const { user, isSignedIn } = useUser();
  const profile = getUserProfile(user);
  const queryClient = useQueryClient();
  const { data: accountAccess } = useGetAccountAccess({
    query: { enabled: Boolean(isSignedIn), staleTime: 15000, queryKey: getGetAccountAccessQueryKey() },
  });
  const isGuest = accountAccess?.accessMode === 'guest';

  useEffect(() => setHasProject(Boolean(window.localStorage.getItem('leaguematrix-hype-card-project-v2'))), []);

  const { data: cloudProjects, isLoading } = useListProjects({
    query: { enabled: !!isSignedIn && !!accountAccess, queryKey: getListProjectsQueryKey() }
  });

  const deleteProject = useDeleteProject({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      }
    }
  });
  const cancelAccount = useCancelAccount();

  const visibleTools = roleToolKinds[role];

  return (
    <StudioLayout role={role}>
      <main className="mx-auto w-full max-w-[1400px] px-5 py-12 sm:px-8 lg:py-20 flex-1">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 bg-muted px-3 py-1 text-xs font-bold uppercase tracking-widest text-foreground clip-angled-sm">
              <Maximize className="h-4 w-4" /> Command Center
            </div>
            <h1 className="font-display text-5xl leading-[0.9] tracking-tight text-foreground sm:text-7xl uppercase">
               {role === 'coach' ? 'COACH COMMAND' : 'FAN COMMAND'}<br /><span className="text-primary">CENTER.</span>
            </h1>
             <p className="mt-6 flex max-w-xl items-start gap-2 text-lg font-medium leading-relaxed text-muted-foreground">
               <span>Save Hype Cards, schedules, and roster lineups locally or to your Pixl Sports cloud workspace, then export finished graphics.</span>
              <Dialog>
                <DialogTrigger asChild>
                  <button type="button" className="mt-1.5 shrink-0 text-primary transition-colors hover:text-foreground" aria-label="How local and cloud saves work" data-testid="button-save-help">
                    <CircleHelp className="h-5 w-5" />
                  </button>
                </DialogTrigger>
                <DialogContent className="border-primary bg-foreground text-background sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="font-display text-3xl tracking-wide text-white">HOW SAVES WORK</DialogTitle>
                    <DialogDescription className="text-left text-white/70">
                      Choose the save option that fits how you work.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 text-sm leading-relaxed text-white/80">
                    <div className="border-l-2 border-primary pl-4">
                      <p className="font-bold uppercase tracking-widest text-primary">Save locally</p>
                      <p className="mt-1">Keeps your work in this browser and works without an account. It will not appear on another device.</p>
                    </div>
                    <div className="border-l-2 border-primary pl-4">
                      <p className="font-bold uppercase tracking-widest text-primary">Save to cloud</p>
                      <p className="mt-1">Stores reusable design settings with your signed-in account so you can reopen them across devices.</p>
                    </div>
                    <p className="text-xs text-white/55">Photos, videos, and uploaded logos remain on the device where they were added.</p>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <button type="button" className="bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-widest text-primary-foreground clip-angled-sm">
                        Got it
                      </button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 bg-card border border-border px-5 py-3 text-sm font-bold uppercase tracking-wider text-muted-foreground clip-angled-sm shadow-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" /> {isSignedIn ? 'Cloud Sync Active' : 'Local Environment Active'}
          </div>
        </div>

         {isGuest && accountAccess && (
           <div className="relative mt-6 overflow-hidden border-l-4 border-primary bg-primary/10 px-5 py-4 clip-angled-sm" data-testid="banner-workspace-limits">
             <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
               <div>
                 <p className="text-xs font-bold uppercase tracking-widest text-primary">Limited workspace</p>
                 <p className="mt-1 text-sm font-medium text-foreground">Your remaining allowance is shared across sessions and devices.</p>
               </div>
               <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                 <span className="border border-border bg-background px-2.5 py-2">Hype {accountAccess.remaining.hypeCards}/{accountAccess.limits.hypeCards}</span>
                 <span className="border border-border bg-background px-2.5 py-2">Events {accountAccess.remaining.scheduleEvents}/{accountAccess.limits.scheduleEvents}</span>
                 <span className="border border-border bg-background px-2.5 py-2">Lineup {accountAccess.remaining.lineups}/{accountAccess.limits.lineups}</span>
               </div>
             </div>
           </div>
         )}

        <div className="relative mt-8 overflow-hidden border-l-4 border-primary bg-foreground bg-tech-grid-dark px-5 py-4 text-background clip-angled-sm" data-testid="banner-user-team">
          <div className="pointer-events-none absolute inset-0 bg-tech-grid-green opacity-30" />
          <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary">{role === 'coach' ? 'Coaching' : 'Supporting'}</p>
              <p className="mt-1 font-display text-2xl uppercase tracking-wide">{profile.teamName}</p>
            </div>
            <p className="text-sm font-bold uppercase tracking-wider text-white/65">{profile.displayName}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {visibleTools.map((kind, index) => <ToolDirectoryCard key={kind} kind={kind} index={index} />)}
        </div>

        <div className="mt-16 relative border border-border bg-card p-6 sm:p-8 clip-angled-sm overflow-hidden group">
          <div className="absolute inset-0 bg-tech-grid opacity-30 pointer-events-none" />
          <div className="relative z-10 flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary">Active Sessions</p>
              <h2 className="mt-2 font-display text-4xl uppercase tracking-wide">RESUME DRAFT.</h2>
            </div>
            <FolderOpen className="h-6 w-6 text-muted-foreground" />
          </div>

          <div className="relative z-10 mt-8 grid gap-4 lg:grid-cols-2">
            {/* Local Draft */}
            {hasProject ? (
              <div className="flex items-center justify-between border-l-4 border-primary bg-muted p-5 clip-angled-sm transition-colors hover:bg-muted/80">
                <div className="flex items-center gap-4">
                  <span className="grid h-12 w-12 place-items-center bg-foreground text-background clip-angled-sm">
                    <FileImage className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-display text-xl uppercase tracking-wide">Hype Card Local Draft</p>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-1">Saved in local storage</p>
                  </div>
                </div>
                <Link href="/studio/hype-card" className="bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground clip-angled-sm hover:scale-105 transition-transform shrink-0" data-testid="link-resume-local-project">
                  Open
                </Link>
              </div>
            ) : (
              <div className="border-2 border-dashed border-border bg-background p-10 text-center clip-angled-sm h-full flex flex-col items-center justify-center">
                <div className="grid h-12 w-12 place-items-center bg-muted text-muted-foreground clip-angled-sm">
                  <Plus className="h-6 w-6" />
                </div>
                <p className="mt-5 font-display text-2xl uppercase tracking-wide text-muted-foreground">NO LOCAL DRAFT</p>
                <p className="mt-2 max-w-xs text-sm font-medium leading-relaxed text-muted-foreground">Start a Hype Card above.</p>
              </div>
            )}

            {/* Cloud Projects */}
            {isSignedIn ? (
              <div className="flex flex-col gap-4">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full p-10 border border-border bg-muted/50 clip-angled-sm">
                    <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground animate-pulse">Loading Cloud Projects...</p>
                  </div>
                ) : cloudProjects && cloudProjects.length > 0 ? (
                  <div className="flex flex-col gap-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {cloudProjects.map(project => (
                      (() => {
                        const tool = isCloudToolProject(project.project, 'schedule')
                          ? 'schedule'
                          : isCloudToolProject(project.project, 'roster')
                            ? 'roster'
                            : 'hype-card';
                        const toolLabel = tool === 'schedule' ? 'Schedule' : tool === 'roster' ? 'Roster lineup' : 'Hype Card';
                        const projectHref = `/studio/${tool}/${project.id}`;
                        return (
                      <div key={project.id} className="flex items-center justify-between border-l-4 border-foreground bg-muted p-5 clip-angled-sm transition-colors hover:bg-muted/80 group/project">
                        <div className="flex items-center gap-4 min-w-0">
                          <span className="grid h-12 w-12 shrink-0 place-items-center bg-background text-foreground clip-angled-sm border border-border">
                            <Layers3 className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 overflow-hidden">
                            <p className="font-display text-xl uppercase tracking-wide truncate">{project.name}</p>
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-1 truncate">
                              {toolLabel} • Rev {project.revision} • {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-4">
                          <button
                            type="button"
                            disabled={deleteProject.isPending}
                            onClick={() => { if(confirm('Delete this project?')) deleteProject.mutate({ projectId: project.id }) }}
                            className="grid h-10 w-10 place-items-center bg-background text-muted-foreground hover:bg-destructive hover:text-destructive-foreground clip-angled-sm transition-colors"
                            data-testid={`btn-delete-project-${project.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <Link href={projectHref} className="bg-foreground px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-background clip-angled-sm hover:scale-105 transition-transform" data-testid={`link-resume-cloud-project-${project.id}`}>
                            Open
                          </Link>
                        </div>
                      </div>
                        );
                      })()
                    ))}
                  </div>
                ) : (
                  <div className="border border-border bg-background p-10 text-center clip-angled-sm h-full flex flex-col items-center justify-center">
                    <div className="grid h-12 w-12 place-items-center bg-muted text-muted-foreground clip-angled-sm">
                      <FolderOpen className="h-6 w-6" />
                    </div>
                    <p className="mt-5 font-display text-2xl uppercase tracking-wide text-muted-foreground">NO CLOUD PROJECTS</p>
                    <p className="mt-2 max-w-xs text-sm font-medium leading-relaxed text-muted-foreground">Save a reusable design to your account and open it from anywhere. Add media again when you are ready to export.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="border border-border bg-background p-10 text-center clip-angled-sm h-full flex flex-col items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-primary/5" />
                <div className="relative z-10 grid h-12 w-12 place-items-center bg-primary text-primary-foreground clip-angled-sm">
                  <Activity className="h-6 w-6" />
                </div>
                <p className="relative z-10 mt-5 font-display text-2xl uppercase tracking-wide text-foreground">CLOUD SYNC</p>
                <p className="relative z-10 mt-2 max-w-xs text-sm font-medium leading-relaxed text-muted-foreground">Sign in to sync reusable designs. Photos, videos, and uploaded logos remain on your device.</p>
                <Link href="/sign-in" className="relative z-10 mt-6 bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground clip-angled-sm hover:scale-105 transition-transform">
                  Sign In
                </Link>
              </div>
            )}
          </div>
        </div>

        <section className="mt-8 border border-destructive/30 bg-destructive/5 p-6 clip-angled-sm" data-testid="account-cancellation-panel">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-destructive">Account access</p>
          <h2 className="mt-2 font-display text-3xl uppercase tracking-wide">Cancel Pixl Sports access.</h2>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-muted-foreground">
                Your studio locks immediately. Your account and cloud work stay recoverable for 90 days after your latest sign-in.
              </p>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <button type="button" className="shrink-0 border border-destructive px-5 py-3 text-xs font-bold uppercase tracking-widest text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground" data-testid="button-open-cancel-account">
                  Cancel account
                </button>
              </DialogTrigger>
              <DialogContent className="border-destructive sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="font-display text-3xl uppercase tracking-wide">Lock your studio?</DialogTitle>
                  <DialogDescription className="text-left leading-relaxed">
                    You will lose studio access immediately. Sign in within 90 days to extend recovery or reactivate without losing your cloud projects, role, or team settings.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-0">
                  <DialogClose asChild>
                    <button type="button" className="border border-border px-4 py-2.5 text-xs font-bold uppercase tracking-widest">Keep account</button>
                  </DialogClose>
                  <button
                    type="button"
                    disabled={cancelAccount.isPending}
                    onClick={() => {
                      cancelAccount.mutate(undefined, {
                        onSuccess: (lifecycle) => {
                          queryClient.setQueryData(getGetAccountLifecycleQueryKey(), lifecycle);
                          queryClient.removeQueries({ queryKey: getListProjectsQueryKey() });
                        },
                      });
                    }}
                    className="bg-destructive px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-destructive-foreground disabled:opacity-60"
                    data-testid="button-confirm-cancel-account"
                  >
                    {cancelAccount.isPending ? 'Cancelling…' : 'Cancel and lock'}
                  </button>
                </DialogFooter>
                {cancelAccount.isError && <p className="text-sm font-bold text-destructive">Cancellation failed. Try again.</p>}
              </DialogContent>
            </Dialog>
          </div>
        </section>
      </main>
    </StudioLayout>
  );
}

function SupporterStudio() {
  const [, setLocation] = useLocation();
  const { user, isSignedIn } = useUser();
  const queryClient = useQueryClient();
  const profile = supporterProfileFromUser(user);
  const localSchedule = readScheduleDraft();
  const [selectedCustomScheduleId, setSelectedCustomScheduleId] = useState<string | null>(
    readSupporterScheduleSelection(),
  );
  const [scheduleActionError, setScheduleActionError] = useState('');
  const { data: athletePhoto } = useGetSupporterPhoto({
    query: { enabled: Boolean(isSignedIn), retry: false, queryKey: getGetSupporterPhotoQueryKey() },
  });
  const [calendarConnection, setCalendarConnection] = useState<CalendarConnection | null>(getStoredCalendarConnection);
  const calendarCode = calendarConnection?.kind === 'code' ? calendarConnection.value : '';
  const calendarSubscriptionToken = calendarConnection?.kind === 'subscription' ? calendarConnection.value : '';
  const { data: accountAccess } = useGetAccountAccess({
    query: {
      enabled: Boolean(isSignedIn),
      staleTime: 15000,
      queryKey: getGetAccountAccessQueryKey(),
    },
  });
  const codeCalendarQuery = useGetConnectedCoachCalendar(calendarCode, {
    query: {
      enabled: Boolean(calendarCode),
      refetchInterval: (query) => getCalendarConnectionErrorKind(query.state.error) === 'invalid' ? false : 30000,
      refetchOnWindowFocus: (query) => getCalendarConnectionErrorKind(query.state.error) !== 'invalid',
      queryKey: ['/api/coach-calendar', calendarCode],
    },
  });
  const subscriptionCalendarQuery = useGetConnectedCoachCalendarBySubscription(calendarSubscriptionToken, {
    query: {
      enabled: Boolean(calendarSubscriptionToken),
      refetchInterval: (query) => getCalendarConnectionErrorKind(query.state.error) === 'invalid' ? false : 30000,
      refetchOnWindowFocus: (query) => getCalendarConnectionErrorKind(query.state.error) !== 'invalid',
      queryKey: ['/api/coach-calendar/subscription', calendarSubscriptionToken],
    },
  });
  const activeCalendarQuery = calendarConnection?.kind === 'subscription'
    ? subscriptionCalendarQuery
    : codeCalendarQuery;
  const calendarConnectionErrorKind = activeCalendarQuery.isError
    ? getCalendarConnectionErrorKind(activeCalendarQuery.error)
    : null;
  const calendarConnectionInvalid = calendarConnectionErrorKind === 'invalid';
  const calendar = calendarConnectionInvalid ? undefined : activeCalendarQuery.data;
  const loadingCalendar = activeCalendarQuery.isFetching;
  const calendarError = activeCalendarQuery.isError && !calendarConnectionInvalid;
  const hasCalendarConnection = Boolean(calendarConnection);
  const { data: cloudProjects } = useListProjects({
    query: {
      enabled: Boolean(isSignedIn && accountAccess),
      queryKey: getListProjectsQueryKey(),
    },
  });
  const updateScheduleProject = useUpdateProject();
  const deleteScheduleProject = useDeleteProject();
  const cloudScheduleProjects = getCloudScheduleProjects(cloudProjects ?? []);
  const selectedCloudScheduleProject = getSelectedCloudScheduleProject(
    cloudScheduleProjects,
    selectedCustomScheduleId,
  );
  const cloudSchedule = selectedCloudScheduleProject
    ? normalizeScheduleDraft(selectedCloudScheduleProject.project)
    : null;
  const customSchedule = cloudSchedule ?? localSchedule;
  const savedCustomSchedules: SupporterScheduleOption[] = cloudScheduleProjects.flatMap((project) => {
    const draft = normalizeScheduleDraft(project.project);
    if (!draft) return [];
    const identity = [draft.teamName, draft.season].filter(Boolean).join(' · ');
    const projectName = project.name?.trim() ?? '';
    const generatedName = `${draft.teamName.trim()} - Schedule`;
    return [{
      id: project.id,
      label: projectName && projectName !== generatedName
        ? projectName
        : identity || projectName || 'Custom schedule',
      name: projectName,
      teamName: draft.teamName,
      season: draft.season,
      revision: project.revision,
      updatedAt: project.updatedAt,
      eventCount: draft.events.length,
    }];
  });
  const scheduleSelection = getSupporterScheduleSelection({
    hasTeamConnection: hasCalendarConnection,
    teamSchedule: calendar,
    customSchedule,
  });

  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  const events = [...scheduleSelection.events]
    .sort((left, right) => {
      const leftKey = left.date ? `${left.date}T${left.time}` : '9999-12-31T23:59';
      const rightKey = right.date ? `${right.date}T${right.time}` : '9999-12-31T23:59';
      return leftKey.localeCompare(rightKey);
    });
  const nextGame = events.find((event) => event.type === 'game' && event.date >= todayKey)
    ?? events.find((event) => event.type === 'game');
  const nextGameIsUpcoming = Boolean(nextGame?.date && nextGame.date >= todayKey);
  const projects: SupporterProject[] = mapRecentSupporterProjects(cloudProjects ?? []);
  const connected = scheduleSelection.source === 'team';
  const scheduleSource = scheduleSelection.source;
  const scheduleLabel = scheduleSelection.source === 'team'
    ? calendar?.teamSeason || calendar?.title || profile.teamName
    : scheduleSelection.source === 'custom'
      ? [customSchedule?.teamName, customSchedule?.season].filter(Boolean).join(' · ')
      : profile.teamName;

  const disconnect = () => {
    clearStoredCalendarConnection();
    setCalendarConnection(null);
  };

  const selectCustomSchedule = (projectId: string) => {
    setScheduleActionError('');
    setSelectedCustomScheduleId(projectId);
    saveSupporterScheduleSelection(window.localStorage, projectId);
  };

  const openCustomSchedule = (projectId: string) => {
    selectCustomSchedule(projectId);
    setLocation(`/studio/schedule/${projectId}`);
  };

  const renameCustomSchedule = async (projectId: string, name: string) => {
    const project = cloudScheduleProjects.find((candidate) => candidate.id === projectId);
    if (!project) return;

    setScheduleActionError('');
    try {
      await updateScheduleProject.mutateAsync({
        projectId,
        data: {
          name,
          expectedRevision: project.revision,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    } catch (error) {
      setScheduleActionError('SCHEDULE NAME COULD NOT BE SAVED — TRY AGAIN');
      throw error;
    }
  };

  const removeCustomSchedule = async (projectId: string) => {
    const remainingProjects = cloudScheduleProjects.filter((project) => project.id !== projectId);
    const activeSelectionId = selectedCloudScheduleProject?.id ?? null;
    const nextSelectionId = activeSelectionId && activeSelectionId !== projectId
      && remainingProjects.some((project) => project.id === activeSelectionId)
      ? activeSelectionId
      : remainingProjects[0]?.id ?? null;

    setScheduleActionError('');
    try {
      await deleteScheduleProject.mutateAsync({ projectId });
      setSelectedCustomScheduleId(nextSelectionId);
      if (nextSelectionId) {
        saveSupporterScheduleSelection(window.localStorage, nextSelectionId);
      } else {
        clearSupporterScheduleSelection();
      }
      await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    } catch (error) {
      setScheduleActionError('SCHEDULE COULD NOT BE REMOVED — TRY AGAIN');
      throw error;
    }
  };

  const scheduleActionPending = updateScheduleProject.isPending || deleteScheduleProject.isPending;

  return (
    <StudioLayout role="fan">
      <main className="flex-1 bg-background">
        <SupporterDashboardView
          profile={profile}
          events={events}
          nextGameIsUpcoming={nextGameIsUpcoming}
          projects={projects}
          savedCustomSchedules={savedCustomSchedules}
          selectedCustomScheduleId={selectedCloudScheduleProject?.id ?? null}
          onSelectCustomSchedule={selectCustomSchedule}
          onOpenCustomSchedule={openCustomSchedule}
          onRenameCustomSchedule={renameCustomSchedule}
          onRemoveCustomSchedule={removeCustomSchedule}
          scheduleActionPending={scheduleActionPending}
          scheduleActionError={scheduleActionError}
          scheduleSource={scheduleSource}
          connected={connected}
          connectionLabel={scheduleLabel}
          loadingCalendar={Boolean(calendarConnection && loadingCalendar)}
          calendarError={Boolean(calendarConnection && calendarError)}
           calendarConnectionInvalid={Boolean(calendarConnection && calendarConnectionInvalid)}
          onOpenProfile={() => setLocation('/studio/profile')}
          onRetryCalendar={() => void activeCalendarQuery.refetch()}
           onReconnectCalendar={() => setLocation('/studio/schedule')}
          onDisconnect={disconnect}
          athletePhotoUrl={athletePhoto ? `${athletePhoto.url}?v=${encodeURIComponent(String(athletePhoto.updatedAt))}` : undefined}
          athletePhotoCrop={athletePhoto ? { x: athletePhoto.cropX, y: athletePhoto.cropY, zoom: athletePhoto.cropZoom } : undefined}
        />
      </main>
    </StudioLayout>
  );
}

function SupporterProfilePage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded, isSignedIn } = useUser();
  const [profile, setProfile] = useState<SupporterProfile>(() => supporterProfileFromUser(user));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [pendingPhoto, setPendingPhoto] = useState<{ file: File; url: string } | null>(null);
  const [pendingPhotoCrop, setPendingPhotoCrop] = useState({ x: 50, y: 50, zoom: 100 });
  const requestPhotoUpload = useRequestSupporterPhotoUploadUrl();
  const savePhoto = useSaveSupporterPhoto();
  const deletePhoto = useDeleteSupporterPhoto();
  const { data: athletePhoto } = useGetSupporterPhoto({
    query: { enabled: Boolean(isSignedIn), retry: false, queryKey: getGetSupporterPhotoQueryKey() },
  });
  const photoBusy = requestPhotoUpload.isPending || savePhoto.isPending || deletePhoto.isPending;

  useEffect(() => {
    if (user) setProfile(supporterProfileFromUser(user));
  }, [user?.id]);

  if (!isLoaded) {
    return <div className="grid min-h-dvh place-items-center bg-background text-sm font-bold uppercase tracking-widest text-muted-foreground">Loading your profile…</div>;
  }
  if (!isSignedIn || !user) return <Redirect to="/sign-in" />;
  if (getUserRole(user) !== 'fan') return <Redirect to="/studio" />;

  const saveProfile = async () => {
    const cleanProfile = cleanSupporterProfile(profile);
    if (!cleanProfile.displayName || !cleanProfile.teamName) {
      setError('Add your display name and team before saving.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const savePlan = createSupporterProfileSavePlan(user.unsafeMetadata, profile);
      await user.update({
        unsafeMetadata: savePlan.unsafeMetadata,
      });
      setLocation(savePlan.redirectTo);
    } catch {
      setSaving(false);
      setError('We could not save your supporter profile. Please try again.');
    }
  };

  useEffect(() => () => {
    if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.url);
  }, [pendingPhoto]);

  const choosePhoto = (file: File) => {
    setPhotoError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError('Choose a JPG, PNG, or WebP photo.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Photo must be 5 MB or smaller.');
      return;
    }
    setPendingPhotoCrop({ x: 50, y: 50, zoom: 100 });
    setPendingPhoto({ file, url: URL.createObjectURL(file) });
  };

  const uploadPhoto = async () => {
    if (!pendingPhoto) return;
    const { file } = pendingPhoto;
    try {
      const prepared = await requestPhotoUpload.mutateAsync({ data: { contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp', size: file.size } });
      const uploaded = await fetch(prepared.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!uploaded.ok) throw new Error('upload failed');
      await savePhoto.mutateAsync({ data: {
        objectPath: prepared.objectPath,
        cropX: pendingPhotoCrop.x,
        cropY: pendingPhotoCrop.y,
        cropZoom: pendingPhotoCrop.zoom,
      } });
      await queryClient.invalidateQueries({ queryKey: getGetSupporterPhotoQueryKey() });
      setPendingPhoto(null);
    } catch {
      setPhotoError('We could not upload that photo. Check your connection and try again.');
    }
  };

  return (
    <StudioLayout role="fan">
      <main className="flex-1">
        <SupporterProfileView
          profile={profile}
          saving={saving}
          error={error}
          onChange={(field, value) => {
            setError('');
            setProfile((current) => ({ ...current, [field]: value }));
          }}
          onSave={() => void saveProfile()}
          onCancel={() => setLocation('/studio')}
          athletePhotoUrl={athletePhoto ? `${athletePhoto.url}?v=${encodeURIComponent(String(athletePhoto.updatedAt))}` : undefined}
          athletePhotoCrop={athletePhoto ? { x: athletePhoto.cropX, y: athletePhoto.cropY, zoom: athletePhoto.cropZoom } : undefined}
          pendingPhotoUrl={pendingPhoto?.url}
          pendingPhotoCrop={pendingPhotoCrop}
          photoBusy={photoBusy}
          photoError={photoError}
          onPhotoChange={choosePhoto}
          onPhotoCropChange={setPendingPhotoCrop}
          onPhotoUpload={() => void uploadPhoto()}
          onPhotoCancel={() => setPendingPhoto(null)}
          onPhotoRemove={() => {
            setPhotoError('');
            deletePhoto.mutate(undefined, {
              onSuccess: () => clearSupporterPhotoCache(queryClient),
              onError: () => setPhotoError('We could not remove the photo. Please try again.'),
            });
          }}
        />
      </main>
    </StudioLayout>
  );
}

function ToolDirectoryCard({ kind, index }: { kind: ToolKind; index: number }) {
  const tool = toolData[kind];
  const Icon = tool.icon;
  return (
    <Link href={`/studio/${tool.slug}`} className={`group relative overflow-hidden border border-border/10 p-6 sm:p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl clip-angled-sm ${tool.soft}`} data-testid={`card-tool-${kind}`}>
      <div className="absolute inset-0 bg-tech-grid-dark opacity-35" />
      <div className="absolute inset-0 bg-tech-grid-green opacity-20" />
      <div className="relative z-10 flex items-start justify-between">
        <span className="font-display text-xl text-white/40">0{index + 1}</span>
        <span className={`grid h-12 w-12 place-items-center clip-angled-sm ${tool.accent}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div className="relative z-10 mt-16 sm:mt-24">
        <h2 className="max-w-[250px] font-display text-4xl leading-none uppercase tracking-wide">{tool.label}</h2>
        <p className="mt-4 max-w-[270px] text-sm font-medium leading-relaxed text-white/70">{tool.description}</p>
      </div>
      <div className="relative z-10 mt-8 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-primary">
        Launch <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

function CoachCalendarCodePanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useGetCoachCalendarCode({
    query: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      queryKey: ['/api/coach-calendar'],
    },
  });
  const [copied, setCopied] = useState(false);
  const [subscriptionCopied, setSubscriptionCopied] = useState(false);
  const [appLinkCopied, setAppLinkCopied] = useState(false);
  const createSubscription = useCreateCoachCalendarSubscription();
  const deleteSubscription = useDeleteCoachCalendarSubscription();
  const feedUrl = data?.subscriptionFeedPath
    ? new URL(data.subscriptionFeedPath, window.location.origin).toString()
    : '';
  const webcalUrl = feedUrl.replace(/^https?:/, 'webcal:');
  const subscriptionToken = getCoachCalendarSubscriptionToken(feedUrl, window.location.origin, window.location.hostname)
    ?? getCoachCalendarHandoffToken(feedUrl, window.location.origin, window.location.hostname);
  const appCalendarUrl = subscriptionToken
    ? `${appOrigin}${basePath}/studio/schedule?calendarToken=${encodeURIComponent(subscriptionToken)}`
    : '';

  const copyCode = async () => {
    if (!data?.code) return;
    await navigator.clipboard?.writeText(data.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const refreshCodeData = async () => {
    await queryClient.invalidateQueries({ queryKey: ['/api/coach-calendar'] });
  };

  const createOrRefreshSubscription = () => {
    if (
      data?.subscriptionFeedPath
      && !window.confirm('Refresh this subscription link? The current link will stop working immediately.')
    ) {
      return;
    }
    createSubscription.mutate(undefined, {
      onSuccess: () => { void refreshCodeData(); },
    });
  };

  const revokeSubscription = () => {
    if (!window.confirm('Revoke this subscription link? Anyone using it will stop receiving schedule updates.')) return;
    deleteSubscription.mutate(undefined, {
      onSuccess: () => { void refreshCodeData(); },
    });
  };

  const copySubscription = async () => {
    if (!feedUrl) return;
    await navigator.clipboard?.writeText(feedUrl);
    setSubscriptionCopied(true);
    window.setTimeout(() => setSubscriptionCopied(false), 1800);
  };

  const copyAppCalendarLink = async () => {
    if (!appCalendarUrl) return;
    await navigator.clipboard?.writeText(appCalendarUrl);
    setAppLinkCopied(true);
    window.setTimeout(() => setAppLinkCopied(false), 1800);
  };

  return (
    <section className="relative w-fit max-w-full overflow-hidden border border-primary/30 bg-primary/5 p-2 clip-angled-sm" data-testid="coach-calendar-code-panel">
      <div className="absolute inset-0 bg-tech-grid opacity-20 pointer-events-none" />
      <div className="relative z-10 flex items-center justify-between gap-2">
        <p className="whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-primary sm:text-[10px]">Connect your calendar</p>
        <div className="flex shrink-0 items-center justify-end gap-1">
          <div className="border border-primary bg-background px-2 py-1 font-display text-base tracking-[0.12em] text-foreground" aria-label="Fallback coach calendar code">
            {isLoading ? '·····' : data?.code ?? '-----'}
          </div>
          <button
            type="button"
            onClick={() => { void copyCode(); }}
            disabled={!data?.code || isError}
             className="grid h-8 w-8 place-items-center border border-border bg-card text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 clip-angled-sm"
             aria-label="Copy fallback coach calendar code"
            data-testid="button-copy-coach-calendar-code"
          >
             {copied ? <Check className="h-4 w-4 text-primary" /> : <Clipboard className="h-4 w-4" />}
          </button>
        </div>
      </div>
       {isError && <p className="relative z-10 mt-3 text-xs font-bold uppercase tracking-wider text-destructive">Could not load the calendar sharing options. Refresh and try again.</p>}
        <details className="relative z-10 mt-2 border-t border-primary/20 pt-2">
          <summary className="cursor-pointer text-[9px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">More options</summary>
         <div className="pt-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Calendar app subscription</p>
            <h3 className="mt-2 font-display text-2xl uppercase tracking-wide text-foreground">Keep every schedule update in sync.</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-muted-foreground">
              Anyone with this private link can subscribe without an account. Refresh or revoke it at any time if it is shared with the wrong person.
            </p>
          </div>
          {feedUrl ? (
            <div className="w-full max-w-xl">
              <div className="flex min-w-0 gap-2">
                <input
                  readOnly
                  value={feedUrl}
                  aria-label="Private calendar subscription link"
                  className="min-w-0 flex-1 border border-border bg-background px-3 py-3 text-xs font-medium text-foreground outline-none"
                  data-testid="input-coach-calendar-subscription"
                />
                <button
                  type="button"
                  onClick={() => { void copySubscription(); }}
                  className="grid h-11 w-11 shrink-0 place-items-center border border-border bg-card text-foreground transition-colors hover:bg-muted clip-angled-sm"
                  aria-label="Copy private calendar subscription link"
                  data-testid="button-copy-coach-calendar-subscription"
                >
                  {subscriptionCopied ? <Check className="h-4 w-4 text-primary" /> : <Clipboard className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={webcalUrl}
                  className="inline-flex items-center gap-2 bg-foreground px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-background transition-colors hover:bg-primary hover:text-primary-foreground clip-angled-sm"
                  data-testid="link-open-coach-calendar-subscription"
                >
                  <CalendarDays className="h-4 w-4" /> Open calendar app
                </a>
                <button
                  type="button"
                  onClick={() => { void copyAppCalendarLink(); }}
                  disabled={!appCalendarUrl}
                  className="inline-flex items-center gap-2 border border-primary bg-background px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50 clip-angled-sm"
                  data-testid="button-copy-coach-calendar-app-link"
                >
                  {appLinkCopied ? <Check className="h-4 w-4 text-primary" /> : <Share2 className="h-4 w-4" />}
                  {appLinkCopied ? 'Pixl Sports link copied' : 'Copy Pixl Sports link'}
                </button>
                <button
                  type="button"
                  onClick={createOrRefreshSubscription}
                  disabled={createSubscription.isPending || deleteSubscription.isPending}
                  className="border border-border bg-card px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 clip-angled-sm"
                  data-testid="button-refresh-coach-calendar-subscription"
                >
                  {createSubscription.isPending ? 'Refreshing…' : 'Refresh link'}
                </button>
                <button
                  type="button"
                  onClick={revokeSubscription}
                  disabled={createSubscription.isPending || deleteSubscription.isPending}
                  className="inline-flex items-center gap-2 border border-destructive/40 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-50 clip-angled-sm"
                  data-testid="button-revoke-coach-calendar-subscription"
                >
                  <Link2Off className="h-4 w-4" /> {deleteSubscription.isPending ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={createOrRefreshSubscription}
              disabled={createSubscription.isPending || isLoading || isError}
              className="shrink-0 bg-foreground px-5 py-3 text-xs font-bold uppercase tracking-widest text-background transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 clip-angled-sm"
              data-testid="button-create-coach-calendar-subscription"
            >
              {createSubscription.isPending ? 'Creating…' : 'Create subscription link'}
            </button>
          )}
        </div>
        {(createSubscription.isError || deleteSubscription.isError) && (
          <p className="mt-3 text-xs font-bold uppercase tracking-wider text-destructive">
            The subscription link could not be updated. Try again.
          </p>
        )}
      </div>
       </details>
    </section>
  );
}

function FanCalendarConnectionPanel({
  onConnectionChange,
  compact = false,
}: {
  onConnectionChange?: (connection: CalendarConnection | null) => void;
  compact?: boolean;
}) {
  const [connection, setConnection] = useState<CalendarConnection | null>(getStoredCalendarConnection);
  const [handoffToken] = useState(() => getCoachCalendarHandoffToken(
    window.location.href,
    window.location.origin,
    window.location.hostname,
  ));
  const [handoffError] = useState(() => {
    try {
      const url = new URL(window.location.href);
      const hasHandoffParam = ['calendarToken', 'calendar'].some((key) => url.searchParams.has(key));
      const isCalendarHandoffPath = /\/studio\/schedule\/?$/.test(url.pathname);
      return hasHandoffParam && isCalendarHandoffPath && !getCoachCalendarHandoffToken(
        window.location.href,
        window.location.origin,
        window.location.hostname,
      )
        ? 'That calendar link is invalid, expired, or revoked.'
        : '';
    } catch {
      return '';
    }
  });
  const [input, setInput] = useState(() => (
    handoffToken
      ? `${window.location.origin}/api/coach-calendar/feed/${handoffToken}.ics`
      : connection?.kind === 'subscription'
      ? `${window.location.origin}/api/coach-calendar/feed/${connection.value}.ics`
      : connection?.value ?? ''
  ));
  const [pendingSubscriptionToken, setPendingSubscriptionToken] = useState(handoffToken ?? '');
  const [inputError, setInputError] = useState(handoffError);
  const connect = useConnectToCoachCalendar();
  const code = connection?.kind === 'code' ? connection.value : '';
  const subscriptionToken = connection?.kind === 'subscription' ? connection.value : '';
  const codeCalendarQuery = useGetConnectedCoachCalendar(code, {
    query: {
      enabled: Boolean(code),
      refetchInterval: (query) => getCalendarConnectionErrorKind(query.state.error) === 'invalid' ? false : 30000,
      refetchOnWindowFocus: (query) => getCalendarConnectionErrorKind(query.state.error) !== 'invalid',
      queryKey: ['/api/coach-calendar', code],
    },
  });
  const subscriptionCalendarQuery = useGetConnectedCoachCalendarBySubscription(subscriptionToken, {
    query: {
      enabled: Boolean(subscriptionToken),
      refetchInterval: (query) => getCalendarConnectionErrorKind(query.state.error) === 'invalid' ? false : 30000,
      refetchOnWindowFocus: (query) => getCalendarConnectionErrorKind(query.state.error) !== 'invalid',
      queryKey: ['/api/coach-calendar/subscription', subscriptionToken],
    },
  });
  const pendingSubscriptionQuery = useGetConnectedCoachCalendarBySubscription(pendingSubscriptionToken, {
    query: {
      enabled: Boolean(pendingSubscriptionToken),
      retry: false,
      queryKey: ['/api/coach-calendar/subscription/pending', pendingSubscriptionToken],
    },
  });
  const activeCalendarQuery = connection?.kind === 'subscription'
    ? subscriptionCalendarQuery
    : codeCalendarQuery;
  const calendar = activeCalendarQuery.data;
  const isLoading = activeCalendarQuery.isLoading || pendingSubscriptionQuery.isLoading;
  const isError = activeCalendarQuery.isError;
  const isFetching = activeCalendarQuery.isFetching;
  const activeCalendarErrorKind = isError
    ? getCalendarConnectionErrorKind(activeCalendarQuery.error)
    : null;
  const connectErrorKind = connect.isError
    ? getCalendarConnectionErrorKind(connect.error)
    : null;
  const hasConnectedSchedule = Boolean(
    calendar
    && (calendar.scheduleAvailable || calendar.events.length > 0 || calendar.title || calendar.teamSeason),
  );

  useEffect(() => {
    onConnectionChange?.(connection);
  }, [connection, onConnectionChange]);

  useEffect(() => {
    if (!handoffToken) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('calendarToken');
    url.searchParams.delete('calendar');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [handoffToken]);

  useEffect(() => {
    if (!pendingSubscriptionToken) return;
    if (pendingSubscriptionQuery.isError) {
      setPendingSubscriptionToken('');
      setInputError('That calendar link is invalid, expired, or revoked.');
    }
  }, [pendingSubscriptionQuery.data, pendingSubscriptionQuery.isError, pendingSubscriptionToken]);

  const confirmPendingSubscription = () => {
    if (!pendingSubscriptionToken || !pendingSubscriptionQuery.data) return;
    const nextConnection = { kind: 'subscription' as const, value: pendingSubscriptionToken };
    storeCalendarConnection(nextConnection);
    setConnection(nextConnection);
    setPendingSubscriptionToken('');
    setInput(`${window.location.origin}/api/coach-calendar/feed/${nextConnection.value}.ics`);
    setInputError('');
  };

  const cancelPendingSubscription = () => {
    setPendingSubscriptionToken('');
    setInputError('');
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = input.trim();
    const subscriptionToken = getCoachCalendarSubscriptionToken(value, window.location.origin, window.location.hostname)
      ?? getCoachCalendarHandoffToken(value, window.location.origin, window.location.hostname);
    if (subscriptionToken) {
      setInputError('');
      setPendingSubscriptionToken(subscriptionToken);
      return;
    }
    const nextCode = value.toUpperCase();
    if (nextCode.length !== 5) {
      setInputError('Paste a Pixl Sports calendar link or enter the five-character coach code.');
      return;
    }
    connect.mutate(
      { data: { code: nextCode } },
      {
        onSuccess: (connected) => {
          const nextConnection = { kind: 'code' as const, value: connected.code };
          storeCalendarConnection(nextConnection);
          setConnection(nextConnection);
          setInput(connected.code);
          setInputError('');
        },
      },
    );
  };

  const disconnect = () => {
    clearStoredCalendarConnection();
    setConnection(null);
    setPendingSubscriptionToken('');
    setInput('');
    setInputError('');
  };

  return (
    <section className={`${compact ? 'w-full max-w-[380px] p-2' : 'mb-6 p-5 sm:p-6'} border border-primary/30 bg-primary/5 clip-angled-sm`} data-testid="fan-calendar-connection-panel">
      <div className={compact ? 'flex items-center gap-2' : 'flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between'}>
        <div className={compact ? 'shrink-0' : 'max-w-xl'}>
          <p className={`${compact ? 'hidden text-[9px] tracking-wider text-black md:block' : 'text-xs tracking-widest text-primary'} font-bold uppercase`}>
            {compact ? 'Connect to Coach’s Schedule' : 'Connect your family calendar'}
          </p>
          <h2 className={`${compact ? 'sr-only' : 'mt-2 font-display text-3xl uppercase tracking-wide text-foreground'}`}>Connect your calendar.</h2>
          <p className={`${compact ? 'sr-only' : 'mt-2 text-sm font-medium leading-relaxed text-muted-foreground'}`}>
            Paste the private link your coach shared, or use their five-character code. Your calendar refreshes automatically when the team schedule changes.
          </p>
        </div>
        <form onSubmit={submit} className={`${compact ? 'min-w-0 flex-1 gap-1' : 'w-full max-w-md gap-2'} flex`} data-testid="form-connect-coach-calendar">
          <label className="sr-only" htmlFor="coach-calendar-connection">Coach calendar link or code</label>
          <input
            id="coach-calendar-connection"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setInputError('');
            }}
            placeholder="Paste link or enter ABCDE"
            autoComplete="off"
            className={`min-w-0 flex-1 border border-border bg-background font-medium text-foreground outline-none transition-colors focus:border-primary ${compact ? 'px-2 py-2 text-xs' : 'px-4 py-3 text-sm'}`}
            aria-describedby="coach-calendar-code-help"
            data-testid="input-coach-calendar-link"
          />
          <button
            type="submit"
            disabled={connect.isPending || Boolean(pendingSubscriptionToken) || !input.trim()}
            className={`shrink-0 bg-foreground font-bold uppercase text-background transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 clip-angled-sm ${compact ? 'px-3 py-2 text-[9px] tracking-wider' : 'px-5 py-3 text-xs tracking-widest'}`}
            data-testid="button-connect-coach-calendar"
          >
            {connect.isPending || pendingSubscriptionToken ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      </div>
      <p id="coach-calendar-code-help" className={`${compact ? 'sr-only' : 'mt-3 text-[10px]'} font-bold uppercase tracking-wider text-muted-foreground`}>
        {calendar ? `Connected to ${calendar.title || 'your coach'}${isFetching ? ' · Updating…' : ' · Live sync on'}` : 'Ask your coach for the private calendar link or five-character code from the Calendar section.'}
      </p>
      {pendingSubscriptionToken && (
        <div className="mt-5 border border-primary/40 bg-background p-4 clip-angled-sm" data-testid="calendar-handoff-confirmation">
          {pendingSubscriptionQuery.isLoading ? (
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Checking the private calendar link…</p>
          ) : pendingSubscriptionQuery.data ? (
            <>
              <p className="text-xs font-bold uppercase tracking-widest text-primary">Calendar link found</p>
              <h3 className="mt-2 font-display text-2xl uppercase tracking-wide text-foreground">
                {pendingSubscriptionQuery.data.title || 'Your coach’s calendar'}
              </h3>
              <p className="mt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {pendingSubscriptionQuery.data.teamSeason || 'Current team schedule'}
              </p>
              <p className="mt-3 text-sm font-medium leading-relaxed text-muted-foreground">
                Connect this coach calendar to your family account? Your existing connection will stay unchanged until you confirm.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={confirmPendingSubscription}
                  className="bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/80 clip-angled-sm"
                  data-testid="button-confirm-coach-calendar"
                >
                  Connect this calendar
                </button>
                <button
                  type="button"
                  onClick={cancelPendingSubscription}
                  className="border border-border bg-card px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground transition-colors hover:bg-muted clip-angled-sm"
                  data-testid="button-cancel-coach-calendar-handoff"
                >
                  Not this one
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
      {connection && (
        <button
          type="button"
          onClick={disconnect}
          className="mt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-destructive"
          data-testid="button-disconnect-coach-calendar"
        >
          Disconnect from coach
        </button>
      )}
      {(connect.isError || isError || inputError) && (
        <p className="mt-2 text-xs font-bold uppercase tracking-wider text-destructive">
          {inputError
            || (activeCalendarErrorKind === 'invalid'
              ? connection?.kind === 'subscription'
                ? 'This private calendar link has expired or was revoked. Paste a new link or code from your coach.'
                : 'This coach code is no longer valid. Ask your coach for a new code.'
              : connectErrorKind === 'invalid'
                ? 'That coach code is no longer valid. Ask your coach for a new code.'
                : 'That calendar connection could not be connected. Check the link or code and try again.')}
        </p>
      )}

      {calendar && hasConnectedSchedule && (
        <div className="mt-5 border-t border-primary/20 pt-5" data-testid="fan-connected-calendar">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-foreground">Connected schedule</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{calendar.teamSeason || 'Current season'}</p>
            </div>
            {calendar.updatedAt && <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last update {formatDistanceToNow(new Date(calendar.updatedAt), { addSuffix: true })}</p>}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {calendar.events.length === 0 ? (
              <p className="border border-dashed border-border p-4 text-xs font-medium text-muted-foreground sm:col-span-2">Your coach has not added any events yet.</p>
            ) : calendar.events.map((event) => (
              <div key={event.id} className="border border-border bg-background p-3 clip-angled-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-lg uppercase tracking-wide text-foreground">
                      {event.type === 'game' ? `VS ${event.opponent || 'OPPONENT TBD'}` : event.type === 'practice' ? 'TEAM PRACTICE' : 'TEAM MEETING'}
                    </p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-primary">{formatScheduleDate(event.date)} · {formatScheduleTime(event.time)}</p>
                  </div>
                  <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
                </div>
                <p className="mt-2 text-xs font-medium text-muted-foreground">{event.location || 'Location TBD'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {calendar && !hasConnectedSchedule && (
        <p className="mt-5 border-t border-primary/20 pt-5 text-sm font-medium text-muted-foreground">Connected. Your coach has not added a schedule yet.</p>
      )}
      {isLoading && code && <p className="mt-5 border-t border-primary/20 pt-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Loading connected schedule…</p>}
    </section>
  );
}

function EditorPage({ kind }: { kind: ToolKind }) {
  if (kind === 'schedule') return <ScheduleEditor />;
  if (kind === 'roster') return <RosterEditor />;

  const tool = toolData[kind];
  const Icon = tool.icon;
  const [selectedTemplate, setSelectedTemplate] = useState(0);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState('');
  const [values, setValues] = useState({ headline: 'GAME ON.', subline: 'Falcons vs. Northside', name: '', detail: '' });
  const setValue = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const saveProject = () => {
    window.localStorage.setItem('leaguematrix-project', 'true');
    setSaved(true);
    setNotice('SESSION MARKED ON THIS DEVICE — PROJECT DETAILS ARE PREVIEW-ONLY');
    window.setTimeout(() => setNotice(''), 2400);
  };

  const resetProject = () => {
    setSelectedTemplate(0);
    setSaved(false);
    setValues({ headline: 'GAME ON.', subline: 'Falcons vs. Northside', name: '', detail: '' });
    setNotice('DRAFT RESET');
    window.setTimeout(() => setNotice(''), 2400);
  };

  return (
    <StudioLayout>
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-8 lg:py-10 flex-1 flex flex-col">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/studio" className="grid h-10 w-10 place-items-center bg-card border border-border text-foreground hover:bg-muted clip-angled-sm transition-colors" aria-label="Back to studio" data-testid="button-back-studio">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                <Icon className="h-4 w-4" /> {tool.label}
              </div>
              <p className="mt-1 hidden text-sm font-medium text-muted-foreground sm:block">{tool.kicker}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 self-end sm:self-auto">
            <span className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary transition-opacity duration-300 ${saved ? 'opacity-100' : 'opacity-0'}`}>
              <Check className="h-4 w-4" /> Session Marked
            </span>
            <button type="button" onClick={saveProject} className="inline-flex items-center gap-2 bg-foreground px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-background clip-angled-sm transition-transform hover:scale-105" data-testid="button-save-project">
              <Save className="h-4 w-4" /> Mark Session
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[340px_1fr] flex-1">
          <aside className="order-2 border border-border bg-card p-6 clip-angled-sm lg:order-1 flex flex-col relative overflow-hidden">
            <div className="absolute inset-0 bg-tech-grid opacity-30 pointer-events-none" />
            <div className="relative z-10 mb-6 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-widest text-foreground">Controls</p>
              <span className="bg-primary/10 text-primary px-3 py-1 text-xs font-bold tracking-widest uppercase clip-angled-sm">1 / 3</span>
            </div>

            <div className="relative z-10 space-y-5">
              <Field label="Main message" value={values.headline} onChange={(value) => setValue('headline', value)} testId="input-main-message" />
              <Field label="Supporting line" value={values.subline} onChange={(value) => setValue('subline', value)} testId="input-supporting-line" />
            </div>

            <div className="relative z-10 my-8 h-px bg-border" />

            <div className="relative z-10">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-widest text-foreground">Playbook Template</p>
                <Grid2X2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {tool.templateNames.map((name, index) => (
                  <button type="button" key={name} onClick={() => setSelectedTemplate(index)} className={`min-h-[70px] border p-3 text-left font-display text-xl uppercase tracking-wide leading-none transition-all clip-angled-sm ${selectedTemplate === index ? 'border-primary bg-primary text-primary-foreground shadow-md' : 'border-border bg-background text-muted-foreground hover:border-foreground hover:text-foreground'}`} data-testid={`button-template-${index}`}>
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative z-10 my-8 h-px bg-border" />

            <div className="relative z-10">
              <p className="mb-4 text-xs font-bold uppercase tracking-widest text-foreground">Team Colors</p>
              <div className="flex gap-3">
                {['#00ff66', '#111827', '#ffffff', '#2563eb'].map((color) => (
                  <button type="button" key={color} onClick={() => setNotice('COLOR THEME UPDATED')} className="h-10 w-10 border-2 border-background ring-2 ring-border transition-transform hover:scale-110 clip-angled-sm" style={{ backgroundColor: color }} aria-label={`Choose ${color} color`} data-testid={`button-color-${color.slice(1)}`} />
                ))}
              </div>
            </div>

            <div className="relative z-10 mt-auto pt-10 flex gap-3">
              <button type="button" onClick={resetProject} className="inline-flex flex-1 items-center justify-center gap-2 border border-border bg-card px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:bg-muted hover:text-foreground clip-angled-sm" data-testid="button-reset-project">
                <RotateCcw className="h-4 w-4" /> Reset
              </button>
              <button type="button" onClick={() => setNotice('PREVIEW READY FOR EXPORT SOON')} className="inline-flex flex-[1.5] items-center justify-center gap-2 bg-primary px-4 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-1 clip-angled-sm shadow-md" data-testid="button-next-preview">
                Preview <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            {notice && <p className="relative z-10 mt-4 text-center text-xs font-bold uppercase tracking-widest text-primary animate-pulse" role="status" data-testid="status-editor-notice">{notice}</p>}
          </aside>

          <section className="order-1 min-w-0 lg:order-2 flex flex-col h-full">
            <div className="flex items-center justify-between pb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-foreground">Live Monitor</p>
                <p className="mt-1 text-sm font-medium text-muted-foreground">Changes render instantly.</p>
              </div>
              <span className="hidden items-center gap-2 border border-border bg-card px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground clip-angled-sm sm:flex">
                <span className="h-2 w-2 bg-primary animate-pulse" /> Direct Feed
              </span>
            </div>
            <Preview kind={kind} values={values} selectedTemplate={selectedTemplate} />
          </section>
        </div>
      </main>
    </StudioLayout>
  );
}

function ProtectedEditor({ kind, children }: { kind: ToolKind; children: ReactNode }) {
  const { user, isLoaded, isSignedIn } = useUser();
  if (!isLoaded) {
    return <div className="grid min-h-dvh place-items-center bg-background text-sm font-bold uppercase tracking-widest text-muted-foreground">Loading your studio…</div>;
  }
  if (!isSignedIn) {
    const redirectUrl = `${window.location.pathname}${window.location.search}`;
    return <Redirect to={`/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`} />;
  }
  const role = getUserRole(user);
  if (!role) return <Redirect to={`/studio${kind === 'schedule' ? window.location.search : ''}`} />;
  if (!roleToolKinds[role].includes(kind)) return <Redirect to="/studio" />;
  return <>{children}</>;
}

function rosterText(value: string, fallback: string, maxLength = 28) {
  const clean = value.trim();
  if (!clean) return fallback;
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trimEnd()}…` : clean;
}

function escapeRosterSvgText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rosterBoardStyleLabel(style: RosterBoardStyle): string {
  return rosterBoardStyles.find((option) => option.id === style)?.label ?? 'Classic grid';
}

const portraitRosterBoardAssets: Partial<Record<RosterBoardStyle, { asset: string; svg: string }>> = {
  soccer: { asset: soccerFieldAsset, svg: soccerFieldSvg },
  basketball: { asset: basketballCourtAsset, svg: basketballCourtSvg },
  baseball: { asset: baseballFieldAsset, svg: baseballFieldSvg },
  football: { asset: footballFieldAsset, svg: footballFieldSvg },
  volleyball: { asset: volleyballCourtAsset, svg: volleyballCourtSvg },
};

function isPortraitRosterBoardStyle(style: RosterBoardStyle) {
  return Boolean(portraitRosterBoardAssets[style]);
}

function inlineSvgContent(svg: string) {
  return svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

function createRosterBoardSvg(style: RosterBoardStyle, board: { x: number; y: number; width: number; height: number }) {
  const { x, y, width, height } = board;
  const asset = portraitRosterBoardAssets[style];
  const viewBox = asset ? { width: 750, height: 1000 } : rosterBoardViewBox;
  const geometry = asset ? inlineSvgContent(asset.svg) : createRosterBoardGeometrySvg(style);
  return `<g transform="translate(${x} ${y}) scale(${width / viewBox.width} ${height / viewBox.height})">${geometry}</g>`;
}

function createRosterSvg(draft: RosterDraft) {
  const starters = getStarterPlayers(draft.players);
  const bench = getBenchPlayers(draft.players);
  const title = draft.layout === 'lineup' ? 'GAME DAY LINEUP' : 'TEAM ROSTER';
  const board = {
    x: 72,
    y: 350,
    width: 936,
    height: isPortraitRosterBoardStyle(draft.boardStyle) ? 1248 : 702,
  };
  const starterTokens = starters.length === 0
    ? `<text x="${board.x + board.width / 2}" y="${board.y + board.height / 2}" text-anchor="middle" fill="#a7b2ad" font-family="Outfit, sans-serif" font-size="28" font-weight="600">MARK PLAYERS AS STARTERS TO BUILD THIS BOARD</text>`
    : starters.map((player) => {
      const position = normalizeFormationPosition(player.formationPosition);
      const cx = board.x + (position.x / 100) * board.width;
      const cy = board.y + (position.y / 100) * board.height;
      const initials = escapeRosterSvgText(getPlayerInitials(player.name));
      const number = escapeRosterSvgText(rosterText(player.jerseyNumber, '—', 4));
      const playerPosition = escapeRosterSvgText(rosterText(player.position, 'POSITION TBD', 15));
      return `
        <circle cx="${cx}" cy="${cy}" r="24" fill="#b9f34a" stroke="#f4f6f0" stroke-width="2"/>
        <text x="${cx}" y="${cy + 6}" text-anchor="middle" fill="#17221d" font-family="Outfit, sans-serif" font-size="15" font-weight="900">${initials}</text>
        ${player.isCaptain ? `<circle cx="${cx + 18}" cy="${cy - 18}" r="7" fill="#f4f6f0"/><text x="${cx + 18}" y="${cy - 15}" text-anchor="middle" fill="#17221d" font-family="Outfit, sans-serif" font-size="7" font-weight="900">C</text>` : ''}
        <path d="M${cx - 3.5} ${cy + 28}l3.5 4 3.5-4" fill="none" stroke="#b9f34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="${cx}" y="${cy + 52}" text-anchor="middle" fill="#f4f6f0" font-family="Outfit, sans-serif" font-size="12" font-weight="800">${number}  ·  ${playerPosition}</text>
      `;
    }).join('');
  const benchLabelY = board.y + board.height + 54;
  const benchCardsStartY = benchLabelY + 34;
  const benchCards = bench.length === 0
    ? `<text x="72" y="${benchCardsStartY + 28}" fill="#a7b2ad" font-family="Outfit, sans-serif" font-size="22" font-weight="600">BENCH IS EMPTY — PROMOTE OR ADD A PLAYER</text>`
    : bench.map((player, index) => {
      const x = 72 + (index % 3) * 324;
      const y = benchCardsStartY + Math.floor(index / 3) * 86;
      const number = escapeRosterSvgText(rosterText(player.jerseyNumber, '—', 4));
      const name = escapeRosterSvgText(rosterText(player.name, 'NAME TBD', 18));
      const position = escapeRosterSvgText(rosterText(player.position, 'POSITION TBD', 12));
      return `
        <rect x="${x}" y="${y}" width="296" height="68" fill="#293832" stroke="#53645b" stroke-width="2"/>
        <rect x="${x}" y="${y}" width="60" height="68" fill="#b9f34a"/>
        <text x="${x + 30}" y="${y + 43}" text-anchor="middle" fill="#17221d" font-family="Oswald, sans-serif" font-size="28" font-weight="700">${number}</text>
        <text x="${x + 76}" y="${y + 29}" fill="#f4f6f0" font-family="Outfit, sans-serif" font-size="17" font-weight="800">${name}</text>
        <text x="${x + 76}" y="${y + 51}" fill="#a7b2ad" font-family="Outfit, sans-serif" font-size="12" font-weight="700" letter-spacing="1.5">${position}</text>
      `;
    }).join('');
  const benchRows = Math.max(1, Math.ceil(bench.length / 3));
  const contentBottom = benchCardsStartY + benchRows * 86;
  const height = Math.max(1350, contentBottom + 130);
  const footerY = height - 66;
  const boardStyle = rosterBoardStyleLabel(draft.boardStyle);
  return `<svg xmlns="http://www.w3.org/2000/svg" data-board-style="${draft.boardStyle}" width="1080" height="${height}" viewBox="0 0 1080 ${height}">
    <rect width="1080" height="${height}" fill="#17221d"/>
    <path d="M0 0h1080v${height}H0z" fill="url(#grid)" opacity=".25"/>
    <defs><pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse"><path d="M34 0H0V34" fill="none" stroke="#b9f34a" stroke-opacity=".16"/></pattern></defs>
    <circle cx="930" cy="150" r="240" fill="#b9f34a" opacity=".12"/>
    <text x="72" y="95" fill="#b9f34a" font-family="Outfit, sans-serif" font-size="19" font-weight="800" letter-spacing="4">PIXL SPORTS  /  COACH BOARD</text>
    <text x="72" y="218" fill="#f4f6f0" font-family="Oswald, sans-serif" font-size="96" font-weight="700">${escapeSvgText(title)}</text>
    <text x="76" y="270" fill="#a7b2ad" font-family="Outfit, sans-serif" font-size="26" font-weight="600">${escapeRosterSvgText(rosterText(draft.teamName, 'YOUR TEAM', 34))}  ·  ${escapeRosterSvgText(rosterText(draft.season, 'SEASON', 22))}</text>
    <rect x="72" y="316" width="936" height="3" fill="#b9f34a"/>
    ${createRosterBoardSvg(draft.boardStyle, board)}
    <text x="96" y="386" fill="#b9f34a" font-family="Outfit, sans-serif" font-size="18" font-weight="800" letter-spacing="3">STARTERS  /  ${starters.length}  ·  ${escapeRosterSvgText(boardStyle)}</text>
    ${starterTokens}
    <text x="72" y="${benchLabelY}" fill="#b9f34a" font-family="Outfit, sans-serif" font-size="18" font-weight="800" letter-spacing="3">BENCH  /  ${bench.length}</text>
    ${benchCards}
    <text x="72" y="${footerY}" fill="#b9f34a" font-family="Outfit, sans-serif" font-size="18" font-weight="800" letter-spacing="3">${starters.length} STARTERS  ·  ${bench.length} BENCH  /  LOCAL DRAFT</text>
    <text x="1008" y="${footerY}" text-anchor="end" fill="#a7b2ad" font-family="Outfit, sans-serif" font-size="18" font-weight="600">SHARE READY</text>
  </svg>`;
}

function RosterEditor() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id?: string }>();
  const cloudProjectId = params.id;
  const { user, isSignedIn, isLoaded } = useUser();
  const { data: accountAccess } = useGetAccountAccess({ query: { enabled: Boolean(isSignedIn), staleTime: 15000, queryKey: getGetAccountAccessQueryKey() } });
  const consumeAccountUsage = useConsumeAccountUsage();
  const queryClient = useQueryClient();
  const lineupUsageKey = useRef(getGuestUsageKey('lineup', 'roster-editor')).current;
  const claimedLineup = useRef(false);
  const [storedDraft] = useState(() => readRosterDraft());
  const [draft, setDraft] = useState<RosterDraft>(() => storedDraft ?? getDefaultRoster());
  const [notice, setNotice] = useState('');
  const [guestLineupBlocked, setGuestLineupBlocked] = useState(false);
  const [saved, setSaved] = useState(Boolean(storedDraft));
  const [expandedAthleteId, setExpandedAthleteId] = useState<string | null>(null);
  const cloudRevision = useRef(1);
  const initializedCloudId = useRef<string | null>(null);
  const { data: cloudProjectData } = useGetProject(cloudProjectId ?? '', {
    query: {
      enabled: Boolean(cloudProjectId && isSignedIn),
      queryKey: getGetProjectQueryKey(cloudProjectId ?? ''),
    },
  });
  const createCloudProject = useCreateProject();
  const updateCloudProject = useUpdateProject();

  useEffect(() => {
    if (accountAccess?.accessMode !== 'guest' || claimedLineup.current) return;
    claimedLineup.current = true;
    consumeAccountUsage.mutate(
      { data: { category: 'lineup', usageKey: lineupUsageKey } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAccountAccessQueryKey() }),
        onError: () => {
          if (!storedDraft && !cloudProjectId) setGuestLineupBlocked(true);
          announce('WORKSPACE LINEUP LIMIT REACHED — YOUR EXISTING LOCAL DRAFT IS STILL AVAILABLE');
        },
      },
    );
  }, [accountAccess?.accessMode, consumeAccountUsage, lineupUsageKey, queryClient, storedDraft, cloudProjectId]);

  const starters = getStarterPlayers(draft.players);
  const bench = getBenchPlayers(draft.players);
  const updateDraft = (patch: Partial<RosterDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  };
  const updatePlayer = (id: string, patch: Partial<RosterPlayer>) => {
    setDraft((current) => ({ ...current, players: updateRosterPlayer(current.players, id, patch) }));
    setSaved(false);
  };
  const announce = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  };
  const saveDraft = () => {
    saveRosterDraft(window.localStorage, draft);
    setSaved(true);
    announce('ROSTER SAVED ON THIS DEVICE');
  };
  const resetDraft = () => {
    const nextDraft = getDefaultRoster();
    setDraft(nextDraft);
    saveRosterDraft(window.localStorage, nextDraft);
    setSaved(true);
    announce('ROSTER RESET TO THE STARTER BOARD');
  };
  const addPlayer = () => {
    setDraft((current) => ({ ...current, players: [...current.players, createBlankRosterPlayer()] }));
    setSaved(false);
    announce('PLAYER SLOT ADDED');
  };
  const toggleStarter = (id: string, isStarter: boolean) => {
    updatePlayer(id, { isStarter });
    announce(isStarter ? 'PLAYER ADDED TO THE FIELD' : 'PLAYER MOVED TO THE BENCH');
  };
  const exportRoster = () => {
    const blob = new Blob([createRosterSvg(draft)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${rosterText(draft.teamName, 'team-roster', 32).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${draft.layout}.svg`;
    link.click();
    URL.revokeObjectURL(url);
    announce('SVG READY TO SHARE');
  };
  const cloudDraft = (): CloudProjectPayload => ({
    tool: 'roster',
    version: 1,
    ...draft,
  });
  const saveToCloud = async () => {
    if (!isSignedIn) {
      setLocation('/sign-in');
      return;
    }
    try {
      if (cloudProjectId) {
        await updateCloudProject.mutateAsync({
          projectId: cloudProjectId,
          data: { project: cloudDraft(), expectedRevision: cloudRevision.current },
        });
        cloudRevision.current += 1;
        setSaved(true);
        announce('ROSTER SAVED TO CLOUD');
      } else {
        const created = await createCloudProject.mutateAsync({
          data: { name: `${draft.teamName.trim()} - Roster`, project: cloudDraft() },
        });
        cloudRevision.current = created.revision;
        setSaved(true);
        setLocation(`/studio/roster/${created.id}`);
      }
    } catch (error: any) {
      announce(error?.status === 409 ? 'WORKSPACE LINEUP LIMIT REACHED — KEEP USING YOUR LOCAL DRAFT' : 'CLOUD SAVE FAILED — TRY AGAIN');
    }
  };

  useEffect(() => {
    if (cloudProjectId && !isLoaded) return;
    if (cloudProjectId && isLoaded && !isSignedIn) {
      setLocation('/sign-in');
    }
  }, [cloudProjectId, isLoaded, isSignedIn, setLocation]);

  useEffect(() => {
    if (!cloudProjectId || !cloudProjectData || initializedCloudId.current === cloudProjectId) return;
    if (!isCloudToolProject(cloudProjectData.project, 'roster')) return;
    const loadedDraft = normalizeRosterDraft(cloudProjectData.project);
    if (!loadedDraft) return;
    initializedCloudId.current = cloudProjectId;
    setDraft(loadedDraft);
    setSaved(true);
    cloudRevision.current = cloudProjectData.revision;
  }, [cloudProjectData, cloudProjectId]);

  if (guestLineupBlocked && !cloudProjectId && !storedDraft) {
    return (
      <StudioLayout>
        <main className="mx-auto flex w-full max-w-3xl flex-1 items-center px-5 py-12 sm:px-8">
          <section className="w-full border-l-4 border-primary bg-card p-7 clip-angled-sm">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Limited workspace</p>
            <h1 className="mt-3 font-display text-4xl uppercase tracking-wide">LINEUP ALREADY USED.</h1>
            <p className="mt-4 max-w-xl text-sm font-medium leading-relaxed text-muted-foreground">
            This workspace has already used its editable lineup. Your existing local draft remains safe on the device where it was created.
            </p>
            <Link href="/studio" className="mt-6 inline-flex items-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground clip-angled-sm">
              Back to Command Center <ArrowRight className="h-4 w-4" />
            </Link>
          </section>
        </main>
      </StudioLayout>
    );
  }

  return (
    <StudioLayout>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-8 lg:py-10">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary clip-angled-sm">
              <UsersRound className="h-4 w-4" /> Team Operations Board
            </div>
            <h1 className="font-display text-5xl leading-[.88] tracking-tight sm:text-7xl">ROSTER <span className="text-primary">&amp; LINEUP.</span></h1>
            <p className="mt-5 max-w-2xl text-base font-medium leading-relaxed text-muted-foreground sm:text-lg">
              Keep the whole squad clear, then switch to a game-day board when it is time to share the call.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 border border-border bg-card px-4 py-3 clip-angled-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${saved ? 'bg-primary' : 'bg-amber-500'}`} />
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{saved ? 'Saved locally' : 'Unsaved changes'}</span>
          </div>
        </div>

        <div className="mt-10 grid gap-7 xl:grid-cols-[minmax(0,1fr)_minmax(400px,530px)]">
          <section className="order-1 min-w-0 xl:order-1">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Live board</p>
                <p className="mt-1 text-sm font-medium text-muted-foreground">{draft.players.length} players · {starters.length} starters · {bench.length} bench</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => updateDraft({ layout: 'roster' })} className={`px-3 py-2 text-xs font-bold uppercase tracking-widest clip-angled-sm ${draft.layout === 'roster' ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground hover:text-foreground'}`} data-testid="button-layout-roster">
                  Full roster
                </button>
                <button type="button" onClick={() => updateDraft({ layout: 'lineup' })} className={`px-3 py-2 text-xs font-bold uppercase tracking-widest clip-angled-sm ${draft.layout === 'lineup' ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground hover:text-foreground'}`} data-testid="button-layout-lineup">
                  Game-day lineup
                </button>
              </div>
            </div>
            <RosterGraphicPreview
              draft={draft}
              starters={starters}
              onPositionChange={(id, formationPosition) => updatePlayer(id, { formationPosition })}
            />
            <div className="mt-3 flex items-center justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <span data-testid="text-preview-layout">{draft.layout === 'lineup' ? 'Game-day starters with bench listed' : 'Starters on canvas · bench listed below'}</span>
              <span>SVG export · no photos</span>
            </div>
          </section>

          <aside className="order-2 border border-border bg-card p-5 clip-angled-sm sm:p-7 xl:order-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-primary">Control deck</p>
                <h2 className="mt-2 font-display text-3xl tracking-wide">SET THE BOARD.</h2>
              </div>
              <span className="grid h-11 w-11 shrink-0 place-items-center bg-muted text-foreground clip-angled-sm"><GripVertical className="h-5 w-5" /></span>
            </div>

            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              <Field label="Team name" value={draft.teamName} onChange={(value) => updateDraft({ teamName: value })} testId="input-roster-team-name" />
              <Field label="Season" value={draft.season} onChange={(value) => updateDraft({ season: value })} testId="input-roster-season" />
            </div>

            <div className="mt-7">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-foreground">Board treatment</p>
                  <p className="mt-1 text-sm font-medium text-muted-foreground">Visual context only. Player positions stay freeform.</p>
                </div>
                <Palette className="h-5 w-5 text-primary" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Board treatment">
                {rosterBoardStyles.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => updateDraft({ boardStyle: style.id })}
                    className={`border px-3 py-2 text-left clip-angled-sm transition-colors ${draft.boardStyle === style.id ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background text-muted-foreground hover:border-foreground hover:text-foreground'}`}
                    aria-pressed={draft.boardStyle === style.id}
                    data-testid={`button-board-style-${style.id}`}
                  >
                    <span className="block text-[10px] font-bold uppercase tracking-widest">{style.label}</span>
                    <span className="mt-1 block text-[10px] font-medium leading-tight opacity-70">{style.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={resetDraft} className="inline-flex flex-1 items-center justify-center gap-2 border border-border bg-background px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground clip-angled-sm hover:bg-muted hover:text-foreground" data-testid="button-reset-roster">
                <RotateCcw className="h-4 w-4" /> Reset
              </button>
              <button type="button" onClick={saveDraft} className="inline-flex flex-[1.4] items-center justify-center gap-2 bg-foreground px-4 py-3 text-xs font-bold uppercase tracking-widest text-background clip-angled-sm hover:bg-primary hover:text-primary-foreground" data-testid="button-save-roster">
                <Save className="h-4 w-4" /> Save locally
              </button>
              <button type="button" onClick={saveToCloud} disabled={createCloudProject.isPending || updateCloudProject.isPending} className="inline-flex flex-[1.4] items-center justify-center gap-2 border border-primary bg-primary/10 px-4 py-3 text-xs font-bold uppercase tracking-widest text-primary clip-angled-sm hover:bg-primary hover:text-primary-foreground" data-testid="button-save-roster-cloud">
                <Share2 className="h-4 w-4" /> {cloudProjectId ? 'Save cloud' : 'Save to cloud'}
              </button>
              <button type="button" onClick={exportRoster} className="inline-flex flex-1 items-center justify-center gap-2 bg-primary px-4 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground clip-angled-sm hover:-translate-y-0.5" data-testid="button-export-roster">
                <Download className="h-4 w-4" /> Export SVG
              </button>
            </div>
            <div className="mt-7 border-t border-border pt-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-foreground">Athletes <span className="text-primary">/ {draft.players.length}</span></p>
                  <p className="mt-1 text-sm font-medium text-muted-foreground">Quickly move players between the field and bench.</p>
                </div>
                <button type="button" onClick={addPlayer} className="inline-flex shrink-0 items-center gap-1.5 bg-primary px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-primary-foreground clip-angled-sm hover:-translate-y-0.5" data-testid="button-add-roster-player">
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {draft.players.map((player) => (
                  <div key={player.id} className="border border-border bg-background" data-testid={`card-control-athlete-${player.id}`}>
                    <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center bg-muted font-display text-sm text-foreground">{getPlayerInitials(player.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold uppercase tracking-wide">{rosterText(player.name, 'NAME TBD', 24)}</span>
                        <span className={`block truncate text-[9px] font-bold uppercase tracking-[.12em] ${player.isStarter ? 'text-primary' : 'text-muted-foreground'}`}>
                          {player.isStarter ? 'Starter' : 'Bench'} · #{rosterText(player.jerseyNumber, '—', 4)} · {rosterText(player.position, 'POSITION TBD', 15)}
                        </span>
                      </span>
                      <button type="button" onClick={() => toggleStarter(player.id, !player.isStarter)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground transition hover:border-primary hover:bg-primary hover:text-primary-foreground" aria-label={`${player.isStarter ? 'Move' : 'Add'} ${player.name || 'player'} ${player.isStarter ? 'to bench' : 'to the field'}`} data-testid={`${player.isStarter ? 'button-control-athlete-minus' : 'button-control-athlete-plus'}-${player.id}`}>
                        {player.isStarter ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      </button>
                      <button type="button" onClick={() => setExpandedAthleteId((current) => current === player.id ? null : player.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground transition hover:border-primary hover:bg-primary hover:text-primary-foreground" aria-label={`${expandedAthleteId === player.id ? 'Hide' : 'Edit'} ${player.name || 'player'}`} aria-expanded={expandedAthleteId === player.id} data-testid={`button-toggle-athlete-editor-${player.id}`}>
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedAthleteId === player.id ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                    {expandedAthleteId === player.id && (
                      <div className="grid gap-2 border-t border-border bg-card px-2.5 py-3" data-testid={`control-athlete-editor-${player.id}`}>
                        <input value={player.name} onChange={(event) => updatePlayer(player.id, { name: event.target.value })} placeholder="Player name" className="w-full border border-border bg-background px-2.5 py-2 text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" aria-label={`Name for ${player.name || 'player'}`} data-testid={`input-control-athlete-name-${player.id}`} />
                        <div className="grid grid-cols-2 gap-2">
                          <input value={player.jerseyNumber} onChange={(event) => updatePlayer(player.id, { jerseyNumber: event.target.value })} placeholder="Jersey #" inputMode="numeric" className="min-w-0 border border-border bg-background px-2.5 py-2 text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" aria-label={`Jersey number for ${player.name || 'player'}`} data-testid={`input-control-athlete-number-${player.id}`} />
                          <input value={player.position} onChange={(event) => updatePlayer(player.id, { position: event.target.value })} placeholder="Position" className="min-w-0 border border-border bg-background px-2.5 py-2 text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" aria-label={`Position for ${player.name || 'player'}`} data-testid={`input-control-athlete-position-${player.id}`} />
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => updatePlayer(player.id, { isCaptain: !player.isCaptain })} className={`flex-1 px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider ${player.isCaptain ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`} aria-pressed={player.isCaptain} data-testid={`button-control-athlete-captain-${player.id}`}>
                            {player.isCaptain ? 'Captain' : 'Make captain'}
                          </button>
                          <button type="button" onClick={() => { setDraft((current) => ({ ...current, players: removeRosterPlayer(current.players, player.id) })); setExpandedAthleteId(null); setSaved(false); }} className="px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-red-600 hover:bg-red-500/10" aria-label={`Remove ${player.name || 'player'} from roster`} data-testid={`button-control-athlete-remove-${player.id}`}>
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {notice && <p className="mt-4 text-center text-xs font-bold uppercase tracking-widest text-primary" role="status" data-testid="status-roster-notice">{notice}</p>}
          </aside>
        </div>
      </main>
    </StudioLayout>
  );
}

function FormationBoard({
  starters,
  boardStyle,
  onPositionChange,
}: {
  starters: RosterPlayer[];
  boardStyle: RosterBoardStyle;
  onPositionChange: (id: string, formationPosition: RosterFormationPosition) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [draggingPlayerId, setDraggingPlayerId] = useState<string | null>(null);

  const updatePositionFromPointer = (event: PointerEvent<HTMLDivElement>, id: string) => {
    const board = boardRef.current;
    if (!board) return;
    const bounds = board.getBoundingClientRect();
    onPositionChange(id, normalizeFormationPosition({
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
    }));
  };

  const beginDrag = (event: PointerEvent<HTMLDivElement>, player: RosterPlayer) => {
    if ((event.target as HTMLElement).closest('button, input')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingPlayerId(player.id);
    updatePositionFromPointer(event, player.id);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingPlayerId(null);
  };

  return (
    <div ref={boardRef} className={`relative ${isPortraitRosterBoardStyle(boardStyle) ? 'aspect-[3/4] min-h-[480px] sm:min-h-[560px]' : 'aspect-[4/3] min-h-[350px] sm:min-h-[480px]'} w-full overflow-hidden border border-white/15 touch-none bg-[#10271d]`} data-testid="formation-board" data-board-style={boardStyle}>
        <FormationBoardDecorations style={boardStyle} />
      {starters.length === 0 ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-8 text-center">
          <div className="border border-dashed border-white/25 px-6 py-5 text-xs font-bold uppercase tracking-widest text-white/55" data-testid="empty-formation-board">
            Make a bench player a starter to build the formation
          </div>
        </div>
      ) : starters.map((player) => {
        const formationPosition = normalizeFormationPosition(player.formationPosition);
        const dragging = draggingPlayerId === player.id;
        return (
          <div
            key={player.id}
            className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 select-none ${dragging ? 'z-30 scale-105' : ''}`}
            style={{ left: `${formationPosition.x}%`, top: `${formationPosition.y}%` }}
            onPointerDown={(event) => beginDrag(event, player)}
            onPointerMove={(event) => dragging && updatePositionFromPointer(event, player.id)}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            aria-label={`${player.name || 'Player'}, draggable starter`}
            aria-grabbed={dragging}
            data-testid={`formation-player-${player.id}`}
          >
            <div className="flex flex-col items-center">
              <div className={`relative grid h-8 w-8 place-items-center rounded-full border-2 bg-primary font-display text-[12px] font-bold text-primary-foreground shadow-lg transition sm:h-10 sm:w-10 sm:text-[15px] ${dragging ? 'border-white shadow-primary/40' : 'border-primary/40'}`}>
                {getPlayerInitials(player.name)}
                {player.isCaptain && <span className="absolute -right-1 -top-1 grid h-3 w-3 place-items-center rounded-full bg-white text-[6px] font-black text-foreground">C</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FormationBoardDecorations({ style }: { style: RosterBoardStyle }) {
  const asset = portraitRosterBoardAssets[style];
  if (asset) {
    return (
      <img
        className="pointer-events-none absolute inset-0 h-full w-full"
        src={asset.asset}
        alt=""
        aria-hidden="true"
      />
    );
  }

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${rosterBoardViewBox.width} ${rosterBoardViewBox.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: createRosterBoardGeometrySvg(style) }}
    />
  );
}

function RosterGraphicPreview({
  draft,
  starters,
  onPositionChange,
}: {
  draft: RosterDraft;
  starters: RosterPlayer[];
  onPositionChange: (id: string, formationPosition: RosterFormationPosition) => void;
}) {
  return (
    <div className="relative overflow-hidden border border-border bg-[#17221d] p-4 shadow-xl clip-angled-sm sm:p-7" data-testid="preview-roster-canvas">
      <div className="absolute inset-0 bg-tech-grid-dark opacity-30" />
      <div className="relative w-full overflow-hidden border border-white/10 bg-[#17221d] p-5 text-[#f4f6f0] sm:p-8">
        <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/15" />
        <div className="relative">
          <div className="flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[.18em] text-white/60 sm:text-xs">
            <span data-testid="text-preview-team">{rosterText(draft.teamName, 'YOUR TEAM', 34)}</span>
            <span className="shrink-0 bg-primary px-2 py-1 text-primary-foreground">{rosterText(draft.season, 'SEASON', 20)}</span>
          </div>
          <div className="mt-10">
            <p className="font-display text-[clamp(3rem,8vw,6rem)] leading-[.82] tracking-tight">{draft.layout === 'lineup' ? 'GAME DAY' : 'TEAM ROSTER'}</p>
            <div className="mt-5 h-1 w-16 bg-primary" />
          </div>
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between text-[10px] font-bold uppercase tracking-[.18em] text-primary">
              <span>Starters / formation board</span>
              <span>{starters.length}</span>
            </div>
              <FormationBoard
                boardStyle={draft.boardStyle}
                starters={starters}
                onPositionChange={onPositionChange}
              />
          </div>
          <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 text-[10px] font-bold uppercase tracking-[.16em] text-white/50">
            <span>{starters.length} starters · {draft.players.length - starters.length} bench</span>
             <span className="text-primary">Pixl Sports</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScheduleEditor() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id?: string }>();
  const cloudProjectId = params.id;
  const { user, isSignedIn, isLoaded } = useUser();
  const { data: accountAccess } = useGetAccountAccess({ query: { enabled: Boolean(isSignedIn), staleTime: 15000, queryKey: getGetAccountAccessQueryKey() } });
  const consumeAccountUsage = useConsumeAccountUsage();
  const queryClient = useQueryClient();
  const isFan = getUserRole(user) === 'fan';
  const [calendarConnection, setCalendarConnection] = useState<CalendarConnection | null>(getStoredCalendarConnection);
  const [storedDraft] = useState(() => readScheduleDraft());
  const [selectedTemplate, setSelectedTemplate] = useState(storedDraft?.template ?? 0);
  const [saved, setSaved] = useState(Boolean(storedDraft));
  const [notice, setNotice] = useState('');
  const [teamName, setTeamName] = useState(storedDraft?.teamName ?? 'Eastside Falcons');
  const [season, setSeason] = useState(storedDraft?.season ?? 'Fall 2024');
  const [events, setEvents] = useState<ScheduleEvent[]>(() => (
    storedDraft ? storedDraft.events : defaultScheduleEvents
  ));
  const [selectedWeekKey, setSelectedWeekKey] = useState(
    () => getScheduleWeekKey(storedDraft?.events[0]?.date ?? defaultScheduleEvents[0]?.date ?? ''),
  );
  const [selectedEventId, setSelectedEventId] = useState(
    () => storedDraft?.events[0]?.id ?? defaultScheduleEvents[0]?.id ?? '',
  );
  const [eventForm, setEventForm] = useState<ScheduleEvent | null>(null);
  const [shareToken, setShareToken] = useState(storedDraft?.shareToken ?? '');
  const [shareUrl, setShareUrl] = useState(() => (
    storedDraft?.shareToken
      ? `${appOrigin}${basePath}/schedule/${storedDraft.shareToken}`
      : ''
  ));
  const cloudRevision = useRef(1);
  const initializedCloudId = useRef<string | null>(null);

  const createShare = useCreateScheduleShare();
  const updateShare = useUpdateScheduleShare();
  const deleteShare = useDeleteScheduleShare();
  const { data: cloudProjectData } = useGetProject(cloudProjectId ?? '', {
    query: {
      enabled: Boolean(cloudProjectId && isSignedIn),
      queryKey: getGetProjectQueryKey(cloudProjectId ?? ''),
    },
  });
  const { data: cloudProjects } = useListProjects({
    query: {
      enabled: Boolean(isSignedIn && accountAccess),
      queryKey: getListProjectsQueryKey(),
    },
  });
  const createCloudProject = useCreateProject();
  const updateCloudProject = useUpdateProject();
  const latestCloudScheduleProject = getLatestCloudScheduleProject(cloudProjects ?? []);
  const selectedCloudProject = cloudProjectId
    ? (cloudProjectData && isCloudToolProject(cloudProjectData.project, 'schedule')
      ? cloudProjectData
      : null)
    : latestCloudScheduleProject;
  const activeCloudProjectId = cloudProjectId ?? selectedCloudProject?.id;
  const hasExistingShare = Boolean(shareToken);
  const sharePending = createShare.isPending || updateShare.isPending;
  const scheduleWeeks = getScheduleWeeks(events);
  const selectedWeek = scheduleWeeks.find((week) => week.key === selectedWeekKey) ?? scheduleWeeks[0];
  const visibleEvents = selectedWeek
    ? events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => getScheduleWeekKey(event.date) === selectedWeek.key)
    : [];
  const selectedEventIndex = events.findIndex((event) => event.id === selectedEventId);

  useEffect(() => {
    if (cloudProjectId && !isLoaded) return;
    if (cloudProjectId && isLoaded && !isSignedIn) {
      setLocation('/sign-in');
    }
  }, [cloudProjectId, isLoaded, isSignedIn, setLocation]);

  useEffect(() => {
    if (!selectedCloudProject || initializedCloudId.current === selectedCloudProject.id) return;
    const loadedDraft = normalizeScheduleDraft(selectedCloudProject.project);
    if (!loadedDraft) return;
    initializedCloudId.current = selectedCloudProject.id;
    setTeamName(loadedDraft.teamName);
    setSeason(loadedDraft.season);
    setEvents(loadedDraft.events);
    setSelectedTemplate(loadedDraft.template);
    setShareToken(loadedDraft.shareToken ?? '');
    setShareUrl(loadedDraft.shareToken ? `${appOrigin}${basePath}/schedule/${loadedDraft.shareToken}` : '');
    setSelectedEventId(loadedDraft.events[0]?.id ?? '');
    setSelectedWeekKey(getScheduleWeekKey(loadedDraft.events[0]?.date ?? ''));
    setSaved(true);
    cloudRevision.current = selectedCloudProject.revision;
  }, [selectedCloudProject]);

  useEffect(() => {
    if (events.length === 0) {
      if (selectedWeekKey) setSelectedWeekKey('');
      if (selectedEventId) setSelectedEventId('');
      return;
    }
    const weeks = getScheduleWeeks(events);
    const nextWeek = weeks.find((week) => week.key === selectedWeekKey) ?? weeks[0];
    if (nextWeek && nextWeek.key !== selectedWeekKey) {
      setSelectedWeekKey(nextWeek.key);
    }
    if (!events.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(nextWeek?.events[0]?.id ?? events[0].id);
      return;
    }
    const currentEvent = events.find((event) => event.id === selectedEventId);
    const currentEventWeekKey = currentEvent ? getScheduleWeekKey(currentEvent.date) : '';
    if (currentEventWeekKey && currentEventWeekKey !== selectedWeekKey) {
      setSelectedWeekKey(currentEventWeekKey);
    }
  }, [events, selectedEventId, selectedWeekKey]);

  const setNoticeFor = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2400);
  };

  const updateEvent = (id: string, patch: Partial<ScheduleEvent>) => {
    setSaved(false);
    setEventForm((current) => (
      current?.id === id
        ? updateScheduleEvent([current], id, patch)[0]
        : current
    ));
  };

  const openNewEventForm = () => {
    setSaved(false);
    setSelectedEventId('');
    setEventForm(createBlankScheduleEvent('game'));
  };

  const openEventForm = (event: ScheduleEvent) => {
    setSelectedEventId(event.id);
    setEventForm({ ...event });
  };

  const saveEventForm = async () => {
    if (!eventForm) return;

    const isNewEvent = !events.some((event) => event.id === eventForm.id);
    if (isNewEvent && accountAccess?.accessMode === 'guest') {
      try {
        await consumeAccountUsage.mutateAsync({
          data: { category: 'schedule_event', usageKey: `schedule-event:${eventForm.id}` },
        });
        await queryClient.invalidateQueries({ queryKey: getGetAccountAccessQueryKey() });
      } catch {
         setNoticeFor('WORKSPACE SCHEDULE LIMIT REACHED — USE YOUR EXISTING DRAFT OR CONTACT SUPPORT');
        return;
      }
    }
    const nextEvents = saveScheduleEvent(events, eventForm);
    setEvents(nextEvents);
    setSelectedEventId(eventForm.id);
    setSelectedWeekKey(getScheduleWeekKey(eventForm.date));
    setEventForm(null);
    setSaved(false);
    setNoticeFor(isNewEvent ? 'EVENT ADDED TO SCHEDULE' : 'EVENT CHANGES SAVED');
  };

  const removeEvent = (id: string) => {
    setSaved(false);
    const removedIndex = events.findIndex((event) => event.id === id);
    const nextEvents = removeScheduleEvent(events, id);
    setEvents(nextEvents);
    setEventForm(null);
    if (id === selectedEventId) {
      setSelectedEventId(nextEvents[Math.min(removedIndex, nextEvents.length - 1)]?.id ?? '');
    }
  };

  const moveEvent = (id: string, direction: -1 | 1) => {
    setSaved(false);
    setEvents((current) => moveScheduleEvent(current, id, direction));
  };

  const saveCurrentDraft = (nextShareToken = shareToken) => {
    window.localStorage.setItem('leaguematrix-project', 'true');
    saveScheduleDraft(window.localStorage, {
      teamName,
      season,
      events,
      template: selectedTemplate,
      ...(nextShareToken ? { shareToken: nextShareToken } : {}),
    });
  };

  const cloudSchedule = (): CloudProjectPayload => ({
    tool: 'schedule',
    version: 1,
    teamName,
    season,
    events,
    template: selectedTemplate,
    ...(shareToken ? { shareToken } : {}),
  });

  const saveToCloud = async () => {
    if (!isSignedIn) {
      setLocation('/sign-in');
      return;
    }
    try {
      const data = {
        project: cloudSchedule(),
        expectedRevision: cloudRevision.current,
      };
      if (activeCloudProjectId) {
        const updated = await updateCloudProject.mutateAsync({
          projectId: activeCloudProjectId,
          data,
        });
        cloudRevision.current = updated.revision;
      } else {
        const created = await createCloudProject.mutateAsync({
          data: { name: `${teamName.trim()} - Schedule`, project: cloudSchedule() },
        });
        cloudRevision.current = created.revision;
        await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setLocation(`/studio/schedule/${created.id}`);
      }
      setSaved(true);
      setNoticeFor('SCHEDULE SAVED');
    } catch (error: any) {
       setNoticeFor(error?.status === 409 ? 'WORKSPACE SCHEDULE LIMIT REACHED — USE YOUR EXISTING DRAFT OR CONTACT SUPPORT' : 'CLOUD SAVE FAILED — TRY AGAIN');
    }
  };

  const saveSchedule = async () => {
    saveCurrentDraft();
    if (!isSignedIn) {
      setSaved(true);
      setNoticeFor('SCHEDULE SAVED ON THIS DEVICE');
      return;
    }
    await saveToCloud();
  };

  const publishSchedule = async () => {
    if (!isSignedIn) {
      setLocation('/sign-in');
      return;
    }
    if (!teamName.trim() || events.length === 0) {
      setNoticeFor('ADD A TEAM NAME AND EVENT BEFORE PUBLISHING');
      return;
    }

    try {
      const shareData = {
        title: teamName.trim(),
        teamSeason: season.trim(),
        events,
      };
      let nextShareToken = shareToken;
      if (nextShareToken) {
        await updateShare.mutateAsync({ shareToken: nextShareToken, data: shareData });
      } else {
        const share = await createShare.mutateAsync({ data: shareData });
        nextShareToken = share.shareToken;
        setShareToken(nextShareToken);
        setShareUrl(`${appOrigin}${basePath}/schedule/${nextShareToken}`);
      }

      const data = {
        project: { ...cloudSchedule(), shareToken: nextShareToken },
        expectedRevision: cloudRevision.current,
      };
      let createdProjectId = '';
      if (activeCloudProjectId) {
        const updated = await updateCloudProject.mutateAsync({
          projectId: activeCloudProjectId,
          data,
        });
        cloudRevision.current = updated.revision;
      } else {
        const project = { ...cloudSchedule(), shareToken: nextShareToken };
        const created = await createCloudProject.mutateAsync({
          data: { name: `${teamName.trim()} - Schedule`, project },
        });
        createdProjectId = created.id;
        cloudRevision.current = created.revision;
      }
      await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      saveCurrentDraft(nextShareToken);
      setSaved(true);
      setNoticeFor('CALENDAR PUBLISHED TO ALL');
      if (createdProjectId) {
        setLocation(`/studio/schedule/${createdProjectId}`);
      }
    } catch (error: any) {
       setNoticeFor(error?.status === 409 ? 'WORKSPACE SCHEDULE LIMIT REACHED — USE YOUR EXISTING DRAFT OR CONTACT SUPPORT' : 'PUBLISH FAILED — TRY AGAIN');
    }
  };

  const shareSchedule = async () => {
    if (!teamName.trim() || events.length === 0) {
      setNoticeFor('ADD A TEAM NAME AND EVENT BEFORE SHARING');
      return;
    }

    try {
      const data = {
        title: teamName.trim(),
        teamSeason: season.trim(),
        events,
      };
      const share = hasExistingShare
        ? await updateShare.mutateAsync({ shareToken, data })
        : await createShare.mutateAsync({ data });
      const url = `${appOrigin}${basePath}/schedule/${share.shareToken}`;
      setShareToken(share.shareToken);
      setShareUrl(url);
      saveCurrentDraft(share.shareToken);
      setSaved(true);

      if (!hasExistingShare && typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: teamName.trim(),
            text: `${teamName.trim()}${season.trim() ? ` · ${season.trim()}` : ''}`,
            url,
          });
          setNoticeFor('SCHEDULE SHARED WITH PARENTS');
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }

      if (!hasExistingShare) {
        await navigator.clipboard?.writeText(url);
        setNoticeFor('PARENT LINK COPIED TO CLIPBOARD');
      } else {
        setNoticeFor('PARENT LINK UPDATED');
      }
    } catch {
      setNoticeFor(hasExistingShare ? 'LINK UPDATE FAILED — TRY AGAIN' : 'SHARING FAILED — TRY AGAIN');
    }
  };

  const revokeScheduleShare = async () => {
    if (!shareToken || !window.confirm('Revoke this parent link? Parents will no longer be able to open it.')) {
      return;
    }

    try {
      await deleteShare.mutateAsync({ shareToken });
      setShareToken('');
      setShareUrl('');
      saveCurrentDraft('');
      setSaved(true);
      setNoticeFor('PARENT LINK REVOKED');
    } catch {
      setNoticeFor('LINK REVOKE FAILED — TRY AGAIN');
    }
  };

  if (isFan && calendarConnection) {
    return (
      <StudioLayout>
        <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-4 py-6 sm:px-8 lg:py-10">
          <div className="mb-6 flex items-center gap-4">
            <Link href="/studio" className="grid h-10 w-10 place-items-center border border-border bg-card text-foreground transition-colors hover:bg-muted clip-angled-sm" aria-label="Back to studio" data-testid="button-back-studio">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                <CalendarDays className="h-4 w-4" /> Team Calendar
              </div>
              <p className="mt-1 hidden text-sm font-medium text-muted-foreground sm:block">Your coach’s latest schedule.</p>
            </div>
          </div>
           <FanCalendarConnectionPanel onConnectionChange={setCalendarConnection} />
        </main>
      </StudioLayout>
    );
  }

  return (
    <StudioLayout>
      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-4 py-6 sm:px-8 lg:py-10">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <Link href="/studio" className="grid h-10 w-10 place-items-center border border-border bg-card text-foreground transition-colors hover:bg-muted clip-angled-sm" aria-label="Back to studio" data-testid="button-back-studio">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
                <CalendarDays className="h-4 w-4" /> Schedule Maker
              </div>
              <p className="mt-1 hidden text-sm font-medium text-muted-foreground sm:block">Put the season in motion.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:gap-4 sm:self-auto">
            <span className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary transition-opacity duration-300 ${saved ? 'opacity-100' : 'opacity-0'}`}>
              <Check className="h-4 w-4" /> Saved
            </span>
            <button type="button" onClick={() => { void saveSchedule(); }} disabled={createCloudProject.isPending || updateCloudProject.isPending} className="inline-flex items-center gap-2 bg-foreground px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-background transition-transform hover:scale-105 disabled:cursor-wait disabled:opacity-60 clip-angled-sm" data-testid="button-save-project">
              <Save className="h-4 w-4" /> {createCloudProject.isPending || updateCloudProject.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={publishSchedule} disabled={createCloudProject.isPending || updateCloudProject.isPending || sharePending} className="inline-flex items-center gap-2 bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60 clip-angled-sm" data-testid="button-publish-schedule">
              <CloudUpload className="h-4 w-4" /> {createCloudProject.isPending || updateCloudProject.isPending || sharePending ? 'Publishing…' : 'Publish to All'}
            </button>
          </div>
        </div>

        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <section className="min-w-0 lg:sticky lg:top-6">
            <div className="mb-2 flex flex-wrap items-center justify-end gap-1.5" data-testid="schedule-template-picker">
              <span className="mr-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Template</span>
              {toolData.schedule.templateNames.map((name, index) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => { setSaved(false); setSelectedTemplate(index); }}
                  className={`h-8 min-w-[76px] border px-2 text-center font-display text-[11px] uppercase leading-none tracking-wide transition-all clip-angled-sm ${selectedTemplate === index ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border bg-card text-muted-foreground hover:border-foreground hover:text-foreground'}`}
                  data-testid={`button-template-${index}`}
                >
                  {name}
                </button>
              ))}
            </div>
            <SchedulePreview
              teamName={teamName}
              season={season}
              events={events}
              selectedTemplate={selectedTemplate}
              bottomActions={(
                <>
                  <button
                    type="button"
                    onClick={openNewEventForm}
                    className="ml-2 grid h-14 w-14 shrink-0 place-items-center rounded-full border-4 border-background bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background sm:ml-3"
                    aria-label="Add event"
                    data-testid="button-add-event"
                  >
                    <Plus className="h-7 w-7" strokeWidth={3} />
                    <span className="sr-only">Add event</span>
                  </button>
                  {!isFan && accountAccess?.accessMode !== 'guest' && (
                    <div className="min-w-0 max-w-[420px]">
                      <CoachCalendarCodePanel />
                    </div>
                  )}
                  {isFan && (
                    <div className="min-w-0 max-w-[380px]">
                      <FanCalendarConnectionPanel compact onConnectionChange={setCalendarConnection} />
                    </div>
                  )}
                </>
              )}
            />
          </section>

          <aside className="flex flex-col border border-border bg-card p-5 clip-angled-sm">
            <div className="relative z-10">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-foreground">Schedule weeks</p>
                  <p className="mt-1 text-xs font-medium text-muted-foreground">Swipe across weeks, then choose a date to edit.</p>
                </div>
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
              </div>

              <div className="overflow-x-auto pb-2 no-scrollbar" data-testid="schedule-week-list">
                <div className="flex min-w-max gap-2">
                  {scheduleWeeks.map((week) => (
                    <button
                      key={week.key}
                      type="button"
                      onClick={() => {
                        setSelectedWeekKey(week.key);
                        const firstEvent = week.events[0];
                        setSelectedEventId(firstEvent?.id ?? '');
                      }}
                      aria-pressed={week.key === selectedWeek?.key}
                      className={`min-w-[138px] border px-3 py-2.5 text-left transition-colors clip-angled-sm ${week.key === selectedWeek?.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/60 hover:text-foreground'}`}
                      data-testid={`button-select-schedule-week-${week.key}`}
                    >
                      <span className="block text-[10px] font-bold uppercase tracking-wider">{week.label}</span>
                      <span className="mt-1 block text-[10px] font-medium uppercase tracking-wider opacity-75">{week.events.length} {week.events.length === 1 ? 'entry' : 'entries'}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 max-h-52 overflow-y-auto pr-1" data-testid="schedule-event-list">
                <div className="space-y-2">
                  {visibleEvents.map(({ event, index }) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => openEventForm(event)}
                      aria-pressed={event.id === selectedEventId}
                      className={`flex w-full items-center gap-3 border px-3 py-2.5 text-left transition-colors clip-angled-sm ${event.id === selectedEventId ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/60 hover:text-foreground'}`}
                      data-testid={`button-select-schedule-event-${index}`}
                    >
                      <span className="min-w-[74px] text-[10px] font-bold uppercase tracking-wider">{formatScheduleDate(event.date)}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-wide">
                        {event.type === 'game' ? event.opponent || 'Game' : event.type === 'practice' ? 'Practice' : 'Meeting'}
                      </span>
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider">{formatScheduleTime(event.time)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Select an event to edit it
              </p>
            </div>

            <div className="relative z-10 mt-auto pt-8">
              <button type="button" onClick={shareSchedule} disabled={sharePending || deleteShare.isPending} className="inline-flex w-full items-center justify-center gap-2 bg-foreground px-3 py-3 text-xs font-bold uppercase tracking-widest text-background transition-colors hover:bg-foreground/90 disabled:cursor-wait disabled:opacity-60 clip-angled-sm" data-testid="button-share-schedule">
                <Share2 className="h-4 w-4" /> {sharePending ? (hasExistingShare ? 'Updating link…' : 'Creating link…') : hasExistingShare ? 'Update parent link' : 'Share with parents'}
              </button>
            </div>

            {shareUrl && (
              <div className="relative z-10 mt-3 border border-primary/30 bg-primary/5 p-3 clip-angled-sm" data-testid="schedule-share-link">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Public parent link</p>
                <div className="mt-2 flex items-center gap-2">
                  <input readOnly value={shareUrl} className="min-w-0 flex-1 bg-transparent text-xs font-medium text-foreground outline-none" aria-label="Public parent schedule link" />
                  <button type="button" onClick={() => { void navigator.clipboard?.writeText(shareUrl); setNoticeFor('PARENT LINK COPIED TO CLIPBOARD'); }} className="grid h-8 w-8 shrink-0 place-items-center border border-border bg-card text-foreground hover:bg-muted" aria-label="Copy parent schedule link" data-testid="button-copy-schedule-link">
                    <Clipboard className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-2 text-[10px] font-medium leading-relaxed text-muted-foreground">Update this link after changing the schedule. Parents keep the same URL.</p>
                <button type="button" onClick={() => { void revokeScheduleShare(); }} disabled={sharePending || deleteShare.isPending} className="mt-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-destructive disabled:cursor-wait disabled:opacity-60" data-testid="button-revoke-schedule-link">
                  <Link2Off className="h-3.5 w-3.5" /> {deleteShare.isPending ? 'Revoking link…' : 'Revoke parent link'}
                </button>
              </div>
            )}

            {notice && <p className="relative z-10 mt-4 text-center text-xs font-bold uppercase tracking-widest text-primary animate-pulse" role="status" data-testid="status-editor-notice">{notice}</p>}
          </aside>
        </div>

        <Dialog
          open={Boolean(eventForm)}
          onOpenChange={(open) => {
            if (!open) setEventForm(null);
          }}
        >
          <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] gap-5 overflow-y-auto border-primary/40 bg-card p-4 sm:max-w-2xl sm:p-6" data-testid="schedule-event-dialog">
            <DialogHeader className="pr-8">
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Team calendar</p>
              <DialogTitle className="font-display text-3xl uppercase tracking-wide">
                {eventForm && events.some((event) => event.id === eventForm.id) ? 'Edit event' : 'Add event'}
              </DialogTitle>
              <DialogDescription className="text-left">
                Add the details families need, then save the event to the calendar.
              </DialogDescription>
            </DialogHeader>
            {eventForm && (
              <ScheduleEventCard
                event={eventForm}
                index={selectedEventIndex >= 0 ? selectedEventIndex : events.length}
                count={events.length}
                onChange={updateEvent}
                onRemove={removeEvent}
                onMove={moveEvent}
                onSave={() => { void saveEventForm(); }}
                isNew={!events.some((event) => event.id === eventForm.id)}
                onCancel={() => setEventForm(null)}
              />
            )}
          </DialogContent>
        </Dialog>
      </main>
    </StudioLayout>
  );
}

function ScheduleEventCard({
  event,
  index,
  count,
  onChange,
  onRemove,
  onMove,
  onSave,
  isNew,
  onCancel,
}: {
  event: ScheduleEvent;
  index: number;
  count: number;
  onChange: (id: string, patch: Partial<ScheduleEvent>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onSave: () => void;
  isNew: boolean;
  onCancel: () => void;
}) {
  const typeLabel = event.type === 'game' ? 'Game' : event.type === 'practice' ? 'Practice' : 'Meeting';

  return (
    <div className="border border-border bg-background p-3 clip-angled-sm" data-testid={`schedule-event-${index}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <select
          value={event.type}
          onChange={(e) => onChange(event.id, { type: e.target.value as ScheduleEventType, opponent: e.target.value === 'game' ? event.opponent : '' })}
          className="min-w-0 flex-1 border border-border bg-card px-3 py-2 text-xs font-bold uppercase tracking-wider text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary clip-angled-sm"
          aria-label={`Event ${index + 1} type`}
          data-testid={`select-event-type-${index}`}
        >
          <option value="game">Game</option>
          <option value="practice">Practice</option>
          <option value="meeting">Meeting</option>
        </select>
        <span className="hidden text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:block">{typeLabel} {index + 1}</span>
        {isNew ? (
          <button type="button" onClick={onCancel} className="inline-flex h-8 items-center border border-border px-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground" data-testid="button-cancel-new-event">
            Cancel
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onMove(event.id, -1)} disabled={index === 0} className="grid h-8 w-8 place-items-center border border-border text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Move event ${index + 1} up`} data-testid={`button-move-event-up-${index}`}>
              <ChevronUp className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onMove(event.id, 1)} disabled={index === count - 1} className="grid h-8 w-8 place-items-center border border-border text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Move event ${index + 1} down`} data-testid={`button-move-event-down-${index}`}>
              <ChevronDown className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onRemove(event.id)} className="inline-flex h-8 items-center gap-1.5 border border-border px-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-destructive hover:text-destructive" aria-label={`Delete event ${index + 1}`} data-testid={`button-remove-event-${index}`}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ScheduleField label="Date" type="date" value={event.date} onChange={(value) => onChange(event.id, { date: value })} testId={`input-event-date-${index}`} />
        <ScheduleField label="Time" type="time" value={event.time} onChange={(value) => onChange(event.id, { time: value })} testId={`input-event-time-${index}`} />
        {event.type === 'game' && <ScheduleField label="Opponent" value={event.opponent} onChange={(value) => onChange(event.id, { opponent: value })} placeholder="Northside" testId={`input-event-opponent-${index}`} />}
        <ScheduleField label="Location" value={event.location} onChange={(value) => onChange(event.id, { location: value })} placeholder="Central Field" testId={`input-event-location-${index}`} />
        <ScheduleField label="Snacks" value={event.snacks} onChange={(value) => onChange(event.id, { snacks: value })} placeholder="Who brings snacks?" icon={<Utensils className="h-3.5 w-3.5" />} testId={`input-event-snacks-${index}`} />
        <ScheduleField label="Drinks" value={event.drinks} onChange={(value) => onChange(event.id, { drinks: value })} placeholder="Who brings drinks?" icon={<CupSoda className="h-3.5 w-3.5" />} testId={`input-event-drinks-${index}`} />
      </div>
      <ScheduleField label="Notes" value={event.notes} onChange={(value) => onChange(event.id, { notes: value })} placeholder="Bring cleats and a water bottle." multiline icon={<NotebookPen className="h-3.5 w-3.5" />} testId={`input-event-notes-${index}`} />
      <div className="mt-4 flex justify-end border-t border-border pt-3">
        <button type="button" onClick={onSave} className="inline-flex items-center gap-2 bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 clip-angled-sm" data-testid={`button-save-event-${index}`}>
          <Save className="h-4 w-4" /> {isNew ? 'Save event' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function ScheduleField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  multiline = false,
  icon,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'time';
  placeholder?: string;
  multiline?: boolean;
  icon?: ReactNode;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{icon}{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} className="w-full resize-y border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary clip-angled-sm" data-testid={testId} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary clip-angled-sm" data-testid={testId} />
      )}
    </label>
  );
}

function formatScheduleDate(value: string) {
  if (!value) return 'DATE TBD';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

function formatScheduleTime(value: string) {
  if (!value) return 'TIME TBD';
  const [hours, minutes] = value.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

type ScheduleWeek = {
  key: string;
  label: string;
  events: ScheduleEvent[];
};

function getScheduleWeekKey(value: string) {
  if (!value) return 'unscheduled';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return 'unscheduled';

  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  date.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function getScheduleWeeks(events: ScheduleEvent[]): ScheduleWeek[] {
  const groups = new Map<string, ScheduleEvent[]>();
  events.forEach((event) => {
    const key = getScheduleWeekKey(event.date);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  });

  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === 'unscheduled') return 1;
      if (right === 'unscheduled') return -1;
      return left.localeCompare(right);
    })
    .map(([key, weekEvents]) => ({
      key,
      label: key === 'unscheduled' ? 'Unscheduled' : formatScheduleWeekLabel(key),
      events: weekEvents,
    }));
}

function formatScheduleWeekLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 6);
  const startLabel = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
  const endLabel = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
  return start.getMonth() === end.getMonth()
    ? `${startLabel}–${end.getDate()}`
    : `${startLabel}–${endLabel}`;
}

function escapeSvgText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] ?? character);
}

function graphicLine(value: string, maxLength = 86) {
  const normalized = value.trim() || '—';
  return escapeSvgText(normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized);
}

function buildScheduleGraphicSvg({
  teamName,
  season,
  events,
  template,
}: {
  teamName: string;
  season: string;
  events: ScheduleEvent[];
  template: number;
}) {
  const background = template === 1 ? '#177d76' : template === 2 ? '#f5c94d' : '#f36f4c';
  const foreground = template === 2 ? '#243248' : '#f9f3e8';
  const eventBackground = template === 2 ? '#ffffff2b' : '#0000001c';
  const eventHeight = 238;
  const height = Math.max(860, 330 + events.length * eventHeight);
  const eventMarkup = events.map((event, index) => {
    const y = 280 + index * eventHeight;
    const eventName = event.type === 'game'
      ? `VS ${event.opponent || 'OPPONENT TBD'}`
      : event.type === 'practice' ? 'TEAM PRACTICE' : 'TEAM MEETING';
    return `
      <rect x="56" y="${y}" width="968" height="202" rx="18" fill="${eventBackground}" stroke="${foreground}" stroke-opacity=".25"/>
      <text x="82" y="${y + 46}" fill="${foreground}" font-family="Arial, sans-serif" font-size="25" font-weight="700" letter-spacing="2">${graphicLine(formatScheduleDate(event.date), 22)}</text>
      <text x="82" y="${y + 84}" fill="${foreground}" opacity=".78" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="2">${graphicLine(formatScheduleTime(event.time), 22)}</text>
      <line x1="290" y1="${y + 28}" x2="290" y2="${y + 174}" stroke="${foreground}" stroke-opacity=".25"/>
      <text x="322" y="${y + 44}" fill="${foreground}" opacity=".72" font-family="Arial, sans-serif" font-size="16" font-weight="700" letter-spacing="3">${graphicLine(event.type.toUpperCase(), 18)}</text>
      <text x="322" y="${y + 82}" fill="${foreground}" font-family="Arial, sans-serif" font-size="28" font-weight="700">${graphicLine(eventName, 40)}</text>
      <text x="322" y="${y + 117}" fill="${foreground}" opacity=".9" font-family="Arial, sans-serif" font-size="18" font-weight="700">${graphicLine(`LOCATION · ${event.location || 'TBD'}`, 52)}</text>
      <text x="322" y="${y + 151}" fill="${foreground}" opacity=".82" font-family="Arial, sans-serif" font-size="16" font-weight="700">${graphicLine(`SNACKS · ${event.snacks || 'TBD'}   DRINKS · ${event.drinks || 'TBD'}`, 62)}</text>
      <text x="322" y="${y + 180}" fill="${foreground}" opacity=".78" font-family="Arial, sans-serif" font-size="15">${graphicLine(event.notes, 65)}</text>
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}">
    <rect width="1080" height="${height}" fill="${background}"/>
    <circle cx="1010" cy="40" r="190" fill="none" stroke="#f5c94d" stroke-opacity=".35" stroke-width="28"/>
    <circle cx="70" cy="${height - 10}" r="190" fill="#177d76" fill-opacity=".9"/>
     <text x="56" y="72" fill="${foreground}" opacity=".78" font-family="Arial, sans-serif" font-size="16" font-weight="700" letter-spacing="3">PIXL SPORTS · TEAM SCHEDULE</text>
    <text x="56" y="152" fill="${foreground}" font-family="Arial, sans-serif" font-size="62" font-weight="800">${graphicLine(teamName || 'TEAM NAME', 27)}</text>
    <text x="56" y="198" fill="${foreground}" opacity=".86" font-family="Arial, sans-serif" font-size="21" font-weight="700" letter-spacing="2">${graphicLine(season || 'SEASON', 60)}</text>
    <text x="1024" y="72" text-anchor="end" fill="${foreground}" font-family="Arial, sans-serif" font-size="16" font-weight="700" letter-spacing="2">${events.length} ${events.length === 1 ? 'EVENT' : 'EVENTS'}</text>
    ${eventMarkup}
    <text x="56" y="${height - 34}" fill="${foreground}" opacity=".74" font-family="Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="3">BRING THE ENERGY</text>
  </svg>`;
}

function SchedulePreview({
  teamName,
  season,
  events,
  selectedTemplate,
  bottomActions,
}: {
  teamName: string;
  season: string;
  events: ScheduleEvent[];
  selectedTemplate: number;
  bottomActions: ReactNode;
}) {
  const templateClass = selectedTemplate === 1
    ? 'bg-[#177d76] text-[#f9f3e8]'
    : selectedTemplate === 2
      ? 'bg-[#f5c94d] text-[#243248]'
      : 'bg-[#f36f4c] text-[#f9f3e8]';
  const eventClass = selectedTemplate === 1
    ? 'border-white/25 bg-black/10'
    : selectedTemplate === 2
      ? 'border-[#243248]/20 bg-white/20'
      : 'border-white/25 bg-black/10';

  return (
    <div className="relative flex min-h-[600px] items-center justify-center overflow-hidden border border-border bg-muted px-4 pb-24 pt-4 sm:min-h-[760px] sm:px-8 sm:pb-28 sm:pt-8 clip-angled-sm">
      <div className="absolute inset-0 bg-tech-grid opacity-50" />
      <div className={`relative w-full max-w-[960px] overflow-hidden rounded-[22px] ${templateClass} p-5 shadow-2xl sm:p-8`} data-testid="preview-canvas">
        <div className={`absolute -right-24 -top-20 h-72 w-72 rounded-full border-[30px] ${selectedTemplate === 2 ? 'border-[#f36f4c]/45' : 'border-[#f5c94d]/35'}`} />
        <div className={`absolute -bottom-28 -left-20 h-72 w-72 rounded-full ${selectedTemplate === 1 ? 'bg-[#f5c94d]' : 'bg-[#177d76]'}`} />
        <div className="relative">
          <div className="flex items-start justify-between gap-4 text-[10px] font-bold uppercase tracking-[.16em]">
            <div className="min-w-0">
               <p className="truncate opacity-80">Pixl Sports · Team schedule</p>
              <p className="mt-2 max-w-[90%] font-display text-4xl leading-[.88] tracking-[-.04em] sm:text-6xl">{teamName || 'TEAM NAME'}</p>
            </div>
            <span className="shrink-0 rounded-full border border-current px-2.5 py-1">{events.length} {events.length === 1 ? 'event' : 'events'}</span>
          </div>
          <p className="mt-5 text-sm font-bold uppercase tracking-[.12em] opacity-85 sm:text-base">{season || 'SEASON'}</p>

          <div className="mt-8 space-y-3">
            {events.length === 0 ? (
              <div className={`border border-dashed p-6 text-center text-sm font-bold uppercase tracking-widest opacity-75 ${eventClass}`}>
                Add an event to fill the schedule
              </div>
            ) : events.map((event, index) => (
              <div key={event.id} className={`relative border p-3.5 ${eventClass} ${selectedTemplate === 2 ? 'rounded-2xl' : 'clip-angled-sm'} ${index === 0 && selectedTemplate === 1 ? 'border-primary/70' : ''}`}>
                <div className="flex gap-3 sm:gap-5">
                  <div className="w-[86px] shrink-0 border-r border-current/20 pr-3 sm:w-[110px]">
                    <p className="font-display text-lg leading-none sm:text-2xl">{formatScheduleDate(event.date)}</p>
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-widest opacity-75">{formatScheduleTime(event.time)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-[.16em] opacity-75">{event.type}</span>
                      {event.type === 'game' && <span className="font-display text-xl leading-none sm:text-2xl">VS {event.opponent || 'OPPONENT TBD'}</span>}
                      {event.type === 'practice' && <span className="font-display text-xl leading-none sm:text-2xl">TEAM PRACTICE</span>}
                      {event.type === 'meeting' && <span className="font-display text-xl leading-none sm:text-2xl">TEAM MEETING</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold uppercase tracking-wider opacity-85">
                      {event.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{event.location}</span>}
                      {!event.location && <span className="opacity-60">Location TBD</span>}
                    </div>
                    {(event.snacks || event.drinks) && (
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider opacity-80">
                        {event.snacks && <span className="inline-flex items-center gap-1"><Utensils className="h-3 w-3" /> Snacks: {event.snacks}</span>}
                        {event.drinks && <span className="inline-flex items-center gap-1"><CupSoda className="h-3 w-3" /> Drinks: {event.drinks}</span>}
                      </div>
                    )}
                    {event.notes && <p className="mt-2 text-xs font-medium leading-relaxed opacity-80">{event.notes}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center justify-between border-t border-current/25 pt-4 text-[10px] font-bold uppercase tracking-[.16em] opacity-75">
            <span>Bring the energy</span>
            <CalendarDays className="h-5 w-5" />
          </div>
        </div>
      </div>
      <div className="absolute bottom-4 left-1/2 z-20 flex w-[calc(100%-2rem)] max-w-[960px] -translate-x-1/2 items-start justify-between gap-3 sm:bottom-6 sm:w-[calc(100%-4rem)]">
        {bottomActions}
      </div>
    </div>
  );
}

function PublicSchedulePage({ params }: { params: { shareToken?: string } }) {
  const shareToken = params.shareToken ?? '';
  const { data: schedule, isLoading, isError } = useGetScheduleShare(shareToken, {
    query: { enabled: Boolean(shareToken), queryKey: ['/api/schedule-shares', shareToken] },
  });

  if (isLoading) {
    return (
      <div className="noise min-h-dvh bg-background">
        <SiteNav />
        <main className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-[760px] items-center justify-center px-5 py-12">
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground" role="status">Loading schedule…</p>
        </main>
      </div>
    );
  }

  if (isError || !schedule) {
    return (
      <div className="noise min-h-dvh bg-background">
        <SiteNav />
        <main className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-[760px] flex-col items-center justify-center px-5 py-12 text-center">
          <CalendarDays className="h-10 w-10 text-primary" />
          <h1 className="mt-5 font-display text-4xl uppercase tracking-wide">Schedule not found</h1>
          <p className="mt-3 max-w-md text-sm font-medium leading-relaxed text-muted-foreground">This parent link may have expired or been copied incorrectly.</p>
           <Link href="/" className="mt-7 bg-foreground px-5 py-3 text-xs font-bold uppercase tracking-widest text-background clip-angled-sm">Go to Pixl Sports</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="noise min-h-dvh bg-background">
      <SiteNav />
      <main className="mx-auto w-full max-w-[860px] px-4 py-8 sm:px-8 sm:py-14">
        <div className="mb-8 border-l-4 border-primary pl-4">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Shared team schedule</p>
          <h1 className="mt-2 font-display text-5xl leading-[.9] tracking-tight text-foreground sm:text-7xl">{schedule.title}</h1>
          <p className="mt-4 text-base font-bold uppercase tracking-[.12em] text-muted-foreground">{schedule.teamSeason}</p>
        </div>

        <div className="space-y-4" data-testid="public-schedule-events">
          {schedule.events.length === 0 ? (
            <div className="border border-dashed border-border bg-card p-8 text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">No events have been added yet.</div>
          ) : schedule.events.map((event) => (
            <article key={event.id} className="border border-border bg-card p-5 shadow-sm clip-angled-sm sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row">
                <div className="shrink-0 sm:w-36 sm:border-r sm:border-border sm:pr-5">
                  <p className="font-display text-2xl leading-none text-foreground">{formatScheduleDate(event.date)}</p>
                  <p className="mt-2 text-xs font-bold uppercase tracking-widest text-primary">{formatScheduleTime(event.time)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[.16em] text-primary">{event.type}</span>
                    <h2 className="font-display text-2xl leading-none text-foreground">
                      {event.type === 'game' ? `VS ${event.opponent || 'OPPONENT TBD'}` : event.type === 'practice' ? 'TEAM PRACTICE' : 'TEAM MEETING'}
                    </h2>
                  </div>
                  <p className="mt-4 flex items-start gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {event.location || 'Location TBD'}
                  </p>
                  {(event.snacks || event.drinks) && (
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {event.snacks && <span className="inline-flex items-center gap-1.5"><Utensils className="h-3.5 w-3.5 text-primary" /> Snacks: {event.snacks}</span>}
                      {event.drinks && <span className="inline-flex items-center gap-1.5"><CupSoda className="h-3.5 w-3.5 text-primary" /> Drinks: {event.drinks}</span>}
                    </div>
                  )}
                  {event.notes && <p className="mt-4 border-t border-border pt-3 text-sm font-medium leading-relaxed text-muted-foreground">{event.notes}</p>}
                </div>
              </div>
            </article>
          ))}
        </div>

        <p className="mt-10 text-center text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Shared from Pixl Sports</p>
      </main>
    </div>
  );
}

function Field({ label, value, onChange, testId }: { label: string; value: string; onChange: (val: string) => void; testId?: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-border bg-background px-4 py-3 font-medium text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary clip-angled-sm transition-colors" data-testid={testId} />
    </label>
  );
}

function Preview({ kind, values, selectedTemplate }: { kind: ToolKind; values: { headline: string; subline: string; name: string; detail: string }; selectedTemplate: number }) {
  const isSchedule = kind === 'schedule';
  const templateClass = selectedTemplate === 1 ? 'bg-[#177d76]' : selectedTemplate === 2 ? 'bg-[#f5c94d]' : 'bg-[#f36f4c]';
  const foreground = selectedTemplate === 2 ? 'text-[#243248]' : 'text-[#f9f3e8]';

  return (
    <div className="relative flex min-h-[410px] flex-1 items-center justify-center overflow-hidden border border-border bg-muted p-5 sm:min-h-[580px] sm:p-10 clip-angled-sm">
      <div className="absolute inset-0 bg-tech-grid opacity-50" />
      <div className={`relative aspect-[1.12] w-full max-w-[650px] overflow-hidden rounded-[22px] ${templateClass} p-5 shadow-2xl transition-colors duration-300 sm:p-8`} data-testid="preview-canvas">
        <div className={`absolute -right-20 -top-16 h-60 w-60 rounded-full border-[28px] ${selectedTemplate === 2 ? 'border-[#f36f4c]/45' : 'border-[#f5c94d]/35'}`} />
        <div className={`absolute -bottom-24 -left-16 h-64 w-64 rounded-full ${selectedTemplate === 1 ? 'bg-[#f5c94d]' : 'bg-[#177d76]'}`} />
        <div className={`relative flex h-full flex-col justify-between ${foreground}`}>
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.16em]">
            <span>Eastside Falcons</span>
            <span className="rounded-full border border-current px-2.5 py-1">{isSchedule ? 'Fall season' : 'Game day'}</span>
          </div>
          <div className="relative max-w-[85%]">
            <p className="font-display text-[clamp(2.5rem,7vw,6.2rem)] font-bold leading-[.82] tracking-[-.08em]">{values.headline || 'YOUR MESSAGE'}</p>
            <p className="mt-5 max-w-md text-sm font-bold leading-relaxed opacity-85 sm:text-base">{values.subline || 'Add a supporting line'}</p>
          </div>
          <div className="relative flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.16em] opacity-80">{isSchedule ? 'Next up' : 'Bring the energy'}</p>
              <p className="mt-1 font-display text-lg font-bold sm:text-2xl">{values.detail || 'Falcons vs. Northside'}</p>
            </div>
            <div className="grid h-11 w-11 place-items-center rounded-xl border border-current sm:h-14 sm:w-14"><IconForPreview kind={kind} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconForPreview({ kind }: { kind: ToolKind }) {
  if (kind === 'schedule') return <CalendarDays className="h-5 w-5 sm:h-6 sm:w-6" />;
  return <Zap className="h-5 w-5 fill-current sm:h-6 sm:w-6" />;
}

function Help() {
  return (
    <StudioLayout>
      <main className="mx-auto max-w-[800px] px-5 py-12 sm:px-8 lg:py-24">
        <div className="mb-10 inline-flex items-center gap-2 bg-muted px-3 py-1 text-xs font-bold uppercase tracking-widest text-foreground clip-angled-sm">
          <CircleHelp className="h-4 w-4" /> Support Manual
        </div>
        <h1 className="font-display text-5xl leading-none tracking-wide text-foreground uppercase sm:text-7xl">Help & FAQ</h1>
        <div className="mt-12 space-y-10">
          <section>
            <h2 className="font-display text-3xl uppercase tracking-wide">Where are my graphics saved?</h2>
            <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">Local editing is the default. Hype Card settings and attached media are saved in this browser. If you sign in and choose Save design, only reusable design settings sync to your account; photos, videos, and uploaded logos stay on this device. Reopen a saved design, add media, then export the finished file to share it. Clearing browser data can remove locally stored work.</p>
          </section>
          <section>
            <h2 className="font-display text-3xl uppercase tracking-wide">Will my media follow me across devices?</h2>
            <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">For Hype Cards, attached photos, videos, and logos stay on the device where you added them. Cloud saves keep the reusable design settings, so you can reopen the design elsewhere, but you will need to add the original media again before editing or exporting. When you publish a Hype Card share, a prepared video and poster are uploaded separately so the public link can display them. Schedule, roster, and lineup data saved to your cloud workspace can be reopened on other signed-in devices.</p>
          </section>
          <section>
            <h2 className="font-display text-3xl uppercase tracking-wide">Can I use my own fonts?</h2>
            <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">The studio relies on heavily optimized, pre-selected display fonts designed specifically for sports impact. Custom font uploads are not supported to ensure immediate rendering without layout shifts.</p>
          </section>
          <section>
            <h2 className="font-display text-3xl uppercase tracking-wide">Video export is failing.</h2>
            <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">Video processing pushes your device's hardware. Source files can be up to 120MB, are prepared locally as a smaller MP4 when supported, and can be trimmed to a 15-second export. If processing fails, turn off power-saving mode and make sure the device has sufficient free memory.</p>
          </section>
        </div>
        <div className="mt-16 rounded-none bg-primary p-8 clip-angled text-primary-foreground sm:p-10 flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-4">
            <MessageCircleQuestion className="h-10 w-10" />
            <div>
              <p className="font-display text-2xl uppercase tracking-wide">Still stuck?</p>
              <p className="text-sm font-bold uppercase tracking-widest opacity-80 mt-1">Reach out for tactical support</p>
            </div>
          </div>
           <a href="mailto:hello@pixlsports.com" className="bg-foreground text-background font-bold uppercase tracking-wider px-6 py-3 clip-angled-sm hover:scale-105 transition-transform whitespace-nowrap">Contact Team</a>
        </div>
      </main>
    </StudioLayout>
  );
}

function Privacy() {
  return (
    <StudioLayout>
      <main className="mx-auto max-w-[800px] px-5 py-12 sm:px-8 lg:py-24">
        <div className="mb-10 inline-flex items-center gap-2 bg-muted px-3 py-1 text-xs font-bold uppercase tracking-widest text-foreground clip-angled-sm">
          <ShieldCheck className="h-4 w-4" /> Data Security
        </div>
        <h1 className="font-display text-5xl leading-none tracking-wide text-foreground uppercase sm:text-7xl">Privacy Policy</h1>
        <div className="prose prose-lg mt-12 max-w-none prose-headings:font-display prose-headings:uppercase prose-headings:tracking-wide prose-a:text-primary hover:prose-a:text-foreground">
           <p className="lead font-medium text-xl">The short version: We don't track your team, and Pixl Sports does not upload newly attached photos, videos, or logos. Account saves contain reusable design settings only.</p>
          <h3>1. Local Execution</h3>
           <p>Pixl Sports is built as a local-first application. When you attach a photo, video, or logo to create a graphic, that media is processed on your device using browser APIs. Saving a design to your account sends the layout, text, colors, crop settings, and output configuration, but not the attached media. Older cloud projects created before this policy may temporarily retain their previously uploaded media until it is removed in a later migration.</p>
          <h3>2. Analytics</h3>
          <p>We do not use tracking pixels, session recording tools, or advertising analytics in this release.</p>
          <h3>3. Cookies</h3>
          <p>Project settings and attached media may be kept in local browser storage so they can survive a reload. If you create an account, Clerk uses necessary session cookies to maintain your login. We do not use advertising cookies.</p>
          <h3>4. Your Media</h3>
           <p>You are responsible for having the rights and any required consent to use media you attach, including permission involving minors. To share a finished card, export the image or video and share that file; Pixl Sports does not host new finished media for public sharing.</p>
        </div>
      </main>
    </StudioLayout>
  );
}

function NotFound() {
  return (
    <div className="noise flex min-h-dvh flex-col bg-background">
      <SiteNav dark />
      <main className="flex flex-1 flex-col items-center justify-center px-5 py-20 text-center bg-tech-grid">
        <div className="font-display text-[12rem] leading-none text-muted-foreground/20">404</div>
        <h1 className="mt-4 font-display text-5xl uppercase tracking-wide text-foreground sm:text-6xl">Out of bounds.</h1>
        <p className="mt-4 max-w-md text-lg font-medium text-muted-foreground">The page you're looking for doesn't exist or has been moved off the active roster.</p>
        <Link href="/" className="mt-10 inline-flex items-center gap-2 bg-primary px-8 py-4 text-sm font-bold uppercase tracking-wider text-primary-foreground clip-angled-sm transition-transform hover:scale-105">
          <ArrowLeft className="h-5 w-5" /> Return to Home
        </Link>
      </main>
    </div>
  );
}


const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${appOrigin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(145 100% 45%)",
    colorForeground: "hsl(210 20% 98%)",
    colorMutedForeground: "hsl(215 14% 65%)",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "#181a1f",
    colorInput: "#121316",
    colorInputForeground: "hsl(210 20% 98%)",
    colorNeutral: "rgba(255,255,255,0.1)",
    fontFamily: "var(--app-font-sans)",
    borderRadius: "0.125rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#181a1f] w-[440px] max-w-full overflow-hidden clip-angled-sm border border-white/10 shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-display text-4xl uppercase tracking-wide text-white",
    headerSubtitle: "text-sm font-medium text-white/60",
    socialButtonsBlockButtonText: "text-sm font-bold uppercase tracking-wider !text-white",
    formFieldLabel: "text-xs font-bold uppercase tracking-widest text-white/80",
    footerActionLink: "text-primary font-bold hover:underline",
    footerActionText: "text-sm font-medium text-white/60",
    dividerText: "text-xs font-bold uppercase tracking-widest text-white/40",
    identityPreviewEditButton: "text-primary",
    formFieldSuccessText: "text-primary text-xs",
    alertText: "text-sm font-medium",
    logoBox: "mb-6",
    logoImage: "h-16 object-contain",
    socialButtonsBlockButton: "rounded-none border border-white/10 clip-angled-sm h-12 bg-white/5 hover:bg-white/10 transition-colors text-white",
    formButtonPrimary: "rounded-none h-12 clip-angled-sm font-bold uppercase tracking-wider bg-primary hover:bg-primary/90 text-primary-foreground transition-transform hover:scale-[1.02]",
    formFieldInput: "rounded-none h-12 border-white/10 bg-[#121316] text-white font-medium focus:border-primary focus:ring-1 focus:ring-primary clip-angled-sm transition-all",
    footerAction: "mt-8",
    dividerLine: "bg-white/10",
    alert: "rounded-none border border-destructive/20 bg-destructive/10 text-destructive clip-angled-sm",
    otpCodeFieldInput: "rounded-none border-white/10 bg-[#121316] text-white focus:border-primary clip-angled-sm",
    formFieldRow: "mb-5",
    main: "p-8 sm:p-10",
  },
};

function AuthLayout({ children, title, subtitle }: { children: ReactNode, title: ReactNode, subtitle: string }) {
  return (
    <div className="flex min-h-[100dvh] flex-col lg:flex-row bg-[#090a0c] noise">
      {/* Brand & Context Panel */}
      <div className="relative flex w-full flex-col justify-between overflow-hidden bg-foreground text-background lg:w-[45%] xl:w-[40%] px-5 py-6 sm:px-10 sm:py-12 shrink-0 border-b lg:border-b-0 lg:border-r border-white/5 shadow-2xl z-20">
        <div className="absolute inset-0 bg-tech-grid-dark opacity-[0.05]" />
        <div className="absolute -left-20 -top-20 h-[500px] w-[500px] rounded-full bg-primary/20 blur-[120px] pointer-events-none animate-stadium-flash" />

        <div className="relative z-10 flex items-center justify-between">
          <Link href="/" className="inline-block transition-opacity hover:opacity-80 scale-[0.85] origin-left sm:scale-100" data-testid="link-auth-home">
            <BrandMark inverse />
          </Link>
          <div className="hidden lg:inline-flex items-center gap-2 bg-primary/20 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-primary clip-angled-sm">
            <Activity className="h-4 w-4" /> Secure Auth
          </div>
        </div>

        <div className="relative z-10 mt-8 mb-4 lg:my-0">
          <h1 className="font-display text-4xl leading-[0.85] tracking-tight uppercase sm:text-5xl lg:text-6xl xl:text-7xl">
            {title}
          </h1>
          <p className="mt-4 hidden lg:block max-w-md text-lg font-medium leading-relaxed text-white/70">
            {subtitle}
          </p>
        </div>

        <div className="relative z-10 hidden lg:block mt-8 border-t border-white/10 pt-8">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center bg-white/5 text-primary clip-angled-sm">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
               <p className="text-sm font-bold uppercase tracking-wider text-white" data-testid="status-cloud-sync">Cloud sync is included.</p>
              <p className="mt-2 text-sm font-medium leading-relaxed text-white/60">
                 Sign in to create graphics, save reusable projects, and keep your team settings across devices.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Auth Form Panel */}
      <div className="relative flex flex-1 p-5 py-8 sm:p-10 bg-[#090a0c]">
        <div className="absolute inset-0 bg-tech-grid-dark opacity-[0.02]" />
        <div className="relative z-10 w-full max-w-[440px] animate-slide-up m-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

function SignInPage() {
  const redirectUrl = new URLSearchParams(window.location.search).get('redirect_url');
  return (
    <AuthLayout
      title={<>ENTER<br/><span className="text-primary">CONTROL ROOM.</span></>}
      subtitle="Access your saved templates, synced rosters, and broadcast graphics across all your devices."
    >
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} fallbackRedirectUrl={redirectUrl || `${basePath}/studio`} />
    </AuthLayout>
  );
}

function SignUpPage() {
  return (
    <AuthLayout
      title={<>CREATE<br/><span className="text-primary">CALLSIGN.</span></>}
       subtitle="Join Pixl Sports to save your custom templates and broadcast settings securely in the cloud."
    >
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} fallbackRedirectUrl={`${basePath}/studio`} />
    </AuthLayout>
  );
}

function RoleSelectionPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useUser();
  const existingProfile = getUserProfile(user);
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(existingProfile.role);
  const selectedAccessMode: AccessMode = existingProfile.accessMode ?? 'full';
  const [displayName, setDisplayName] = useState(existingProfile.displayName);
  const [teamName, setTeamName] = useState(existingProfile.teamName);
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState('');
  const updateAccountAccess = useUpdateAccountAccess();

  if (!isLoaded) {
    return <div className="grid min-h-dvh place-items-center bg-background text-sm font-bold uppercase tracking-widest text-muted-foreground">Checking account access…</div>;
  }
  if (!user) return <Redirect to="/sign-in" />;

  const saveProfile = async () => {
    const cleanName = displayName.trim();
    const cleanTeam = teamName.trim();
    if (!selectedRole) {
      setError('Choose Coach or Fan to continue.');
      return;
    }
    if (!cleanName || !cleanTeam) {
      setError('Add your name and team to continue.');
      return;
    }

    setSavingProfile(true);
    setError('');
    try {
      await updateAccountAccess.mutateAsync({
        data: { role: selectedRole, accessMode: selectedAccessMode },
      });
      await user.update({
        unsafeMetadata: {
          ...(user.unsafeMetadata ?? {}),
          role: selectedRole,
          accessMode: selectedAccessMode,
          displayName: cleanName,
          teamName: cleanTeam,
        },
      });
      const search = new URLSearchParams(window.location.search);
      const calendarHandoffSearch = search.has('calendarToken') || search.has('calendar')
        ? window.location.search
        : '';
      setLocation(calendarHandoffSearch ? `/studio/schedule${calendarHandoffSearch}` : '/studio');
    } catch {
      setSavingProfile(false);
      setError('We could not save your profile. Please try again.');
    }
  };

  return (
    <div className="noise min-h-dvh bg-background">
      <SiteNav />
      <main className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-6xl items-center px-5 py-12 sm:px-8">
        <div className="grid w-full gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 bg-muted px-3 py-1 text-xs font-bold uppercase tracking-widest clip-angled-sm">
              <UsersRound className="h-4 w-4 text-primary" /> One quick setup
            </div>
            <h1 className="font-display text-6xl leading-[0.88] tracking-tight sm:text-8xl">
              PICK YOUR<br /><span className="text-primary">PLAYBOOK.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg font-medium leading-relaxed text-muted-foreground">
              Tell us who you are and which team matters to you so your Command Center starts with the right tools.
            </p>
          </div>

          <section className="border border-border bg-card p-6 shadow-sm clip-angled-sm sm:p-8" aria-labelledby="role-heading">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Account setup</p>
            <h2 id="role-heading" className="mt-2 font-display text-4xl uppercase tracking-wide">YOUR PLAYBOOK</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Your name
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="e.g. Jordan Smith"
                  autoComplete="name"
                  className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary"
                  data-testid="input-profile-name"
                />
              </label>
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Team
                <input
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  placeholder="e.g. Eastside Falcons"
                  autoComplete="organization"
                  className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary"
                  data-testid="input-profile-team"
                />
              </label>
            </div>
            <div className="mt-7 flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Choose your role</p>
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Select one</span>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2" role="radiogroup" aria-label="Choose your role">
              <button
                type="button"
                onClick={() => setSelectedRole('coach')}
                disabled={savingProfile}
                role="radio"
                aria-checked={selectedRole === 'coach'}
                className={`group relative border-2 p-6 text-left transition-all hover:-translate-y-1 hover:border-primary hover:shadow-lg disabled:cursor-wait disabled:opacity-60 clip-angled-sm ${selectedRole === 'coach' ? 'border-primary bg-primary/10 shadow-[0_0_0_4px_rgba(0,232,120,0.2)]' : 'border-border bg-background'}`}
                data-testid="button-role-coach"
              >
                <span className={`absolute right-4 top-4 inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest clip-angled-sm ${selectedRole === 'coach' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {selectedRole === 'coach' && <Check className="h-3 w-3" />} {selectedRole === 'coach' ? 'Selected' : 'Choose'}
                </span>
                <span className="grid h-14 w-14 place-items-center bg-primary text-primary-foreground clip-angled-sm">
                  <ShieldCheck className="h-7 w-7" />
                </span>
                <span className="mt-8 block font-display text-3xl uppercase tracking-wide">Coach</span>
                <span className="mt-3 block text-sm font-medium leading-relaxed text-muted-foreground">Build schedules, manage rosters, and prepare lineups for game day.</span>
                <span className="mt-6 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">Schedule + Roster <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedRole('fan')}
                disabled={savingProfile}
                role="radio"
                aria-checked={selectedRole === 'fan'}
                className={`group relative border-2 p-6 text-left transition-all hover:-translate-y-1 hover:border-primary hover:shadow-lg disabled:cursor-wait disabled:opacity-60 clip-angled-sm ${selectedRole === 'fan' ? 'border-primary bg-foreground text-background shadow-[0_0_0_4px_rgba(0,232,120,0.2)]' : 'border-white/15 bg-foreground text-background'}`}
                data-testid="button-role-fan"
              >
                <span className={`absolute right-4 top-4 inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest clip-angled-sm ${selectedRole === 'fan' ? 'bg-primary text-primary-foreground' : 'bg-white/10 text-white/60'}`}>
                  {selectedRole === 'fan' && <Check className="h-3 w-3" />} {selectedRole === 'fan' ? 'Selected' : 'Choose'}
                </span>
                <span className="grid h-14 w-14 place-items-center bg-primary text-primary-foreground clip-angled-sm">
                  <Star className="h-7 w-7" />
                </span>
                <span className="mt-8 block font-display text-3xl uppercase tracking-wide">Fan</span>
                <span className="mt-3 block text-sm font-medium leading-relaxed text-white/65">
                  Make hype cards and keep up with the team schedule.<br />
                  Celebrate your athlete.<br />
                  Keep friends and family in the loop.
                </span>
                <span className="mt-6 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">Hype Card + Schedule <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
              </button>
            </div>
             {selectedRole && (
               <div className="mt-7 border-l-4 border-primary bg-primary/10 px-4 py-3 clip-angled-sm">
                 <p className="text-xs font-bold uppercase tracking-widest text-primary">Full team account</p>
                 <p className="mt-1 text-sm font-medium leading-relaxed text-muted-foreground">
                   Your account includes cloud saves, publishing, roster tools, and connected calendars.
                 </p>
               </div>
             )}
             <button type="button" onClick={() => void saveProfile()} disabled={savingProfile} className="mt-6 w-full bg-primary px-5 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60 clip-angled-sm" data-testid="button-save-profile">
              {savingProfile ? 'Saving your playbook…' : 'Enter my Command Center'}
            </button>
            {error && <p className="mt-5 text-sm font-bold text-destructive" role="alert">{error}</p>}
          </section>
        </div>
      </main>
    </div>
  );
}

function StudioPortal() {
  const { user, isLoaded, isSignedIn } = useUser();

  return (
    <StudioRoleBoundary
      user={user}
      isLoaded={isLoaded}
      isSignedIn={Boolean(isSignedIn)}
      loading={<div className="grid min-h-dvh place-items-center bg-background text-sm font-bold uppercase tracking-widest text-muted-foreground">Loading your studio…</div>}
      signedOut={<Redirect to="/sign-in" />}
      roleSelection={<RoleSelectionPage />}
      supporter={<SupporterStudio />}
      coach={<Studio role="coach" />}
    />
  );
}

function LockedAccountPage({ deletionEligibleAt, expired }: { deletionEligibleAt: string | Date | null; expired: boolean }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const reactivate = useReactivateAccount();
  const recoveryDate = deletionEligibleAt ? new Date(deletionEligibleAt) : null;
   const upgradeUrl = import.meta.env.VITE_BILLING_UPGRADE_URL
     ?? 'mailto:hello@pixlsports.com?subject=Pixl%20Sports%20upgrade';

  return (
    <div className="noise min-h-dvh bg-background">
      <SiteNav dark />
      <main className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-5xl items-center px-5 py-12 sm:px-8">
        <section className="relative w-full overflow-hidden border-l-4 border-primary bg-foreground p-7 text-white clip-angled-sm sm:p-10" data-testid="locked-account-page">
          <div className="absolute inset-0 bg-tech-grid-dark opacity-30" />
          <div className="relative z-10 max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">{expired ? 'Recovery window ended' : 'Account locked'}</p>
            <h1 className="mt-4 font-display text-5xl uppercase leading-[0.9] tracking-tight sm:text-7xl">
              YOUR STUDIO IS<br /><span className="text-primary">ON HOLD.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base font-medium leading-relaxed text-white/70 sm:text-lg">
              {expired
                 ? 'Your 90-day recovery window has ended. Pixl Sports data is queued for permanent deletion and cannot be restored.'
                : `Your projects, team settings, and account role are preserved. Reactivate before ${recoveryDate?.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) ?? 'the recovery deadline'} to return to the studio.`}
            </p>
            {!expired && (
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={reactivate.isPending}
                  onClick={() => {
                    reactivate.mutate(undefined, {
                      onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: getGetAccountLifecycleQueryKey() });
                        queryClient.invalidateQueries({ queryKey: getGetAccountAccessQueryKey() });
                        setLocation('/studio');
                      },
                    });
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-primary px-6 py-4 text-sm font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-60 clip-angled-sm"
                  data-testid="button-reactivate-account"
                >
                  {reactivate.isPending ? 'Reactivating…' : 'Reactivate account'} <ArrowRight className="h-4 w-4" />
                </button>
                <a
                  href={upgradeUrl}
                  target={upgradeUrl.startsWith('http') ? '_blank' : undefined}
                  rel={upgradeUrl.startsWith('http') ? 'noreferrer' : undefined}
                  className="border border-white/20 bg-white/5 px-6 py-4 text-sm font-bold uppercase tracking-widest text-white transition-colors hover:bg-white/10 clip-angled-sm"
                  data-testid="button-review-upgrade"
                >
                  Upgrade your account
                </a>
              </div>
            )}
            {reactivate.isError && (
              <p className="mt-5 text-sm font-bold text-primary" role="status">
                Reactivation failed. Refresh and try again.
              </p>
            )}
            <p className="mt-8 text-xs font-bold uppercase tracking-widest text-white/45">Authentication remains available so you can sign out or return during recovery.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

function AccountLifecycleGate({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isLoaded, isSignedIn } = useUser();
  const bypassLifecycle = location.startsWith('/schedule/') || location.startsWith('/watch/') || location.startsWith('/h/') || location.startsWith('/sign-in') || location.startsWith('/sign-up');
  const { data: lifecycle, isLoading } = useGetAccountLifecycle({
    query: {
      enabled: Boolean(isLoaded && isSignedIn && !bypassLifecycle),
      staleTime: 0,
      refetchOnMount: 'always',
      queryKey: getGetAccountLifecycleQueryKey(),
    },
  });

  if (!isLoaded || (isSignedIn && !bypassLifecycle && isLoading)) {
    return <div className="grid min-h-dvh place-items-center bg-background text-sm font-bold uppercase tracking-widest text-muted-foreground">Checking account access…</div>;
  }
  if (isSignedIn && !bypassLifecycle && lifecycle && lifecycle.status !== 'active') {
    return <LockedAccountPage deletionEligibleAt={lifecycle.deletionEligibleAt} expired={lifecycle.expired} />;
  }
  return <>{children}</>;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/studio" />
      </Show>
      <Show when="signed-out">
        <HomePage />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "ENTER THE ARENA",
            subtitle: "Sign in to access your cloud drafts",
          },
        },
        signUp: {
          start: {
            title: "JOIN THE ROSTER",
            subtitle: "Create an account to save drafts in the cloud",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <AccountLifecycleGate>
            <ErrorBoundary resetKey={useLocation()[0]}>
              <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/schedule/:shareToken" component={PublicSchedulePage} />
               <Route path="/h/:shareToken" component={PublicHypeCardPage} />
               <Route path="/watch/:slug/:shareToken" component={PublicHypeCardPage} />
              <Route path="/studio/profile" component={SupporterProfilePage} />
              <Route path="/studio" component={StudioPortal} />
              <Route path="/studio/hype-card"><ProtectedEditor kind="hype"><HypeCardEditor /></ProtectedEditor></Route>
              <Route path="/studio/hype-card/:id"><ProtectedEditor kind="hype"><HypeCardEditor /></ProtectedEditor></Route>
              <Route path="/studio/schedule/:id?"><ProtectedEditor kind="schedule"><EditorPage kind="schedule" /></ProtectedEditor></Route>
              <Route path="/studio/roster/:id?"><ProtectedEditor kind="roster"><RosterEditor /></ProtectedEditor></Route>
              <Route path="/help" component={Help} />
              <Route path="/privacy" component={Privacy} />
              <Route component={NotFound} />
              </Switch>
            </ErrorBoundary>
          </AccountLifecycleGate>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
      <Toaster />
    </WouterRouter>
  );
}
