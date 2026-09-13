import { useListProjects, useDeleteProject, getListProjectsQueryKey } from '@workspace/api-client-react';
import { formatDistanceToNow } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check,
  ChevronDown, CircleHelp, FileImage, FolderOpen, Grid2X2,
  Heart, Layers3, Lightbulb, Menu, MessageCircleQuestion,
  Palette, Plus, RotateCcw, Save, ShieldCheck, Sparkles,
  SquarePen, Trophy, X, Zap, Maximize, Activity
} from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HypeCardEditor } from '@/features/hype-card';

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
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

type ToolKind = 'hype' | 'schedule' | 'awards';

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
    label: 'Schedule Graphic Maker',
    kicker: 'Put the season in motion.',
    description: 'Turn a messy fixture list into a clean graphic families can follow.',
    icon: CalendarDays,
    accent: 'bg-white text-foreground',
    soft: 'bg-[#22252a] text-white',
    templateNames: ['Clean Slate', 'Full Court', 'Weekend Run'],
  },
  awards: {
    slug: 'awards',
    label: 'Awards Creator',
    kicker: 'Give the good stuff a spotlight.',
    description: 'Celebrate effort, progress, and the players who show up for each other.',
    icon: Trophy,
    accent: 'bg-muted text-foreground',
    soft: 'bg-[#2a2d35] text-white',
    templateNames: ['Player Spotlight', 'Big Heart', 'Season Standout'],
  },
};

function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="flex items-center gap-2" data-testid="brand-leaguematrix">
      <span className={`grid h-8 w-8 place-items-center clip-angled-sm ${inverse ? 'bg-primary text-primary-foreground' : 'bg-foreground text-background'}`}>
        <span className="font-display text-xl leading-none mt-0.5">LM</span>
      </span>
      <span className={`font-display text-2xl tracking-wide mt-1 ${inverse ? 'text-white' : 'text-foreground'}`}>
        LEAGUE<span className="text-primary">MATRIX</span>
      </span>
    </span>
  );
}


