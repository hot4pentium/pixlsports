import type { ReactNode } from 'react';
import { HypeCardReplyInboxTrigger } from './hype-card-reply-inbox';
import type { SupporterGameRecord } from './supporter-game-record-model';
import type { Sport } from './stat-tracker';

export type { SupporterGameRecord } from './supporter-game-record-model';

type SupporterGameOnSummaryProps = {
  variant: 'mobile' | 'desktop';
  seasonName?: string;
  sport: Sport | null;
  record: SupporterGameRecord;
  headerAction?: ReactNode;
  installReminder?: ReactNode;
  showTitle?: boolean;
  showSeasonKicker?: boolean;
  children: ReactNode;
  mobileHypeCard?: ReactNode;
};

export function SupporterGameOnSummary({
  variant,
  seasonName,
  sport,
  record,
  headerAction,
  installReminder,
  showTitle = true,
  showSeasonKicker = true,
  children,
  mobileHypeCard,
}: SupporterGameOnSummaryProps) {
  const isMobile = variant === 'mobile';
  const showHeader = isMobile || Boolean(headerAction || installReminder || showSeasonKicker);
  const hasDashboardTools = Boolean(headerAction || installReminder);

  return (
    <section
      className={`supporter-game-on-summary supporter-game-on-summary--${variant}`}
      aria-labelledby={`game-on-summary-heading-${variant}`}
      data-testid={isMobile ? 'mobile-hero-banner' : 'desktop-game-on-summary'}
    >
      {showTitle && (
        <h1 id={`game-on-summary-heading-${variant}`} className="sr-only" tabIndex={-1}>Athlete overview</h1>
      )}
      {showHeader && (
        <header
          className={`supporter-game-on-summary__header${headerAction || installReminder ? ' supporter-game-on-summary__header--with-action' : ''}`}
          aria-label={hasDashboardTools
            ? showSeasonKicker ? 'Dashboard tools and season' : 'Dashboard tools'
            : 'Season overview'}
          data-testid={isMobile ? 'mobile-dashboard-summary-header' : 'athlete-summary'}
        >
          {headerAction && <div className="supporter-game-on-summary__header-action">{headerAction}</div>}
          {installReminder}
          {showSeasonKicker && (
            <div className="supporter-game-on-summary__locker-kicker">
              <span className="supporter-game-on-summary__locker-dot" aria-hidden="true" />
              <span>All in, all season</span>
              {seasonName && <span className="supporter-game-on-summary__locker-season">Family season · {seasonName}</span>}
            </div>
          )}
        </header>
      )}

      <div className={`supporter-game-on-summary__grid${isMobile ? ' mobile-hero-columns' : ''}`}>
        {(() => {
          const hasHype = isMobile && !!mobileHypeCard;
          const eventSection = (
            <section
              className={`supporter-game-on-summary__event${isMobile ? '' : ' sr-only'}`}
              aria-labelledby={isMobile ? 'mobile-upcoming-calendar-events-heading' : undefined}
              aria-label={isMobile ? undefined : 'Upcoming Event Cards'}
              data-testid={isMobile ? undefined : 'section-next-game-context'}
            >
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