import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Clock3, MapPin, Search, Swords } from 'lucide-react';
import { SupporterGameOnSummary } from './SupporterGameOnSummary';
import './_group.css';

const upcomingEvents = [
  {
    id: 'event-next',
    kind: 'Game',
    date: 'Sat, May 18 · 10:30 AM',
    title: 'Northside Falcons',
    location: 'Riverside Athletic Complex · Field 2',
  },
  {
    id: 'event-practice',
    kind: 'Practice',
    date: 'Tue, May 21 · 5:15 PM',
    title: 'Team practice',
    location: 'Westview High School',
  },
];

const eventCards = [
  { id: 'card-next', kind: 'game' as const, date: '2025-05-18', time: '10:30 AM', status: 'Published', opponent: 'Northside Falcons', location: 'Riverside Athletic Complex' },
  { id: 'card-practice', kind: 'practice' as const, date: '2025-05-21', time: '5:15 PM', status: 'Published', opponent: 'Team practice', location: 'Westview High School' },
  { id: 'card-previous', kind: 'game' as const, date: '2025-05-25', time: '1:00 PM', status: 'Draft', opponent: 'Cedar Valley', location: 'Westview Stadium' },
];

function dateParts(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return {
    month: new Intl.DateTimeFormat('en', { month: 'short' }).format(date),
    day: date.getDate(),
    weekday: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date),
  };
}

