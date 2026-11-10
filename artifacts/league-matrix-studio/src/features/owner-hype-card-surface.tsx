import { useEffect, useState } from 'react';
import { CalendarDays, ChartNoAxesCombined, Play, RectangleVertical, SquarePlay } from 'lucide-react';
import type { PublicAthleteFanCard } from '@workspace/api-client-react';
import { LivingCardVideo } from './living-card-video';
import { NativeHypeCardFront } from './living-athlete-card-front';
import { LivingCardControls } from './living-card-controls';
import {
  armFlip,
  beginFlip,
  flipDurationMs,
  initialFlipState,
  reconcileFlip,
  settleFlip,
  type CardSide,
  type PrimaryCardSide,
} from './hype-card-flip-model';
import { getOwnerHypeCardSides } from './owner-hype-card-surface-model';
import './owner-hype-card-surface.css';

type OwnerInvite = {
  showHypeCard: boolean;
  showStats: boolean;
  showEvents: boolean;
  paused: boolean;
  photoUrl?: string | null;
  cardAppearance?: PublicAthleteFanCard['cardAppearance'];
  seasonName?: string;
};

type Props = {
  card: PublicAthleteFanCard | null;
  invite?: OwnerInvite | null;
  athleteName: string;
  teamName?: string;
  sport?: string;
  privatePreview?: boolean;
};

