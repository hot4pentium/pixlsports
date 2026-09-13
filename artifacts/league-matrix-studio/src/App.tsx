import { type ReactNode, useEffect, useState } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  FileImage,
  FolderOpen,
  Grid2X2,
  Heart,
  Layers3,
  Lightbulb,
  Menu,
  MessageCircleQuestion,
  Palette,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { HypeCardEditor } from '@/features/hype-card';

const queryClient = new QueryClient();

type ToolKind = 'hype' | 'schedule' | 'awards';

const toolData: Record<ToolKind, {
  slug: string;
  label: string;
  kicker: string;
  description: string;
  icon: typeof Sparkles;
  accent: string;
  soft: string;
  templateNames: string[];
}> = {
  hype: {
    slug: 'hype-card',
    label: 'Moment Card Creator',
    kicker: 'Make the moment bigger.',
    description: 'Turn a photo or short video into a share-ready celebration of the play.',
    icon: Zap,
    accent: 'coral',
    soft: 'bg-[#fff0e9]',
    templateNames: ['Slugger', 'All-Star', 'Rookie', 'Dugout'],
  },
  schedule: {
    slug: 'schedule',
    label: 'Schedule Graphic Maker',
    kicker: 'Put the season in motion.',
    description: 'Turn a messy fixture list into a clean graphic families can follow.',
    icon: CalendarDays,
    accent: 'teal',
    soft: 'bg-[#e3f1ed]',
    templateNames: ['Clean Slate', 'Full Court', 'Weekend Run'],
  },
  awards: {
    slug: 'awards',
    label: 'Awards Creator',
    kicker: 'Give the good stuff a spotlight.',
    description: 'Celebrate effort, progress, and the players who show up for each other.',
    icon: Trophy,
    accent: 'gold',
    soft: 'bg-[#fff5cc]',
    templateNames: ['Player Spotlight', 'Big Heart', 'Season Standout'],
  },
};

function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="flex items-center gap-2.5" data-testid="brand-leaguematrix">
      <span className={`grid h-8 w-8 place-items-center rounded-[10px] ${inverse ? 'bg-[#f9f3e8] text-[#243248]' : 'bg-[#f36f4c] text-[#fff8ee]'} shadow-sm`}>
        <span className="font-display text-lg font-bold leading-none">L</span>
      </span>
      <span className={`font-display text-[17px] font-bold tracking-[-0.04em] ${inverse ? 'text-[#f9f3e8]' : 'text-foreground'}`}>
        League<span className={inverse ? 'text-[#f5c94d]' : 'text-primary'}>Matrix</span>
      </span>
    </span>
  );
}

