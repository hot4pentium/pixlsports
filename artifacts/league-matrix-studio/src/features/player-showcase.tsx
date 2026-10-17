import { useEffect, useState } from 'react';
import { CalendarDays, Footprints, MessageCircle } from 'lucide-react';
import { Link } from 'wouter';
import {
  getGetSoccerGearQueryKey,
  getListAthleteInvitesQueryKey,
  useGetSoccerGear,
  useListAthleteInvites,
  type OwnedAthleteInvite,
  type SoccerGearState,
} from '@workspace/api-client-react';
import type { SupporterProfile } from './supporter-dashboard';
import { getSupporterFanCard, getSupporterFanCardHref } from './supporter-dashboard-model';
import { isSoccerGearForAthlete } from './athlete-locker-model';
import { AthleteLocker, type AthleteLockerCardStatus, type AthleteLockerGearStatus } from './athlete-locker';
import './player-showcase.css';

export interface PlayerShowcaseContentProps {
  profile: SupporterProfile;
  card: OwnedAthleteInvite | null;
  cardHref: string | null;
  cardStatus: AthleteLockerCardStatus;
  gear: SoccerGearState | null;
  gearStatus: AthleteLockerGearStatus;
  onRetry?: () => void;
}

const DEFAULT_KIT = '#2878f5';

function useIsDesktop() {
  const query = '(min-width: 861px)';
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : true);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return match;
}

function sportLabel(sport: string | null) {
  return sport ? sport.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Sport';
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

export function PlayerShowcaseContent({ profile, card, cardHref, cardStatus, gear, gearStatus, onRetry }: PlayerShowcaseContentProps) {
  const desktop = useIsDesktop();
  const placement = desktop ? 'desktop' : 'mobile';
  const isSoccer = profile.sport === 'soccer';
  const first = profile.athleteName.trim().split(/\s+/)[0] || 'Player';
  const number = profile.jerseyNumber.trim().replace(/^#/, '') || '—';
  const color = isSoccer && gearStatus === 'ready' && gear ? gear.loadout.jerseyColor : DEFAULT_KIT;
  const label = `${profile.athleteName || 'Player'} number ${number} ${sportLabel(profile.sport)} jersey`;
  const showError = cardStatus === 'error' || (isSoccer && gearStatus === 'error');

  return (
    <div className="ps" data-testid="page-player-showcase">
      <h1 className="ps__title">Player <span>Showcase</span></h1>

      <section className="ps__season" aria-labelledby="ps-season">
        <p className="ps__eyebrow">Your season</p>
        <h2 id="ps-season">Plan the week for {first}.</h2>
        <Link href="/studio" className="ps__btn" data-testid="link-showcase-parent-week">
          <CalendarDays size={18} aria-hidden="true" /> Plan your week
        </Link>
      </section>

      <section className="ps__stage-wrap" aria-labelledby="ps-dyn" data-testid="section-dynamic-showcase" style={{ minWidth: 0 }}>
        <h2 id="ps-dyn" className="ps__section-title">Dynamic <span>Showcase</span></h2>
        <div className="ps__stage">
          <span className="ps__ring" aria-hidden="true" />
          <p className="ps__team">{profile.teamName || 'Your team'}<br />{sportLabel(profile.sport)}</p>
          {isSoccer && gearStatus === 'loading' ? (
            <p className="ps__state ps__skel" role="status" data-testid="status-showcase-gear-loading" style={{ marginTop: 120 }}>Loading the saved kit…</p>
          ) : (
            <Jersey color={color} name={first} number={number} label={label} />
          )}
          <div className="ps__podium" aria-hidden="true" />
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
            Some saved details couldn&rsquo;t load.
            {onRetry && <button type="button" onClick={onRetry} data-testid="button-showcase-retry">Try again</button>}
          </p>
        )}
      </section>

      <div className="ps__locker">
        <AthleteLocker
          key={placement}
          placement={placement}
          athleteName={profile.athleteName}
          teamName={profile.teamName}
          jerseyNumber={number}
          card={card}
          cardHref={cardHref}
          cardStatus={cardStatus}
          gear={gear}
          gearStatus={gearStatus}
          sport={profile.sport}
          eventCardsHref="/studio"
        />
      </div>
    </div>
  );
}

export function PlayerShowcasePage({ profile, userId }: { profile: SupporterProfile; userId: string | null }) {
  const invites = useListAthleteInvites({
    query: {
      enabled: Boolean(userId),
      queryKey: [...getListAthleteInvitesQueryKey(), userId],
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      retry: false,
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
  const list = invites.data ?? [];
  const card = getSupporterFanCard(list, profile) ?? null;
  const href = card ? getSupporterFanCardHref(list, profile) : null;
  const gear = isSoccerGearForAthlete(gearQuery.data, profile.athleteName, profile.sport) ? gearQuery.data : null;
  const cardStatus: AthleteLockerCardStatus = Boolean(userId) && invites.isLoading ? 'loading'
    : Boolean(userId) && invites.isError ? 'error'
      : card ? 'ready' : 'missing';
  const gearStatus: AthleteLockerGearStatus = profile.sport !== 'soccer' || !userId ? 'unavailable'
    : gearQuery.isLoading ? 'loading'
      : gearQuery.isError ? 'error'
        : gear ? 'ready' : 'unavailable';
  const retry = () => {
    if (invites.isError) void invites.refetch();
    if (gearQuery.isError) void gearQuery.refetch();
  };
  return <PlayerShowcaseContent profile={profile} card={card} cardHref={href} cardStatus={cardStatus} gear={gear} gearStatus={gearStatus} onRetry={retry} />;
}

export default PlayerShowcasePage;
