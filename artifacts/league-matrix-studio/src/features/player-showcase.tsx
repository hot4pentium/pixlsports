import { ArrowRight, CalendarDays, Footprints, MessageCircle, ShieldCheck, Zap } from 'lucide-react';
import { Link } from 'wouter';
import { useClerk } from '@clerk/react';
import type { ReactNode } from 'react';
import {
  getGetSoccerGearQueryKey,
  getListAthleteInvitesQueryKey,
  useGetSoccerGear,
  useListAthleteInvites,
  useGetAthleteEditorAccess,
  getGetAthleteEditorAccessQueryKey,
  type SoccerGearState,
} from '@workspace/api-client-react';
import type { SupporterProfile } from './supporter-dashboard';
import { isSoccerGearForAthlete } from './athlete-locker-model';
import type { AthleteLockerGearStatus } from './athlete-locker-types';
import { AthleteEditorInvitationPanel } from './athlete-invite';
import jerseyPhoto from '@/assets/player-showcase-jersey-base.webp';
import './player-showcase.css';

export interface PlayerShowcaseContentProps {
  profile: SupporterProfile;
  gear: SoccerGearState | null;
  gearStatus: AthleteLockerGearStatus;
  onRetry?: () => void;
}

const DEFAULT_KIT = '#2878f5';

function sportLabel(sport: string | null) {
  return sport ? sport.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Sport';
}

