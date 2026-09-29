import {
  useCreateScheduleShare,
  useDeleteScheduleShare,
  listOwnedGameOnCards,
  getListOwnedGameOnCardsQueryKey,
  useCreateProject,
  useGetProject,
  getGetProjectQueryKey,
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
  usePauseAccount,
  useResumeAccount,
  useReactivateAccount,
  getGetAccountLifecycleQueryKey,
  getGetSupporterPhotoQueryKey,
  useRequestSupporterPhotoUploadUrl,
  useSaveSupporterPhoto,
  useCreateChecklistShare,
  useDeleteChecklistShare,
} from '@workspace/api-client-react';
import { Trash2 } from 'lucide-react';
import { lazy, Suspense, type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';

import { ErrorBoundary } from '@/components/error-boundary';
import { AccountLoadingScreen } from '@/features/account-loading-screen';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Bell, CalendarDays, Check, Clipboard, ClipboardCheck,
  ChevronDown, ChevronUp, CircleHelp, CupSoda, FileImage, Grid2X2,
  Heart, Lightbulb, Menu, MessageCircleQuestion, Minus,
  MapPin, NotebookPen, Palette, Plus, RotateCcw, Save, Share2, CloudUpload, ShieldCheck, Sparkles,
  SquarePen, X, Zap, Maximize, Activity, Link2Off, UsersRound, GripVertical,
  Download, Star, Link2
} from 'lucide-react';
import { Utensils } from 'lucide-react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter, Redirect } from 'wouter';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  SupporterEvent,
  SupporterProfile,
} from '@/features/supporter-dashboard';
import { navigateToGameOnSection } from '@/features/game-on-navigation';
import {
  createScheduleAutosaveQueue,
  getCloudScheduleProjects,
  getCloudScheduleProjectForIdentity,
  getLatestCloudScheduleProject,
  getScheduleIdentity,
  moveScheduleEvent,
  normalizeScheduleDraft,
  readScheduleDraft,
  saveScheduleEvent,
  removeScheduleEvent,
  saveScheduleDraft,
  updateScheduleEvent,
  updateScheduleEventStatus,
  type ScheduleEvent,
  type ScheduleEventType,
  clearRetiredStandaloneScheduleStorage,
  clearPendingScheduleSync,
  hasPendingScheduleSync,
  markPendingScheduleSync,
} from '@/features/schedule-draft';
import { revokeGameOnCardForScheduleEvent } from '@/features/game-on-card-storage';
import { getGuestUsageKey } from '@/features/guest-access';
import {
  getScheduleInstallInstructions,
} from '@/features/schedule-install';
import { useAppInstallPrompt } from '@/features/app-install-prompt';
import {
  updateSupporterPhotoCache,
  useCachedSupporterPhoto,
} from '@/features/supporter-photo-cache';
import { trackEvent } from '@/lib/analytics';
import { LANDING_MEDIA_BADGE, LANDING_MEDIA_DETAIL, LOCAL_MEDIA_DEFAULT, PUBLIC_SHARE_MEDIA } from '@/features/privacy-copy';
import {
  cleanSupporterProfile,
  createSupporterProfileSavePlan,
  getUserProfile,
  getUserRole,
  isSupporterSetupComplete,
  supporterProfileFromUser,
  type AccessMode,
  type UserRole,
} from '@/features/supporter-dashboard-model';
import {
  clearPrivateOfflineAccountData,
  readOfflineDashboardSnapshot,
  updateOfflineDashboardSnapshot,
} from '@/features/offline-dashboard-cache';
import {
  buildWorkspaceToolHref,
  readWorkspaceEventContext,
  saveWorkspaceEventContext,
} from '@/features/workspace-context';
import { roleSignupHref, roleToolKinds, type ToolKind } from '@/features/landing-role-flow';
import { StudioRoleBoundary } from '@/features/studio-role-boundary';
import { getDashboardTourState, tourStateAfterSetup } from '@/features/supporter-dashboard-tour-state';
import {
  completedChecklistCount,
  applyChecklistEventType,
  createGamedayChecklist,
  readEventChecklist,
  gamedayChecklistStorageKey,
  getChecklistEventCopy,
  getChecklistCompletionFeedback,
  getChecklistResetConfirmation,
  resetGamedayChecklist,
  saveGamedayChecklist,
  type GamedayChecklistItem,
  type ChecklistEventType,
  type LocalGamedayChecklist,
} from '@/features/gameday-checklist';
import { readChecklistForEvent, useChecklistSave, type ChecklistSyncStatus } from '@/features/use-checklist-save';
import MeetingCapture from '@/features/meeting-capture';
import heroBanner from '@/assets/hero-banner.webp';
import footballFieldAsset from '@/assets/football-field.svg';
import hypeCardFootballTemplate from '@/assets/hype-card-football-template.png';
import hypecardPlayerPhoto from '@/assets/hypecard-player-photo.png';
import hypeCardRecipientPreview from '@/assets/hype-card-recipient-preview.png';
import hypecardPlayerPhoto320 from '@/assets/hypecard-player-photo-320.webp';
import hypecardPlayerPhoto640 from '@/assets/hypecard-player-photo-640.webp';
import hypecardPlayerPhoto1024 from '@/assets/hypecard-player-photo-1024.webp';
import statTrackerLive from '@/assets/stat-tracker-live.png';
import statTrackerLive480 from '@/assets/stat-tracker-live-480.webp';
import statTrackerLive768 from '@/assets/stat-tracker-live-768.webp';
import statTrackerLive974 from '@/assets/stat-tracker-live-974.webp';
import statTrackerTapStat from '@/assets/stat-tracker-tap-stat.png';
import statTrackerTapStat480 from '@/assets/stat-tracker-tap-stat-480.webp';
import statTrackerTapStat768 from '@/assets/stat-tracker-tap-stat-768.webp';
import statTrackerTapStat1248 from '@/assets/stat-tracker-tap-stat-1248.webp';
import gameDayChecklist from '@/assets/game-day-checklist.png';
import gameDayChecklist480 from '@/assets/game-day-checklist-480.webp';
import gameDayChecklist768 from '@/assets/game-day-checklist-768.webp';
import gameDayChecklist1404 from '@/assets/game-day-checklist-1404.webp';
import './landing-unified.css';
import './auth-page.css';

const PublicLandingPage = lazy(() =>
  import('@/features/landing-home').then(({ PublicLandingPage }) => ({ default: PublicLandingPage })),
);
const HypeCardReplyInboxTrigger = lazy(() =>
  import('@/features/hype-card-reply-inbox').then(({ HypeCardReplyInboxTrigger }) => ({ default: HypeCardReplyInboxTrigger })),
);
const AthleteInviteManager = lazy(() =>
  import('@/features/athlete-invite').then(({ AthleteInviteManager }) => ({ default: AthleteInviteManager })),
);
const PublicAthleteInvitePage = lazy(() =>
  import('@/features/athlete-invite').then(({ PublicAthleteInvitePage }) => ({ default: PublicAthleteInvitePage })),
);
const LivingAthleteCardPage = lazy(() =>
  import('@/features/living-athlete-card').then(({ LivingAthleteCardPage }) => ({ default: LivingAthleteCardPage })),
);
const FanCardActions = lazy(() =>
  import('@/features/fan-card-follow').then(({ FanCardActions }) => ({ default: FanCardActions })),
);
function LivingAthleteCardRoute({ params }: { params: { inviteToken?: string } }) {
  return <LivingAthleteCardPage params={params} followControls={<FanCardActions inviteToken={params.inviteToken ?? ''} />} />;
}
function LegacyAthleteInviteRedirect({ params }: { params: { inviteToken?: string } }) {
  return <Redirect to={`/fan/${encodeURIComponent(params.inviteToken ?? '')}`} />;
}
const OwnerAthleteInviteManagePage = lazy(() =>
  import('@/features/athlete-invite').then(({ OwnerAthleteInviteManagePage }) => ({ default: OwnerAthleteInviteManagePage })),
);
const PublicHypeCardPage = lazy(() =>
  import('@/features/public-hype-card').then(({ PublicHypeCardPage }) => ({ default: PublicHypeCardPage })),
);
const PublicMeetingRecapPage = lazy(() =>
  import('@/features/public-meeting-recap').then(({ PublicMeetingRecapPage }) => ({ default: PublicMeetingRecapPage })),
);
const StatTrackerPage = lazy(() =>
  import('@/features/stat-tracker-page').then(({ StatTrackerPage }) => ({ default: StatTrackerPage })),
);
const SeasonStatsPage = lazy(() =>
  import('@/features/season-stats-page').then(({ SeasonStatsPage }) => ({ default: SeasonStatsPage })),
);
const PublicStatTrackerPage = lazy(() =>
  import('@/features/stat-tracker-spectator').then(({ PublicStatTrackerPage }) => ({ default: PublicStatTrackerPage })),
);
const PublicGameOnCardPage = lazy(() =>
  import('@/features/game-on-card').then(({ PublicGameOnCardPage }) => ({ default: PublicGameOnCardPage })),
);
const SupporterDashboardView = lazy(() =>
  import('@/features/supporter-dashboard').then(({ SupporterDashboardView }) => ({ default: SupporterDashboardView })),
);
const SupporterProfileView = lazy(() =>
  import('@/features/supporter-dashboard').then(({ SupporterProfileView }) => ({ default: SupporterProfileView })),
);

 const queryClient = new QueryClient();

 type CloudProjectPayload = Record<string, unknown>;

function isCloudToolProject(value: unknown, tool: 'schedule'): value is CloudProjectPayload {
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
    slug: 'athlete-page',
    label: 'HYPE Card',
    kicker: 'One story. One HYPE Card link.',
    description: 'Create and manage the athlete’s evolving HYPE Card, then share it with family and friends.',
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
  'stat-tracker': {
    slug: 'stat-tracker',
    label: 'Stat Tracker',
    kicker: 'Keep the game moving.',
    description: 'Tap live plays, finish the game, and build a season total for your athlete.',
    icon: Activity,
    accent: 'bg-primary text-primary-foreground',
    soft: 'bg-[#1d2a25] text-white',
    templateNames: [],
  },
  checklist: {
    slug: 'checklist',
    label: 'Gameday Checklist',
    kicker: 'Be ready before first whistle.',
    description: 'Keep uniforms, equipment, timing, lineup, and schedule details in one shared checklist.',
    icon: ClipboardCheck,
    accent: 'bg-primary text-primary-foreground',
    soft: 'bg-[#28352f] text-white',
    templateNames: [],
  },
};

type ResponsiveLandingImageProps = {
  alt: string;
  className: string;
  fallback: string;
  sizes: string;
  srcSet: string;
  width: number;
  height: number;
};

function ResponsiveLandingImage({
  alt,
  className,
  fallback,
  sizes,
  srcSet,
  width,
  height,
}: ResponsiveLandingImageProps) {
  return (
    <picture className="contents">
      <source type="image/webp" srcSet={srcSet} sizes={sizes} />
      <img
        src={fallback}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className={className}
      />
    </picture>
  );
}

type LandingJourneyStep = {
  icon: typeof CalendarDays;
  title: string;
  body: string;
  label: string;
  hub: string;
  notification: string;
  notificationMeta: string;
};

type LandingRoleCopy = {
  eyebrow: string;
  headline: string;
  accent: string;
  description: string;
  cta: string;
  previewLabel: string;
  previewTitle: string;
  previewMetric: string;
  previewAccent: string;
  previewItems: [string, string, string][];
  hubGreeting: string;
  hubDescription: string;
  journey: LandingJourneyStep[];
};

