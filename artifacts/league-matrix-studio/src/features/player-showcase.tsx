import { CalendarDays, Footprints, MessageCircle } from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetSoccerGearQueryKey,
  useGetSoccerGear,
  type SoccerGearState,
} from '@workspace/api-client-react';
import type { SupporterProfile } from './supporter-dashboard';
import { isSoccerGearForAthlete } from './athlete-locker-model';
import type { AthleteLockerGearStatus } from './athlete-locker-types';
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
  return <PlayerShowcaseContent profile={profile} gear={gear} gearStatus={gearStatus} onRetry={retry} />;
}

export default PlayerShowcasePage;
