import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'wouter';
import { HypeCardReplyInboxTrigger } from './hype-card-reply-inbox';
import type { SupporterGameRecord } from './supporter-game-record-model';
import type { Sport } from './stat-tracker';

export type { SupporterGameRecord } from './supporter-game-record-model';

type SupporterGameOnSummaryProps = {
  variant: 'mobile' | 'desktop';
  athleteName: string;
  teamName: string;
  jerseyNumber: string;
  athleteAvatar: ReactNode;
  profileHref: string;
  sport: Sport | null;
  record: SupporterGameRecord;
  headerAction?: ReactNode;
  installReminder?: ReactNode;
  children: ReactNode;
  mobileHypeCard?: ReactNode;
};

export function SupporterGameOnSummary({
  variant,
  athleteName,
  teamName,
  jerseyNumber,
  athleteAvatar,
  profileHref,
  sport,
  record,
  headerAction,
  installReminder,
  children,
  mobileHypeCard,
}: SupporterGameOnSummaryProps) {
  const isMobile = variant === 'mobile';
  const athleteHeadingId = isMobile ? 'mobile-athlete-summary-heading' : 'athlete-summary-heading';

  return (
    <section
      className={`supporter-game-on-summary supporter-game-on-summary--${variant}`}
      aria-labelledby={`game-on-summary-heading-${variant}`}
      data-testid={isMobile ? 'mobile-hero-banner' : 'desktop-game-on-summary'}
    >
      <header
        className={`supporter-game-on-summary__header${headerAction || installReminder ? ' supporter-game-on-summary__header--with-action' : ''}`}
        aria-label={headerAction || installReminder ? 'Dashboard tools and athlete profile' : 'Athlete profile'}
        data-testid={isMobile ? 'mobile-athlete-summary' : 'athlete-summary'}
      >
        <h1 id={`game-on-summary-heading-${variant}`} className="sr-only" tabIndex={-1}>Athlete overview</h1>
        {headerAction && <div className="supporter-game-on-summary__header-action">{headerAction}</div>}
        {installReminder}
        <Link
          href={profileHref}
          className="supporter-game-on-summary__athlete-link"
          aria-label={athleteName ? `Edit ${athleteName}'s athlete profile` : 'Set up athlete details'}
          data-testid={isMobile ? 'btn-mobile-athlete-switcher' : 'btn-edit-athlete-avatar'}
        >
          <span className="supporter-game-on-summary__athlete-avatar" aria-hidden="true">
            {athleteAvatar}
          </span>
          <span className="supporter-game-on-summary__athlete-copy">
            <span className="supporter-game-on-summary__eyebrow">ATHLETE</span>
            <span className="supporter-game-on-summary__athlete-details">
              <span className="supporter-game-on-summary__athlete-name" id={athleteHeadingId}>
                {athleteName || 'Set up athlete details'}
              </span>
              {jerseyNumber && <span className="supporter-game-on-summary__jersey">#{jerseyNumber}</span>}
            </span>
            {teamName && <span className="supporter-game-on-summary__team-name" data-testid="athlete-team-name">{teamName}</span>}
          </span>
          <ChevronRight size={17} aria-hidden="true" />
        </Link>
      </header>

      <div className={`supporter-game-on-summary__grid${isMobile ? ' mobile-hero-columns' : ''}`}>
        {(() => {
          const hasHype = isMobile && !!mobileHypeCard;
          const eventSection = (
            <section
              className="supporter-game-on-summary__event"
              aria-labelledby={isMobile ? 'mobile-next-game-heading' : 'next-game-heading'}
              data-testid={isMobile ? undefined : 'section-next-game-context'}
            >
              {hasHype && <span className="supporter-hype-preview__label">EVENT CARD</span>}
              <div className="supporter-game-on-summary__event-content" data-testid={isMobile ? 'card-mobile-featured-event' : undefined}>
                {children}
              </div>
            </section>
          );
          if (!hasHype) return eventSection;
          return (
            <div className="supporter-game-on-summary__hype-row" data-testid="mobile-calendar-hype-row">
              {eventSection}
              <div className="supporter-game-on-summary__hype-slot" data-testid="mobile-hype-card-slot">
                {mobileHypeCard}
              </div>
            </div>
          );
        })()}

        {!isMobile && (
          <div className="supporter-game-on-summary__replies" aria-label="Recent Shoutouts and replies">
            <HypeCardReplyInboxTrigger variant="dashboard" />
          </div>
        )}

        <section
          className="supporter-game-on-summary__record"
          aria-label="Tracked game record"
          data-testid={`supporter-game-record-${variant}`}
        >
          <div className="supporter-game-on-summary__record-heading">
            <span>TRACKED GAMES</span>
            <h2>RECORD</h2>
            <p>{sport ? `${sport} · completed games` : 'Completed games'}</p>
          </div>
          <div className="supporter-game-on-summary__record-stats">
            <div className="supporter-game-on-summary__record-stat" data-testid={`record-wins-${variant}`}>
              <strong>{record.wins}</strong>
              <span>WINS</span>
            </div>
            <div className="supporter-game-on-summary__record-stat" data-testid={`record-losses-${variant}`}>
              <strong>{record.losses}</strong>
              <span>LOSSES</span>
            </div>
            <div className="supporter-game-on-summary__record-stat" data-testid={`record-ties-${variant}`}>
              <strong>{record.ties}</strong>
              <span>TIES</span>
            </div>
          </div>
          <p className="supporter-game-on-summary__record-footnote">
            {record.gamesPlayed > 0
              ? `${record.gamesPlayed} scored ${record.gamesPlayed === 1 ? 'game' : 'games'} tracked`
              : 'Score completed games to build your record'}
          </p>
        </section>
      </div>
    </section>
  );
}