const landingRoleCopy: Record<string, LandingRoleCopy> = {
  fan: {
    eyebrow: 'Fan playbook',
    headline: 'Celebrate the play.',
    accent: 'Follow the season.',
    description: 'Keep the schedule close, track the game, and make the moment everyone wants to share.',
    cta: 'Build my fan workspace',
    previewLabel: 'Fan game day',
    previewTitle: 'Maya / 12U',
    previewMetric: '4 plays',
    previewAccent: 'to celebrate.',
    previewItems: [
      ['HYPE CARD', 'Moment ready to share', 'SHARE'],
      ['SCHEDULE', 'Next game / Saturday', '4:30 PM'],
      ['STAT TRACKER', 'Season totals building', 'LIVE'],
    ],
    hubGreeting: 'Welcome back, Maya.',
    hubDescription: 'Your Game Day Hub keeps the next game, live stats, and best moments together.',
    journey: [
      {
        icon: CalendarDays,
        title: '01 / Follow the week',
        body: 'Keep practices, games, and the next place to be in view.',
        label: 'Schedule maker',
        hub: 'Next up: Falcons vs Northside.',
        notification: 'Game added to your week',
        notificationMeta: 'Saturday · 4:30 PM',
      },
      {
        icon: Activity,
        title: '02 / Track the game',
        body: 'Tap live plays and build a season total for your athlete.',
        label: 'Stat tracker',
        hub: 'Maya is at bat. Follow the live line.',
        notification: 'Game update',
        notificationMeta: 'Maya · 2 hits · 1 RBI',
      },
      {
        icon: Zap,
        title: '03 / Catch the moment',
        body: 'Turn a photo or short video into the post the group chat wants.',
        label: 'Hype card creator',
        hub: 'Your best moment is ready to share.',
        notification: 'Your Hype Card is ready',
        notificationMeta: 'Maya · Slugger template',
      },
      {
        icon: Share2,
        title: '04 / Send it around',
        body: 'Export a polished graphic and keep friends and family in the loop.',
        label: 'Ready to share',
        hub: 'The season story keeps building.',
        notification: 'Moment shared',
        notificationMeta: 'Send it to your family group',
      },
    ],
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


function SiteNav({ dark = true }: { dark?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navText = dark ? 'text-white/70 hover:text-accent' : 'text-muted-foreground hover:text-accent';
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  return (
    <header className={`relative z-30 border-b ${dark ? 'bg-[#0B1F3A]/95 border-white/15 backdrop-blur-md' : 'bg-background border-border'}`}>
      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="shrink-0 transition-opacity hover:opacity-80 focus-visible:opacity-80" data-testid="link-logo-home">
          <BrandMark inverse={dark} />
        </Link>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
          <Link href="/studio" className={`text-sm font-bold uppercase tracking-wider transition-colors ${navText}`} data-testid="link-nav-studio">Studio</Link>

          {isSignedIn ? (
            <div className="flex items-center gap-4">
              <span className={`text-sm font-bold tracking-wider ${dark ? 'text-white/50' : 'text-muted-foreground'}`}>{user?.primaryEmailAddress?.emailAddress}</span>
              <button onClick={() => signOut({ redirectUrl: basePath || "/" })} className={`group flex items-center gap-2 clip-angled-sm px-5 py-2.5 text-sm font-bold uppercase tracking-wider transition-all hover:bg-destructive hover:text-destructive-foreground ${dark ? 'bg-white/10 text-white' : 'bg-muted text-foreground'}`} data-testid="btn-sign-out">
                Sign Out
              </button>
            </div>
          ) : (
            <Link href="/sign-in" className={`group flex items-center gap-2 clip-angled-sm px-5 py-2.5 text-sm font-bold uppercase tracking-wider transition-all hover:bg-primary/90 ${dark ? 'bg-primary text-primary-foreground' : 'bg-card text-card-foreground'}`} data-testid="link-nav-sign-in">
              Sign In <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          )}
        </nav>
        <button type="button" className={`grid h-10 w-10 place-items-center md:hidden ${dark ? 'text-white' : 'text-foreground'}`} onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} data-testid="button-mobile-menu">
          {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {menuOpen && (
        <div className={`absolute inset-x-0 top-[72px] border-b p-5 shadow-2xl md:hidden clip-angled-sm ${dark ? 'border-white/10 bg-[#0B1F3A]' : 'border-border bg-card'}`} data-testid="menu-mobile">
          <nav className="flex flex-col gap-2">
            <Link href="/studio" className={`flex items-center justify-between p-4 text-lg font-display tracking-wide ${dark ? 'text-white bg-white/5' : 'text-foreground bg-muted'}`} onClick={() => setMenuOpen(false)} data-testid="link-mobile-studio">STUDIO <ArrowRight className="h-5 w-5 text-primary" /></Link>
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
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4 sm:px-8 bg-background/80 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-4">
          <BrandMark />
          <p className="text-xs font-medium leading-relaxed text-muted-foreground">HYPE Cards, game-day tools, and stats <span className="mx-1 text-accent">·</span> Built for your team account.</p>
        </div>
        <div className="flex shrink-0 items-center gap-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Link href="/help" className="transition-colors hover:text-foreground" data-testid="link-footer-help">Help / FAQ</Link>
          <Link href="/privacy" className="transition-colors hover:text-foreground" data-testid="link-footer-privacy">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}

function LegacyHomePage() {
  const [selectedRole, setSelectedRole] = useState<UserRole>('fan');
  const [selectedWeekStep, setSelectedWeekStep] = useState(0);
  const roleCopy = landingRoleCopy[selectedRole];
  const heroCtaHref = roleSignupHref(selectedRole);
  const showcaseTools: ToolKind[] = roleToolKinds[selectedRole];
  const journey = roleCopy.journey;
  const selectedJourneyStep = journey[selectedWeekStep] ?? journey[0];

  return (
    <div className="noise home-shell min-h-dvh overflow-hidden">
      <SiteNav dark />
      <main>
        {/* HERO — profile first, then the week. */}
        <section className="relative overflow-hidden bg-[#0B1F3A] text-[#F3F6FA] clip-angled pb-16 pt-12 sm:pb-24 sm:pt-20">
          <img
            src={heroBanner}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-45"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0B1F3A] via-[#0B1F3A]/90 to-[#0B1F3A]/50" />
          <div className="pointer-events-none absolute inset-0 home-hero-grid opacity-25" />
          <div className="pointer-events-none absolute inset-0 home-scanline opacity-20" />

          <div className="relative z-10 mx-auto grid max-w-[1400px] items-center gap-14 px-5 sm:px-8 lg:grid-cols-[1.02fr_.98fr] lg:gap-20">
            <div className="max-w-3xl">
              <div className="home-reveal inline-flex items-center gap-2 border border-accent/50 bg-accent/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-accent clip-angled-sm">
                <Activity className="h-4 w-4" /> Your season, in one place
              </div>
              <h1 className="home-reveal home-reveal-delay-1 home-display mt-7 text-[clamp(4.5rem,10.7vw,10rem)] leading-[0.82]" data-testid="text-landing-headline">
                <>{roleCopy.headline}<br /><span className="text-primary">{roleCopy.accent}</span><br />Game on.</>
              </h1>
              <p className="home-reveal home-reveal-delay-2 mt-8 max-w-xl text-base font-medium leading-relaxed text-[#F3F6FA]/72 sm:text-lg">
                {roleCopy.description}
              </p>
              <div className="home-reveal home-reveal-delay-3 mt-8" data-testid="landing-role-selector">
                 <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">Choose your home base</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row" role="radiogroup" aria-label="Choose a Pixl Sports path">
                  {(['fan'] as UserRole[]).map((role) => {
                    const isSelected = selectedRole === role;
                    const Icon = Heart;
                    return (
                      <button
                        key={role}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setSelectedRole(role)}
                        className={`group inline-flex items-center gap-3 border px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.14em] transition-colors clip-angled-sm ${isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-[#F3F6FA]/20 bg-[#F3F6FA]/5 text-[#F3F6FA]/70 hover:border-primary hover:text-primary'}`}
                        data-testid={`button-landing-role-${role}`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>Fan hub</span>
                        {isSelected && <Check className="ml-auto h-4 w-4" />}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="home-reveal home-reveal-delay-3 mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link href={heroCtaHref} className="group inline-flex items-center justify-center gap-3 bg-primary px-7 py-4 text-sm font-bold uppercase tracking-[0.12em] text-primary-foreground clip-angled-sm transition-transform hover:-translate-y-1" data-testid="link-hero-open-studio">
                  {roleCopy.cta} <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
                <a href="#week" className="group inline-flex items-center justify-center gap-2 px-3 py-4 text-sm font-bold uppercase tracking-[0.12em] text-[#F3F6FA]/70 transition-colors hover:text-primary" data-testid="link-hero-see-week">
                  See the weekly rhythm <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </a>
              </div>
              <div className="home-reveal home-reveal-delay-4 mt-12 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold uppercase tracking-[0.16em] text-[#F3F6FA]/45">
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> {LANDING_MEDIA_BADGE}</span>
                <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Made for real life</span>
              </div>
            </div>

            <div className="home-reveal home-reveal-delay-2 relative mx-auto w-full max-w-[530px]">
              <div className="home-float absolute -right-3 -top-7 z-20 hidden rotate-3 bg-primary px-4 py-3 text-primary-foreground home-lime-shadow sm:block border-b-4 border-accent">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em]">Next up</p>
                <p className="home-display mt-1 text-2xl">Saturday / 4:30</p>
              </div>
              <div className="relative overflow-hidden border border-[#F3F6FA]/20 bg-[#102B4D]/90 p-4 home-card-shadow clip-angled">
                <div className="flex items-center justify-between border-b border-[#F3F6FA]/15 pb-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center bg-primary text-primary-foreground clip-angled-sm border-b-2 border-accent"><Zap className="h-5 w-5" /></span>
                    <div>
                       <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">{roleCopy.previewLabel}</p>
                       <p className="home-display text-2xl">{roleCopy.previewTitle}</p>
                    </div>
                  </div>
                  <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_0_5px_hsl(var(--accent)/.14)]" />
                </div>
                <div className="relative mt-4 overflow-hidden bg-[#0E2542] p-5">
                  <div className="absolute right-0 top-0 h-28 w-28 bg-primary/10 [clip-path:polygon(100%_0,100%_100%,0_0)]" />
                  <div className="relative flex items-start justify-between">
                    <div>
                       <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#F3F6FA]/50">Your week</p>
                       <p className="home-display mt-2 text-5xl leading-none">{roleCopy.previewMetric}<br /><span className="text-primary">{roleCopy.previewAccent}</span></p>
                    </div>
                    <div className="text-right text-[10px] font-bold uppercase tracking-[0.16em] text-[#F3F6FA]/45">
                      <p>Eastside Falcons</p>
                      <p className="mt-2 text-accent">Fall / 2024</p>
                    </div>
                  </div>
                  <div className="mt-7 space-y-2">
                     {roleCopy.previewItems.map(([day, title, time], index) => (
                       <div key={day} className={`flex items-center gap-3 border-t border-[#F3F6FA]/10 py-3 ${index === 2 ? 'text-primary' : 'text-[#F3F6FA]/72'}`} data-testid={`text-profile-week-${index + 1}`}>
                         <span className="w-9 text-[10px] font-bold tracking-[0.16em]">{day}</span>
                         <span className="flex-1 text-sm font-semibold">{title}</span>
                         <span className="text-xs font-bold tracking-[0.08em]">{time}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-[#F3F6FA]/42">
                  <span className="inline-flex items-center gap-2"><Share2 className="h-3.5 w-3.5" /> Ready to share</span>
                  <span>Updated just now</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SIGNAL STRIP */}
        <section className="overflow-hidden border-b border-border bg-primary text-primary-foreground">
          <div className="home-marquee flex w-max items-center gap-8 py-3 text-xs font-bold uppercase tracking-[0.22em]" aria-label="Pixl Sports features">
            <span>Profile first</span><span className="text-primary-foreground/40">/</span><span>Week ready</span><span className="text-primary-foreground/40">/</span><span>Game-day clear</span><span className="text-primary-foreground/40">/</span><span>Share the good stuff</span><span className="text-primary-foreground/40">/</span>
            <span>Profile first</span><span className="text-primary-foreground/40">/</span><span>Week ready</span><span className="text-primary-foreground/40">/</span><span>Game-day clear</span><span className="text-primary-foreground/40">/</span><span>Share the good stuff</span>
          </div>
        </section>

        {/* WEEKLY RHYTHM */}
        <section id="week" className="mx-auto max-w-[1400px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr] lg:gap-20">
            <div>
              <div className="inline-flex items-center gap-2 border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-accent clip-angled-sm">
                The weekly rhythm
              </div>
               <h2 className="home-display mt-6 text-6xl leading-[0.86] sm:text-8xl">
                 One hub.<br /><span className="text-accent">A better week.</span>
              </h2>
              <p className="mt-7 max-w-md text-base font-medium leading-relaxed text-muted-foreground">
                 Start with the moment you need most. Then follow the tools in order, with a clear place to land after every update.
              </p>
               <div className="mt-8 border border-border bg-card p-5 text-card-foreground clip-angled-sm" data-testid="card-landing-hub-welcome">
                 <div className="flex items-start justify-between gap-4">
                   <div>
                     <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">What your hub says hello with</p>
                     <p className="mt-3 font-display text-2xl uppercase tracking-wide">{roleCopy.hubGreeting}</p>
                   </div>
                   <span className="grid h-10 w-10 shrink-0 place-items-center bg-primary text-primary-foreground clip-angled-sm">
                     {selectedRole === 'fan' ? <Heart className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                   </span>
                 </div>
                 <p className="mt-3 max-w-md text-sm font-medium leading-relaxed text-white/60">{roleCopy.hubDescription}</p>
                 <div className="mt-5 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">
                   {showcaseTools.map((kind) => <span key={kind} className="border border-white/15 px-2.5 py-2">{toolData[kind].label.replace(' Creator', '')}</span>)}
                 </div>
               </div>
               <Link href={heroCtaHref} className="group mt-8 inline-flex items-center gap-3 text-sm font-bold uppercase tracking-[0.12em] text-foreground transition-colors hover:text-primary" data-testid="link-week-open-studio">
                 {roleCopy.cta} <ArrowUpRight className="h-5 w-5 transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" />
              </Link>
              <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                 <Link href={roleSignupHref('fan')} onClick={() => setSelectedRole('fan')} className="group border border-border bg-card p-4 transition-transform hover:-translate-y-1" data-testid="link-week-supporter-path">
                  <Heart className="h-5 w-5 text-accent" />
                  <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-accent">For families</p>
                  <p className="mt-2 text-sm font-bold leading-snug text-foreground">Follow an athlete and keep the whole week in view.</p>
                  <span className="mt-4 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors group-hover:text-accent">Follow an athlete <ArrowUpRight className="h-3.5 w-3.5" /></span>
                </Link>
              </div>
            </div>
             <div className="relative min-w-0" data-testid="week-path">
               <div className="week-path-track" role="tablist" aria-label="Your week path">
                 {journey.map((step, index) => {
                   const IconComponent = step.icon;
                   const isSelected = selectedWeekStep === index;
                   return (
                     <button
                       key={step.title}
                       type="button"
                       role="tab"
                       aria-selected={isSelected}
                       aria-controls={`week-path-panel-${index + 1}`}
                       onClick={() => setSelectedWeekStep(index)}
                       className={`week-path-segment ${isSelected ? 'is-selected' : ''}`}
                       data-testid={`card-week-step-${index + 1}`}
                     >
                       <span className="week-path-segment-content">
                         <span className="week-path-step-circle">{String(index + 1).padStart(2, '0')}</span>
                         <span className="week-path-step-icon" aria-hidden="true"><IconComponent className="h-5 w-5" /></span>
                         <span className="week-path-step-title">{step.title}</span>
                         <span className="week-path-step-label">{step.label}</span>
                       </span>
                     </button>
                   );
                 })}
               </div>

               <div
                 id={`week-path-panel-${selectedWeekStep + 1}`}
                 className="week-path-detail"
                 role="tabpanel"
                 aria-label={`${selectedJourneyStep.title} details`}
                 data-testid={`week-path-panel-${selectedWeekStep + 1}`}
               >
                 <div className="flex items-start justify-between gap-4">
                   <div className="min-w-0">
                     <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">Step {String(selectedWeekStep + 1).padStart(2, '0')} / {selectedJourneyStep.label}</p>
                     <h3 className="mt-2 font-display text-3xl uppercase tracking-wide text-foreground">{selectedJourneyStep.title}</h3>
                     <p className="mt-3 max-w-xl text-sm font-medium leading-relaxed text-muted-foreground">{selectedJourneyStep.body}</p>
                   </div>
                   <span className="week-path-detail-icon" aria-hidden="true"><selectedJourneyStep.icon className="h-6 w-6" /></span>
                 </div>
                 <div className="mt-5 grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
                   <div className="bg-muted/60 px-3 py-3">
                     <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">In your hub</p>
                     <p className="mt-1 text-xs font-bold leading-relaxed text-foreground">{selectedJourneyStep.hub}</p>
                   </div>
                   <div className="flex items-start gap-3 border border-border bg-background px-3 py-3">
                     <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-card text-card-foreground">
                       <Bell className="h-3.5 w-3.5" />
                     </span>
                     <div className="min-w-0">
                       <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-accent">Phone notification</p>
                       <p className="mt-1 text-xs font-bold leading-relaxed text-foreground">{selectedJourneyStep.notification}</p>
                       <p className="mt-0.5 truncate text-[10px] font-medium text-muted-foreground">{selectedJourneyStep.notificationMeta}</p>
                     </div>
                   </div>
                 </div>
               </div>
             </div>
          </div>
        </section>

         {/* ROLE TOOL WALKTHROUGH */}
        <section id="tools" className="relative overflow-hidden bg-[#0B1F3A] py-20 text-[#F3F6FA] clip-angled sm:py-28">
          <div className="pointer-events-none absolute inset-0 home-hero-grid opacity-20" />
          <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div>
                 <div className="inline-flex items-center gap-2 border border-[#F3F6FA]/20 bg-[#F3F6FA]/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-primary clip-angled-sm" data-testid="text-walkthrough-role">{roleCopy.eyebrow}</div>
                 <h2 className="home-display mt-6 text-6xl leading-[0.86] sm:text-8xl">See your<br /><span className="text-primary">tools in action.</span></h2>
              </div>
               <p className="max-w-xs text-sm font-medium leading-relaxed text-[#F3F6FA]/55">This is what your Fan Hub looks like, one tool at a time.</p>
            </div>

             <div className="mt-14 grid gap-4 md:grid-cols-2" data-testid="section-role-tool-walkthrough">
               {showcaseTools.map((kind, index) => (
                 <ToolWalkthroughCard key={kind} kind={kind} step={index + 1} role={selectedRole} />
               ))}
             </div>
          </div>
        </section>

        {/* LOCAL-FIRST PROMISE */}
        <section className="mx-auto grid max-w-[1400px] gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
          <div className="relative overflow-hidden bg-primary p-7 text-primary-foreground home-lime-shadow clip-angled sm:p-10">
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full border-[18px] border-primary-foreground/15" />
            <Heart className="relative h-9 w-9" />
            <p className="home-display relative mt-12 text-5xl leading-[0.88]">The good stuff<br />stays yours.</p>
            <p className="relative mt-6 max-w-sm text-sm font-semibold leading-relaxed text-primary-foreground/72">{LOCAL_MEDIA_DEFAULT} {PUBLIC_SHARE_MEDIA}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Built for the in-between moments</p>
            <h2 className="home-display mt-5 text-6xl leading-[0.86] sm:text-8xl">Less admin.<br /><span className="text-accent">More living.</span></h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              <div className="border-t border-border pt-4">
                <SquarePen className="h-5 w-5 text-accent" />
                <p className="mt-4 text-sm font-bold">Fast enough between practice and pickup.</p>
              </div>
              <div className="border-t border-border pt-4">
                <MapPin className="h-5 w-5 text-accent" />
                <p className="mt-4 text-sm font-bold">Clear enough that nobody asks, “Where is it again?”</p>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-5 mb-12 overflow-hidden bg-card text-card-foreground clip-angled-tl sm:mx-8">
          <div className="relative mx-auto flex max-w-[1100px] flex-col items-start justify-between gap-10 px-6 py-16 sm:flex-row sm:items-end sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute inset-0 home-hero-grid opacity-10" />
            <div className="relative">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Your next good week starts here</p>
              <h2 className="home-display mt-5 max-w-2xl text-6xl leading-[0.84] sm:text-8xl">
                Give it<br /><span className="text-primary">a home.</span>
              </h2>
            </div>
             <Link href={heroCtaHref} className="group relative inline-flex shrink-0 items-center gap-3 bg-primary px-7 py-5 text-sm font-bold uppercase tracking-[0.12em] text-primary-foreground clip-angled-sm transition-transform hover:-translate-y-1" data-testid="link-bottom-open-studio">
               {roleCopy?.cta ?? 'Start with Pixl'} <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function HomePage() {
  const [selectedRole, setSelectedRole] = useState<UserRole>('fan');
  const [activeFanTool, setActiveFanTool] = useState<ToolKind>('checklist');
  const roleCopy = landingRoleCopy[selectedRole];
  const roleTools = roleToolKinds[selectedRole];
  const nextPreview = roleCopy.previewItems[1];
  const selectLandingRole = (role: UserRole) => {
    setSelectedRole(role);
    setActiveFanTool(roleToolKinds[role][0]);
  };

  return (
    <div className="pixl-landing noise min-h-dvh overflow-hidden">
      <SiteNav dark />
      <main className="pixl-landing-shell">
        <section className="pixl-landing-content" aria-label="Pixl Sports overview">
          <section className="pixl-landing-overview" aria-labelledby="landing-overview-heading">
            <div className="pixl-landing-grid-lines" aria-hidden="true" />
            <div className="pixl-landing-overview-top">
              <span className="pixl-landing-pill"><Activity /> Your season, in one place</span>
              <span className="pixl-landing-live"><span aria-hidden="true">●</span> LIVE STUDIO</span>
            </div>
            <div className="pixl-landing-overview-main">
              <div className="pixl-landing-hero-copy">
                <small>PIXL SPORTS / HOME BASE</small>
                  <h1 id="landing-overview-heading" data-testid="text-landing-headline">
                    We guide<br />the week.<br /><em><span className="pixl-landing-hero-line">You capture</span><br /><span className="pixl-landing-hero-line">the moments.</span></em>
                  </h1>
                <p>Pixl gives families a clear place to start, then puts the right tool in front of you.</p>
              </div>
              <aside className="pixl-landing-overview-context" aria-label="This week preview">
                <div className="pixl-landing-side-label">THIS WEEK <CalendarDays /></div>
                <div className="pixl-landing-week-event">
                  <small>NEXT UP · SATURDAY</small>
                  <h2>{nextPreview[1]}</h2>
                  <span><MapPin /> {nextPreview[2]}</span>
                </div>
                <Link href={roleSignupHref(selectedRole)} className="pixl-landing-open-schedule" data-testid="link-landing-open-studio">Enter fan hub <ArrowRight /></Link>
                <div className="pixl-landing-principle">
                  <small>THE PIXL PRINCIPLE</small>
                  <strong>Less chasing.<br />More cheering.</strong>
                  <span>FOR EVERY SIDELINE <Heart /></span>
                </div>
              </aside>
            </div>
            <div className="pixl-landing-role-row" data-testid="landing-role-selector">
              <div>
                <small>CHOOSE YOUR HOME BASE</small>
                <div className="pixl-landing-role-buttons" role="radiogroup" aria-label="Choose a Pixl Sports home base">
                  {(['fan'] as UserRole[]).map((role) => {
                    const isSelected = selectedRole === role;
                    const Icon = role === 'fan' ? Heart : ShieldCheck;
                    return (
                      <button key={role} type="button" role="radio" aria-checked={isSelected} className={isSelected ? 'is-selected' : ''} onClick={() => selectLandingRole(role)} data-testid={`button-landing-role-${role}`}>
                        <Icon /> Fan hub {isSelected && <Check />}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Link href={roleSignupHref(selectedRole)} className="pixl-landing-text-link" data-testid="link-hero-open-studio">
                Enter fan hub <ArrowRight />
              </Link>
            </div>
          </section>

        </section>

        <section className="pixl-landing-tools" aria-labelledby="landing-tools-heading">
          <div className="pixl-landing-tools-heading">
            <div>
              <small>FAN HUB / YOUR WEEK</small>
              <h2 id="landing-tools-heading">We guide the week. <em>{selectedRole === 'fan' ? 'You enjoy the moments.' : 'Lead the team.'}</em></h2>
            </div>
            <p>Move from Event Cards to game day to celebration with one clear next step at every turn.</p>
          </div>
          <div className="pixl-landing-tools-body">
            <div className="pixl-landing-tool-index">
              <div className="pixl-landing-tool-index-intro">
                <small>YOUR FAN TOOLKIT</small>
              </div>
              <div className="pixl-landing-tool-tabs" role="tablist" aria-label="Fan Hub tools">
                {roleTools.map((kind, index) => {
                  const isActive = activeFanTool === kind;
                  const Icon = toolData[kind].icon;
                  return (
                    <button
                      key={kind}
                      id={`landing-tool-tab-${kind}`}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`landing-tool-panel-${kind}`}
                      className={isActive ? 'is-selected' : ''}
                      onClick={() => setActiveFanTool(kind)}
                      data-testid={`tab-fan-tool-${kind}`}
                    >
                      <span className="pixl-landing-tool-number">0{index + 1}</span>
                      <span className="pixl-landing-tool-tab-copy">
                        <small>{toolData[kind].kicker}</small>
                        <strong>{toolData[kind].label.replace(' Creator', '')}</strong>
                      </span>
                      <Icon />
                      <span className="sr-only">Tool {index + 1}</span>
                    </button>
                  );
                })}
              </div>
              <p className="pixl-landing-tool-index-foot">Every tool keeps the next step clear.</p>
            </div>
            <div className="pixl-landing-tool-detail">
              <div className="pixl-landing-feature-label">
                <span>SELECTED TOOL</span>
                <strong>FAN HUB / {toolData[activeFanTool].label.replace(' Creator', '')}</strong>
              </div>
              <div id={`landing-tool-panel-${activeFanTool}`} role="tabpanel" aria-labelledby={`landing-tool-tab-${activeFanTool}`} data-testid={`panel-fan-tool-${activeFanTool}`}>
                <ToolWalkthroughCard kind={activeFanTool} step={Math.max(1, roleTools.indexOf(activeFanTool) + 1)} role={selectedRole} />
              </div>
            </div>
          </div>
        </section>

        <div className="pixl-landing-mobile-pulse" aria-label="Quick pulse">
          <small>QUICK PULSE</small>
          <span>● 3 THINGS MOVING</span>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function ToolFeatureCard({ kind, large = false }: { kind: ToolKind; large?: boolean }) {
  const tool = toolData[kind];
  const Icon = tool.icon;
  return (
    <Link href={`/studio/${tool.slug}`} className={`group relative overflow-hidden border border-border transition-all hover:border-foreground clip-angled-sm ${large ? 'min-h-[420px] bg-card text-card-foreground' : 'min-h-[200px] bg-card text-foreground'} p-6 sm:p-8 flex flex-col justify-between`} data-testid={`link-tool-${kind}`}>
      {large && <div className="absolute inset-0 bg-tech-grid-dark opacity-10" />}
      {!large && <div className="absolute inset-0 bg-tech-grid opacity-30" />}

      <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/20 blur-2xl transition-transform duration-700 group-hover:scale-150 group-hover:bg-primary/30" />

      <div className="relative flex items-start justify-between">
        <span className={`grid h-14 w-14 place-items-center clip-angled-sm ${large ? 'bg-primary text-primary-foreground' : 'bg-card text-card-foreground'}`}>
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

function ToolWalkthroughCard({ kind, step, role }: { kind: ToolKind; step: number; role: UserRole }) {
  const tool = toolData[kind];
  const Icon = tool.icon;
  const toolHref = `/studio/${tool.slug}`;
  const walkthroughCopy: Record<ToolKind, { what: string; next: string; steps: string[] }> = {
    schedule: {
      what: 'Turn the season plan into one event families can actually follow.',
      next: 'Add a game, practice, or place. Pixl turns the details into a clean calendar card.',
      steps: ['Add the event', 'Share the details', 'Keep the week current'],
    },
    checklist: {
      what: 'Replace the game-day group chat with one shared list of what needs to happen next.',
      next: 'Check off equipment, timing, lineup, and arrival details as the team gets ready.',
      steps: ['Set the essentials', 'Check items off', 'Arrive ready'],
    },
    'stat-tracker': {
      what: 'Capture the game as it happens, then keep the season total growing after the final play.',
      next: 'Tap a play, see the live line change, and finish with a simple game report.',
      steps: ['Tap live plays', 'Watch the line update', 'Build the season total'],
    },
    hype: {
      what: 'Turn a photo or short video into a polished moment card without leaving the sideline.',
      next: 'Choose the media, pick a look, attach optional season stats, and share the finished celebration with your people.',
      steps: ['Choose the moment', 'Attach season stats', 'Share the card'],
    },
  };
  const copy = walkthroughCopy[kind];

  return (
    <article className="group overflow-hidden border border-[#F3F6FA]/15 bg-[#F3F6FA]/5 clip-angled-sm" data-testid={`card-tool-walkthrough-${kind}`}>
      <div className="flex items-start justify-between gap-4 border-b border-[#F3F6FA]/10 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center bg-primary text-primary-foreground clip-angled-sm">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">0{step} / Fan Hub</p>
            <h3 className="mt-1 font-display text-3xl uppercase tracking-wide text-[#F3F6FA]">{tool.label.replace(' Creator', '')}</h3>
          </div>
        </div>
        <ArrowUpRight className="mt-1 h-5 w-5 text-[#F3F6FA]/40 transition-transform group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-primary" />
      </div>

      <div className="min-h-[250px] bg-[#0E2542] p-5 sm:p-6">
        <div className="mb-4 border-l-2 border-primary pl-3">
          <p className="text-sm font-semibold leading-relaxed text-white/85">{copy.what}</p>
          <p className="mt-1 text-xs leading-relaxed text-white/50">{copy.next}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {copy.steps.map((item, index) => (
              <span key={item} className="inline-flex items-center gap-1.5 border border-white/10 bg-white/[0.04] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-white/55">
                <span className="text-primary">0{index + 1}</span> {item}
              </span>
            ))}
          </div>
        </div>

        {kind === 'hype' && (
          <div className="grid grid-cols-2 items-start gap-2 sm:gap-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
            <div className="relative mx-auto min-w-0 aspect-[760/1036] w-full max-w-[250px] overflow-hidden border border-primary/40 bg-[#0E2542]">
              <img src={hypeCardFootballTemplate} alt="All Star Hype Card template" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute left-[16%] right-[16%] top-[24%] h-[57%] overflow-hidden">
                <img
                  src={footballFieldAsset}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#102d1e]/35 via-transparent to-[#102d1e]/20" />
                <ResponsiveLandingImage
                  fallback={hypecardPlayerPhoto}
                  srcSet={`${hypecardPlayerPhoto320} 320w, ${hypecardPlayerPhoto640} 640w, ${hypecardPlayerPhoto1024} 1024w`}
                  sizes="(min-width: 640px) 170px, 156px"
                  alt="Youth football player running with a football"
                  className="relative h-full w-full object-cover object-center"
                  width={1024}
                  height={1536}
                />
              </div>
            </div>
            <figure className="mx-auto min-w-0 w-full max-w-[190px] overflow-hidden border border-white/15 bg-[#0B1F3A]">
              <img
                src={hypeCardRecipientPreview}
                alt="Recipient view of a shared Hype Card with reactions and a reply box"
                className="h-auto w-full"
              />
              <figcaption className="border-t border-white/10 px-3 py-2 text-center text-[9px] font-bold uppercase tracking-wider text-white/55">
                Recipient view · add season stats
              </figcaption>
            </figure>
          </div>
        )}
        {kind === 'hype' && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              [FileImage, 'Choose media'],
              [Palette, 'Pick a look'],
              [Share2, 'Send it out'],
            ].map(([StepIcon, label]) => {
              const SmallIcon = StepIcon as typeof FileImage;
              return (
                <div key={label as string} className="border border-white/10 bg-white/[0.04] px-2 py-3 text-center">
                  <SmallIcon className="mx-auto h-4 w-4 text-primary" />
                  <p className="mt-2 text-[9px] font-bold uppercase tracking-wider text-white/55">{label as string}</p>
                </div>
              );
            })}
          </div>
        )}

        {kind === 'schedule' && (
          <div className="border border-primary/30 bg-[#F3F6FA] text-[#0B1F3A]">
            <div className="flex items-center justify-between border-b border-[#0B1F3A]/15 px-4 py-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#087a48]">Next event</span>
              <CalendarDays className="h-4 w-4 text-[#087a48]" />
            </div>
            <div className="grid grid-cols-[72px_1fr]">
              <div className="border-r border-[#0B1F3A]/15 bg-[#dfe6df] p-4 text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#087a48]">SAT</p>
                <p className="font-display text-4xl leading-none">14</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-widest">SEP</p>
              </div>
              <div className="p-4">
                <p className="font-display text-2xl uppercase leading-none">Falcons vs Northside</p>
                <p className="mt-3 text-xs font-semibold text-[#0B1F3A]/60">4:30 PM · Eastside Field</p>
                <div className="mt-4 inline-flex items-center gap-2 bg-[#0B1F3A] px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest text-white">
                  <MapPin className="h-3 w-3 text-primary" /> Game day
                </div>
              </div>
            </div>
          </div>
        )}

        {kind === 'stat-tracker' && (
          <div className="grid gap-3 md:grid-cols-2">
            <figure className="overflow-hidden border border-primary/30 bg-[#F3F6FA]">
              <div className="h-[180px] overflow-hidden sm:h-[220px]">
                <ResponsiveLandingImage
                  fallback={statTrackerLive}
                  srcSet={`${statTrackerLive480} 480w, ${statTrackerLive768} 768w, ${statTrackerLive974} 974w`}
                  sizes="(min-width: 768px) 50vw, calc(100vw - 3rem)"
                  alt="Stat Tracker live game score controls"
                  className="h-full w-full object-cover object-top"
                  width={974}
                  height={802}
                />
              </div>
              <figcaption className="border-t border-[#0B1F3A]/10 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-[#0B1F3A]/60">1 / Track the live game</figcaption>
            </figure>
            <figure className="overflow-hidden border border-primary/30 bg-[#F3F6FA]">
              <div className="h-[180px] overflow-hidden sm:h-[220px]">
                <ResponsiveLandingImage
                  fallback={statTrackerTapStat}
                  srcSet={`${statTrackerTapStat480} 480w, ${statTrackerTapStat768} 768w, ${statTrackerTapStat1248} 1248w`}
                  sizes="(min-width: 768px) 50vw, calc(100vw - 3rem)"
                  alt="Stat Tracker tap-a-stat detail screen"
                  className="h-full w-full object-cover object-top"
                  width={1248}
                  height={1110}
                />
              </div>
              <figcaption className="border-t border-[#0B1F3A]/10 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-[#0B1F3A]/60">2 / Tap a stat and build the report</figcaption>
            </figure>
          </div>
        )}

        {kind === 'checklist' && (
          <div className="relative aspect-[16/10] overflow-hidden border border-primary/30 bg-[#F3F6FA]">
            <ResponsiveLandingImage
              fallback={gameDayChecklist}
              srcSet={`${gameDayChecklist480} 480w, ${gameDayChecklist768} 768w, ${gameDayChecklist1404} 1404w`}
              sizes="(min-width: 1024px) 800px, calc(100vw - 3rem)"
              alt="Game Day checklist with saved game selection, equipment tasks, and team details"
              className="absolute inset-0 h-full w-full object-cover object-top"
              width={1404}
              height={1378}
            />
          </div>
        )}

      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[#F3F6FA]/10 px-5 py-4 sm:px-6">
        <p className="text-xs font-medium leading-relaxed text-[#F3F6FA]/55">
          {kind === 'hype' ? 'Turn a real moment into something worth sharing.' : tool.description}
        </p>
        <Link href={toolHref} className="inline-flex shrink-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-primary hover:text-white" data-testid={`link-walkthrough-${kind}`}>
          Try it <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

function StudioLayout({ children, role, landingBackground = false }: { children: ReactNode; role?: UserRole; landingBackground?: boolean }) {
  const [location] = useLocation();
  const { user } = useUser();
  const activeRole = role ?? getUserRole(user) ?? 'fan';
  const visibleTools = roleToolKinds[activeRole];
  const homeLabel = activeRole === 'fan' ? 'Supporter Hub' : 'Command Center';
  const isFanDashboard = activeRole === 'fan' && location === '/studio';
  const isChecklistPage = location === '/studio/checklist' || location.startsWith('/checklist/');
  const isEditorPage = location === '/studio/checklist'
    || location.startsWith('/checklist/')
    || location === '/studio/schedule'
    || location.startsWith('/studio/schedule/');
  return (
    <div className="noise min-h-dvh bg-background flex flex-col">
      <div className={isFanDashboard ? 'hidden lg:block' : undefined}>
        <SiteNav dark />
      </div>
      {!isChecklistPage && (
        <div className={isFanDashboard ? 'hidden lg:block border-b border-border bg-background bg-tech-grid' : 'border-b border-border bg-background bg-tech-grid'} data-testid="studio-tool-toolbar">
          <div className="mx-auto flex max-w-[1400px] items-center gap-8 overflow-x-auto px-5 sm:px-8 bg-background/90 backdrop-blur-sm no-scrollbar">
            <Link href="/studio" className={`shrink-0 border-b-4 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${location === '/studio' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid="link-studio-directory">{homeLabel}</Link>
            {visibleTools.map((key) => {
              const tool = toolData[key];
              return (
              <Link key={key} href={`/studio/${tool.slug}`} className={`shrink-0 border-b-4 py-4 text-sm font-bold uppercase tracking-widest transition-colors lg:hidden ${location.includes(tool.slug) ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid={`link-toolbar-${key}`}>
                {tool.label.replace(' Creator', '').replace(' Graphic Maker', '')}
              </Link>
              );
            })}
            {activeRole === 'fan' && (
              <>
                <Link href="/studio/athlete-page" className={`shrink-0 border-b-4 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${location === '/studio/athlete-page' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid="link-toolbar-athlete-page">
                  Athlete Page
                </Link>
                <Link href="/studio/profile" className={`shrink-0 border-b-4 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${location === '/studio/profile' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid="link-toolbar-profile">
                  My Athlete
                </Link>
              </>
            )}
          </div>
        </div>
      )}
      <div className={`studio-page-background flex-1 flex flex-col ${landingBackground ? 'landing-page-background' : ''} ${isFanDashboard ? 'supporter-dashboard-page-background' : ''} ${isEditorPage ? 'studio-editor-page-background' : ''}`}>
        {children}
      </div>
      <div className={isFanDashboard ? 'hidden lg:block' : undefined}>
        <Footer />
      </div>
    </div>
  );
}


function Studio({ role }: { role: UserRole }) {
  const { user, isSignedIn } = useUser();
  const profile = getUserProfile(user);
  const { data: accountAccess } = useGetAccountAccess({
    query: { enabled: Boolean(isSignedIn), staleTime: 15000, queryKey: getGetAccountAccessQueryKey() },
  });
  const isGuest = accountAccess?.accessMode === 'guest';

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
               SUPPORTER COMMAND<br /><span className="text-primary studio-textured-heading-accent">CENTER.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg font-medium leading-relaxed text-muted-foreground">
              Manage your athlete’s HYPE Card, game-day checklists, and stats in your Pixl Sports workspace.
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
               </div>
             </div>
           </div>
         )}

        <div className="relative mt-8 overflow-hidden border-l-4 border-primary bg-card bg-tech-grid-dark px-5 py-4 text-card-foreground clip-angled-sm" data-testid="banner-user-team">
          <div className="pointer-events-none absolute inset-0 bg-tech-grid-green opacity-30" />
          <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary">Supporting</p>
              <p className="mt-1 font-display text-2xl uppercase tracking-wide">{profile.teamName}</p>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <p className="text-sm font-bold uppercase tracking-wider text-white/65">{profile.displayName}</p>
              <HypeCardReplyInboxTrigger />
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {visibleTools.map((kind, index) => <ToolDirectoryCard key={kind} kind={kind} index={index} />)}
        </div>

      </main>
    </StudioLayout>
  );
}

function SupporterStudio() {
  const { user, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const profile = supporterProfileFromUser(user);
  const tourPending = getDashboardTourState(user?.unsafeMetadata) === 'pending';
  const athletePhoto = useCachedSupporterPhoto(user?.id, Boolean(isSignedIn));
  const cachedDashboard = user?.id
    ? readOfflineDashboardSnapshot(window.localStorage, user.id)
    : null;
  const accountAccessQuery = useGetAccountAccess({
    query: {
      enabled: Boolean(isSignedIn),
      staleTime: 15000,
      queryKey: getGetAccountAccessQueryKey(),
      initialData: cachedDashboard?.accountAccess,
    },
  });
  const accountAccess = accountAccessQuery.data;
  const cloudProjectsQuery = useListProjects({
    query: {
      enabled: Boolean(isSignedIn && accountAccess),
      queryKey: [...getListProjectsQueryKey(), user?.id],
      initialData: cachedDashboard?.projects,
    },
  });
  const [dashboardRefresh, setDashboardRefresh] = useState(0);
  void dashboardRefresh;
  const events: SupporterEvent[] = (cloudProjectsQuery.data ?? []).flatMap((project) => {
    if (!isCloudToolProject(project.project, 'schedule')) return [];
    const draft = normalizeScheduleDraft(project.project);
    if (!draft) return [];
    return draft.events.map((event): SupporterEvent => ({
      id: event.id,
      calendarProjectId: project.id,
      type: event.type,
      date: event.date,
      time: event.time,
      ...(event.timezone ? { timezone: event.timezone } : {}),
      ...(event.status ? { status: event.status } : {}),
      ...(event.completedAt ? { completedAt: event.completedAt } : {}),
      location: event.location,
      ...(event.opponent ? { opponent: event.opponent } : {}),
      ...(event.notes ? { notes: event.notes } : {}),
    }));
  });
  const [offline, setOffline] = useState(() => navigator.onLine === false);

  useEffect(() => {
    if (!user?.id || !accountAccessQuery.data || !cloudProjectsQuery.data) return;
    updateOfflineDashboardSnapshot(window.localStorage, user.id, {
      accountAccess: accountAccessQuery.data,
      projects: cloudProjectsQuery.data,
    });
  }, [user?.id, accountAccessQuery.data, cloudProjectsQuery.data]);
  useEffect(() => {
    const updateConnection = () => setOffline(navigator.onLine === false);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  return (
    <StudioLayout role="fan">
      <main className="flex-1 bg-background">
        {(offline || (cachedDashboard && (accountAccessQuery.isError || cloudProjectsQuery.isError))) && (
          <div className="border-b border-amber-400/40 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-950" role="status" data-testid="offline-dashboard-status">
            Offline mode — showing this device’s saved dashboard. Tracker, Calendar, and checklist work stays on this device until you reconnect. Sharing and uploads need a connection.
          </div>
        )}
        <SupporterDashboardView
          key={user?.id}
          profile={profile}
          userId={user?.id}
          autoStartTour={tourPending && Boolean(
            accountAccessQuery.isSuccess
            && cloudProjectsQuery.isSuccess
            && !cloudProjectsQuery.isFetching
          )}
          onTourDismiss={async () => {
            if (!user) throw new Error('Sign in to save your tour choice.');
            await user.updateMetadata({ unsafeMetadata: { ...(user.unsafeMetadata ?? {}), dashboardTour: 'done' } });
          }}
          events={events}
          onCompleteScheduledGame={async () => setDashboardRefresh((value) => value + 1)}
          selectionSyncReady={Boolean(
            !isSignedIn
            || (
              accountAccessQuery.isSuccess
              && cloudProjectsQuery.isSuccess
              && !cloudProjectsQuery.isFetching
            ),
          )}
           onSignOut={() => {
             if (user?.id) clearPrivateOfflineAccountData(window.localStorage, user.id);
             athletePhoto.clearLocalCache();
             return signOut({ redirectUrl: basePath || "/" });
           }}
           athletePhotoUrl={athletePhoto.imageUrl}
           athletePhotoCrop={athletePhoto.data ? { x: athletePhoto.data.cropX, y: athletePhoto.data.cropY, zoom: athletePhoto.data.cropZoom } : undefined}
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
  const athletePhoto = useCachedSupporterPhoto(user?.id, Boolean(isSignedIn));
  const photoBusy = requestPhotoUpload.isPending || savePhoto.isPending;
  const { data: lifecycle, isLoading: lifecycleLoading, isError: lifecycleError, refetch: refetchLifecycle } = useGetAccountLifecycle({
    query: {
      enabled: Boolean(isSignedIn && user?.id),
      queryKey: [...getGetAccountLifecycleQueryKey(), user?.id],
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: 'always',
    },
  });
  const pauseAccount = usePauseAccount();
  const cancelAccount = useCancelAccount();

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
    if (!cleanProfile.displayName || !cleanProfile.teamName || !cleanProfile.athleteName || !cleanProfile.seasonName) {
      setError('Add your name, team, athlete name, and season before saving.');
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
      const savedPhoto = await savePhoto.mutateAsync({ data: {
        objectPath: prepared.objectPath,
        cropX: pendingPhotoCrop.x,
        cropY: pendingPhotoCrop.y,
        cropZoom: pendingPhotoCrop.zoom,
      } });
      updateSupporterPhotoCache(queryClient, savedPhoto);
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
          userId={user?.id}
          saving={saving}
          error={error}
          onChange={(field, value) => {
            setError('');
            setProfile((current) => ({ ...current, [field]: value }));
          }}
          onSave={() => void saveProfile()}
          onCancel={() => setLocation('/studio')}
           athletePhotoUrl={athletePhoto.imageUrl}
           athletePhotoCrop={athletePhoto.data ? { x: athletePhoto.data.cropX, y: athletePhoto.data.cropY, zoom: athletePhoto.data.cropZoom } : undefined}
          pendingPhotoUrl={pendingPhoto?.url}
          pendingPhotoCrop={pendingPhotoCrop}
          photoBusy={photoBusy}
          photoError={photoError}
          onPhotoChange={choosePhoto}
          onPhotoCropChange={setPendingPhotoCrop}
          onPhotoUpload={() => void uploadPhoto()}
          onPhotoCancel={() => setPendingPhoto(null)}
          accountInformation={
            <>
              <section className="supporter-profile-account-section" aria-labelledby="account-info-heading" data-testid="account-information">
                <h2 id="account-info-heading" className="font-display text-3xl uppercase tracking-wide">Account information</h2>
                <dl className="mt-5 grid gap-5 sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Sign-in email</dt>
                    <dd className="mt-2 break-all text-sm font-semibold">{user.primaryEmailAddress?.emailAddress ?? 'No primary email available'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Subscriber plan</dt>
                    <dd className="mt-2 text-sm font-semibold" data-testid="account-plan">
                      {lifecycleLoading ? 'Loading plan…' : lifecycleError || !lifecycle ? 'Plan unavailable — retry below' : ({ free: 'Free', plus: 'Plus', pro: 'Pro' } as const)[lifecycle.planTier]}
                    </dd>
                  </div>
                </dl>
                {lifecycleError && <button type="button" onClick={() => void refetchLifecycle()} className="mt-4 text-sm font-bold text-primary underline">Retry account information</button>}
              </section>
              <section className="supporter-profile-danger mt-6 border-l-4 border-destructive bg-destructive/5 p-5 sm:p-6" aria-labelledby="account-danger-heading" data-testid="account-danger-zone">
                <p className="text-xs font-bold uppercase tracking-widest text-destructive">Account access</p>
                <h2 id="account-danger-heading" className="mt-2 font-display text-3xl uppercase tracking-wide">Danger zone</h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">These actions lock access to your studio immediately. Your sign-in remains available.</p>
                <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
                  <Dialog onOpenChange={() => pauseAccount.reset()}>
                    <DialogTrigger asChild>
                      <button type="button" disabled={!lifecycle || lifecycle.status !== 'active' || pauseAccount.isPending || cancelAccount.isPending} className="min-h-11 border border-foreground px-5 py-3 text-xs font-bold uppercase tracking-widest disabled:opacity-50" data-testid="button-open-pause-account">Pause account</button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle className="font-display text-3xl uppercase">Pause for 90 days?</DialogTitle>
                        <DialogDescription className="text-left leading-relaxed">
                          Your studio and shared content will be unavailable immediately. Your data is preserved, not queued for deletion. Access returns automatically after 90 days, or you can resume early. This does not pause any external billing.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter className="gap-2 sm:gap-0">
                        <DialogClose asChild><button type="button" disabled={pauseAccount.isPending} className="border border-border px-4 py-2.5 text-xs font-bold uppercase">Keep account active</button></DialogClose>
                        <button type="button" disabled={pauseAccount.isPending} onClick={() => pauseAccount.mutate(undefined, {
                          onSuccess: (result) => {
                            queryClient.setQueryData([...getGetAccountLifecycleQueryKey(), user.id], result);
                            queryClient.removeQueries({ queryKey: getListProjectsQueryKey() });
                            setLocation('/studio');
                          },
                        })} className="bg-foreground px-4 py-2.5 text-xs font-bold uppercase text-background disabled:opacity-50" data-testid="button-confirm-pause-account">{pauseAccount.isPending ? 'Pausing…' : 'Pause and lock'}</button>
                      </DialogFooter>
                      {pauseAccount.isError && <p role="alert" className="text-sm text-destructive">Pause failed. Please try again.</p>}
                    </DialogContent>
                  </Dialog>
                  <Dialog onOpenChange={() => cancelAccount.reset()}>
                    <DialogTrigger asChild>
                      <button type="button" disabled={!lifecycle || lifecycle.status !== 'active' || pauseAccount.isPending || cancelAccount.isPending} className="min-h-11 border border-destructive px-5 py-3 text-xs font-bold uppercase tracking-widest text-destructive disabled:opacity-50" data-testid="button-open-cancel-account">Cancel account</button>
                    </DialogTrigger>
                    <DialogContent className="border-destructive sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle className="font-display text-3xl uppercase">Cancel your account?</DialogTitle>
                        <DialogDescription className="text-left leading-relaxed">
                          Your studio and shared content lock immediately. Your data enters a 90-day recovery window and may be permanently deleted after {new Date(Date.now() + (lifecycle?.retentionDays ?? 90) * 86_400_000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} if you do not return. Signing in during recovery extends this window; you can reactivate before it expires. This does not cancel any external billing.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter className="gap-2 sm:gap-0">
                        <DialogClose asChild><button type="button" disabled={cancelAccount.isPending} className="border border-border px-4 py-2.5 text-xs font-bold uppercase">Keep account</button></DialogClose>
                        <button type="button" disabled={cancelAccount.isPending} onClick={() => cancelAccount.mutate(undefined, {
                          onSuccess: (result) => {
                            queryClient.setQueryData([...getGetAccountLifecycleQueryKey(), user.id], result);
                            queryClient.removeQueries({ queryKey: getListProjectsQueryKey() });
                            setLocation('/studio');
                          },
                        })} className="bg-destructive px-4 py-2.5 text-xs font-bold uppercase text-destructive-foreground disabled:opacity-50" data-testid="button-confirm-cancel-account">{cancelAccount.isPending ? 'Cancelling…' : 'Cancel and lock'}</button>
                      </DialogFooter>
                      {cancelAccount.isError && <p role="alert" className="text-sm text-destructive">Cancellation failed. Please try again.</p>}
                    </DialogContent>
                  </Dialog>
                </div>
              </section>
            </>
          }
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

function EditorPage({ kind }: { kind: ToolKind }) {
  if (kind === 'schedule') return <RetiredSchedulePage />;

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
            <button type="button" onClick={saveProject} className="inline-flex items-center gap-2 bg-card px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-card-foreground clip-angled-sm transition-transform hover:scale-105" data-testid="button-save-project">
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
                {['#00F776', '#111827', '#ffffff', '#2563eb'].map((color) => (
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

export function ScheduleEditor() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id?: string }>();
  const cloudProjectId = params.id;
  const { user, isSignedIn, isLoaded } = useUser();
  const profileTeamName = getUserProfile(user).teamName;
  const cachedDashboard = user?.id
    ? readOfflineDashboardSnapshot(window.localStorage, user.id)
    : null;
  const { data: accountAccess } = useGetAccountAccess({
    query: {
      enabled: Boolean(isSignedIn),
      staleTime: 15000,
      queryKey: getGetAccountAccessQueryKey(),
      initialData: cachedDashboard?.accountAccess,
    },
  });
  const consumeAccountUsage = useConsumeAccountUsage();
  const queryClient = useQueryClient();
  const [storedDraft] = useState(() => readScheduleDraft(window.localStorage, user?.id));
  const [pendingDeviceSync, setPendingDeviceSync] = useState(() => (
    Boolean(user?.id && hasPendingScheduleSync(window.localStorage, user.id))
  ));
  const [saved, setSaved] = useState(Boolean(storedDraft));
  const [saveStatus, setSaveStatus] = useState<'cloud' | 'device' | null>(
    storedDraft ? 'device' : null,
  );
  const [notice, setNotice] = useState('');
  const [teamName, setTeamName] = useState(storedDraft?.teamName || profileTeamName);
  const [season, setSeason] = useState(storedDraft?.season ?? '');
  const [events, setEvents] = useState<ScheduleEvent[]>(() => (
    storedDraft?.events ?? []
  ));
  const [selectedWeekKey, setSelectedWeekKey] = useState(
    () => getScheduleWeekKey(storedDraft?.events[0]?.date ?? ''),
  );
  const [selectedEventId, setSelectedEventId] = useState(
    () => {
      const requestedId = typeof window === 'undefined'
        ? ''
        : new URLSearchParams(window.location.search).get('eventId') ?? '';
      const storedId = typeof window === 'undefined'
        ? ''
        : readWorkspaceEventContext(window.localStorage)?.id ?? '';
      return storedDraft?.events.some((event) => event.id === requestedId)
        ? requestedId
        : storedDraft?.events.some((event) => event.id === storedId)
          ? storedId
          : storedDraft?.events[0]?.id ?? '';
    },
  );
  const [eventForm, setEventForm] = useState<ScheduleEvent | null>(null);
  const [removingEventId, setRemovingEventId] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState(storedDraft?.shareToken ?? '');
  const [shareUrl, setShareUrl] = useState(() => (
    storedDraft?.shareToken
      ? `${appOrigin}${basePath}/schedule/${storedDraft.shareToken}`
      : ''
  ));
  const [noticeTone, setNoticeTone] = useState<'success' | 'error'>('success');
  const cloudRevision = useRef(1);
  const initializedCloudId = useRef<string | null>(null);
  const autosaveQueue = useRef(createScheduleAutosaveQueue()).current;

  const createShare = useCreateScheduleShare();
  const updateShare = useUpdateScheduleShare();
  const deleteShare = useDeleteScheduleShare();
  const { data: cloudProjectData } = useGetProject(cloudProjectId ?? '', {
    query: {
      enabled: Boolean(cloudProjectId && isSignedIn),
      queryKey: getGetProjectQueryKey(cloudProjectId ?? ''),
      initialData: cachedDashboard?.projects?.find((project) => project.id === cloudProjectId),
    },
  });
  const { data: cloudProjects } = useListProjects({
    query: {
      enabled: Boolean(isSignedIn && accountAccess),
      queryKey: [...getListProjectsQueryKey(), user?.id],
      initialData: cachedDashboard?.projects,
    },
  });
  const createCloudProject = useCreateProject();
  const updateCloudProject = useUpdateProject();
  const cloudScheduleProjects = getCloudScheduleProjects(cloudProjects ?? []);
  const localDraftHasIdentity = Boolean(storedDraft && getScheduleIdentity(storedDraft));
  const latestCloudScheduleProject = localDraftHasIdentity
    ? getCloudScheduleProjectForIdentity(cloudProjects ?? [], storedDraft!)
    : getLatestCloudScheduleProject(cloudProjects ?? []);
  const selectedCloudProject = cloudProjectId
    ? (cloudProjectData && isCloudToolProject(cloudProjectData.project, 'schedule')
      ? cloudProjectData
      : null)
    : latestCloudScheduleProject;
  const currentScheduleIdentity = getScheduleIdentity({ teamName, season });
  const selectedCloudScheduleDraft = selectedCloudProject
    ? normalizeScheduleDraft(selectedCloudProject.project)
    : null;
  const selectedCloudIdentity = selectedCloudScheduleDraft
    ? getScheduleIdentity(selectedCloudScheduleDraft)
    : null;
  const cloudProjectForCurrentIdentity = currentScheduleIdentity
    ? getCloudScheduleProjectForIdentity(cloudScheduleProjects, { teamName, season })
    : null;
  const cloudProjectToSave = cloudProjectForCurrentIdentity
    ?? (selectedCloudProject && (!currentScheduleIdentity || currentScheduleIdentity === selectedCloudIdentity)
      ? selectedCloudProject
      : null);
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
    if (!profileTeamName) return;
    setTeamName((current) => current.trim() ? current : profileTeamName);
  }, [profileTeamName]);

  useEffect(() => {
    if (!selectedCloudProject || initializedCloudId.current === selectedCloudProject.id) return;
    const loadedDraft = normalizeScheduleDraft(selectedCloudProject.project);
    if (!loadedDraft) return;
    initializedCloudId.current = selectedCloudProject.id;
    cloudRevision.current = selectedCloudProject.revision;
    if (pendingDeviceSync && storedDraft) return;
    setTeamName(loadedDraft.teamName || profileTeamName);
    setSeason(loadedDraft.season);
    setEvents(loadedDraft.events);
    setShareToken(loadedDraft.shareToken ?? '');
    setShareUrl(loadedDraft.shareToken ? `${appOrigin}${basePath}/schedule/${loadedDraft.shareToken}` : '');
    const requestedId = new URLSearchParams(window.location.search).get('eventId') ?? '';
    const storedId = readWorkspaceEventContext(window.localStorage)?.id ?? '';
    const selectedEvent = loadedDraft.events.find((event) => event.id === requestedId)
      ?? loadedDraft.events.find((event) => event.id === storedId)
      ?? loadedDraft.events[0];
    setSelectedEventId(selectedEvent?.id ?? '');
    setSelectedWeekKey(getScheduleWeekKey(selectedEvent?.date ?? ''));
    setSaved(true);
  }, [selectedCloudProject, profileTeamName, pendingDeviceSync, storedDraft]);

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

  const setNoticeFor = (message: string, tone: 'success' | 'error' = 'success') => {
    setNoticeTone(tone);
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2400);
  };

  const updateEvent = (id: string, patch: Partial<ScheduleEvent>) => {
    setSaved(false);
    setSaveStatus(null);
    setEventForm((current) => (
      current?.id === id
        ? updateScheduleEvent([current], id, patch)[0]
        : current
    ));
  };

  const openEventForm = (event: ScheduleEvent) => {
    setSelectedEventId(event.id);
    saveWorkspaceEventContext(window.localStorage, event);
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
         setNoticeFor('WORKSPACE SCHEDULE LIMIT REACHED — USE YOUR EXISTING DRAFT OR CONTACT SUPPORT', 'error');
        return;
      }
    }
    const nextEvents = saveScheduleEvent(events, eventForm);
    setEvents(nextEvents);
    setSelectedEventId(eventForm.id);
    saveWorkspaceEventContext(window.localStorage, eventForm);
    setSelectedWeekKey(getScheduleWeekKey(eventForm.date));
    setEventForm(null);
    await persistSchedule(
      nextEvents,
      isNewEvent ? 'EVENT ADDED — SCHEDULE SAVED' : 'EVENT CHANGES SAVED',
    );
  };

  const removeEvent = async (id: string) => {
    setRemovingEventId(id);
    try {
      // A card made on another device is still public, even if it is absent from this browser's saved-card list.
      const linkedShareTokens = user?.id
        ? (await listOwnedGameOnCards())
          .filter((share) => share.events[0]?.id === id)
          .map((share) => share.shareToken)
        : [];
      const cardRevoked = await revokeGameOnCardForScheduleEvent({
        userId: user?.id,
        eventId: id,
        linkedShareTokens,
        revokeShare: (shareToken) => deleteShare.mutateAsync({ shareToken }),
      });
      if (cardRevoked) void queryClient.invalidateQueries({ queryKey: getListOwnedGameOnCardsQueryKey() });
      const removedIndex = events.findIndex((event) => event.id === id);
      const nextEvents = removeScheduleEvent(events, id);
      setEvents(nextEvents);
      setEventForm(null);
      if (id === selectedEventId) {
        setSelectedEventId(nextEvents[Math.min(removedIndex, nextEvents.length - 1)]?.id ?? '');
      }
      void persistSchedule(
        nextEvents,
        cardRevoked
          ? 'EVENT REMOVED — EVENT CARD REVOKED'
          : 'EVENT REMOVED — SCHEDULE SAVED',
      );
    } catch {
      setNoticeFor('COULD NOT VERIFY OR REVOKE LINKED CARDS — EVENT NOT REMOVED. RECONNECT AND TRY AGAIN', 'error');
    } finally {
      setRemovingEventId(null);
    }
  };

  const moveEvent = (id: string, direction: -1 | 1) => {
    const nextEvents = moveScheduleEvent(events, id, direction);
    setEvents(nextEvents);
    void persistSchedule(nextEvents, 'SCHEDULE ORDER SAVED');
  };

  const saveCurrentDraft = (
    nextEvents = events,
    nextShareToken = shareToken,
  ) => {
    window.localStorage.setItem('leaguematrix-project', 'true');
    saveScheduleDraft(window.localStorage, {
      teamName,
      season,
      events: nextEvents,
      template: 0,
      ...(nextShareToken ? { shareToken: nextShareToken } : {}),
    }, user?.id);
  };

  const cloudSchedule = (nextEvents = events): CloudProjectPayload => ({
    tool: 'schedule',
    version: 1,
    teamName,
    season,
    events: nextEvents,
    template: 0,
    ...(shareToken ? { shareToken } : {}),
  });

  const saveToCloud = async (nextEvents = events) => {
    if (!isSignedIn) {
      return false;
    }
    try {
      const data = {
        project: cloudSchedule(nextEvents),
        expectedRevision: cloudProjectToSave?.id === selectedCloudProject?.id
          ? cloudRevision.current
          : cloudProjectToSave?.revision ?? 1,
      };
      if (cloudProjectToSave) {
        const updated = await updateCloudProject.mutateAsync({
          projectId: cloudProjectToSave.id,
          data,
        });
        cloudRevision.current = updated.revision;
        if (cloudProjectToSave.id !== cloudProjectId) {
          setLocation(`/studio/schedule/${cloudProjectToSave.id}`);
        }
      } else {
        const created = await createCloudProject.mutateAsync({
          data: { name: `${teamName.trim() || 'Team'} - Schedule`, project: cloudSchedule(nextEvents) },
        });
        cloudRevision.current = created.revision;
        setLocation(`/studio/schedule/${created.id}`);
      }
      await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      if (user?.id) {
        clearPendingScheduleSync(window.localStorage, user.id);
        setPendingDeviceSync(false);
      }
      return true;
    } catch (error: any) {
      setNoticeFor(error?.status === 409 ? 'WORKSPACE SCHEDULE LIMIT REACHED — SAVED ON THIS DEVICE' : 'CLOUD SAVE FAILED — SAVED ON THIS DEVICE', 'error');
      return false;
    }
  };

  const persistSchedule = async (nextEvents: ScheduleEvent[], successNotice: string) => {
    saveCurrentDraft(nextEvents);
    if (user?.id) {
      markPendingScheduleSync(window.localStorage, user.id);
      setPendingDeviceSync(true);
    }
    setSaveStatus('device');
    const cloudSaved = isSignedIn
      ? await autosaveQueue.enqueue(() => saveToCloud(nextEvents))
      : false;
    setSaved(true);
    setSaveStatus(isSignedIn && cloudSaved ? 'cloud' : 'device');
    setNoticeFor(isSignedIn && cloudSaved ? `${successNotice} TO CLOUD` : `${successNotice} ON THIS DEVICE`);
  };

  useEffect(() => {
    if (!pendingDeviceSync || !user?.id) return;
    const syncPendingDraft = () => {
      if (navigator.onLine === false) return;
      void autosaveQueue.enqueue(() => saveToCloud(events)).then((savedToCloud) => {
        if (!savedToCloud) return;
        setSaveStatus('cloud');
        setSaved(true);
        setNoticeFor('SAVED DEVICE CHANGES TO CLOUD');
      });
    };
    window.addEventListener('online', syncPendingDraft);
    const initialSync = window.setTimeout(syncPendingDraft, 0);
    return () => {
      window.clearTimeout(initialSync);
      window.removeEventListener('online', syncPendingDraft);
    };
  }, [pendingDeviceSync, user?.id, events, autosaveQueue]);

  const publishSchedule = async () => {
    if (!isSignedIn) {
      setLocation('/sign-in');
      return;
    }
    if (!teamName.trim() || events.length === 0) {
      setNoticeFor('ADD A TEAM NAME AND EVENT BEFORE PUBLISHING', 'error');
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
      if (cloudProjectToSave) {
        const updated = await updateCloudProject.mutateAsync({
          projectId: cloudProjectToSave.id,
          data,
        });
        cloudRevision.current = updated.revision;
        if (cloudProjectToSave.id !== cloudProjectId) {
          setLocation(`/studio/schedule/${cloudProjectToSave.id}`);
        }
      } else {
        const project = { ...cloudSchedule(), shareToken: nextShareToken };
        const created = await createCloudProject.mutateAsync({
          data: { name: `${teamName.trim()} - Schedule`, project },
        });
        createdProjectId = created.id;
        cloudRevision.current = created.revision;
      }
      await queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      saveCurrentDraft(events, nextShareToken);
      setSaved(true);
      setNoticeFor('CALENDAR PUBLISHED TO ALL');
      if (createdProjectId) {
        setLocation(`/studio/schedule/${createdProjectId}`);
      }
    } catch (error: any) {
       setNoticeFor(error?.status === 409 ? 'WORKSPACE SCHEDULE LIMIT REACHED — USE YOUR EXISTING DRAFT OR CONTACT SUPPORT' : 'PUBLISH FAILED — TRY AGAIN', 'error');
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
      saveCurrentDraft(events, '');
      setSaved(true);
      setNoticeFor('PARENT LINK REVOKED');
    } catch {
      setNoticeFor('LINK REVOKE FAILED — TRY AGAIN', 'error');
    }
  };

  const renderScheduleSharePanel = (testId: string) => shareUrl ? (
    <div className="relative z-10 border border-primary/30 bg-primary/5 p-3 clip-angled-sm" data-testid={testId}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-accent">Public parent link</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={shareUrl}
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 min-w-0 flex-1 bg-transparent text-xs font-medium text-foreground outline-none"
          aria-label="Public parent schedule link"
        />
        <button
          type="button"
          onClick={() => { void navigator.clipboard?.writeText(shareUrl); setNoticeFor('PARENT LINK COPIED TO CLIPBOARD'); }}
          className="grid h-11 w-11 shrink-0 place-items-center border border-border bg-card text-foreground hover:bg-muted"
          aria-label="Copy parent schedule link"
          data-testid="button-copy-schedule-link"
        >
          <Clipboard className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-[10px] font-medium leading-relaxed text-muted-foreground">Update this link after changing the schedule. Parents keep the same URL.</p>
      <button
        type="button"
        onClick={() => { void revokeScheduleShare(); }}
        disabled={sharePending || deleteShare.isPending}
        className="mt-2 inline-flex min-h-11 items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-destructive disabled:cursor-wait disabled:opacity-60"
        data-testid="button-revoke-schedule-link"
      >
        <Link2Off className="h-3.5 w-3.5" /> {deleteShare.isPending ? 'Revoking link…' : 'Revoke parent link'}
      </button>
    </div>
  ) : null;

  const renderScheduleNotice = (className: string) => notice ? (
    <p
      className={`${className} inline-flex max-w-full items-center justify-center border px-3 py-2 text-center text-[10px] font-bold uppercase tracking-widest animate-pulse ${
        noticeTone === 'error'
          ? 'border-red-300/40 bg-red-500/10 text-red-200'
          : 'border-emerald-300/40 bg-emerald-500/10 text-emerald-200'
      }`}
      role="status"
      data-testid="status-editor-notice"
    >
      {notice}
    </p>
  ) : null;

  return (
    <StudioLayout>
      <main className="pixl-editor-main mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-4 py-6 sm:px-8 lg:py-10">
        <div className="pixl-editor-header mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <Link href="/studio" className="grid h-10 w-10 place-items-center border border-border bg-card text-foreground transition-colors hover:bg-muted clip-angled-sm" aria-label="Back to studio" data-testid="button-back-studio">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent">
                <CalendarDays className="h-4 w-4" /> Schedule Maker
              </div>
              <p className="mt-1 hidden text-sm font-medium text-muted-foreground sm:block">Put the season in motion.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 self-end sm:gap-4 sm:self-auto">
            <span className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary-ink transition-opacity duration-300 ${saved ? 'opacity-100' : 'opacity-0'}`} data-testid="status-schedule-save">
              <Check className="h-4 w-4" /> {saveStatus === 'cloud' ? 'Auto-saved to cloud' : 'Auto-saved on this device'}
            </span>
            <button type="button" onClick={publishSchedule} disabled={createCloudProject.isPending || updateCloudProject.isPending || sharePending} className="inline-flex items-center gap-2 bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60 clip-angled-sm" data-testid="button-publish-schedule">
              <CloudUpload className="h-4 w-4" /> {createCloudProject.isPending || updateCloudProject.isPending || sharePending ? 'Publishing…' : 'Publish to All'}
            </button>
          </div>
        </div>

        <div className="mb-6 lg:hidden">
          {renderScheduleSharePanel('schedule-share-link-mobile')}
        </div>
        {renderScheduleNotice('mb-6 lg:hidden')}

        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <section className="min-w-0 lg:sticky lg:top-6" aria-hidden="true" />

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

            <div className="hidden lg:block">
              {renderScheduleSharePanel('schedule-share-link')}
            </div>

            {renderScheduleNotice('relative z-10 mt-4 hidden lg:inline-flex')}
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
              <p className="text-[10px] font-bold uppercase tracking-[.2em] text-accent">Season calendar</p>
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
                onRemove={(id) => { void removeEvent(id); }}
                onMove={moveEvent}
                onSave={() => { void saveEventForm(); }}
                isRemoving={removingEventId === eventForm.id || deleteShare.isPending}
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
  isRemoving,
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
  isRemoving: boolean;
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
          className="min-h-11 min-w-0 flex-1 touch-manipulation border border-border bg-card px-3 py-3 text-xs font-bold uppercase tracking-wider text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary clip-angled-sm"
          aria-label={`Event ${index + 1} type`}
          data-testid={`select-event-type-${index}`}
        >
          <option value="game">Game</option>
          <option value="practice">Practice</option>
          {event.type === 'meeting' && <option value="meeting" disabled>Meeting (legacy)</option>}
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
            <button type="button" onClick={() => onRemove(event.id)} disabled={isRemoving} className="inline-flex h-8 items-center gap-1.5 border border-border px-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:cursor-wait disabled:opacity-60" aria-label={`Delete event ${index + 1}`} data-testid={`button-remove-event-${index}`}>
              <Trash2 className="h-3.5 w-3.5" /> {isRemoving ? 'Deleting…' : 'Delete'}
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
  const foreground = template === 2 ? '#243248' : '#F3F6FA';
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

function ScheduleInstallPrompt() {
  const {
    action,
    isIOS,
    showInstructions,
    handleInstall,
  } = useAppInstallPrompt('shared_schedule');

  return (
    <div
      className="mt-5 border-t border-[#F3F6FA]/20 pt-4"
      data-testid="schedule-install-prompt"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#F3F6FA]">
            Keep this schedule close
          </p>
          <p className="mt-1 max-w-xl text-xs font-medium leading-relaxed text-[#F3F6FA]/65">
            Install Pixl Sports on your phone to reach this shared card anytime.
          </p>
        </div>
        {action === 'installed' ? (
          <span
            className="shrink-0 text-[10px] font-extrabold uppercase tracking-[.14em] text-[#16B981]"
            data-testid="schedule-install-installed"
          >
            Available on this phone
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              const deviceClass = window.matchMedia('(max-width: 639px)').matches ? 'mobile' : 'desktop';
              void handleInstall(deviceClass);
            }}
            className="inline-flex shrink-0 items-center justify-center gap-2 self-start border border-[#16B981]/70 px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.14em] text-[#16B981] transition-colors hover:bg-[#16B981] hover:text-[#102B4D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3F6FA] sm:self-auto"
            aria-expanded={showInstructions}
            aria-controls="schedule-install-instructions"
            data-testid="button-schedule-install"
          >
            {action === 'install' ? 'Install on phone' : 'How to add it'}
          </button>
        )}
      </div>
      {showInstructions && action !== 'installed' && (
        <p
          id="schedule-install-instructions"
          className="mt-3 border border-[#F3F6FA]/15 bg-[#F3F6FA]/[.06] p-3 text-xs font-medium leading-relaxed text-[#F3F6FA]/75"
          role="status"
          data-testid="schedule-install-instructions"
        >
          {getScheduleInstallInstructions(isIOS)}
        </p>
      )}
    </div>
  );
}

function RetiredSchedulePage() {
  return (
    <div className="noise min-h-dvh bg-background">
      <SiteNav />
      <main className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-[760px] flex-col items-center justify-center px-5 py-12 text-center">
        <h1 className="font-display text-4xl uppercase tracking-wide text-foreground sm:text-5xl">Schedule Maker retired</h1>
        <p className="mt-4 max-w-lg text-sm font-medium leading-relaxed text-muted-foreground">
          Standalone Calendar schedules and shared schedule links are no longer available. Event Cards, your tracker, and your checklist are still here.
        </p>
        <Link href="/studio" className="mt-7 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground clip-angled-sm" data-testid="link-retired-schedule-dashboard">
          Go to your dashboard
        </Link>
      </main>
    </div>
  );
}

function PublicSchedulePage() {
  return <RetiredSchedulePage />;
}

function ChecklistRoutePage() {
  const isMeeting = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('eventType') === 'meeting';

  return isMeeting ? <MeetingCapture key={window.location.search} /> : <ChecklistPage />;
}

export function ChecklistPage({ shared = false }: { shared?: boolean }) {
  const [, setLocation] = useLocation();
  const params = useParams<{ shareToken?: string }>();
  const shareToken = shared ? (params.shareToken ?? '') : '';
  const { user, isSignedIn } = useUser();
  const requestedEventType = useRef<ChecklistEventType | undefined>(
    shared || typeof window === 'undefined'
      ? undefined
      : (() => {
        const value = new URLSearchParams(window.location.search).get('eventType');
        return value === 'practice' || value === 'meeting' || value === 'game' ? value : undefined;
      })(),
  );
  const userStorageKey = `${gamedayChecklistStorageKey}:${encodeURIComponent(user?.id ?? 'anonymous')}`;
  const [checklist, setChecklist] = useState<LocalGamedayChecklist>(() => createGamedayChecklist(requestedEventType.current));
  const [hydrated, setHydrated] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [notice, setNotice] = useState('');
  const [completionFeedback, setCompletionFeedback] = useState<ReturnType<typeof getChecklistCompletionFeedback>>(null);
  const [shareUrl, setShareUrl] = useState(shareToken ? `${appOrigin}${basePath}/checklist/${shareToken}` : '');
  const [revision, setRevision] = useState(1);
  const [syncStatus, setSyncStatus] = useState<ChecklistSyncStatus>('idle');
  const requestedGameId = useRef(
    shared || typeof window === 'undefined'
      ? ''
      : new URLSearchParams(window.location.search).get('gameId') ?? '',
  );
  const requestedGameApplied = useRef(false);
  const storedChecklistLoaded = useRef(false);
  const completionTimer = useRef<number | null>(null);
  const latestChecklist = useRef(checklist);
  const revisionRef = useRef(revision);
  const activeShareToken = shared ? shareToken : checklist.shareToken;

  const displayedEvent = checklist.selectedGame;
  const displayedEventType: ChecklistEventType = checklist.selectedGame?.type ?? 'game';
  const eventCopy = getChecklistEventCopy(displayedEventType);

  const createShare = useCreateChecklistShare();
  const deleteShare = useDeleteChecklistShare();
  const setNoticeFor = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  };
  const {
    updateShare,
    sharedChecklist,
    sharedLoading,
    sharedError,
    liveStatus,
    persistLocal,
    updateChecklist,
    retrySharedSave,
  } = useChecklistSave({
    shared,
    shareToken,
    activeShareToken,
    userId: user?.id ?? 'anonymous',
    userStorageKey,
    appOrigin,
    basePath,
    latestChecklist,
    revisionRef,
    setChecklist,
    setRevision,
    setHydrated,
    setShareUrl,
    setStorageUnavailable,
    setSyncStatus,
    onNotice: setNoticeFor,
  });

  useEffect(() => {
    latestChecklist.current = checklist;
  }, [checklist]);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  useEffect(() => {
    if (shared) return;
    try {
      const requestedId = requestedGameId.current;
      const stored = readChecklistForEvent(window.localStorage, userStorageKey, user?.id ?? 'anonymous', requestedId);
      if (stored) {
        storedChecklistLoaded.current = true;
        setChecklist(stored);
        if (stored.shareToken) setShareUrl(`${appOrigin}${basePath}/checklist/${stored.shareToken}`);
        if (stored.revision) {
          setRevision(stored.revision);
          revisionRef.current = stored.revision;
        }
      }
    } catch {
      setStorageUnavailable(true);
    } finally {
      setHydrated(true);
    }
  }, [shared, userStorageKey, user?.id]);

  useEffect(() => () => {
    if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
  }, []);

  useEffect(() => {
    if (shared || !hydrated || requestedGameApplied.current || !requestedGameId.current) return;
    const searchParams = new URLSearchParams(window.location.search);
    const requestedGame = latestChecklist.current.selectedGame?.id === requestedGameId.current
      ? latestChecklist.current.selectedGame
      : (['date', 'time', 'location', 'opponent'].some((key) => searchParams.has(key))
        ? {
          id: requestedGameId.current,
          type: requestedEventType.current === 'practice' ? 'practice' as const : 'game' as const,
          date: searchParams.get('date') ?? '',
          time: searchParams.get('time') ?? '',
          location: searchParams.get('location') ?? '',
          opponent: searchParams.get('opponent') ?? '',
        }
        : undefined);
    if (!requestedGame) return;
    requestedGameApplied.current = true;
    const eventType = requestedGame.type ?? requestedEventType.current ?? 'game';
    const currentEventType = latestChecklist.current.selectedGame?.type ?? 'game';
    const eventTypeChanged = currentEventType !== eventType;
    const shouldApplyTemplate = !storedChecklistLoaded.current || eventTypeChanged;
    const next = {
      ...(shouldApplyTemplate ? applyChecklistEventType(latestChecklist.current, eventType) : latestChecklist.current),
      selectedGame: {
        id: requestedGame.id,
        type: eventType,
        date: requestedGame.date,
        time: requestedGame.time,
        location: requestedGame.location,
        opponent: requestedGame.opponent,
      },
    };
    latestChecklist.current = next;
    setChecklist(next);
    persistLocal(next);
  }, [hydrated, shared]);

  const updateItem = (id: string, patch: Partial<GamedayChecklistItem>) => {
    updateChecklist({
      ...latestChecklist.current,
      items: latestChecklist.current.items.map((item) => item.id === id ? { ...item, ...patch } : item),
    });
  };

  const toggleItemCompletion = (item: GamedayChecklistItem) => {
    const completed = !item.completed;
    const feedback = getChecklistCompletionFeedback(
      latestChecklist.current.items,
      item.id,
      completed,
      displayedEventType,
    );
    updateItem(item.id, { completed });
    if (completed) {
      const completedCount = completedChecklistCount(latestChecklist.current.items) + 1;
      const totalCount = latestChecklist.current.items.length;
      const eventData = {
        source: shared ? 'shared_checklist' : 'local_checklist',
        completed_count: completedCount,
        total_count: totalCount,
      };
      trackEvent('checklist_item_completed', eventData);
      if (totalCount > 0 && completedCount === totalCount) {
        trackEvent('checklist_completed', eventData);
      }
    }
    if (!feedback) return;
    if (completionTimer.current !== null) window.clearTimeout(completionTimer.current);
    setCompletionFeedback(feedback);
    completionTimer.current = window.setTimeout(() => setCompletionFeedback(null), feedback.kind === 'complete' ? 4200 : 2600);
  };

  const addItem = () => {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    updateChecklist({
      ...latestChecklist.current,
      items: [...latestChecklist.current.items, { id, label: 'New checklist item', completed: false, section: null }],
    });
    setNoticeFor('ITEM ADDED');
  };

  const resetChecklist = () => {
    if (!window.confirm(getChecklistResetConfirmation(displayedEventType))) return;
    updateChecklist(resetGamedayChecklist(latestChecklist.current));
    setNoticeFor('CHECKLIST RESET — TEMPLATE ITEMS RESTORED');
  };

  const createOrCopyShare = async () => {
    if (!isSignedIn) {
      setLocation(`/sign-in?redirect_url=${encodeURIComponent('/studio/checklist')}`);
      return;
    }
    if (!shared && latestChecklist.current.shareToken) {
      const url = `${appOrigin}${basePath}/checklist/${latestChecklist.current.shareToken}`;
      await navigator.clipboard?.writeText(url);
      setNoticeFor('EDIT LINK COPIED TO CLIPBOARD');
      return;
    }
    try {
      const created = await createShare.mutateAsync({
        data: {
          title: latestChecklist.current.title.trim() || 'Gameday Checklist',
          notes: latestChecklist.current.notes ?? '',
          mode: latestChecklist.current.mode,
          items: latestChecklist.current.items,
          selectedGame: latestChecklist.current.selectedGame ?? null,
        },
      });
      const url = `${appOrigin}${basePath}/checklist/${created.shareToken}`;
      setShareUrl(url);
      const sharedDraft = { ...latestChecklist.current, shareToken: created.shareToken, revision: created.revision };
      latestChecklist.current = sharedDraft;
      setChecklist(sharedDraft);
      setRevision(created.revision);
      revisionRef.current = created.revision;
      try {
        saveGamedayChecklist(window.localStorage, { ...latestChecklist.current, shareToken: created.shareToken, revision: created.revision }, userStorageKey);
      } catch {
        setStorageUnavailable(true);
      }
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: latestChecklist.current.title, text: 'Open this checklist to edit it with me.', url });
          setNoticeFor('EDIT LINK SHARED');
          if (shared) setLocation(`/checklist/${created.shareToken}`);
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }
      await navigator.clipboard?.writeText(url);
      setNoticeFor('EDIT LINK COPIED TO CLIPBOARD');
      if (shared) setLocation(`/checklist/${created.shareToken}`);
    } catch {
      setNoticeFor('SHARING FAILED — SIGN IN AND TRY AGAIN');
    }
  };

  const revokeShare = async () => {
    const activeShareToken = shared ? shareToken : latestChecklist.current.shareToken;
    if (!activeShareToken || !window.confirm('Revoke this edit link? Everyone using it will lose access.')) return;
    try {
      await deleteShare.mutateAsync({ shareToken: activeShareToken });
      if (!shared) {
        const next = { ...latestChecklist.current };
        delete next.shareToken;
        delete next.revision;
        updateChecklist(next);
      }
      setNoticeFor('EDIT LINK REVOKED');
      if (shared) setLocation('/studio/checklist');
    } catch {
      setNoticeFor('ONLY THE CHECKLIST OWNER CAN REVOKE THIS LINK');
    }
  };

  if (shared && sharedLoading && !sharedError && !sharedChecklist && !hydrated) {
    return (
      <div className="noise studio-editor-fallback min-h-dvh bg-background">
        <SiteNav />
        <main className="grid min-h-[calc(100dvh-72px)] place-items-center px-5">
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground" role="status">Loading shared checklist…</p>
        </main>
      </div>
    );
  }

  if (shared && (sharedError || !sharedChecklist)) {
    return (
      <div className="noise studio-editor-fallback min-h-dvh bg-background">
        <SiteNav />
        <main className="mx-auto flex min-h-[calc(100dvh-72px)] max-w-xl flex-col items-center justify-center px-5 py-12 text-center">
          <Link2Off className="h-11 w-11 text-primary" />
          <h1 className="mt-5 font-display text-4xl uppercase tracking-wide">Checklist link unavailable</h1>
          <p className="mt-3 text-sm font-medium leading-relaxed text-muted-foreground">This edit link may have been revoked or copied incorrectly. Ask the owner to create a fresh link.</p>
          <Link href="/studio/checklist" className="mt-7 bg-card px-5 py-3 text-xs font-bold uppercase tracking-widest text-card-foreground clip-angled-sm">Start a local checklist</Link>
        </main>
      </div>
    );
  }

  const completed = completedChecklistCount(checklist.items);
  const progress = checklist.items.length ? Math.round((completed / checklist.items.length) * 100) : 0;
  const isChecklistComplete = checklist.items.length > 0 && completed === checklist.items.length;
  const trackerHref = displayedEvent
    ? buildWorkspaceToolHref('stats', {
      id: displayedEvent.id,
      type: displayedEvent.type ?? 'game',
      date: displayedEvent.date,
      time: displayedEvent.time,
      location: displayedEvent.location,
      opponent: displayedEvent.opponent || '',
    })
    : '/studio/stat-tracker';
  const isSaving = createShare.isPending || updateShare.isPending;
  const canManageShare = shared ? Boolean(sharedChecklist?.canManage) : Boolean(checklist.shareToken && isSignedIn);

  return (
    <StudioLayout>
      <main className="pixl-editor-main mx-auto flex w-full max-w-4xl flex-1 flex-col px-3 py-3 sm:px-8 sm:py-8" data-testid="checklist-page">
        <div className="pixl-editor-header mb-4 flex items-start justify-between gap-3 sm:mb-6 sm:items-end sm:gap-5">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <Link href={shared ? '/studio/checklist' : '/studio'} className="grid h-10 w-10 shrink-0 place-items-center border border-border bg-card text-foreground transition-colors hover:bg-muted clip-angled-sm" aria-label="Back to studio">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-primary"><ClipboardCheck className="h-4 w-4" /> {shared ? 'Shared workspace' : eventCopy.hubLabel}</p>
              <h1 className="mt-1 font-display text-4xl uppercase leading-[.88] tracking-tight sm:mt-2 sm:text-7xl">{eventCopy.heading.split(' ')[0]}<br /><span className="text-primary studio-textured-heading-accent">{eventCopy.heading.split(' ').slice(1).join(' ')}</span></h1>
              <p className="mt-2 max-w-xl text-xs font-medium leading-relaxed text-muted-foreground sm:mt-4 sm:text-sm">{shared ? 'Edit together from one link. Changes refresh for everyone automatically.' : eventCopy.description}</p>
            {shared && (
              <p className="mt-2 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground sm:mt-3" role="status" data-testid="checklist-live-status">
                <span className={`h-2 w-2 rounded-full ${liveStatus === 'connected' ? 'bg-primary' : 'bg-muted-foreground animate-pulse'}`} />
                {liveStatus === 'connected' ? 'Live updates connected' : 'Reconnecting live updates…'}
              </p>
            )}
            </div>
          </div>
          <div className="shrink-0 border border-border bg-card px-3 py-2 text-right clip-angled-sm sm:px-4 sm:py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Progress</p>
            <p className="mt-0.5 font-display text-2xl text-primary sm:mt-1 sm:text-3xl">{completed}/{checklist.items.length}</p>
          </div>
        </div>

        {storageUnavailable && !shared && (
          <div className="mb-5 border-l-4 border-primary bg-primary/10 px-4 py-3 text-sm font-medium text-foreground" role="status">
            This browser is not allowing local storage. You can keep editing, but reload recovery is unavailable until storage is enabled.
          </div>
        )}

        <section className="border border-border bg-card p-3 shadow-sm clip-angled-sm sm:p-6">
          <div className="flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4 sm:pb-5">
            <label className="min-w-0 flex-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Checklist name</span>
              <input value={checklist.title} onChange={(event) => updateChecklist({ ...latestChecklist.current, title: event.target.value })} className="mt-0.5 w-full bg-transparent font-display text-2xl uppercase tracking-wide text-foreground outline-none placeholder:text-muted-foreground sm:mt-1 sm:text-3xl" aria-label="Checklist name" />
            </label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={resetChecklist} className="inline-flex items-center gap-2 border border-border bg-background px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-foreground" data-testid="button-reset-checklist"><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
              <button type="button" onClick={addItem} className="inline-flex items-center gap-2 bg-primary px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary/90" data-testid="button-add-checklist-item"><Plus className="h-3.5 w-3.5" /> Add item</button>
            </div>
          </div>

          <div className="mt-3 border-t border-border pt-3 sm:mt-5 sm:pt-5" data-testid="checklist-event-context">
            {displayedEvent ? (
              <>
                <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary">
                  <CalendarDays className="h-3.5 w-3.5" /> Event Card details
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-l-4 border-primary bg-primary/5 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-foreground sm:gap-x-5 sm:gap-y-2 sm:py-3" data-testid="checklist-selected-event-summary">
                  <span>{formatScheduleDate(displayedEvent.date)}</span>
                  <span>{formatScheduleTime(displayedEvent.time)}</span>
                  {displayedEventType === 'game' ? <span>VS {displayedEvent.opponent || 'OPPONENT TBD'}</span> : <span>{displayedEventType.toUpperCase()}</span>}
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground"><MapPin className="h-3.5 w-3.5 text-primary" /> {displayedEvent.location || 'Location TBD'}</span>
                </div>
              </>
            ) : (
              <p className="text-xs font-medium leading-relaxed text-muted-foreground">
                Open this checklist from an Event Card to keep its event details with your prep.
              </p>
            )}
          </div>

          <div className="mt-3 h-1.5 overflow-hidden bg-muted sm:mt-5 sm:h-2" aria-label={`${progress}% complete`}><div className="h-full bg-primary transition-all motion-reduce:transition-none" style={{ width: `${progress}%` }} /></div>

          <div className="min-h-5 pt-2 sm:min-h-7 sm:pt-3" aria-live="polite" aria-atomic="true" data-testid="checklist-completion-feedback">
            {completionFeedback && (
              <p className={`flex items-center gap-2 text-xs font-bold ${completionFeedback.kind === 'undo' ? 'text-muted-foreground' : 'text-primary'} motion-safe:animate-pulse`}>
                {completionFeedback.kind !== 'undo' && <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />}
                {completionFeedback.message}
              </p>
            )}
          </div>

          {isChecklistComplete && (
            <section className={`relative mt-3 overflow-hidden border border-primary/50 bg-card px-5 py-5 text-card-foreground clip-angled-sm sm:px-6 ${completionFeedback?.kind === 'complete' ? 'motion-safe:animate-pulse' : ''}`} data-testid="checklist-ready-celebration" aria-labelledby="checklist-ready-heading">
              <div className="pointer-events-none absolute -right-5 -top-7 text-primary/15" aria-hidden="true">
                <Sparkles className="h-28 w-28" />
              </div>
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary"><Sparkles className="h-4 w-4" /> All tasks complete</p>
                  <h2 id="checklist-ready-heading" className="mt-2 font-display text-3xl uppercase tracking-wide sm:text-4xl">{eventCopy.readyHeading}</h2>
                  <p className="mt-2 max-w-xl text-sm font-medium text-white/65">
                    {eventCopy.readyDescription(displayedEvent?.opponent)}
                  </p>
                </div>
                <Link
                  href={trackerHref}
                  onClick={() => trackEvent('completion_next_action_clicked', {
                    source: shared ? 'shared_checklist' : 'local_checklist',
                    stage: 'live',
                    completed_count: completed,
                    total_count: checklist.items.length,
                  })}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 bg-primary px-4 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:brightness-110"
                >
                  Open Stat Tracker <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </section>
          )}

          <div className="mt-4 space-y-5 sm:mt-6 sm:space-y-6" data-testid="checklist-items">
            {(Array.from(new Set(checklist.items.map((item) => item.section || eventCopy.defaultSection))) as string[]).map((section) => (
              <div key={section}>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">{section}</p>
                <div className="space-y-1.5 sm:space-y-2">
                  {checklist.items.filter((item) => (item.section || eventCopy.defaultSection) === section).map((item) => (
                    <div key={item.id} data-completed={item.completed ? 'true' : 'false'} className={`flex items-center gap-3 border px-3 py-2.5 transition-all motion-reduce:transition-none sm:py-3 ${item.completed ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'} ${completionFeedback?.itemId === item.id && completionFeedback.kind !== 'undo' ? 'ring-2 ring-primary/30 motion-safe:animate-pulse' : ''}`}>
                      <button type="button" onClick={() => toggleItemCompletion(item)} className={`grid h-7 w-7 shrink-0 place-items-center border ${item.completed ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 text-transparent hover:border-primary'}`} aria-label={`${item.completed ? 'Uncheck' : 'Check'} ${item.label}`} data-testid={`button-checklist-toggle-${item.id}`}><Check className="h-4 w-4" /></button>
                      <input value={item.label} onChange={(event) => updateItem(item.id, { label: event.target.value })} className={`min-w-0 flex-1 bg-transparent text-sm font-bold text-foreground outline-none ${item.completed ? 'line-through opacity-60' : ''}`} aria-label={`Edit ${item.label}`} data-testid={`input-checklist-item-${item.id}`} />
                      {item.completed && <span className="hidden text-[10px] font-bold uppercase tracking-widest text-primary sm:inline">Ready</span>}
                      <button type="button" onClick={() => updateChecklist({ ...latestChecklist.current, items: latestChecklist.current.items.filter((candidate) => candidate.id !== item.id) })} className="text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-destructive" aria-label={`Remove ${item.label}`}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {checklist.items.length === 0 && <div className="border-2 border-dashed border-border p-8 text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">{eventCopy.emptyItemsMessage}</div>}
          </div>
        </section>

        <section className="mt-5 border border-border bg-card p-5 text-card-foreground clip-angled-sm sm:p-6">
          <label htmlFor="checklist-notes" className="block text-xs font-bold uppercase tracking-widest text-primary">Notes for everyone</label>
          <p className="mt-2 text-sm text-muted-foreground">Arrival details, reminders, or anything that does not fit a checkbox.</p>
          <textarea
            id="checklist-notes"
            data-testid="input-checklist-notes"
            value={checklist.notes ?? ''}
            onChange={(event) => updateChecklist({ ...latestChecklist.current, notes: event.target.value })}
            maxLength={2000}
            rows={4}
            placeholder="Add a note for this event…"
            className="mt-4 w-full resize-y border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </section>

        <section className="mt-5 border border-border bg-card p-5 text-card-foreground clip-angled-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary"><UsersRound className="h-4 w-4" /> Work together</p>
            <p className="mt-2 max-w-xl text-sm font-medium leading-relaxed text-white/65">{shared ? 'Everyone with this link can edit notes and checklist items. Changes save automatically and update for collaborators.' : 'Create one edit link for parents and helpers. After sharing, changes here also update that link automatically.'}</p>
            </div>
            {!shared && <button type="button" onClick={() => { void createOrCopyShare(); }} disabled={isSaving} className="inline-flex shrink-0 items-center justify-center gap-2 bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60 clip-angled-sm" data-testid="button-share-checklist"><Share2 className="h-4 w-4" /> {createShare.isPending ? 'Creating link…' : checklist.shareToken ? 'Copy edit link' : 'Create edit link'}</button>}
          </div>
          {shareUrl && (
            <div className="mt-5 border border-white/15 bg-white/5 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Collaborative edit link</p>
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={shareUrl} className="min-w-0 flex-1 bg-transparent text-xs font-medium text-white outline-none" aria-label="Collaborative checklist edit link" />
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(shareUrl); setNoticeFor('EDIT LINK COPIED TO CLIPBOARD'); }} className="grid h-8 w-8 shrink-0 place-items-center border border-white/20 bg-white/10 text-white hover:bg-white/20" aria-label="Copy collaborative checklist edit link"><Clipboard className="h-4 w-4" /></button>
              </div>
              {canManageShare && (
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <button type="button" onClick={() => { void createOrCopyShare(); }} disabled={isSaving} className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/55 hover:text-primary disabled:opacity-60"><RotateCcw className="h-3.5 w-3.5" /> {createShare.isPending ? 'Refreshing…' : 'Refresh link'}</button>
                  <button type="button" onClick={() => { void revokeShare(); }} disabled={deleteShare.isPending} className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/55 hover:text-primary disabled:opacity-60"><Link2Off className="h-3.5 w-3.5" /> {deleteShare.isPending ? 'Revoking…' : 'Revoke link'}</button>
                </div>
              )}
            </div>
          )}
        </section>
        {notice && <p className="mt-5 text-center text-xs font-bold uppercase tracking-widest text-primary animate-pulse" role="status">{notice}</p>}
        {(activeShareToken || syncStatus === 'error') && (
          <div className="mt-3 text-center text-xs font-bold text-muted-foreground" role="status" aria-live="polite">
            {syncStatus === 'saving' || isSaving ? 'Saving to shared checklist…' : syncStatus === 'saved' ? 'Saved to shared checklist' : syncStatus === 'error' ? 'Shared save failed — changes remain here.' : 'Shared checklist is ready'}
            {syncStatus === 'error' && activeShareToken && (
              <button type="button" onClick={retrySharedSave} className="ml-2 underline underline-offset-2 text-primary" data-testid="button-retry-checklist-sync">Replace shared version</button>
            )}
          </div>
        )}
      </main>
    </StudioLayout>
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
  const foreground = selectedTemplate === 2 ? 'text-[#243248]' : 'text-[#F3F6FA]';

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
        <div className="mb-10 inline-flex items-center gap-2 border-l-2 border-accent bg-accent/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-accent clip-angled-sm">
          <CircleHelp className="h-4 w-4" /> Support Manual
        </div>
        <h1 className="font-display text-5xl leading-none tracking-wide text-foreground uppercase sm:text-7xl">Help & FAQ</h1>
        <div className="mt-12 space-y-10">
          <section>
            <h2 className="font-display text-3xl uppercase tracking-wide">How do I create and share a HYPE Card?</h2>
            <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">Open the HYPE Card tool in your studio to create or manage your athlete’s card. Share its public link from the manager; owners can return to update card details and highlights.</p>
          </section>
          <section>
            <h2 className="font-display text-3xl uppercase tracking-wide">Where can owners manage a shared card?</h2>
            <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">Use the HYPE Card Manager at the owner-only management link associated with your invite. The HYPE Card stays viewable at its /fan/ link; managing it requires signing in as its owner.</p>
          </section>
          <section>
            <h2 className="font-display text-3xl uppercase tracking-wide">Where do I find game-day tools?</h2>
            <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">Your studio keeps game-day cards, checklists, and stats together. Open a game card to access its available preparation and tracking actions.</p>
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
           <a href="mailto:hello@pixlsports.com" className="bg-card text-card-foreground font-bold uppercase tracking-wider px-6 py-3 clip-angled-sm hover:scale-105 transition-transform whitespace-nowrap">Contact Team</a>
        </div>
      </main>
    </StudioLayout>
  );
}

function Privacy() {
  return (
    <StudioLayout>
      <main className="mx-auto max-w-[800px] px-5 py-12 sm:px-8 lg:py-24">
        <div className="mb-10 inline-flex items-center gap-2 border-l-2 border-accent bg-accent/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-accent clip-angled-sm">
          <ShieldCheck className="h-4 w-4" /> Data Security
        </div>
        <h1 className="font-display text-5xl leading-none tracking-wide text-foreground uppercase sm:text-7xl">Privacy Policy</h1>
        <div className="prose prose-lg mt-12 max-w-none prose-headings:font-display prose-headings:uppercase prose-headings:tracking-wide prose-a:text-primary hover:prose-a:text-foreground">
           <p className="lead font-medium text-xl">The short version: We don't track your team, and Pixl Sports keeps source media on your device by default. Account saves contain reusable design settings only unless you use private media storage on a paid Hype Card account. {PUBLIC_SHARE_MEDIA}</p>
          <h3>1. Local Execution</h3>
            <p>Pixl Sports is built as a local-first application. When you attach a photo, video, or logo to create a graphic, that source media is processed on your device using browser APIs. Guest and unpaid design saves send the layout, text, colors, crop settings, and output configuration, but not the attached media. Paid Hype Card accounts can keep private project media in cloud storage under the account quota. {PUBLIC_SHARE_MEDIA} Older cloud projects created before this policy may temporarily retain their previously uploaded media until it is removed in a later migration.</p>
          <h3>2. Analytics</h3>
          <p>We do not use tracking pixels, session recording tools, or advertising analytics in this release.</p>
          <h3>3. Cookies</h3>
          <p>Project settings and attached media may be kept in local browser storage so they can survive a reload. If you create an account, Clerk uses necessary session cookies to maintain your login. We do not use advertising cookies.</p>
          <h3>4. Your Media</h3>
            <p>You are responsible for having the rights and any required consent to use media you attach, including permission involving minors. Source media remains local by default, while a published Hype Card uses a prepared hosted copy so the public player page can display it. {PUBLIC_SHARE_MEDIA}</p>
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
        <div className="font-display text-[12rem] leading-none text-accent/20">404</div>
        <h1 className="mt-4 font-display text-5xl uppercase tracking-wide text-foreground sm:text-6xl">Out of bounds.</h1>
        <p className="mt-4 max-w-md text-lg font-medium text-muted-foreground">The page you're looking for doesn't exist or has been moved off the page.</p>
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
    logoImageUrl: `${appOrigin}${basePath}/pixlsports-logo.png`,
  },
  variables: {
    colorPrimary: "#55A4FF",
    colorForeground: "#F3F6FA",
    colorMutedForeground: "#B9CADC",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "#102B4D",
    colorInput: "#0B1F3A",
    colorInputForeground: "#F3F6FA",
    colorNeutral: "#91ACC3",
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: "0.375rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#102B4D] w-[440px] max-w-full overflow-hidden rounded-xl border border-[#55A4FF]/30 shadow-[0_24px_80px_rgba(0,8,25,.38)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-display text-3xl uppercase tracking-wide text-white",
    headerSubtitle: "text-sm font-medium text-[#B9CADC]",
    socialButtonsBlockButtonText: "text-xs font-bold uppercase tracking-wider text-white",
    formFieldLabel: "text-xs font-bold uppercase tracking-wider text-[#E0EDFA]",
    footerActionLink: "text-[#73B5FF] font-bold hover:underline",
    footerActionText: "text-sm font-medium text-[#B9CADC]",
    dividerText: "text-xs font-bold uppercase tracking-widest text-[#B9CADC]",
    identityPreviewEditButton: "text-[#73B5FF]",
    formFieldSuccessText: "text-[#73B5FF] text-xs",
    alertText: "text-sm font-medium",
    logoBox: "mb-3",
    logoImage: "h-10 max-w-[134px] object-contain",
    socialButtonsBlockButton: "h-12 rounded-md border border-[#91ACC3]/40 bg-white/5 hover:bg-white/10 transition-colors text-white",
    formButtonPrimary: "h-12 rounded-md font-bold bg-[#55A4FF] !text-[#0B1F3A] hover:!bg-[#82BDFF] transition-colors",
    formFieldInput: "h-12 rounded-md border border-[#91ACC3]/40 bg-[#0B1F3A] text-white font-medium focus:border-[#55A4FF] focus:ring-1 focus:ring-[#55A4FF] transition-all",
    footerAction: "mt-4",
    dividerLine: "bg-white/20",
    alert: "rounded-md border border-destructive/30 bg-destructive/10 text-white",
    otpCodeFieldInput: "rounded-md border border-[#91ACC3]/40 bg-[#0B1F3A] text-white focus:border-[#55A4FF]",
    formFieldRow: "mb-3",
    main: "p-6 sm:p-8",
  },
};

const authFormAppearance = {
  ...clerkAppearance,
  variables: {
    ...clerkAppearance.variables,
    colorPrimary: "#2878F5",
    colorForeground: "#0B1F3A",
    colorMutedForeground: "#47617B",
    colorBackground: "#FFFFFF",
    colorInput: "#EDF5FC",
    colorInputForeground: "#0B1F3A",
    colorNeutral: "#9EB8CF",
  },
  elements: {
    ...clerkAppearance.elements,
    cardBox: "bg-white w-[440px] max-w-full overflow-hidden rounded-xl border border-[#B4C9DC] border-t-4 border-t-[#FF6433] shadow-[0_24px_80px_rgba(0,8,25,.45)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none !gap-5 !px-6 !py-5 sm:!px-8 sm:!py-7",
    header: "!gap-3",
    headerTitle: "font-display text-3xl uppercase tracking-wide !text-[#0B1F3A]",
    headerSubtitle: "text-sm font-medium !text-[#47617B]",
    logoBox: "mb-2",
    logoImage: "h-9 max-w-[125px] object-contain",
    socialButtonsBlockButton: "h-12 rounded-md border border-[#8AA9C6] !bg-[#EDF5FC] hover:!bg-[#DCEEFF] transition-colors",
    socialButtonsBlockButtonText: "text-xs font-bold uppercase tracking-wider !text-[#0B1F3A]",
    formFieldLabel: "text-xs font-bold uppercase tracking-wider !text-[#193752]",
    formFieldInput: "h-12 rounded-md border border-[#8AA9C6] !bg-[#EDF5FC] !text-[#0B1F3A] font-medium focus:border-[#2878F5] focus:ring-1 focus:ring-[#2878F5] transition-all",
    formButtonPrimary: "h-12 rounded-md font-bold !bg-[#55A4FF] !text-[#0B1F3A] hover:!bg-[#82BDFF] transition-colors",
    footerActionLink: "!text-[#165FAF] font-bold hover:underline",
    footerActionText: "text-sm font-medium !text-[#47617B]",
    dividerText: "text-xs font-bold uppercase tracking-widest !text-[#47617B]",
    dividerLine: "bg-[#B4C9DC]",
    identityPreviewEditButton: "!text-[#165FAF]",
    formFieldSuccessText: "!text-[#165FAF] text-xs",
    alertText: "!text-[#762323] text-sm font-medium",
    alert: "rounded-md border border-[#D59090] bg-[#FFF0F0] !text-[#762323]",
    otpCodeFieldInput: "rounded-md border border-[#8AA9C6] !bg-[#EDF5FC] !text-[#0B1F3A] focus:border-[#2878F5]",
    form: "!gap-4",
    formFieldRow: "!mb-0 !gap-2",
    footerAction: "mt-3",
    main: "!p-0 !gap-4",
  },
};

function AuthLayout({ children, title, subtitle }: { children: ReactNode, title: ReactNode, subtitle: string }) {
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Link href="/" className="auth-home" data-testid="link-auth-home">
          <BrandMark inverse />
        </Link>
        <Link href="/" className="auth-back"><ArrowLeft size={16} aria-hidden="true" /> Back to Pixl Sports</Link>
      </header>
      <main className="auth-shell">
        <section className="auth-story" aria-label="About Pixl Sports">
          <p className="auth-eyebrow"><span aria-hidden="true" /> Your season, guided</p>
          <h1>{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>
          <div className="auth-story-rule" aria-hidden="true" />
          <ul className="auth-highlights">
            <li><Check size={17} aria-hidden="true" /> Plan each week</li>
            <li><Check size={17} aria-hidden="true" /> Share game day</li>
            <li><Check size={17} aria-hidden="true" /> Cheer on your athlete</li>
          </ul>
        </section>
        <div className="auth-form-wrap">
          {children}
          <p className="auth-footnote">A season worth keeping / Pixl Sports</p>
        </div>
      </main>
    </div>
  );
}

function SignInPage() {
  const redirectUrl = new URLSearchParams(window.location.search).get('redirect_url');
  return (
    <AuthLayout
      title={<>Pick up<br/><span>the season.</span></>}
      subtitle="Your athlete’s season, all in one place. Pick up where you left off."
    >
      <SignIn appearance={authFormAppearance} routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} fallbackRedirectUrl={redirectUrl || `${basePath}/studio`} />
    </AuthLayout>
  );
}

function SignUpPage() {
  const roleRedirect = `${basePath}/studio/setup`;
  const signInUrl = `${basePath}/sign-in`;

  return (
    <AuthLayout
      title={<>Start their<br/><span>season here.</span></>}
      subtitle="Plan each week, share game day, and cheer on your athlete together."
    >
      <SignUp appearance={authFormAppearance} routing="path" path={`${basePath}/sign-up`} signInUrl={signInUrl} fallbackRedirectUrl={roleRedirect} />
    </AuthLayout>
  );
}

function RoleSelectionPage() {
  const [, setLocation] = useLocation();
  const { user, isLoaded } = useUser();
  const existingProfile = getUserProfile(user);
  const selectedAccessMode: AccessMode = existingProfile.accessMode ?? 'full';
  const [displayName, setDisplayName] = useState(existingProfile.displayName);
  const [teamName, setTeamName] = useState(existingProfile.teamName);
  const [athleteName, setAthleteName] = useState(existingProfile.athleteName);
  const [seasonName, setSeasonName] = useState(existingProfile.seasonName);
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState('');
  const updateAccountAccess = useUpdateAccountAccess();

  if (!isLoaded) {
    return <AccountLoadingScreen />;
  }
  if (!user) return <Redirect to="/sign-in" />;
  if (isSupporterSetupComplete(existingProfile)) {
    return <Redirect to="/studio" />;
  }

  const saveProfile = async () => {
    const cleanName = displayName.trim();
    const cleanTeam = teamName.trim();
    const cleanAthleteName = athleteName.trim();
    const cleanSeasonName = seasonName.trim();
    if (!cleanName || !cleanTeam || !cleanAthleteName || !cleanSeasonName) {
      setError('Add your name, team, athlete name, and season to continue.');
      return;
    }

    setSavingProfile(true);
    setError('');
    try {
      await updateAccountAccess.mutateAsync({
        data: { role: 'fan', accessMode: selectedAccessMode },
      });
      await user.update({
        unsafeMetadata: {
          ...(user.unsafeMetadata ?? {}),
          role: 'fan',
          accessMode: selectedAccessMode,
          displayName: cleanName,
          teamName: cleanTeam,
          athleteName: cleanAthleteName,
          seasonName: cleanSeasonName,
           ...(tourStateAfterSetup(
             user.unsafeMetadata,
             Boolean(existingProfile.role && existingProfile.teamName && existingProfile.displayName),
           ) === 'pending' ? { dashboardTour: 'pending' } : {}),
        },
      });
      setLocation('/studio');
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
              <UsersRound className="h-4 w-4 text-primary" /> Supporter setup
            </div>
            <h1 className="font-display text-6xl leading-[0.88] tracking-tight sm:text-8xl">
              YOUR ATHLETE’S<br /><span className="text-primary">SEASON.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg font-medium leading-relaxed text-muted-foreground">
              Tell us about your athlete and season so your supporter dashboard starts with the right details.
            </p>
          </div>

          <section className="border border-border bg-card p-6 shadow-sm clip-angled-sm sm:p-8" aria-labelledby="supporter-heading">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Supporter account</p>
            <h2 id="supporter-heading" className="mt-2 font-display text-4xl uppercase tracking-wide">SET UP YOUR DASHBOARD</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveProfile();
              }}
            >
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Your name
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="e.g. Jordan Smith"
                    autoComplete="name"
                    required
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
                    required
                    className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary"
                    data-testid="input-profile-team"
                  />
                </label>
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Athlete name
                  <input
                    value={athleteName}
                    onChange={(event) => setAthleteName(event.target.value)}
                    placeholder="e.g. Avery Smith"
                    autoComplete="off"
                    required
                    className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary"
                    data-testid="input-profile-athlete"
                  />
                </label>
                <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Season
                  <input
                    value={seasonName}
                    onChange={(event) => setSeasonName(event.target.value)}
                    placeholder="e.g. Fall 2026 or 2026–27"
                    autoComplete="off"
                    required
                    className="mt-2 w-full border border-border bg-background px-4 py-3 text-sm font-medium text-foreground outline-none focus:border-primary"
                    data-testid="input-profile-season"
                  />
                </label>
              </div>
              <div className="mt-7 border-l-4 border-primary bg-primary/10 px-4 py-3 clip-angled-sm">
                <p className="text-xs font-bold uppercase tracking-widest text-primary">One supporter account</p>
                <p className="mt-1 text-sm font-medium leading-relaxed text-muted-foreground">
                  Manage your athlete’s HYPE Card, game-day prep, and stats from one dashboard.
                </p>
              </div>
              <button type="submit" disabled={savingProfile} className="mt-6 w-full bg-primary px-5 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60 clip-angled-sm" data-testid="button-save-profile">
                {savingProfile ? 'Saving your dashboard…' : 'Build my dashboard'}
              </button>
              {error && <p className="mt-5 text-sm font-bold text-destructive" role="alert">{error}</p>}
            </form>
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
      supporter={<SupporterStudio />}
    />
  );
}

function LockedAccountPage({ status, pauseEndsAt, deletionEligibleAt, expired, userId }: {
  status: 'paused' | 'cancelled' | 'deletion_pending';
  pauseEndsAt: string | Date | null;
  deletionEligibleAt: string | Date | null;
  expired: boolean;
  userId: string;
}) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const reactivate = useReactivateAccount();
  const resume = useResumeAccount();
  const paused = status === 'paused';
  const recoveryDate = deletionEligibleAt ? new Date(deletionEligibleAt) : null;
   const upgradeUrl = import.meta.env.VITE_BILLING_UPGRADE_URL
     ?? 'mailto:hello@pixlsports.com?subject=Pixl%20Sports%20upgrade';

  return (
    <div className="noise min-h-dvh bg-background">
      <SiteNav dark />
      <main className="mx-auto flex min-h-[calc(100dvh-72px)] w-full max-w-5xl items-center px-5 py-12 sm:px-8">
        <section className="relative w-full overflow-hidden border-l-4 border-primary bg-card p-7 text-white clip-angled-sm sm:p-10" data-testid="locked-account-page">
          <div className="absolute inset-0 bg-tech-grid-dark opacity-30" />
          <div className="relative z-10 max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">{paused ? 'Account paused' : expired ? 'Recovery window ended' : 'Account cancelled'}</p>
            <h1 className="mt-4 font-display text-5xl uppercase leading-[0.9] tracking-tight sm:text-7xl">
              YOUR STUDIO IS<br /><span className="text-primary">ON HOLD.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base font-medium leading-relaxed text-white/70 sm:text-lg">
              {paused
                ? `Your data is preserved and is not queued for deletion. Access will return automatically after ${pauseEndsAt ? new Date(pauseEndsAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'the pause ends'}, or you can resume now. This pause does not change external billing.`
                : expired
                 ? 'Your 90-day recovery window has ended. Pixl Sports data is queued for permanent deletion and cannot be restored.'
                : `Your projects, team settings, and account role are preserved. Reactivate before ${recoveryDate?.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) ?? 'the recovery deadline'} to return to the studio.`}
            </p>
            {!expired && (
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={paused ? resume.isPending : reactivate.isPending}
                  onClick={() => {
                    const onSuccess = (result: { status: string }) => {
                      queryClient.setQueryData([...getGetAccountLifecycleQueryKey(), userId], result);
                      queryClient.invalidateQueries({ queryKey: getGetAccountAccessQueryKey() });
                      setLocation('/studio');
                    };
                    if (paused) resume.mutate(undefined, { onSuccess });
                    else reactivate.mutate(undefined, { onSuccess });
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-primary px-6 py-4 text-sm font-bold uppercase tracking-widest text-primary-foreground disabled:opacity-60 clip-angled-sm"
                  data-testid={paused ? 'button-resume-account' : 'button-reactivate-account'}
                >
                  {paused ? resume.isPending ? 'Resuming…' : 'Resume account' : reactivate.isPending ? 'Reactivating…' : 'Reactivate account'} <ArrowRight className="h-4 w-4" />
                </button>
                {!paused && <a
                  href={upgradeUrl}
                  target={upgradeUrl.startsWith('http') ? '_blank' : undefined}
                  rel={upgradeUrl.startsWith('http') ? 'noreferrer' : undefined}
                  className="border border-white/20 bg-white/5 px-6 py-4 text-sm font-bold uppercase tracking-widest text-white transition-colors hover:bg-white/10 clip-angled-sm"
                  data-testid="button-review-upgrade"
                >
                  Upgrade your account
                </a>}
              </div>
            )}
            {(reactivate.isError || resume.isError) && (
              <p className="mt-5 text-sm font-bold text-primary" role="alert">
                {paused ? 'Resume failed. Refresh and try again.' : 'Reactivation failed. Refresh and try again.'}
              </p>
            )}
            <p className="mt-8 text-xs font-bold uppercase tracking-widest text-white/45">Authentication remains available so you can sign out or return later.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

function AccountLifecycleGate({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isLoaded, isSignedIn, user } = useUser();
  const bypassLifecycle = location.startsWith('/schedule/')
    || location.startsWith('/checklist/')
    || location.startsWith('/watch/')
    || location.startsWith('/live/')
    || location.startsWith('/h/')
    || location.startsWith('/player/')
    || location.startsWith('/sign-in')
    || location.startsWith('/sign-up');
  const cachedDashboard = user?.id
    ? readOfflineDashboardSnapshot(window.localStorage, user.id)
    : null;
  const [allowSlowCache, setAllowSlowCache] = useState(false);
  const lifecycleQuery = useGetAccountLifecycle({
    query: {
      enabled: Boolean(isLoaded && isSignedIn && !bypassLifecycle),
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: 'always',
      refetchInterval: (query) => query.state.data?.status === 'paused' ? 30_000 : false,
      queryKey: [...getGetAccountLifecycleQueryKey(), user?.id],
      initialData: cachedDashboard?.lifecycle,
    },
  });
  const { data: lifecycle, isLoading, isError, refetch } = lifecycleQuery;
  useEffect(() => {
    setAllowSlowCache(false);
    if (!cachedDashboard || !isSignedIn) return;
    const timer = window.setTimeout(() => setAllowSlowCache(true), 1800);
    return () => window.clearTimeout(timer);
  }, [user?.id, isSignedIn, Boolean(cachedDashboard)]);
  useEffect(() => {
    if (!user?.id || !lifecycle || isError || !lifecycleQuery.isFetchedAfterMount) return;
    updateOfflineDashboardSnapshot(window.localStorage, user.id, {
      lifecycle,
      verifiedAt: new Date().toISOString(),
    });
  }, [user?.id, lifecycle, isError, lifecycleQuery.isFetchedAfterMount]);
  const canUseCachedLifecycle = Boolean(
    isSignedIn
    && cachedDashboard
    && (navigator.onLine === false || isError || allowSlowCache),
  );
  const waitingForFreshLifecycle = Boolean(
    isSignedIn
    && cachedDashboard
    && navigator.onLine !== false
    && !lifecycleQuery.isFetchedAfterMount
    && !allowSlowCache,
  );

  if (!bypassLifecycle && (
    !isLoaded
    || waitingForFreshLifecycle
    || (isSignedIn && isLoading && !canUseCachedLifecycle)
  )) {
    return <AccountLoadingScreen onRetry={isLoaded && isSignedIn ? () => void refetch() : undefined} />;
  }
  if (isSignedIn && !bypassLifecycle && (isError || !lifecycle) && !canUseCachedLifecycle) {
    return <AccountLoadingScreen error onRetry={() => void refetch()} />;
  }
  if (isSignedIn && !bypassLifecycle && lifecycle && lifecycle.status !== 'active') {
    return <LockedAccountPage status={lifecycle.status} pauseEndsAt={lifecycle.pauseEndsAt} deletionEligibleAt={lifecycle.deletionEligibleAt} expired={lifecycle.expired} userId={user!.id} />;
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
        <PublicLandingPage />
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
        if (prevUserIdRef.current) {
          clearPrivateOfflineAccountData(window.localStorage, prevUserIdRef.current);
        }
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

export { SupporterProfilePage, AccountLifecycleGate, ClerkQueryClientCacheInvalidator, queryClient };

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    clearRetiredStandaloneScheduleStorage(window.localStorage);
  }, []);

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
            title: "WELCOME BACK",
            subtitle: "Sign in to continue your athlete’s season",
          },
        },
        signUp: {
          start: {
            title: "JOIN PIXL SPORTS",
            subtitle: "Create an account to start your athlete’s season",
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
              <Suspense fallback={<RouteLoadingState />}>
                <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/studio/setup" component={RoleSelectionPage} />
              <Route path="/schedule/:shareToken" component={RetiredSchedulePage} />
              <Route path="/game-on/:shareToken" component={PublicGameOnCardPage} />
               <Route path="/checklist/:shareToken"><ChecklistPage shared /></Route>
               <Route path="/meeting/:shareToken" component={PublicMeetingRecapPage} />
               <Route path="/h/:shareToken" component={PublicHypeCardPage} />
               <Route path="/watch/:slug/:shareToken" component={PublicHypeCardPage} />
              <Route path="/live/:shareToken" component={PublicStatTrackerPage} />
              <Route path="/fan/:inviteToken" component={LivingAthleteCardRoute} />
               <Route path="/player/:inviteToken/manage" component={OwnerAthleteInviteManagePage} />
               <Route path="/player/:inviteToken" component={LegacyAthleteInviteRedirect} />
              <Route path="/studio/profile" component={SupporterProfilePage} />
               <Route path="/studio/athlete-page" component={AthleteInviteManager} />
              <Route path="/studio" component={StudioPortal} />
               <Route path="/studio/schedule/:id?" component={RetiredSchedulePage} />
              <Route path="/studio/stat-tracker"><ProtectedEditor kind="stat-tracker"><StatTrackerPage /></ProtectedEditor></Route>
               <Route path="/studio/season-stats"><ProtectedEditor kind="stat-tracker"><SeasonStatsPage /></ProtectedEditor></Route>
                <Route path="/studio/checklist"><ChecklistRoutePage /></Route>
              <Route path="/help" component={Help} />
              <Route path="/privacy" component={Privacy} />
                 <Route component={NotFound} />
                </Switch>
              </Suspense>
            </ErrorBoundary>
          </AccountLifecycleGate>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function RouteLoadingState() {
  return (
    <div
      className="grid min-h-dvh place-items-center bg-background text-sm font-bold uppercase tracking-widest text-muted-foreground"
      role="status"
    >
      Loading your studio…
    </div>
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
