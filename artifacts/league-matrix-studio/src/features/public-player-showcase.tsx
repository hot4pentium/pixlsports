import { useGetAthleteFanCard, getGetAthleteFanCardQueryKey } from '@workspace/api-client-react';
import { ArrowDownRight, ArrowUpRight, CalendarDays, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import { normalizeCardAppearance } from './hype-card-appearance';
import { gameOnHref } from './athlete-event-links';
import { JerseyLayerStage } from './jersey-layers';
import './public-player-showcase.css';

export interface PublicPlayerShowcasePageProps {
  params: { inviteToken?: string };
}

function sportName(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function GenericJersey({ name, number, accent, sport }: { name: string; number: string; accent: string; sport: string }) {
  return (
    <div className="public-showcase__generic-kit">
      <svg viewBox="0 0 300 380" role="img" aria-label="Team jersey illustration">
        <defs>
          <linearGradient id="public-kit-shade" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".22" />
            <stop offset="1" stopColor="#071630" stopOpacity=".46" />
          </linearGradient>
        </defs>
        <path d="M70 40 105 24c10 22 30 30 45 30s35-8 45-30l35 16 52 78-48 34-24-36v196H90V116l-24 36-48-34z" fill={accent} />
        <path d="M70 40 105 24c10 22 30 30 45 30s35-8 45-30l35 16 52 78-48 34-24-36v196H90V116l-24 36-48-34z" fill="url(#public-kit-shade)" />
        <path d="M105 24c10 22 30 30 45 30s35-8 45-30" fill="none" stroke="#f3f6fa" strokeWidth="11" />
        <path d="m22 119 42 29m214-29-42 29" stroke="#f3f6fa" strokeWidth="11" />
        <text x="150" y="120" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800" letterSpacing="2" fontFamily="DM Sans,sans-serif">{name.toUpperCase().slice(0, 14)}</text>
        <text x="150" y="255" textAnchor="middle" fill="#fff" fontSize={number.length > 2 ? 82 : 112} fontWeight="900" fontFamily="Barlow Condensed,Impact,sans-serif">{number || '—'}</text>
      </svg>
    </div>
  );
}

export function PublicPlayerShowcasePage({ params }: PublicPlayerShowcasePageProps) {
  const inviteToken = params.inviteToken ?? '';
  const { data: invite, isLoading, isError, refetch } = useGetAthleteFanCard(inviteToken, {
    query: {
      enabled: !!inviteToken,
      queryKey: getGetAthleteFanCardQueryKey(inviteToken),
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
  const fanHref = `/fan/${encodeURIComponent(inviteToken)}`;
  const isSoccer = invite.sport === 'soccer';

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
          <Link href={fanHref} className="public-showcase__hype-link" data-testid="link-public-showcase-hype-card">
            <span className="public-showcase__hype-icon"><Sparkles size={19} aria-hidden="true" /></span>
            <span><small>Take a closer look</small><strong>Open {firstName}’s HYPE Card</strong></span>
            <ArrowUpRight className="public-showcase__hype-arrow" size={20} aria-hidden="true" />
          </Link>
          <span className="public-showcase__read-only"><ShieldCheck size={14} aria-hidden="true" /> Public view · read only</span>
        </div>

        <div className="public-showcase__visual" style={{ ['--showcase-accent' as string]: appearance.accentColor }}>
          <div className="public-showcase__visual-orbit" aria-hidden="true" />
          <div className="public-showcase__visual-index" aria-hidden="true"><span>01</span> / SEASON ID</div>
          <div className="public-showcase__kit-display" data-testid="figure-public-showcase-jersey">
            {isSoccer ? (
              <JerseyLayerStage
                loadout={invite.soccerGear ?? null}
                name={firstName}
                number={jerseyNumber}
                label={`${invite.athleteName} ${jerseyNumber ? `number ${jerseyNumber}` : ''} soccer jersey`}
              />
            ) : (
              <GenericJersey name={firstName} number={jerseyNumber} accent="#2878f5" sport={sport} />
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
        </div>
      </section>

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