function EventCard({ card }: { card: typeof eventCards[number] }) {
  const date = dateParts(card.date);
  const isPractice = card.kind === 'practice';
  return (
    <article className="game-on-collection__card" data-testid={`card-game-on-${card.id}`} role="listitem">
      <div className="game-on-collection__flip-inner">
        <div className="game-on-collection__flip-front">
          <div className="game-on-collection__summary">
            <span className="game-on-collection__card-top">
              <span className="game-on-collection__kind">
                {isPractice ? <CalendarDays size={14} aria-hidden="true" /> : <Swords size={14} aria-hidden="true" />}
                {isPractice ? 'Practice' : 'Game'}
              </span>
              <span className={`game-on-collection__status game-on-collection__status--${card.status.toLowerCase()}`}>
                <span className="game-on-collection__status-dot" aria-hidden="true" />
                {card.status}
              </span>
            </span>
            <span className="game-on-collection__card-main">
              <span className="game-on-collection__date">
                <span className="game-on-collection__date-month">{date.month}</span>
                <span className="game-on-collection__date-day">{date.day}</span>
                <span className="game-on-collection__date-weekday">{date.weekday} · 2025</span>
              </span>
              <span className="game-on-collection__time"><Clock3 size={12} aria-hidden="true" /><span>{card.time}</span></span>
              <span className="game-on-collection__card-content">
                <span className="game-on-collection__athlete">Maya Carter</span>
                <span className="game-on-collection__opponent">{isPractice ? card.opponent : `vs ${card.opponent}`}</span>
              </span>
            </span>
            <span className="game-on-collection__card-footer">
              <span className="game-on-collection__details">
                <span className="game-on-collection__detail"><Clock3 size={14} aria-hidden="true" /><span className="game-on-collection__detail-label">Time</span><span className="game-on-collection__detail-value">{card.time}</span></span>
                <span className="game-on-collection__detail"><MapPin size={14} aria-hidden="true" /><span className="game-on-collection__detail-label">Location</span><span className="game-on-collection__detail-value">{card.location}</span></span>
              </span>
              <span className="game-on-collection__card-arrow" aria-hidden="true"><ArrowRight size={17} /></span>
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function EventCards() {
  return (
    <section className="game-on-collection" aria-labelledby="event-cards-heading" data-testid="game-on-dashboard-collection">
      <div className="game-on-collection__inner">
        <div className="game-on-collection__header">
          <div className="game-on-collection__header-copy">
            <p className="game-on-collection__eyebrow"><span className="game-on-collection__eyebrow-line" aria-hidden="true" /> Your season, one card at a time</p>
            <h2 className="game-on-collection__title" id="event-cards-heading">Event Cards</h2>
            <p className="game-on-collection__intro">Everything for the next game or practice, right where you need it.</p>
          </div>
          <button type="button" className="game-on-collection__create"><span className="mock-plus" aria-hidden="true">+</span><span>Add an Event Card</span></button>
        </div>
        <div className="game-on-collection__toolbar">
          <div className="game-on-collection__toolbar-left">
            <span className="game-on-collection__rail-label">Your cards</span>
            <span className="game-on-collection__count">Showing 3 of 3 Event Cards</span>
          </div>
          <label className="game-on-collection__search" role="search">
            <Search size={17} aria-hidden="true" />
            <input type="search" aria-label="Search Event Cards by opponent, location, or date" placeholder="Opponent, location, or date" readOnly />
          </label>
        </div>
        <div className="game-on-collection__grid" role="list" aria-label="Event Cards" data-testid="grid-game-on-cards">
          {eventCards.map((card) => <EventCard key={card.id} card={card} />)}
        </div>
        <div className="game-on-collection__bottom">
          <p className="game-on-collection__hint">Tap a card to open its badge and choose a tool.</p>
        </div>
      </div>
    </section>
  );
}

export function Current() {
  return (
    <main className="supporter-dashboard-desktop-shell">
      <div className="pixl-dashboard">
        <SupporterGameOnSummary
          variant="desktop"
          athleteName="Maya Carter"
          teamName="Westview Wildcats"
          jerseyNumber="7"
          profileHref="#athlete-profile"
          sport="Softball"
          record={{ wins: 8, losses: 3, ties: 1, gamesPlayed: 12 }}
          athleteAvatar={<span className="mock-athlete-avatar">MC</span>}
        >
          <>
            <div className="supporter-game-on-summary__event-top">
              <div className="supporter-game-on-summary__event-kicker">
                <span className="supporter-game-on-summary__event-dot" aria-hidden="true" />
                <span className="mobile-featured-event-kicker">Event Cards</span>
              </div>
              <span className="supporter-game-on-summary__event-badge">2 cards</span>
            </div>
            <h2 id="upcoming-calendar-events-heading" className="supporter-game-on-summary__event-title">Upcoming events</h2>
            <ul className="supporter-game-on-summary__upcoming-list" aria-label="Upcoming Event Cards">
              {upcomingEvents.map((event) => (
                <li key={event.id} className="supporter-game-on-summary__upcoming-item">
                  <div className="supporter-game-on-summary__upcoming-meta">
                    <span className="supporter-game-on-summary__upcoming-type">{event.kind}</span>
                    <span className="supporter-game-on-summary__upcoming-date">{event.date}</span>
                  </div>
                  <h3 className="supporter-game-on-summary__upcoming-title">{event.title}</h3>
                  <p className="supporter-game-on-summary__upcoming-location"><MapPin size={13} aria-hidden="true" />{event.location}</p>
                  <button type="button" className="supporter-game-on-summary__upcoming-action">Open Event Card <ArrowRight size={14} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          </>
        </SupporterGameOnSummary>

        <EventCards />

        <section className="combined-actions-card" aria-label="Quick links" data-testid="dashboard-primary-actions-desktop">
          <div className="combined-actions-card__heading"><span className="combined-actions-card__heading-mark" aria-hidden="true" /><span>Quick links</span></div>
          <div className="combined-actions-card__grid combined-actions-card__grid--single">
            <a href="#stats" className="combined-actions-card__stats-link"><ArrowLeft size={16} aria-hidden="true" /><span>View stats</span></a>
            <a href="#family-guide" className="combined-actions-card__stats-link"><BookOpen size={16} aria-hidden="true" /><span>Family guide</span></a>
          </div>
        </section>
      </div>
    </main>
  );
}

export default Current;