function jerseyHue(color: string) {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (!match) return 0;
  const value = Number.parseInt(match[1], 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const delta = max - min;
  let hue = max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta;
  hue = (hue * 60 + 360) % 360;
  return Math.round(hue - 218);
}

function Jersey({ color, name, number, label }: { color: string; name: string; number: string; label: string }) {
  const body = 'M70 40 105 24c10 22 30 30 45 30s35-8 45-30l35 16 52 78-48 34-24-36v196H90V116l-24 36-48-34z';
  return (
    <svg className="ps__jersey" viewBox="0 0 300 380" role="img" aria-label={label}>
      <path d={body} fill={color} />
      <path d={body} fill="url(#ps-shade)" />
      <defs>
        <linearGradient id="ps-shade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".18" />
          <stop offset="1" stopColor="#000" stopOpacity=".3" />
        </linearGradient>
      </defs>
      <path d="M105 24c10 22 30 30 45 30s35-8 45-30" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" />
      <path d="M22 119l42 29m214-29-42 29" stroke="#fff" strokeWidth="12" />
      <text x="150" y="122" textAnchor="middle" fill="#fff" fontSize="26" fontWeight="800" letterSpacing="3" fontFamily="DM Sans,sans-serif">{name.toUpperCase().slice(0, 14)}</text>
      <text x="150" y="250" textAnchor="middle" fill="#fff" textLength={number.length > 2 ? 110 : undefined} lengthAdjust="spacingAndGlyphs" fontSize={number.length > 2 ? 90 : 118} fontWeight="900" fontFamily="Barlow Condensed,sans-serif">{number}</text>
    </svg>
  );
}

export function PlayerShowcaseContent({ profile, gear, gearStatus, onRetry }: PlayerShowcaseContentProps) {
  const isSoccer = profile.sport === 'soccer';
  const first = profile.athleteName.trim().split(/\s+/)[0] || 'Player';
  const number = profile.jerseyNumber.trim().replace(/^#/, '') || '—';
  const color = isSoccer && gearStatus === 'ready' && gear ? gear.loadout.jerseyColor : DEFAULT_KIT;
  const label = `${profile.athleteName || 'Player'} number ${number} ${sportLabel(profile.sport)} jersey`;
  const showError = isSoccer && gearStatus === 'error';

  return (
    <div className="ps" data-testid="page-player-showcase">
      <section className="ps__season" aria-labelledby="ps-season">
        <p className="ps__eyebrow">Your season</p>
        <h2 id="ps-season">Plan the week for {first}.</h2>
        <Link href="/studio" className="ps__btn" data-testid="link-showcase-parent-week">
          <CalendarDays size={18} aria-hidden="true" /> Plan your week
        </Link>
      </section>

      <section className="ps__stage-wrap" aria-labelledby="ps-dyn" data-testid="section-dynamic-showcase" style={{ minWidth: 0 }}>
        <h1 id="ps-dyn" className="ps__section-title">Dynamic <span>Showcase</span></h1>
        <div className="ps__stage" data-testid="showcase-jersey-stage">
          <p className="ps__team">{profile.teamName || 'Your team'}<br />{sportLabel(profile.sport)}</p>
          {isSoccer ? (
            <div className="ps__photo-wrap">
              <img
                className="ps__jersey-photo"
                src={jerseyPhoto}
                alt={label}
                data-testid="image-showcase-jersey"
                style={{ filter: `hue-rotate(${jerseyHue(color)}deg) saturate(1.08)` }}
              />
              <span className="ps__photo-name" aria-hidden="true">{first.toUpperCase().slice(0, 14)}</span>
              <span className="ps__photo-number" aria-hidden="true">{number}</span>
            </div>
          ) : (
            <Jersey color={color} name={first} number={number} label={label} />
          )}
          {isSoccer && gearStatus === 'loading' && (
            <p className="ps__loading" role="status" data-testid="status-showcase-gear-loading">Loading your saved kit…</p>
          )}
          <div className="ps__links">
            <Link href="/studio/hype-card" className="ps__link" data-testid="link-showcase-hype-card">
              <Zap size={18} aria-hidden="true" /> HYPE Card
            </Link>
            {isSoccer && (
              <Link href="/studio/soccer-gear" className="ps__link" data-testid="link-showcase-gear">
                <Footprints size={18} aria-hidden="true" /> Gear
              </Link>
            )}
            <Link href="/studio/athlete-page#owner-fan-hypes" className="ps__link" data-testid="link-showcase-shoutouts">
              <MessageCircle size={18} aria-hidden="true" /> Shoutouts
            </Link>
          </div>
          {isSoccer && gearStatus === 'unavailable' && <p className="ps__note" data-testid="status-showcase-gear-empty">No saved kit for {first} yet, so the default blue shows. Start in Gear.</p>}
          {!isSoccer && <p className="ps__note">Showing a {sportLabel(profile.sport)} jersey with {first}&rsquo;s name and number.</p>}
        </div>
        {showError && (
          <p className="ps__state" role="alert" data-testid="status-showcase-error" style={{ marginTop: 12 }}>
            Your saved kit couldn&rsquo;t load.
            {onRetry && <button type="button" onClick={onRetry} data-testid="button-showcase-retry">Try again</button>}
          </p>
        )}
      </section>
    </div>
  );
}

export function PlayerShowcasePage({ profile, userId }: { profile: SupporterProfile; userId: string | null }) {
  const { data: invites } = useListAthleteInvites({
    query: {
      enabled: Boolean(userId),
      queryKey: getListAthleteInvitesQueryKey(),
    },
  });
  const gearQuery = useGetSoccerGear({
    query: {
      enabled: Boolean(userId && profile.sport === 'soccer'),
      queryKey: [...getGetSoccerGearQueryKey(), userId],
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      retry: false,
    },
  });
  const gear = isSoccerGearForAthlete(gearQuery.data, profile.athleteName, profile.sport) ? gearQuery.data : null;
  const gearStatus: AthleteLockerGearStatus = profile.sport !== 'soccer' || !userId ? 'unavailable'
    : gearQuery.isLoading ? 'loading'
      : gearQuery.isError ? 'error'
        : gear ? 'ready' : 'unavailable';
  const retry = () => {
    if (gearQuery.isError) void gearQuery.refetch();
  };
  return (
    <>
      <PlayerShowcaseContent profile={profile} gear={gear} gearStatus={gearStatus} onRetry={retry} />
      <div className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-8">
        <AthleteEditorInvitationPanel inviteToken={invites?.[0]?.inviteToken ?? null} />
      </div>
    </>
  );
}

export function AthleteShowcaseHome() {
  const accessQuery = useGetAthleteEditorAccess({
    query: {
      queryKey: getGetAthleteEditorAccessQueryKey(),
      refetchOnMount: 'always',
      staleTime: 0,
      retry: false,
    },
  });
  const access = accessQuery.data;
  if (accessQuery.isLoading) {
    return <AthleteStudioShell><main className="grid min-h-[70dvh] place-items-center px-5"><div className="w-full max-w-xl space-y-4"><div className="h-4 w-28 animate-pulse bg-primary/20" /><div className="h-14 w-3/4 animate-pulse bg-muted" /><div className="h-36 animate-pulse bg-muted" /></div></main></AthleteStudioShell>;
  }
  if (accessQuery.isError || !access) {
    return (
      <AthleteStudioShell><main className="mx-auto grid min-h-[70dvh] w-full max-w-3xl place-items-center px-5 py-12">
        <section className="w-full border-l-4 border-primary bg-card p-7 sm:p-10" role="alert">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Athlete design access</p>
          <h1 className="mt-4 font-display text-4xl uppercase sm:text-6xl">This invite is unavailable.</h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">Ask your parent or guardian to confirm the invitation is active and sent to the email you use to sign in.</p>
          <button type="button" onClick={() => void accessQuery.refetch()} className="mt-6 inline-flex min-h-11 items-center gap-2 bg-primary px-5 text-xs font-bold uppercase tracking-widest text-primary-foreground">Try again <ArrowRight className="h-4 w-4" /></button>
        </section>
      </main></AthleteStudioShell>
    );
  }
  return (
    <AthleteStudioShell><main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-8" data-testid="athlete-showcase-home">
      <section className="relative overflow-hidden border-l-4 border-primary bg-[#0B1F3A] px-6 py-9 text-white sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute inset-0 bg-tech-grid opacity-20" />
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 border border-primary/40 bg-primary/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[.2em] text-primary"><Zap className="h-4 w-4" /> Athlete design studio</div>
          <p className="mt-7 text-xs font-bold uppercase tracking-[.18em] text-white/55">{access.teamName} · {access.seasonName}</p>
          <h1 className="mt-3 font-display text-5xl uppercase leading-[.9] sm:text-7xl">{access.athleteName}<span className="block text-primary">Your HYPE Card.</span></h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-white/70">Make the design yours. Your parent or guardian manages the athlete page, visibility, publishing, privacy, and sharing.</p>
          <Link href={`/studio/player-showcase/hype-card/${encodeURIComponent(access.projectId)}`} className="mt-7 inline-flex min-h-12 items-center gap-3 bg-primary px-6 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="link-athlete-edit-hype-card">
            Edit my HYPE Card <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
      <section className="mt-6 grid gap-4 sm:grid-cols-[1.1fr_.9fr]">
        <div className="border border-border bg-card p-5 sm:p-7">
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">Your profile</p>
          <h2 className="mt-3 font-display text-3xl uppercase">{access.teamName}</h2>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wider">
            {[access.sport, access.position, access.jerseyNumber ? `#${access.jerseyNumber.replace(/^#/, '')}` : ''].filter(Boolean).map((item) => <span key={item} className="border border-border bg-muted px-3 py-2">{item}</span>)}
          </div>
        </div>
        <div className="border border-border bg-primary/5 p-5 sm:p-7">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="mt-3 font-display text-2xl uppercase">A parent stays in control</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Your access is limited to one linked HYPE Card design. Page settings and sharing stay with your parent or guardian.</p>
        </div>
      </section>
    </main></AthleteStudioShell>
  );
}

function AthleteStudioShell({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return (
    <div className="noise min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/studio/player-showcase" className="inline-flex items-center" aria-label="Athlete showcase home">
            <img src={`${basePath}/pixlsports-logo.png`} alt="Pixl Sports" className="h-10 w-auto max-w-[160px] object-contain" />
          </Link>
          <button type="button" onClick={() => void signOut({ redirectUrl: basePath || '/' })} className="min-h-10 border border-border px-4 text-[10px] font-bold uppercase tracking-widest hover:border-primary hover:text-primary">Sign out</button>
        </div>
      </header>
      <div className="min-h-[calc(100dvh-68px)]">{children}</div>
    </div>
  );
}

export default PlayerShowcasePage;
