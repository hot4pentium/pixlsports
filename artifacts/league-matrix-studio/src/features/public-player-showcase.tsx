import {
  getGetAthleteFanCardQueryKey,
  getGetPublicJerseyShowcaseGearQueryKey,
  useGetAthleteFanCard,
  useGetPublicJerseyShowcaseGear,
} from '@workspace/api-client-react';
import { ArrowDownRight, ArrowUpRight, CalendarDays, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { useState } from 'react';
import { normalizeCardAppearance } from './hype-card-appearance';
import { gameOnHref } from './athlete-event-links';
import { JerseyLayerStage } from './jersey-layers';
import { FootballJerseyPreview } from './football-jersey-preview';
import { SportGearCollection } from './sport-gear-collection';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import './public-player-showcase.css';

export interface PublicPlayerShowcasePageProps {
  params: { inviteToken?: string };
}

function sportName(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function PublicPlayerShowcasePage({ params }: PublicPlayerShowcasePageProps) {
  const [selectedSlide, setSelectedSlide] = useState<'jersey' | 'card'>('jersey');
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
  const fanHref = `/fan/${encodeURIComponent(inviteToken)}`;
  const isSoccer = invite.sport === 'soccer';
  const isFootball = invite.sport === 'football';
  const activeSlide = selectedSlide;

  return (
    <main className="public-showcase" data-testid="page-public-player-showcase">
      <header className="public-showcase__topbar">
        <div className="public-showcase__brand" aria-label="Pixl Sports">
          <span className="public-showcase__brand-icon" aria-hidden="true">P</span>
          <span>PIXL <b>SPORTS</b></span>
        </div>
        <span className="public-showcase__safe-label"><ShieldCheck size={15} aria-hidden="true" /> Shared by family</span>
      </header>

      <section className="public-showcase__hero" aria-labelledby="public-showcase-title">
        <div className="public-showcase__hero-copy">
          <p className="public-showcase__eyebrow"><span /> Player profile / {sport}</p>
          <h1 id="public-showcase-title" data-testid="text-public-showcase-name">{invite.athleteName}<i>.</i></h1>
          <p className="public-showcase__intro">The season so far, in one place.</p>
          <div className="public-showcase__identity">
            <span>{invite.teamName || 'Team'}</span>
            <span aria-hidden="true">/</span>
            <span>{invite.seasonName || 'Current season'}</span>
          </div>
          <div className="public-showcase__carousel-tabs" role="tablist" aria-label={`${firstName}’s Showcase`} data-testid="public-showcase-carousel-tabs">
            <button type="button" role="tab" aria-selected={activeSlide === 'jersey'} onClick={() => setSelectedSlide('jersey')} data-testid="button-public-showcase-slide-jersey"><span>01</span> Jersey</button>
            <button type="button" role="tab" aria-selected={activeSlide === 'card'} onClick={() => setSelectedSlide('card')} data-testid="button-public-showcase-slide-card"><span>02</span> HYPE Card</button>
          </div>
          <Link href={fanHref} className="public-showcase__hype-link" data-testid="link-public-showcase-hype-card">
            <span className="public-showcase__hype-icon"><Sparkles size={19} aria-hidden="true" /></span>
            <span><small>Take a closer look</small><strong>Open {firstName}’s HYPE Card</strong></span>
            <ArrowUpRight className="public-showcase__hype-arrow" size={20} aria-hidden="true" />
          </Link>
          <span className="public-showcase__read-only"><ShieldCheck size={14} aria-hidden="true" /> Public view · read only</span>
        </div>

        <div className="public-showcase__visual" style={{ ['--showcase-accent' as string]: appearance.accentColor }}>
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
          </> : <div className="public-showcase__card-slide" data-testid="figure-public-showcase-hype-card">
            <div className="public-showcase__visual-index" aria-hidden="true"><span>02</span> SAVED HYPE CARD</div>
            <div className="public-showcase__card-art">
              <LivingAthleteCardFront athleteName={invite.athleteName} teamName={invite.teamName} photoUrl={invite.photoUrl} appearance={invite.cardAppearance} sport={invite.sport} cutoutUrl={invite.cutoutUrl} />
            </div>
            <Link href={fanHref} className="public-showcase__card-open" data-testid="link-public-showcase-card-interactive">
              <span><small>Front preview</small><strong>Open the interactive HYPE Card</strong></span><ArrowUpRight size={20} aria-hidden="true" />
            </Link>
            <span className="public-showcase__corner public-showcase__corner--one" aria-hidden="true" />
            <span className="public-showcase__corner public-showcase__corner--two" aria-hidden="true" />
          </div>}
        </div>
      </section>

      {showcaseGear && <section aria-label="Earned equipment" data-testid="section-public-showcase-gear">
        <p className="public-showcase__eyebrow">Earned equipment</p>
        <SportGearCollection sport={showcaseGear.sport} earnedGear={showcaseGear.earnedGear} equippedGear={showcaseGear.equippedGear} />
      </section>}

      <section className="public-showcase__details" aria-label="Athlete details">
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
      </section>

      <section className="public-showcase__events" aria-labelledby="public-showcase-events-title" data-testid="section-public-showcase-events">
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
      </section>

      <footer className="public-showcase__footer">
        <span>PIXL SPORTS <i>·</i> ATHLETE FIRST</span>
        <span>Made to celebrate the work.</span>
        <a href={fanHref} className="public-showcase__footer-link">HYPE Card <ArrowDownRight size={14} aria-hidden="true" /></a>
      </footer>
    </main>
  );
}

export default PublicPlayerShowcasePage;
