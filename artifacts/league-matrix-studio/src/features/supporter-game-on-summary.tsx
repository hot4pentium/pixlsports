import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { HypeCardReplyInboxTrigger } from './hype-card-reply-inbox';
import type { SupporterGameRecord } from './supporter-game-record-model';
import type { Sport } from './stat-tracker';
import { FanBaseEntry } from './fan-base-owner-card';

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
  fanBaseInviteToken?: string;
  seasonStatsHref?: string;
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
  fanBaseInviteToken,
  seasonStatsHref,
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
                <FanBaseEntry inviteToken={fanBaseInviteToken} />
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
            <span>SEASON</span>
            <h2>GAME RECORD</h2>
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
      {isMobile && seasonStatsHref && (
        <Link
          href={seasonStatsHref}
          className="mx-4 mb-4 flex min-h-[72px] items-center justify-between gap-4 rounded-2xl border border-[#29486d] bg-gradient-to-r from-[#102b50] to-[#0b1f3a] px-5 py-4 text-white shadow-[0_12px_28px_rgba(3,17,36,.22)] transition-colors hover:border-[#72c9ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2878f5]"
          data-testid="link-mobile-season-stats-card"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-[10px] font-black uppercase tracking-[.16em] text-[#72c9ff]">Season insights</span>
            <span className="font-display text-xl font-black">Season Stats</span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-[#b8f45c]" aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}