function SiteNav({ dark = false }: { dark?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navText = dark ? 'text-[#f9f3e8]/72 hover:text-[#f9f3e8]' : 'text-muted-foreground hover:text-foreground';
  return (
    <header className={`relative z-30 ${dark ? 'bg-[#243248]' : 'bg-background'}`}>
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-12">
        <Link href="/" className="shrink-0" data-testid="link-logo-home"><BrandMark inverse={dark} /></Link>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
          <Link href="/studio" className={`text-sm font-semibold transition-colors ${navText}`} data-testid="link-nav-studio">Studio</Link>
          <Link href="/help" className={`text-sm font-semibold transition-colors ${navText}`} data-testid="link-nav-help">Help</Link>
          <Link href="/privacy" className={`text-sm font-semibold transition-colors ${navText}`} data-testid="link-nav-privacy">Privacy</Link>
          <Link href="/studio" className={`group flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold transition-transform hover:-translate-y-0.5 ${dark ? 'bg-[#f5c94d] text-[#243248]' : 'bg-primary text-primary-foreground'}`} data-testid="link-nav-start">
            Open Studio <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </nav>
        <button type="button" className={`grid h-10 w-10 place-items-center rounded-full md:hidden ${dark ? 'text-[#f9f3e8]' : 'text-foreground'}`} onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} data-testid="button-mobile-menu">
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {menuOpen && (
        <div className={`absolute inset-x-4 top-[64px] rounded-2xl border p-3 shadow-lg md:hidden ${dark ? 'border-[#566176] bg-[#2e3c52]' : 'border-border bg-card'}`} data-testid="menu-mobile">
          <Link href="/studio" className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold ${dark ? 'text-[#f9f3e8]' : 'text-foreground'}`} onClick={() => setMenuOpen(false)} data-testid="link-mobile-studio">Studio <ArrowRight className="h-4 w-4" /></Link>
          <Link href="/help" className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold ${dark ? 'text-[#f9f3e8]' : 'text-foreground'}`} onClick={() => setMenuOpen(false)} data-testid="link-mobile-help">Help <ArrowRight className="h-4 w-4" /></Link>
          <Link href="/privacy" className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold ${dark ? 'text-[#f9f3e8]' : 'text-foreground'}`} onClick={() => setMenuOpen(false)} data-testid="link-mobile-privacy">Privacy <ArrowRight className="h-4 w-4" /></Link>
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-8 text-sm text-muted-foreground sm:px-8 md:flex-row md:items-center md:justify-between lg:px-12">
        <BrandMark />
        <p>Made for the people who make game day happen.</p>
        <div className="flex gap-5 font-semibold">
          <Link href="/help" className="transition-colors hover:text-foreground" data-testid="link-footer-help">Help</Link>
          <Link href="/privacy" className="transition-colors hover:text-foreground" data-testid="link-footer-privacy">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}

function Home() {
  return (
    <div className="noise min-h-dvh overflow-hidden bg-background">
      <SiteNav />
      <main>
        <section className="relative overflow-hidden bg-[#243248] text-[#f9f3e8]">
          <div className="absolute -right-24 top-20 h-72 w-72 rounded-full border-[34px] border-[#f36f4c]/20 sm:h-96 sm:w-96" />
          <div className="absolute -bottom-32 left-[43%] h-64 w-64 rounded-full bg-[#177d76]/40 blur-3xl" />
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20 lg:grid-cols-[1.04fr_.96fr] lg:gap-20 lg:px-12 lg:pb-28 lg:pt-24">
            <div className="relative z-10">
              <div className="animate-rise mb-7 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.2em] text-[#f5c94d]">
                <span className="h-2 w-2 rounded-full bg-[#f5c94d]" /> The creative side of game day
              </div>
              <h1 className="animate-rise animate-rise-delay-1 max-w-3xl font-display text-[clamp(3.4rem,8vw,7.7rem)] font-bold leading-[.88] tracking-[-0.075em]">
                Make your<br /><span className="text-[#f36f4c]">moment</span> count.
              </h1>
              <p className="animate-rise animate-rise-delay-2 mt-8 max-w-lg text-lg leading-relaxed text-[#d5d9d8] sm:text-xl">
                LeagueMatrix turns the little wins, big games, and long Saturdays into graphics worth sharing. No design degree. No account. Just start.
              </p>
              <div className="animate-rise animate-rise-delay-3 mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link href="/studio" className="group inline-flex items-center justify-center gap-3 rounded-full bg-[#f5c94d] px-6 py-3.5 text-sm font-bold text-[#243248] transition-transform hover:-translate-y-1" data-testid="link-hero-open-studio">
                  Start making <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <span className="inline-flex items-center gap-2 px-2 text-sm text-[#d5d9d8]"><ShieldCheck className="h-4 w-4 text-[#65c7b6]" /> Your work stays on your device</span>
              </div>
            </div>
            <div className="relative z-10 mx-auto w-full max-w-[510px] animate-rise animate-rise-delay-2">
              <div className="absolute -left-5 -top-5 z-20 hidden rounded-2xl border border-[#f9f3e8]/20 bg-[#35445c] px-4 py-3 shadow-2xl sm:block">
                <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-[#f5c94d]"><span className="h-1.5 w-1.5 rounded-full bg-[#f5c94d]" /> Live preview</div>
                <p className="font-display text-sm font-bold">Change it. See it. Share it.</p>
              </div>
              <div className="relative rotate-[2deg] rounded-[28px] bg-[#f36f4c] p-3 shadow-[18px_24px_0_rgba(0,0,0,.16)] transition-transform duration-500 hover:rotate-0">
                <div className="relative flex aspect-[.88] flex-col justify-between overflow-hidden rounded-[20px] bg-[#f8e8d4] p-6 text-[#243248] sm:p-8">
                  <div className="absolute -right-12 top-12 h-56 w-56 rounded-full border-[24px] border-[#177d76]/30" />
                  <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-[#f5c94d]" />
                  <div className="relative flex items-center justify-between text-[10px] font-bold uppercase tracking-[.18em]"><span>Eastside Falcons</span><span className="rounded-full bg-[#243248] px-2.5 py-1 text-[#f8e8d4]">Sat / 10.12</span></div>
                  <div className="relative">
                    <p className="font-display text-6xl font-bold leading-[.8] tracking-[-.07em] sm:text-8xl">GAME<br /><span className="text-[#f36f4c]">ON.</span></p>
                    <div className="mt-5 flex items-center gap-3"><span className="h-px w-10 bg-[#243248]/40" /><span className="text-xs font-bold uppercase tracking-[.15em]">Home court energy</span></div>
                  </div>
                  <div className="relative flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.15em]">Falcons vs. Northside</p><p className="mt-1 font-display text-xl font-bold">Tip-off 4:30 PM</p></div><Zap className="h-12 w-12 fill-[#f36f4c] text-[#f36f4c]" /></div>
                </div>
              </div>
              <div className="animate-drift absolute -bottom-7 -right-2 rounded-full bg-[#177d76] px-4 py-2.5 text-xs font-bold uppercase tracking-[.15em] text-[#f9f3e8] shadow-lg sm:-right-8"><Sparkles className="mr-2 inline h-3.5 w-3.5" /> No account needed</div>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-[#f8e8d4]">
          <div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 sm:grid-cols-3 sm:px-8 lg:px-12">
            {[
              ['01', 'Pick a starting point', 'Templates with enough personality to get you moving.'],
              ['02', 'Make it yours', 'Names, colors, details — all the good stuff is yours.'],
              ['03', 'Keep the momentum', 'Your project stays local while you shape the final.'],
            ].map(([number, title, body], index) => (
              <div key={number} className={`flex gap-4 ${index > 0 ? 'border-t border-[#243248]/15 pt-6 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0' : ''}`} data-testid={`feature-step-${number}`}>
                <span className="font-display text-2xl font-bold text-[#f36f4c]">{number}</span>
                <div><p className="font-display text-base font-bold text-[#243248]">{title}</p><p className="mt-1 text-sm leading-relaxed text-[#243248]/65">{body}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-secondary">Three ways to bring the energy</p>
            <h2 className="mt-4 font-display text-4xl font-bold leading-[.95] tracking-[-.06em] text-foreground sm:text-6xl">Small tools.<br />Big <span className="text-primary">presence.</span></h2>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
            <ToolFeatureCard kind="hype" large />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
              <ToolFeatureCard kind="schedule" />
              <ToolFeatureCard kind="awards" />
            </div>
          </div>
        </section>

        <section className="bg-[#177d76] text-[#f9f3e8]">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[.85fr_1.15fr] lg:px-12 lg:py-28">
            <div>
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5c94d] text-[#243248]"><FolderOpen className="h-5 w-5" /></div>
              <p className="text-xs font-bold uppercase tracking-[.18em] text-[#f5c94d]">A calmer creative workflow</p>
              <h2 className="mt-4 font-display text-4xl font-bold leading-[.95] tracking-[-.06em] sm:text-5xl">Open it.<br />Make it.<br /><span className="text-[#f5c94d]">Keep it.</span></h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                [Palette, 'No blank canvas', 'Start with a sharp point of view, then make the details yours.'],
                [ShieldCheck, 'Local by default', 'Projects live in your browser. No login, upload, or surprise inbox.'],
                [SquarePen, 'Made for real life', 'Fast enough between practice and pickup, polished enough to post.'],
                [Heart, 'Celebrate more', 'The good stuff deserves more than a group-chat text.'],
              ].map(([Icon, title, body]) => {
                const IconComponent = Icon as typeof Palette;
                return <div key={title as string} className="rounded-2xl border border-[#f9f3e8]/15 bg-[#f9f3e8]/[.08] p-5 transition-colors hover:bg-[#f9f3e8]/[.13]"><IconComponent className="h-5 w-5 text-[#f5c94d]" /><p className="mt-6 font-display text-lg font-bold">{title as string}</p><p className="mt-2 text-sm leading-relaxed text-[#d5e4e0]">{body as string}</p></div>;
              })}
            </div>
          </div>
        </section>

        <section className="bg-[#f5c94d]">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-5 py-16 sm:px-8 md:flex-row md:items-end lg:px-12 lg:py-20">
            <div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#243248]/65">Ready when you are</p><h2 className="mt-3 max-w-xl font-display text-4xl font-bold leading-[.95] tracking-[-.06em] text-[#243248] sm:text-6xl">Your next post is<br />already in you.</h2></div>
            <Link href="/studio" className="group inline-flex items-center gap-3 rounded-full bg-[#243248] px-6 py-3.5 text-sm font-bold text-[#f9f3e8] transition-transform hover:-translate-y-1" data-testid="link-bottom-open-studio">Open the studio <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></Link>
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
    <Link href={`/studio/${tool.slug}`} className={`group relative overflow-hidden rounded-[24px] border border-border ${large ? 'min-h-[390px] bg-[#243248] text-[#f9f3e8]' : 'min-h-[185px] bg-card text-foreground'} p-6 transition-transform duration-300 hover:-translate-y-1 sm:p-7`} data-testid={`link-tool-${kind}`}>
      <div className={`absolute -right-10 -top-10 h-36 w-36 rounded-full ${kind === 'hype' ? 'bg-[#f36f4c]/20' : kind === 'schedule' ? 'bg-[#177d76]/15' : 'bg-[#f5c94d]/35'} transition-transform duration-500 group-hover:scale-125`} />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between"><span className={`grid h-11 w-11 place-items-center rounded-2xl ${kind === 'hype' ? 'bg-[#f36f4c] text-[#fff8ee]' : kind === 'schedule' ? 'bg-[#d5ebe6] text-[#177d76]' : 'bg-[#f5c94d] text-[#243248]'}`}><Icon className="h-5 w-5" /></span><ArrowUpRight className="h-5 w-5 opacity-50 transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" /></div>
        <div className={large ? 'mt-20' : 'mt-7'}><p className={`text-xs font-bold uppercase tracking-[.16em] ${large ? 'text-[#f5c94d]' : 'text-secondary'}`}>{tool.kicker}</p><h3 className={`mt-2 font-display font-bold leading-[.96] tracking-[-.05em] ${large ? 'text-4xl sm:text-5xl' : 'text-2xl'}`}>{tool.label}</h3><p className={`mt-3 max-w-md text-sm leading-relaxed ${large ? 'text-[#d5d9d8]' : 'text-muted-foreground'}`}>{tool.description}</p></div>
      </div>
    </Link>
  );
}

function StudioLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <div className="noise min-h-dvh bg-background">
      <SiteNav />
      <div className="border-y border-border bg-[#f8e8d4]">
        <div className="mx-auto flex max-w-7xl items-center gap-5 overflow-x-auto px-5 sm:px-8 lg:px-12">
          <Link href="/studio" className={`shrink-0 border-b-2 py-3.5 text-xs font-bold uppercase tracking-[.16em] ${location === '/studio' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid="link-studio-directory">All tools</Link>
          {Object.entries(toolData).map(([key, tool]) => <Link key={key} href={`/studio/${tool.slug}`} className={`shrink-0 border-b-2 py-3.5 text-xs font-bold uppercase tracking-[.16em] ${location.includes(tool.slug) ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} data-testid={`link-toolbar-${key}`}>{tool.label.replace(' Creator', '').replace(' Graphic Maker', '')}</Link>)}
        </div>
      </div>
      {children}
    </div>
  );
}

function Studio() {
  const [hasProject, setHasProject] = useState(false);
  useEffect(() => setHasProject(window.localStorage.getItem('leaguematrix-project') === 'true'), []);
  return (
    <StudioLayout>
      <main className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-12 lg:py-20">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div><div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-secondary"><Sparkles className="h-4 w-4" /> Creative studio</div><h1 className="font-display text-5xl font-bold leading-[.9] tracking-[-.07em] text-foreground sm:text-7xl">Make something<br /><span className="text-primary">worth sharing.</span></h1><p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">Choose a starting point. Tweak the details. Walk away with a graphic that feels like your team.</p></div>
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-bold text-muted-foreground"><span className="h-2 w-2 rounded-full bg-[#177d76]" /> Works offline in your browser</div>
        </div>
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {(Object.keys(toolData) as ToolKind[]).map((kind, index) => <ToolDirectoryCard key={kind} kind={kind} index={index} />)}
        </div>
        <section className="mt-16 grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
          <div className="paper-grid rounded-[24px] border border-border bg-card p-6 sm:p-8">
            <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-secondary">Local projects</p><h2 className="mt-2 font-display text-3xl font-bold tracking-[-.05em]">Pick up where you left off.</h2></div><FolderOpen className="h-5 w-5 text-primary" /></div>
            {hasProject ? <div className="mt-8 flex items-center justify-between rounded-2xl border border-[#f5c94d] bg-[#fff8dc] p-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#f5c94d] text-[#243248]"><FileImage className="h-5 w-5" /></span><div><p className="font-display font-bold">Moment Card project</p><p className="text-xs text-muted-foreground">Saved on this device</p></div></div><Link href="/studio/hype-card" className="rounded-full bg-[#243248] px-4 py-2 text-xs font-bold text-[#f9f3e8]" data-testid="link-resume-project">Resume</Link></div> : <div className="mt-8 rounded-2xl border border-dashed border-border bg-background/60 p-7 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground"><Plus className="h-5 w-5" /></div><p className="mt-4 font-display font-bold">No projects yet</p><p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-muted-foreground">Start with a tool above. Your first project will be remembered here.</p></div>}
          </div>
          <div className="rounded-[24px] bg-[#243248] p-6 text-[#f9f3e8] sm:p-8"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f5c94d] text-[#243248]"><Lightbulb className="h-5 w-5" /></div><h2 className="mt-8 max-w-sm font-display text-3xl font-bold leading-[.96] tracking-[-.05em]">A good graphic starts with one clear idea.</h2><p className="mt-4 max-w-sm text-sm leading-relaxed text-[#d5d9d8]">Keep the words short. Make the feeling obvious. Let the template handle the rest.</p><div className="mt-8 flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-[#f5c94d]">A little creative direction <ArrowRight className="h-4 w-4" /></div></div>
        </section>
      </main>
    </StudioLayout>
  );
}

function ToolDirectoryCard({ kind, index }: { kind: ToolKind; index: number }) {
  const tool = toolData[kind];
  const Icon = tool.icon;
  return <Link href={`/studio/${tool.slug}`} className={`group relative overflow-hidden rounded-[24px] border border-border p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${tool.soft}`} data-testid={`card-tool-${kind}`}><div className="flex items-start justify-between"><span className="font-display text-sm font-bold text-foreground/45">0{index + 1}</span><span className={`grid h-11 w-11 place-items-center rounded-2xl ${kind === 'hype' ? 'bg-[#f36f4c] text-white' : kind === 'schedule' ? 'bg-[#177d76] text-white' : 'bg-[#f5c94d] text-[#243248]'}`}><Icon className="h-5 w-5" /></span></div><h2 className="mt-16 max-w-[250px] font-display text-3xl font-bold leading-[.95] tracking-[-.06em]">{tool.label}</h2><p className="mt-3 max-w-[270px] text-sm leading-relaxed text-foreground/65">{tool.description}</p><div className="mt-7 flex items-center gap-2 text-xs font-bold uppercase tracking-[.15em] text-foreground">Start here <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></div></Link>;
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
    setNotice('Saved on this device');
    window.setTimeout(() => setNotice(''), 2400);
  };
  const resetProject = () => {
    setSelectedTemplate(0);
    setSaved(false);
    setValues({ headline: kind === 'hype' ? 'GAME ON.' : kind === 'schedule' ? 'WEEKEND RUN' : 'PLAYER SPOTLIGHT', subline: kind === 'hype' ? 'Falcons vs. Northside' : kind === 'schedule' ? 'Eastside Falcons · Fall 2024' : 'For showing up and shining bright', name: kind === 'awards' ? 'Maya Chen' : '', detail: kind === 'schedule' ? 'SAT 10.12  ·  4:30 PM' : '' });
    setNotice('Project reset');
    window.setTimeout(() => setNotice(''), 2400);
  };
  return (
    <StudioLayout>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3"><Link href="/studio" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground" aria-label="Back to studio" data-testid="button-back-studio"><ArrowLeft className="h-4 w-4" /></Link><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-secondary"><Icon className="h-3.5 w-3.5" /> {tool.label}</div><p className="mt-1 hidden text-sm text-muted-foreground sm:block">{tool.kicker}</p></div></div>
          <div className="flex items-center gap-2"><span className={`hidden items-center gap-1.5 text-xs font-semibold text-muted-foreground sm:flex ${saved ? 'opacity-100' : 'opacity-0'}`}><Check className="h-3.5 w-3.5 text-[#177d76]" /> Saved locally</span><button type="button" onClick={saveProject} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-bold transition-colors hover:bg-muted" data-testid="button-save-project"><Save className="h-3.5 w-3.5" /> Save</button></div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(260px,330px)_1fr]">
          <aside className="order-2 rounded-[22px] border border-border bg-card p-5 lg:order-1 lg:p-6">
            <div className="mb-6 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">Build your graphic</p><span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold text-muted-foreground">1 / 3</span></div>
            <div className="space-y-5">
              <Field label={kind === 'awards' ? 'Award title' : 'Main message'} value={values.headline} onChange={(value) => setValue('headline', value)} testId="input-main-message" />
              <Field label={kind === 'awards' ? 'The why' : 'Supporting line'} value={values.subline} onChange={(value) => setValue('subline', value)} testId="input-supporting-line" />
              {kind === 'awards' && <Field label="Player name" value={values.name} onChange={(value) => setValue('name', value)} testId="input-player-name" />}
              {kind === 'schedule' && <Field label="Next up" value={values.detail} onChange={(value) => setValue('detail', value)} testId="input-next-up" />}
            </div>
            <div className="my-6 h-px bg-border" />
            <div><div className="mb-3 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">Starting point</p><Grid2X2 className="h-4 w-4 text-muted-foreground" /></div><div className="grid grid-cols-3 gap-2">{tool.templateNames.map((name, index) => <button type="button" key={name} onClick={() => setSelectedTemplate(index)} className={`min-h-[62px] rounded-xl border px-2 py-2 text-left text-[11px] font-bold leading-tight transition-all ${selectedTemplate === index ? 'border-primary bg-[#fff0e9] text-foreground ring-1 ring-primary' : 'border-border bg-background text-muted-foreground hover:border-primary/60'}`} data-testid={`button-template-${index}`}>{name}</button>)}</div></div>
            <div className="my-6 h-px bg-border" />
            <div><p className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">Color feeling</p><div className="flex gap-2">{['#f36f4c', '#177d76', '#f5c94d', '#243248'].map((color) => <button type="button" key={color} onClick={() => setNotice('Color palette selected')} className="h-8 w-8 rounded-full border-2 border-background shadow-[0_0_0_1px_hsl(var(--border))] transition-transform hover:scale-110" style={{ backgroundColor: color }} aria-label={`Choose ${color} color`} data-testid={`button-color-${color.slice(1)}`} />)}</div></div>
            <div className="mt-7 flex gap-2"><button type="button" onClick={resetProject} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-border px-3 py-2.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" data-testid="button-reset-project"><RotateCcw className="h-3.5 w-3.5" /> Reset</button><button type="button" onClick={() => setNotice('Preview is ready to share in a future update')} className="inline-flex flex-[1.35] items-center justify-center gap-2 rounded-full bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="button-next-preview">Next: Preview <ArrowRight className="h-3.5 w-3.5" /></button></div>
            {notice && <p className="mt-3 text-center text-xs font-semibold text-secondary" role="status" data-testid="status-editor-notice">{notice}</p>}
          </aside>
          <section className="order-1 min-w-0 lg:order-2">
            <div className="flex items-center justify-between pb-4"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">Live canvas</p><p className="mt-1 text-sm text-muted-foreground">Your graphic updates as you type.</p></div><span className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#177d76]" /> Local preview</span></div>
            <Preview kind={kind} values={values} selectedTemplate={selectedTemplate} />
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-border bg-card p-4"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#fff5cc] text-[#a87700]"><Lightbulb className="h-4 w-4" /></div><p className="text-xs leading-relaxed text-muted-foreground"><span className="font-bold text-foreground">Keep it punchy.</span> Schedule and Award tools are currently preview-only. Moment Cards support local photo and video uploads plus finished downloads.</p></div>
          </section>
        </div>
      </main>
    </StudioLayout>
  );
}

function Field({ label, value, onChange, testId }: { label: string; value: string; onChange: (value: string) => void; testId: string }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold text-foreground">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3.5 text-sm font-medium outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" data-testid={testId} /></label>;
}

function Preview({ kind, values, selectedTemplate }: { kind: ToolKind; values: { headline: string; subline: string; name: string; detail: string }; selectedTemplate: number }) {
  const isSchedule = kind === 'schedule';
  const isAwards = kind === 'awards';
  const templateClass = selectedTemplate === 1 ? 'bg-[#177d76]' : selectedTemplate === 2 ? 'bg-[#f5c94d]' : 'bg-[#f36f4c]';
  const foreground = selectedTemplate === 2 ? 'text-[#243248]' : 'text-[#f9f3e8]';
  return <div className="paper-grid relative flex min-h-[410px] items-center justify-center overflow-hidden rounded-[24px] border border-border bg-[#e8dfd0] p-5 sm:min-h-[580px] sm:p-10"><div className={`relative aspect-[1.12] w-full max-w-[650px] overflow-hidden rounded-[22px] ${templateClass} p-5 shadow-[12px_16px_0_rgba(36,50,72,.12)] transition-colors duration-300 sm:p-8`} data-testid="preview-canvas"><div className={`absolute -right-20 -top-16 h-60 w-60 rounded-full border-[28px] ${selectedTemplate === 2 ? 'border-[#f36f4c]/45' : 'border-[#f5c94d]/35'}`} /><div className={`absolute -bottom-24 -left-16 h-64 w-64 rounded-full ${selectedTemplate === 1 ? 'bg-[#f5c94d]' : 'bg-[#177d76]'}`} /><div className={`relative flex h-full flex-col justify-between ${foreground}`}><div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.16em]"><span>{isAwards ? 'LeagueMatrix · Recognition' : isSchedule ? 'Eastside Falcons' : 'Eastside Falcons'}</span><span className="rounded-full border border-current px-2.5 py-1">{isAwards ? '2024' : isSchedule ? 'Fall season' : 'Game day'}</span></div><div className="relative max-w-[85%]"><p className="font-display text-[clamp(2.5rem,7vw,6.2rem)] font-bold leading-[.82] tracking-[-.08em]">{values.headline || 'YOUR MESSAGE'}</p><p className="mt-5 max-w-md text-sm font-bold leading-relaxed opacity-85 sm:text-base">{isAwards && values.name ? `${values.name} · ` : ''}{values.subline || 'Add a supporting line'}</p></div><div className="relative flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] opacity-80">{isAwards ? 'A moment worth remembering' : isSchedule ? 'Next up' : 'Bring the energy'}</p><p className="mt-1 font-display text-lg font-bold sm:text-2xl">{values.detail || (isAwards ? 'Your team sees the work.' : 'Falcons vs. Northside')}</p></div><div className="grid h-11 w-11 place-items-center rounded-xl border border-current sm:h-14 sm:w-14"><IconForPreview kind={kind} /></div></div></div></div><div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-[.16em] text-foreground/40">Preview only · export arrives next</div></div>;
}

function IconForPreview({ kind }: { kind: ToolKind }) {
  if (kind === 'schedule') return <CalendarDays className="h-5 w-5 sm:h-6 sm:w-6" />;
  if (kind === 'awards') return <Trophy className="h-5 w-5 sm:h-6 sm:w-6" />;
  return <Zap className="h-5 w-5 fill-current sm:h-6 sm:w-6" />;
}

function Privacy() {
  return <div className="noise min-h-dvh bg-background"><SiteNav /><main className="mx-auto max-w-3xl px-5 py-16 sm:px-8 lg:py-24"><div className="mb-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#d5ebe6] text-[#177d76]"><ShieldCheck className="h-7 w-7" /></div><p className="text-xs font-bold uppercase tracking-[.18em] text-secondary">The short version</p><h1 className="mt-4 font-display text-5xl font-bold leading-[.92] tracking-[-.07em] sm:text-7xl">Your graphics<br /><span className="text-primary">are yours.</span></h1><p className="mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground">LeagueMatrix is designed to be useful before it asks you for anything. Phase 1 has no accounts, no database, and no cloud project storage.</p><div className="mt-14 space-y-4"><PrivacyBlock title="What stays on your device" icon={FolderOpen}>The project details you enter in the studio are kept in your browser so you can pick up where you left off. They are not sent to our servers in this release.</PrivacyBlock><PrivacyBlock title="What we collect" icon={ShieldCheck}>We do not collect names, team information, images, or design content in Phase 1. There is no sign-in form hiding around the corner.</PrivacyBlock><PrivacyBlock title="What changes later" icon={Layers3}>If we add optional cloud features in a future release, we will explain exactly what they do before you turn them on. This page will be updated in plain language.</PrivacyBlock><PrivacyBlock title="Questions?" icon={MessageCircleQuestion}>If something feels unclear, ask us. We would rather make the answer obvious than make you read a wall of legal copy.</PrivacyBlock></div><Link href="/help" className="mt-10 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" data-testid="link-privacy-help">Read help & FAQs <ArrowRight className="h-4 w-4" /></Link></main><Footer /></div>;
}

function PrivacyBlock({ title, icon: Icon, children }: { title: string; icon: typeof FolderOpen; children: ReactNode }) {
  return <article className="rounded-[20px] border border-border bg-card p-5 sm:p-6"><div className="flex items-start gap-4"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-secondary"><Icon className="h-5 w-5" /></div><div><h2 className="font-display text-xl font-bold tracking-[-.03em]">{title}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p></div></div></article>;
}

function Help() {
  const [open, setOpen] = useState<number | null>(0);
  const questions = [
    ['Do I need an account?', 'No. LeagueMatrix is built to let you start immediately. Phase 1 runs without an account, login, or cloud storage.'],
    ['Where does my project go?', 'When you save, a small local marker is kept in this browser. Your project does not leave your device in this release. Clearing browser data can remove it.'],
    ['Can I export my graphic?', 'Yes for Moment Cards. Add a photo or a video up to 15 seconds, design the card, and download a finished image or video locally. Schedule Graphics and Awards are currently preview-only.'],
    ['What should I make first?', 'Start with a Moment Card for a big play, a Schedule Graphic for a season snapshot, or an Award for a player moment worth remembering.'],
    ['Is LeagueMatrix a league-management tool?', 'No. It is a creative studio for the posts, cards, and celebrations around sports. It is not a roster, registration, or league operations system.'],
  ];
  return <div className="noise min-h-dvh bg-background"><SiteNav /><main className="mx-auto max-w-5xl px-5 py-16 sm:px-8 lg:py-24"><div className="grid gap-12 lg:grid-cols-[.75fr_1.25fr]"><div><div className="mb-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff5cc] text-[#a87700]"><CircleHelp className="h-7 w-7" /></div><p className="text-xs font-bold uppercase tracking-[.18em] text-secondary">A little clarity</p><h1 className="mt-4 font-display text-5xl font-bold leading-[.92] tracking-[-.07em] sm:text-7xl">Good questions<br /><span className="text-primary">welcome.</span></h1><p className="mt-6 max-w-sm text-base leading-relaxed text-muted-foreground">Short answers for the moments when you just want to get back to making something.</p><Link href="/studio" className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#243248] px-5 py-3 text-sm font-bold text-[#f9f3e8]" data-testid="link-help-studio">Go to studio <ArrowRight className="h-4 w-4" /></Link></div><div className="space-y-3" data-testid="faq-list">{questions.map(([question, answer], index) => <div key={question} className={`rounded-[18px] border bg-card transition-colors ${open === index ? 'border-primary/50' : 'border-border'}`}><button type="button" className="flex w-full items-center justify-between gap-4 p-5 text-left sm:p-6" onClick={() => setOpen(open === index ? null : index)} aria-expanded={open === index} data-testid={`button-faq-${index}`}><span className="font-display text-lg font-bold tracking-[-.03em]">{question}</span><ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${open === index ? 'rotate-180' : ''}`} /></button>{open === index && <div className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground sm:px-6 sm:pb-6">{answer}</div>}</div>)}</div></div><div className="mt-16 rounded-[24px] bg-[#177d76] p-7 text-[#f9f3e8] sm:p-9"><div className="flex items-start justify-between gap-6"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#f5c94d]">Still curious?</p><h2 className="mt-3 font-display text-3xl font-bold tracking-[-.05em]">Ask the person who made it.</h2><p className="mt-3 max-w-lg text-sm leading-relaxed text-[#d5e4e0]">The best product feedback is specific. Tell us what you were trying to make, where you got stuck, and what would have helped.</p></div><MessageCircleQuestion className="hidden h-8 w-8 text-[#f5c94d] sm:block" /></div><a href="mailto:hello@leaguematrix.studio" className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#f5c94d] px-5 py-3 text-sm font-bold text-[#243248]" data-testid="link-email-help">Email the studio <ArrowUpRight className="h-4 w-4" /></a></div></main><Footer /></div>;
}

function NotFound() {
  return <div className="min-h-dvh bg-background"><SiteNav /><main className="mx-auto flex max-w-3xl flex-col items-start px-5 py-28 sm:px-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">404 · Out of bounds</p><h1 className="mt-4 font-display text-6xl font-bold tracking-[-.08em] sm:text-8xl">That play<br />isn't here.</h1><p className="mt-6 max-w-md text-muted-foreground">Try heading back to the studio and picking a new starting point.</p><Link href="/studio" className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" data-testid="link-404-studio">Back to studio <ArrowRight className="h-4 w-4" /></Link></main></div>;
}

function Router() {
  return <ErrorBoundary resetKey={useLocation()[0]}><Switch><Route path="/" component={Home} /><Route path="/studio" component={Studio} /><Route path="/studio/hype-card"><HypeCardEditor /></Route><Route path="/studio/schedule"><EditorPage kind="schedule" /></Route><Route path="/studio/awards"><EditorPage kind="awards" /></Route><Route path="/privacy" component={Privacy} /><Route path="/help" component={Help} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;