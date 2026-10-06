import type { ReactNode } from 'react';
import { ChevronRight, ArrowRight, MessageCircleHeart } from 'lucide-react';

type Record = { wins: number; losses: number; ties: number; gamesPlayed: number };

export function SupporterGameOnSummary({
  athleteName, teamName, jerseyNumber, athleteAvatar, profileHref, sport, record, children,
}: {
  variant: 'desktop';
  athleteName: string;
  teamName: string;
  jerseyNumber: string;
  athleteAvatar: ReactNode;
  profileHref: string;
  sport: string | null;
  record: Record;
  children: ReactNode;
}) {
  return (
    <section className="supporter-game-on-summary supporter-game-on-summary--desktop" aria-label="Athlete overview" data-testid="desktop-game-on-summary">
      <header className="supporter-game-on-summary__header" aria-label="Athlete profile" data-testid="athlete-summary">
        <a href={profileHref} className="supporter-game-on-summary__athlete-link" aria-label={`Edit ${athleteName}'s athlete profile`}>
          <span className="supporter-game-on-summary__athlete-avatar" aria-hidden="true">{athleteAvatar}</span>
          <span className="supporter-game-on-summary__athlete-copy">
            <span className="supporter-game-on-summary__eyebrow">ATHLETE</span>
            <span className="supporter-game-on-summary__athlete-details">
              <span className="supporter-game-on-summary__athlete-name" id="athlete-summary-heading">{athleteName}</span>
              <span className="supporter-game-on-summary__jersey">#{jerseyNumber}</span>
            </span>
            <span className="supporter-game-on-summary__team-name" data-testid="athlete-team-name">{teamName}</span>
          </span>
          <ChevronRight size={17} aria-hidden="true" />
        </a>
      </header>
      <div className="supporter-game-on-summary__grid">
        <section className="supporter-game-on-summary__event" aria-labelledby="upcoming-calendar-events-heading" data-testid="section-next-game-context">
          <div className="supporter-game-on-summary__event-content">{children}</div>
        </section>
        <div className="supporter-game-on-summary__replies" aria-label="Recent Shoutouts and replies">
          <button type="button" className="reply-inbox-summary-trigger" aria-label="Open Shoutouts and replies, 3 messages">
            <span className="reply-inbox-summary-trigger__header">
              <span className="reply-inbox-summary-trigger__label"><MessageCircleHeart size={15} aria-hidden="true" /><span>Shoutouts &amp; replies · <span>3</span></span></span>
              <span className="reply-inbox-summary-trigger__unread">2 new</span>
            </span>
            <span className="reply-inbox-summary-trigger__items">
              <span className="reply-inbox-summary-trigger__item"><span className="reply-inbox-summary-trigger__reaction" aria-hidden="true">💙</span><span className="reply-inbox-summary-trigger__copy"><span className="reply-inbox-summary-trigger__share-title">GAME DAY HYPE</span><span className="reply-inbox-summary-trigger__message">You’ve got this, Maya! We’re all cheering you on.</span></span></span>
              <span className="reply-inbox-summary-trigger__item"><span className="reply-inbox-summary-trigger__reaction" aria-hidden="true">👏</span><span className="reply-inbox-summary-trigger__copy"><span className="reply-inbox-summary-trigger__share-title">WAY TO GO!</span><span className="reply-inbox-summary-trigger__message">Proud of you—keep bringing that energy!</span></span></span>
            </span>
            <span className="reply-inbox-summary-trigger__footer">View all <ArrowRight size={14} aria-hidden="true" /></span>
          </button>
        </div>
        <section className="supporter-game-on-summary__record" aria-label="Tracked game record" data-testid="supporter-game-record-desktop">
          <div className="supporter-game-on-summary__record-heading">
            <span>TRACKED GAMES</span><h2>RECORD</h2><p>{sport} · completed games</p>
          </div>
          <div className="supporter-game-on-summary__record-stats">
            <div className="supporter-game-on-summary__record-stat"><strong>{record.wins}</strong><span>WINS</span></div>
            <div className="supporter-game-on-summary__record-stat"><strong>{record.losses}</strong><span>LOSSES</span></div>
            <div className="supporter-game-on-summary__record-stat"><strong>{record.ties}</strong><span>TIES</span></div>
          </div>
          <p className="supporter-game-on-summary__record-footnote">{record.gamesPlayed} scored games tracked</p>
        </section>
      </div>
    </section>
  );
}