function SiteNav({ dark = false }: { dark?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navText = dark ? 'text-white/70 hover:text-white' : 'text-muted-foreground hover:text-foreground';
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  return (
    <header className={`relative z-30 border-b ${dark ? 'bg-foreground border-white/10' : 'bg-background border-border'}`}>
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
          <p className="text-sm font-medium text-muted-foreground">Premium local-first sports graphics.<br/>No account required.</p>
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
          <div className="absolute inset-0 bg-tech-grid-dark opacity-30" />
          <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/15 rounded-full blur-[120px] mix-blend-screen pointer-events-none animate-stadium-flash" />

          <div className="relative z-10 mx-auto grid max-w-[1400px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1.1fr_.9fr] lg:gap-20">
            <div>
              <div className="animate-slide-up mb-6 inline-flex items-center gap-2 bg-primary/20 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-primary clip-angled-sm">
                <Activity className="h-4 w-4" /> Live Broadcast Booth
              </div>
              <h1 className="animate-slide-up delay-100 font-display text-[clamp(4rem,9vw,9rem)] leading-[0.85] tracking-tight">
                MAKE YOUR<br /><span className="text-primary">MOMENT</span> COUNT.
              </h1>
              <p className="animate-slide-up delay-200 mt-8 max-w-xl text-lg font-medium leading-relaxed text-white/70 sm:text-xl">
                LeagueMatrix turns the little wins, big games, and long Saturdays into graphics worth sharing. Professional sports aesthetic. Local privacy. Zero friction.
              </p>
              <div className="animate-slide-up delay-300 mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link href="/studio" className="group inline-flex items-center justify-center gap-3 bg-primary px-8 py-4 text-sm font-bold uppercase tracking-wider text-primary-foreground clip-angled-sm transition-transform hover:scale-105" data-testid="link-hero-open-studio">
                  Enter The Studio <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
                <span className="inline-flex items-center gap-2 px-2 text-sm font-medium text-white/60">
                  <ShieldCheck className="h-5 w-5 text-primary" /> Guest offline mode available
                </span>
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
              <ToolFeatureCard kind="awards" />
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

function StudioLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <div className="noise min-h-dvh bg-background flex flex-col">
      <SiteNav dark />
      <div className="border-b border-border bg-background bg-tech-grid">
        <div className="mx-auto flex max-w-[1400px] items-center gap-8 overflow-x-auto px-5 sm:px-8 bg-background/90 backdrop-blur-sm no-scrollbar">
          <Link href="/studio" className={`shrink-0 border-b-4 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${location === '/studio' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid="link-studio-directory">Command Center</Link>
          {Object.entries(toolData).map(([key, tool]) => (
            <Link key={key} href={`/studio/${tool.slug}`} className={`shrink-0 border-b-4 py-4 text-sm font-bold uppercase tracking-widest transition-colors ${location.includes(tool.slug) ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid={`link-toolbar-${key}`}>
              {tool.label.replace(' Creator', '').replace(' Graphic Maker', '')}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        {children}
      </div>
      <Footer />
    </div>
  );
}



function Studio() {
  const [hasProject, setHasProject] = useState(false);
  const { user, isSignedIn } = useUser();
  const queryClient = useQueryClient();

  useEffect(() => setHasProject(Boolean(window.localStorage.getItem('leaguematrix-hype-card-project-v2'))), []);

  const { data: cloudProjects, isLoading } = useListProjects({
    query: { enabled: !!isSignedIn, queryKey: getListProjectsQueryKey() }
  });

  const deleteProject = useDeleteProject({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      }
    }
  });

  return (
    <StudioLayout>
      <main className="mx-auto w-full max-w-[1400px] px-5 py-12 sm:px-8 lg:py-20 flex-1">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 bg-muted px-3 py-1 text-xs font-bold uppercase tracking-widest text-foreground clip-angled-sm">
              <Maximize className="h-4 w-4" /> Command Center
            </div>
            <h1 className="font-display text-5xl leading-[0.9] tracking-tight text-foreground sm:text-7xl uppercase">
              SELECT YOUR<br /><span className="text-primary">STARTING PLAY.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg font-medium leading-relaxed text-muted-foreground">
              Hype Cards export finished images and videos. Schedule and Award tools are currently preview-only.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 bg-card border border-border px-5 py-3 text-sm font-bold uppercase tracking-wider text-muted-foreground clip-angled-sm shadow-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" /> {isSignedIn ? 'Cloud Sync Active' : 'Local Environment Active'}
          </div>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {(Object.keys(toolData) as ToolKind[]).map((kind, index) => <ToolDirectoryCard key={kind} kind={kind} index={index} />)}
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
                      <div key={project.id} className="flex items-center justify-between border-l-4 border-foreground bg-muted p-5 clip-angled-sm transition-colors hover:bg-muted/80 group/project">
                        <div className="flex items-center gap-4 min-w-0">
                          <span className="grid h-12 w-12 shrink-0 place-items-center bg-background text-foreground clip-angled-sm border border-border">
                            <Layers3 className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 overflow-hidden">
                            <p className="font-display text-xl uppercase tracking-wide truncate">{project.name}</p>
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-1 truncate">
                              Design • Rev {project.revision} • {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
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
                          <Link href={`/studio/hype-card/${project.id}`} className="bg-foreground px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-background clip-angled-sm hover:scale-105 transition-transform" data-testid={`link-resume-cloud-project-${project.id}`}>
                            Open
                          </Link>
                        </div>
                      </div>
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
      </main>
    </StudioLayout>
  );
}

function ToolDirectoryCard({ kind, index }: { kind: ToolKind; index: number }) {
  const tool = toolData[kind];
  const Icon = tool.icon;
  return (
    <Link href={`/studio/${tool.slug}`} className={`group relative overflow-hidden border border-border/10 p-6 sm:p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl clip-angled-sm ${tool.soft}`} data-testid={`card-tool-${kind}`}>
      <div className="absolute inset-0 bg-tech-grid-dark opacity-20" />
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
  const tool = toolData[kind];
  const Icon = tool.icon;
  const [selectedTemplate, setSelectedTemplate] = useState(0);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState('');
  const [values, setValues] = useState({ headline: kind === 'hype' ? 'GAME ON.' : kind === 'schedule' ? 'WEEKEND RUN' : 'PLAYER SPOTLIGHT', subline: kind === 'hype' ? 'Falcons vs. Northside' : kind === 'schedule' ? 'Eastside Falcons · Fall 2024' : 'For showing up and shining bright', name: kind === 'awards' ? 'Maya Chen' : '', detail: kind === 'schedule' ? 'SAT 10.12  ·  4:30 PM' : '' });
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
    setValues({ headline: kind === 'hype' ? 'GAME ON.' : kind === 'schedule' ? 'WEEKEND RUN' : 'PLAYER SPOTLIGHT', subline: kind === 'hype' ? 'Falcons vs. Northside' : kind === 'schedule' ? 'Eastside Falcons · Fall 2024' : 'For showing up and shining bright', name: kind === 'awards' ? 'Maya Chen' : '', detail: kind === 'schedule' ? 'SAT 10.12  ·  4:30 PM' : '' });
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
              <Field label={kind === 'awards' ? 'Award title' : 'Main message'} value={values.headline} onChange={(value) => setValue('headline', value)} testId="input-main-message" />
              <Field label={kind === 'awards' ? 'The why' : 'Supporting line'} value={values.subline} onChange={(value) => setValue('subline', value)} testId="input-supporting-line" />
              {kind === 'awards' && <Field label="Player name" value={values.name} onChange={(value) => setValue('name', value)} testId="input-player-name" />}
              {kind === 'schedule' && <Field label="Next up" value={values.detail} onChange={(value) => setValue('detail', value)} testId="input-next-up" />}
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
  const isAwards = kind === 'awards';
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
            <span>{isAwards ? 'LeagueMatrix · Recognition' : 'Eastside Falcons'}</span>
            <span className="rounded-full border border-current px-2.5 py-1">{isAwards ? '2024' : isSchedule ? 'Fall season' : 'Game day'}</span>
          </div>
          <div className="relative max-w-[85%]">
            <p className="font-display text-[clamp(2.5rem,7vw,6.2rem)] font-bold leading-[.82] tracking-[-.08em]">{values.headline || 'YOUR MESSAGE'}</p>
            <p className="mt-5 max-w-md text-sm font-bold leading-relaxed opacity-85 sm:text-base">{isAwards && values.name ? `${values.name} · ` : ''}{values.subline || 'Add a supporting line'}</p>
          </div>
          <div className="relative flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.16em] opacity-80">{isAwards ? 'A moment worth remembering' : isSchedule ? 'Next up' : 'Bring the energy'}</p>
              <p className="mt-1 font-display text-lg font-bold sm:text-2xl">{values.detail || (isAwards ? 'Your team sees the work.' : 'Falcons vs. Northside')}</p>
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
  if (kind === 'awards') return <Trophy className="h-5 w-5 sm:h-6 sm:w-6" />;
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
            <h2 className="font-display text-3xl uppercase tracking-wide">Can I use my own fonts?</h2>
            <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">The studio relies on heavily optimized, pre-selected display fonts designed specifically for sports impact. Custom font uploads are not supported to ensure immediate rendering without layout shifts.</p>
          </section>
          <section>
            <h2 className="font-display text-3xl uppercase tracking-wide">Video export is failing.</h2>
            <p className="mt-3 text-base font-medium leading-relaxed text-muted-foreground">Video export pushes your device's hardware. If it fails, make sure your source video is under 15 seconds, you are not using power-saving mode, and you have sufficient free memory on your device.</p>
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
          <a href="mailto:hello@leaguematrix.studio" className="bg-foreground text-background font-bold uppercase tracking-wider px-6 py-3 clip-angled-sm hover:scale-105 transition-transform whitespace-nowrap">Contact Team</a>
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
          <p className="lead font-medium text-xl">The short version: We don't track your team, and LeagueMatrix does not upload newly attached photos, videos, or logos. Account saves contain reusable design settings only.</p>
          <h3>1. Local Execution</h3>
          <p>LeagueMatrix is built as a local-first application. When you attach a photo, video, or logo to create a graphic, that media is processed on your device using browser APIs. Saving a design to your account sends the layout, text, colors, crop settings, and output configuration, but not the attached media. Older cloud projects created before this policy may temporarily retain their previously uploaded media until it is removed in a later migration.</p>
          <h3>2. Analytics</h3>
          <p>We do not use tracking pixels, session recording tools, or advertising analytics in this release.</p>
          <h3>3. Cookies</h3>
          <p>Project settings and attached media may be kept in local browser storage so they can survive a reload. If you create an account, Clerk uses necessary session cookies to maintain your login. We do not use advertising cookies.</p>
          <h3>4. Your Media</h3>
          <p>You are responsible for having the rights and any required consent to use media you attach, including permission involving minors. To share a finished card, export the image or video and share that file; LeagueMatrix does not host new finished media for public sharing.</p>
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
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
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
          <Link href="/studio" className="group lg:hidden inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:text-white bg-white/5 px-3 py-1.5 clip-angled-sm" data-testid="link-auth-guest-access-mobile">
            Guest Studio <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
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
              <p className="text-sm font-bold uppercase tracking-wider text-white" data-testid="status-cloud-optional">Cloud sync is optional.</p>
              <p className="mt-2 text-sm font-medium leading-relaxed text-white/60">
                You don't need an account to create graphics. Local editing remains fully available for guest users.
              </p>
              <Link href="/studio" className="group mt-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:text-white" data-testid="link-auth-guest-access">
                Return to Guest Studio <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
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
  return (
    <AuthLayout
      title={<>ENTER<br/><span className="text-primary">CONTROL ROOM.</span></>}
      subtitle="Access your saved templates, synced rosters, and broadcast graphics across all your devices."
    >
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthLayout>
  );
}

function SignUpPage() {
  return (
    <AuthLayout
      title={<>CREATE<br/><span className="text-primary">CALLSIGN.</span></>}
      subtitle="Join LeagueMatrix to save your custom templates and broadcast settings securely in the cloud."
    >
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthLayout>
  );
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
          <ErrorBoundary resetKey={useLocation()[0]}>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/studio" component={Studio} />
              <Route path="/studio/hype-card" component={HypeCardEditor} />
              <Route path="/studio/hype-card/:id" component={HypeCardEditor} />
              <Route path="/studio/schedule"><EditorPage kind="schedule" /></Route>
              <Route path="/studio/awards"><EditorPage kind="awards" /></Route>
              <Route path="/help" component={Help} />
              <Route path="/privacy" component={Privacy} />
              <Route component={NotFound} />
            </Switch>
          </ErrorBoundary>
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
