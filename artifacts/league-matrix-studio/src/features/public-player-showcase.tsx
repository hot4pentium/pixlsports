import {
  getGetAthleteFanCardQueryKey,
  getGetPublicJerseyShowcaseGearQueryKey,
  useGetAthleteFanCard,
  useGetPublicJerseyShowcaseGear,
} from '@workspace/api-client-react';
import { ArrowUpRight, CalendarDays, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { useState } from 'react';
import { normalizeCardAppearance } from './hype-card-appearance';
import { gameOnHref } from './athlete-event-links';
import { JerseyLayerStage } from './jersey-layers';
import { FootballJerseyPreview } from './football-jersey-preview';
import { SportGearCollection } from './sport-gear-collection';
import { LivingAthleteCardPage } from './living-athlete-card';
import { FanCardFollow } from './fan-card-follow';
import { useShowcaseSwipe } from './use-showcase-swipe';
import './public-player-showcase.css';

export interface PublicPlayerShowcasePageProps {
  params: { inviteToken?: string };
}

function sportName(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function PublicPlayerShowcasePage({ params }: PublicPlayerShowcasePageProps) {
  const [selectedSlide, setSelectedSlide] = useState<'jersey' | 'card'>('jersey');
  const swipeHandlers = useShowcaseSwipe(setSelectedSlide);
  const inviteToken = params.inviteToken ?? '';
  const { data: invite, isLoading, isError, refetch } = useGetAthleteFanCard(inviteToken, {
    query: {
      enabled: !!inviteToken,
      queryKey: getGetAthleteFanCardQueryKey(inviteToken),
      retry: false,
      refetchOnWindowFocus: true,
    },
  });
  const { data: publicGear } = useGetPublicJerseyShowcaseGear(inviteToken, {
    query: {
      enabled: !!inviteToken,
      queryKey: getGetPublicJerseyShowcaseGearQueryKey(inviteToken),
      retry: false,
      refetchOnWindowFocus: true,
    },
  });

  if (isLoading) {
    return (
      <main className="public-showcase public-showcase--state" aria-busy="true" role="status" data-testid="status-public-showcase-loading">
        <div className="public-showcase__state-panel">
          <span className="public-showcase__state-mark" aria-hidden="true">PS</span>
          <p className="public-showcase__eyebrow">Pixl Sports · Athlete showcase</p>
          <div className="public-showcase__skeleton public-showcase__skeleton--title" />
          <div className="public-showcase__skeleton public-showcase__skeleton--line" />
          <div className="public-showcase__skeleton public-showcase__skeleton--stage" />
          <span className="public-showcase__loading-copy">Getting the showcase ready</span>
        </div>
      </main>
    );
  }

  if (isError || !invite) {
    return (
      <main className="public-showcase public-showcase--state" role="alert" data-testid="status-public-showcase-unavailable">
        <section className="public-showcase__state-panel public-showcase__state-panel--error">
          <span className="public-showcase__state-mark" aria-hidden="true">PS</span>
          <p className="public-showcase__eyebrow">A private-by-default share</p>
          <h1>This showcase isn’t available.</h1>
          <p>The link may have expired, or the athlete’s family may have paused sharing. Check with the person who sent it.</p>
          {inviteToken && <button className="public-showcase__retry" type="button" onClick={() => void refetch()} data-testid="button-public-showcase-retry">Try again <ArrowUpRight size={16} aria-hidden="true" /></button>}
        </section>
      </main>
    );
  }

  const appearance = normalizeCardAppearance(invite.cardAppearance);
  const firstName = invite.athleteName.trim().split(/\s+/)[0] || 'Athlete';
  const jerseyNumber = appearance.jerseyNumber.replace(/^#/, '');
  const sport = sportName(invite.sport);
  const events = invite.showEvents ? invite.events ?? [] : [];
  const showcaseGear = publicGear?.sport === invite.sport ? {
    sport: publicGear.sport,
    earnedGear: publicGear.earnedGear,
    equippedGear: publicGear.loadout.equippedGear,
  } : null;
  const isSoccer = invite.sport === 'soccer';
  const isFootball = invite.sport === 'football';
  const activeSlide = selectedSlide;

  return (
    <main className={`public-showcase${activeSlide === 'card' ? ' public-showcase--card' : ''}`} data-testid="page-public-player-showcase">
      {activeSlide === 'jersey' && <header className="public-showcase__topbar">
        <div className="public-showcase__brand" aria-label="Pixl Sports">
          <span className="public-showcase__brand-icon" aria-hidden="true">P</span>
          <span>PIXL <b>SPORTS</b></span>
        </div>
        <span className="public-showcase__safe-label"><ShieldCheck size={15} aria-hidden="true" /> Shared by family</span>
      </header>}

      <section className="public-showcase__hero" aria-labelledby="public-showcase-title">
        <div className="public-showcase__hero-copy">
          {activeSlide === 'jersey' && <p className="public-showcase__eyebrow"><span /> Player profile / {sport}</p>}
          <h1 id="public-showcase-title" data-testid="text-public-showcase-name">{invite.athleteName}<i>.</i></h1>
          {activeSlide === 'jersey' && <><p className="public-showcase__intro">The season so far, in one place.</p>
          <div className="public-showcase__identity">
            <span>{invite.teamName || 'Team'}</span>
            <span aria-hidden="true">/</span>
            <span>{invite.seasonName || 'Current season'}</span>
          </div></>}
          <div className="public-showcase__carousel-tabs" role="group" aria-label={`${firstName}’s Showcase`} data-testid="public-showcase-carousel-tabs">
            <button type="button" aria-pressed={activeSlide === 'jersey'} onClick={() => setSelectedSlide('jersey')} data-testid="button-public-showcase-slide-jersey"><span>01</span> Jersey</button>
            <button type="button" aria-pressed={activeSlide === 'card'} onClick={() => setSelectedSlide('card')} data-testid="button-public-showcase-slide-card"><span>02</span> HYPE Card</button>
          </div>
          {activeSlide === 'jersey' && <span className="public-showcase__read-only"><ShieldCheck size={14} aria-hidden="true" /> Public view · read only</span>}
        </div>

        <div className={`public-showcase__visual${activeSlide === 'card' ? ' public-showcase__visual--card' : ''}`} role="group" aria-roledescription="carousel" aria-label={`${firstName}’s jersey and HYPE Card`} {...swipeHandlers} style={{ ['--showcase-accent' as string]: appearance.accentColor }}>
          {activeSlide === 'jersey' ? <>
            <div className="public-showcase__visual-orbit" aria-hidden="true" />
            <div className="public-showcase__visual-index" aria-hidden="true"><span>01</span> / SEASON ID</div>
            <div className="public-showcase__kit-display" data-testid="figure-public-showcase-jersey">
            {isFootball ? (
              <FootballJerseyPreview
                name={firstName}
                number={jerseyNumber}
                label={`${invite.athleteName} ${jerseyNumber ? `number ${jerseyNumber}` : ''} football jersey`}
                accent={publicGear?.sport === invite.sport ? publicGear.loadout.jerseyColor : undefined}
                showcaseGear={showcaseGear}
              />
            ) : (
              <JerseyLayerStage
                loadout={isSoccer ? invite.soccerGear ?? null : null}
                name={firstName}
                number={jerseyNumber}
                label={`${invite.athleteName} ${jerseyNumber ? `number ${jerseyNumber}` : ''} ${sport} jersey`}
                showcaseGear={showcaseGear}
              />
            )}
            </div>
            {invite.photoUrl && (
              <div className="public-showcase__portrait">
                <img src={invite.photoUrl} alt={`${invite.athleteName}, ${sport} athlete`} data-testid="img-public-showcase-athlete" />
              </div>
            )}
            <div className="public-showcase__visual-name" aria-hidden="true">
              <span>{invite.teamName || sport}</span>
              <strong>{jerseyNumber ? `#${jerseyNumber}` : sport.toUpperCase()}</strong>
            </div>
            <span className="public-showcase__corner public-showcase__corner--one" aria-hidden="true" />
            <span className="public-showcase__corner public-showcase__corner--two" aria-hidden="true" />
          </> : <div className="public-showcase__card-slide public-showcase__card-slide--interactive" data-testid="figure-public-showcase-hype-card">
            <div className="public-showcase__card-interactive" data-testid="public-showcase-interactive-hype-card">
              <LivingAthleteCardPage params={{ inviteToken }} embedded />
            </div>
          </div>}
        </div>
      </section>

      {activeSlide === 'jersey' && showcaseGear && <section className="public-showcase__gear" aria-label="Earned equipment" data-testid="section-public-showcase-gear">
        <p className="public-showcase__eyebrow">Earned equipment</p>
        <SportGearCollection sport={showcaseGear.sport} earnedGear={showcaseGear.earnedGear} equippedGear={showcaseGear.equippedGear} />
      </section>}

      {activeSlide === 'jersey' && <section className="public-showcase__details" aria-label="Athlete details">
        <div className="public-showcase__detail">
          <span className="public-showcase__detail-label">Sport</span>
          <strong>{sport}</strong>
        </div>
        <div className="public-showcase__detail">
          <span className="public-showcase__detail-label">Team</span>
          <strong>{invite.teamName || '—'}</strong>
        </div>
        <div className="public-showcase__detail">
          <span className="public-showcase__detail-label">Season</span>
          <strong>{invite.seasonName || '—'}</strong>
        </div>
        {appearance.position && <div className="public-showcase__detail">
          <span className="public-showcase__detail-label">Position</span>
          <strong>{appearance.position}</strong>
        </div>}
      </section>}

      {activeSlide === 'jersey' && <section className="public-showcase__events" aria-labelledby="public-showcase-events-title" data-testid="section-public-showcase-events">
        <div className="public-showcase__section-heading">
          <div>
            <p className="public-showcase__eyebrow">On the calendar</p>
            <h2 id="public-showcase-events-title">Game day, <em>ahead.</em></h2>
          </div>
          <span className="public-showcase__section-icon"><CalendarDays size={19} aria-hidden="true" /></span>
        </div>
        {events.length ? (
          <div className="public-showcase__event-list">
            {events.map((event) => (
              <Link key={`${event.shareToken}-${event.eventId}`} href={gameOnHref(event.shareToken)} className="public-showcase__event" data-testid={`link-public-showcase-event-${event.eventId}`}>
                <span className="public-showcase__event-date">{event.date || 'UP NEXT'}</span>
                <span className="public-showcase__event-main">
                  <strong>{event.opponent ? `vs ${event.opponent}` : event.title || 'Event'}</strong>
                  <small>{[event.time, event.location].filter(Boolean).join(' · ') || 'Event details'}</small>
                </span>
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
            ))}
          </div>
        ) : (
          <p className="public-showcase__empty-events" data-testid="text-public-showcase-no-events">
            {invite.showEvents ? 'No public Event Cards have been shared yet.' : 'The family has kept event details private.'}
          </p>
        )}
        {invite.showEvents && (
          <div className="public-showcase__alerts" data-testid="section-public-showcase-alerts">
            <FanCardFollow inviteToken={inviteToken} surface="showcase" />
          </div>
        )}
      </section>}

      {activeSlide === 'jersey' && <footer className="public-showcase__footer">
        <span>PIXL SPORTS <i>·</i> ATHLETE FIRST</span>
        <span>Made to celebrate the work.</span>
      </footer>}
    </main>
  );
}

export default PublicPlayerShowcasePage;