function CardSideContent({ side, card, athleteName, teamName, seasonName }: {
  side: PrimaryCardSide;
  card: PublicAthleteFanCard;
  athleteName: string;
  teamName: string;
  seasonName: string;
}) {
  if (side === 'front') {
    return <NativeHypeCardFront athleteName={athleteName} teamName={teamName} seasonName={seasonName} photoUrl={card.photoUrl} appearance={card.cardAppearance} />;
  }
  if (side === 'videos') {
    return (
      <section className="owner-card-side owner-card-side--videos" data-testid="owner-card-videos-side">
        <div className="owner-card-side__heading">
          <span>Shared moments</span>
          <h2>Videos</h2>
        </div>
        {card.videos.length ? (
          <ul className="owner-card-videos">
            {card.videos.map((video) => (
              <li key={video.shareToken}>
                <LivingCardVideo src={video.videoUrl} poster={video.posterUrl} token={`owner-${video.shareToken}`} active={false} />
                <div className="owner-card-media-caption">
                  <strong>{video.title || 'Athlete video'}</strong>
                  <span>{video.mediaName}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="owner-card-empty" data-testid="owner-card-videos-empty">
            <SquarePlay aria-hidden="true" />
            <strong>Videos will appear here</strong>
            <span>Shared athlete videos will be available on this side of the HYPE Card.</span>
          </div>
        )}
      </section>
    );
  }
  if (side === 'stats') {
    const stats = card.stats;
    return (
      <section className="owner-card-side" data-testid="owner-card-stats-side">
        <div className="owner-card-side__heading">
          <span>Season record</span>
          <h2>Stats</h2>
          <p>{athleteName} · {teamName || card.sport} · Finalized games only</p>
        </div>
        {stats ? (
          <>
            <div className="owner-card-stat-lead">
              <div><strong>{stats.record.wins}–{stats.record.losses}–{stats.record.ties}</strong><span>W – L – T</span></div>
              <div><strong>{stats.gamesPlayed}</strong><span>Games played</span></div>
              <div><strong>{stats.score}</strong><span>Team points / runs</span></div>
            </div>
            {Object.entries(stats.stats).length > 0 && (
              <dl className="owner-card-stat-grid">
                {Object.entries(stats.stats).map(([name, value]) => (
                  <div key={name}><dt>{name.replace(/[-_]/g, ' ')}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            )}
            {stats.games.length > 0 && (
              <section className="owner-card-final-games" aria-label="Finalized games">
                <h3>Finalized games</h3>
                {stats.games.map((game, index) => (
                  <div className="owner-card-game-row" key={`${game.date}-${game.opponent}-${index}`}>
                    <span><strong>{game.opponent ? `vs ${game.opponent}` : `Game ${index + 1}`}</strong><small>{game.date || 'Date not set'}</small></span>
                    <strong>{game.scoreRecorded ? `${game.score}–${game.opponentScore}` : 'Final'}</strong>
                  </div>
                ))}
              </section>
            )}
          </>
        ) : (
          <div className="owner-card-empty"><ChartNoAxesCombined aria-hidden="true" /><strong>Stats are not available yet</strong><span>Finalized stats will appear here when they are published.</span></div>
        )}
      </section>
    );
  }
  return (
    <section className="owner-card-side" data-testid="owner-card-events-side">
      <div className="owner-card-side__heading">
        <span>{seasonName || 'Season schedule'}</span>
        <h2>Events</h2>
        <p>Recent and upcoming Event Cards from {athleteName}’s season.</p>
      </div>
      {card.events.length ? (
        <ol className="owner-card-events">
          {card.events.map((event) => (
            <li key={`${event.shareToken}-${event.eventId}`}>
              <div><span>{event.type} · {event.date || 'Date to come'}</span><span>{event.status}</span></div>
              <h3>{event.opponent ? `vs ${event.opponent}` : event.title}</h3>
              {event.opponent && <p>{event.title}</p>}
              <dl><div><dt>Time</dt><dd>{event.time || 'To be announced'}</dd></div><div><dt>Location</dt><dd>{event.location || 'To be announced'}</dd></div></dl>
            </li>
          ))}
        </ol>
      ) : (
        <div className="owner-card-empty" data-testid="owner-card-events-empty">
          <CalendarDays aria-hidden="true" />
          <strong>Game days will land here</strong>
          <span>There are no eligible Event Cards to show yet.</span>
        </div>
      )}
    </section>
  );
}

/** Owner-only preview. Its available sides are derived from the verified invite and loaded card. */
export function OwnerHypeCardSurface({ card, invite, athleteName, teamName = '', sport = 'Sport', privatePreview = false }: Props) {
  const publicActive = Boolean(invite?.showHypeCard && !invite.paused && card);
  const available: PrimaryCardSide[] = getOwnerHypeCardSides({
    isPublicActive: publicActive,
    inviteAllowsStats: Boolean(invite?.showStats),
    cardHasStats: Boolean(card?.stats),
    inviteAllowsEvents: Boolean(invite?.showEvents),
    cardAllowsEvents: Boolean(card?.showEvents),
  });
  const [flip, setFlip] = useState(() => initialFlipState('front'));

  useEffect(() => {
    setFlip((current) => reconcileFlip(current, available));
  }, [available.join('|')]);
  const displayFlip = reconcileFlip(flip, available);

  useEffect(() => {
    if (!flip.busy) return;
    if (!flip.animate) {
      const frame = window.requestAnimationFrame(() => setFlip((current) => armFlip(current)));
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(() => setFlip((current) => settleFlip(current)), flipDurationMs);
    return () => window.clearTimeout(timer);
  }, [flip.busy, flip.animate]);

  const selectSide = (next: CardSide) => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setFlip((current) => beginFlip(reconcileFlip(current, available), next, available, reduced));
  };

  const previewPhoto = card?.photoUrl ?? invite?.photoUrl ?? null;
  const previewAppearance = card?.cardAppearance ?? invite?.cardAppearance;

  return (
    <div className={`owner-hype-surface${publicActive ? '' : ' owner-hype-surface--private'}`} data-testid="owner-hype-card-surface">
      <div className="owner-hype-stage" data-testid="owner-hype-card-flip-container">
        <div className="owner-hype-flip-inner" data-rotated={displayFlip.rotated ? 'true' : 'false'} data-animate={displayFlip.animate ? 'true' : 'false'}>
          <div className="owner-hype-face owner-hype-face--front" aria-hidden={displayFlip.rotated || undefined} inert={displayFlip.rotated || undefined}>
            {displayFlip.frontFace === 'front' ? (
              <NativeHypeCardFront athleteName={athleteName} teamName={teamName} seasonName={invite?.seasonName} photoUrl={previewPhoto} appearance={previewAppearance} />
            ) : card && <CardSideContent side={displayFlip.frontFace as PrimaryCardSide} card={card} athleteName={athleteName} teamName={teamName} seasonName={invite?.seasonName ?? ''} />}
          </div>
          <div className="owner-hype-face owner-hype-face--back" aria-hidden={!displayFlip.rotated || undefined} inert={!displayFlip.rotated || undefined}>
            {displayFlip.backFace && card && <CardSideContent side={displayFlip.backFace as PrimaryCardSide} card={card} athleteName={athleteName} teamName={teamName} seasonName={invite?.seasonName ?? ''} />}
          </div>
        </div>
      </div>
      {publicActive && card && <LivingCardControls side={displayFlip.selected as PrimaryCardSide} tabs={available} onSelectSide={selectSide} eventCount={card.events.length} />}
      {!publicActive && (
        <div className="owner-hype-private-note" role="status" data-testid="owner-card-private-explanation">
          <span className="owner-hype-private-mark"><RectangleVertical aria-hidden="true" /></span>
          <div>
            <strong>{invite?.paused ? 'Sharing is paused' : privatePreview ? 'Private owner preview' : 'Your card is not public'}</strong>
            <p>{invite?.paused ? 'Your HYPE Card is paused. Only the front preview is shown here.' : privatePreview ? 'Only this owner preview is available. Card sides stay hidden until sharing is active.' : 'Only the front preview is shown while the card is hidden from recipients.'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
