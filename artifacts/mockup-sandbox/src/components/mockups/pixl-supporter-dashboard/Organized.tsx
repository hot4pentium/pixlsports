import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, ChevronRight, Clock3, Heart, MapPin, MessageCircleHeart, Search, Swords, ThumbsUp } from 'lucide-react';
import './_group.css';
import './Organized.css';

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

function AthleteIdentity() {
  return (
    <header className="organized-identity" aria-label="Athlete profile">
      <a href="#athlete-profile" className="organized-identity__link">
        <span className="organized-identity__avatar" aria-hidden="true">MC</span>
        <span className="organized-identity__copy">
          <span className="organized-identity__eyebrow">ATHLETE</span>
          <span className="organized-identity__name">Maya Carter <span className="organized-identity__number">#7</span></span>
          <span className="organized-identity__team">Westview Wildcats <i aria-hidden="true" /> Softball</span>
        </span>
        <ChevronRight size={17} aria-hidden="true" />
      </a>
      <div className="organized-identity__season" aria-hidden="true">
        <span className="organized-identity__season-mark" />
        <span>YOUR SEASON</span>
      </div>
    </header>
  );
}

function SeasonSnapshot() {
  return (
    <section className="organized-snapshot" aria-label="Season snapshot">
      <section className="organized-upcoming" aria-labelledby="organized-upcoming-heading">
        <div className="organized-panel-heading">
          <span className="organized-kicker"><i aria-hidden="true" /> EVENT CARDS <span className="organized-count">2 cards</span></span>
          <h2 id="organized-upcoming-heading">Upcoming events</h2>
        </div>
        <ul className="organized-upcoming__list" aria-label="Upcoming Event Cards">
          {upcomingEvents.map((event) => (
            <li className="organized-upcoming__item" key={event.id}>
              <span className="organized-upcoming__date">{event.date}</span>
              <span className="organized-upcoming__type">{event.kind}</span>
              <span className="organized-upcoming__details">
                <strong>{event.title}</strong>
                <span><MapPin size={13} aria-hidden="true" />{event.location}</span>
              </span>
              <button type="button" className="organized-open-event">Open Event Card <ArrowRight size={14} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      </section>

      <section className="organized-record" aria-label="Tracked game record">
        <div className="organized-record__heading">
          <span>TRACKED GAMES</span>
          <h2>RECORD</h2>
          <p>Softball · completed games</p>
        </div>
        <div className="organized-record__stats">
          <div><strong>8</strong><span>WINS</span></div>
          <div><strong>3</strong><span>LOSSES</span></div>
          <div><strong>1</strong><span>TIES</span></div>
        </div>
        <p className="organized-record__footnote">12 scored games tracked</p>
      </section>

      <section className="organized-replies" aria-label="Recent Shoutouts and replies">
        <div className="organized-replies__heading">
          <span><MessageCircleHeart size={15} aria-hidden="true" /> SHOUTOUTS &amp; REPLIES · 3</span>
          <span className="organized-replies__unread">2 new</span>
        </div>
        <div className="organized-replies__messages">
          <article className="organized-reply">
            <span className="organized-reply__icon" aria-hidden="true"><Heart size={14} /></span>
            <div><span className="organized-reply__title">GAME DAY HYPE</span><p>You’ve got this, Maya! We’re all cheering you on.</p></div>
          </article>
          <article className="organized-reply">
            <span className="organized-reply__icon" aria-hidden="true"><ThumbsUp size={14} /></span>
            <div><span className="organized-reply__title">WAY TO GO!</span><p>Proud of you—keep bringing that energy!</p></div>
          </article>
        </div>
        <button type="button" className="organized-replies__all">View all <ArrowRight size={14} aria-hidden="true" /></button>
      </section>
    </section>
  );
}

function EventCard({ card }: { card: typeof eventCards[number] }) {
  const date = dateParts(card.date);
  const isPractice = card.kind === 'practice';
  return (
    <article className="game-on-collection__card organized-event-card" data-testid={`card-game-on-${card.id}`} role="listitem">
      <div className="game-on-collection__flip-inner">
        <div className="game-on-collection__flip-front">
          <div className="game-on-collection__summary">
            <div className="game-on-collection__card-top">
              <span className="game-on-collection__kind">
                {isPractice ? <CalendarDays size={14} aria-hidden="true" /> : <Swords size={14} aria-hidden="true" />}
                {isPractice ? 'Practice' : 'Game'}
              </span>
              <span className={`game-on-collection__status game-on-collection__status--${card.status.toLowerCase()}`}>
                <span className="game-on-collection__status-dot" aria-hidden="true" />
                {card.status}
              </span>
            </div>
            <div className="organized-event-card__body">
              <div className="game-on-collection__date">
                <span className="game-on-collection__date-month">{date.month}</span>
                <span className="game-on-collection__date-day">{date.day}</span>
                <span className="game-on-collection__date-weekday">{date.weekday} · 2025</span>
              </div>
              <span className="game-on-collection__time"><Clock3 size={12} aria-hidden="true" /><span>{card.time}</span></span>
              <div className="game-on-collection__card-content">
                <span className="game-on-collection__athlete">Maya Carter</span>
                <span className="game-on-collection__opponent">{isPractice ? card.opponent : `vs ${card.opponent}`}</span>
              </div>
            </div>
            <div className="game-on-collection__card-footer">
              <span className="game-on-collection__details">
                <span className="game-on-collection__detail"><MapPin size={14} aria-hidden="true" /><span className="game-on-collection__detail-label">Location</span><span className="game-on-collection__detail-value">{card.location}</span></span>
              </span>
              <span className="game-on-collection__card-arrow" aria-hidden="true"><ArrowRight size={17} /></span>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function EventCards() {
  return (
    <section className="game-on-collection organized-collection" aria-labelledby="organized-cards-heading" data-testid="game-on-dashboard-collection">
      <div className="game-on-collection__inner">
        <div className="organized-collection__top">
          <div className="game-on-collection__header-copy">
            <p className="game-on-collection__eyebrow"><span className="game-on-collection__eyebrow-line" aria-hidden="true" /> YOUR SEASON, ONE CARD AT A TIME</p>
            <h2 className="game-on-collection__title" id="organized-cards-heading">Event Cards</h2>
            <p className="game-on-collection__intro">Everything for the next game or practice, right where you need it.</p>
          </div>
          <button type="button" className="game-on-collection__create"><span className="mock-plus" aria-hidden="true">+</span><span>Add an Event Card</span></button>
        </div>
        <div className="organized-collection__toolbar">
          <div className="game-on-collection__toolbar-left">
            <span className="game-on-collection__rail-label">Your cards</span>
            <span className="game-on-collection__count">Showing 3 of 3 Event Cards</span>
          </div>
          <label className="game-on-collection__search" role="search">
            <Search size={17} aria-hidden="true" />
            <input type="search" aria-label="Search Event Cards by opponent, location, or date" placeholder="Opponent, location, or date" readOnly />
          </label>
        </div>
        <div className="game-on-collection__grid organized-collection__grid" role="list" aria-label="Event Cards" data-testid="grid-game-on-cards">
          {eventCards.map((card) => <EventCard key={card.id} card={card} />)}
        </div>
        <div className="organized-collection__bottom">
          <p className="game-on-collection__hint">Tap a card to open its badge and choose a tool.</p>
          <nav className="organized-quick-links" aria-label="Quick links">
            <span className="organized-quick-links__label"><i aria-hidden="true" /> QUICK LINKS</span>
            <a href="#stats"><ArrowLeft size={15} aria-hidden="true" /><span>View stats</span></a>
            <a href="#family-guide"><BookOpen size={15} aria-hidden="true" /><span>Family guide</span></a>
          </nav>
        </div>
      </div>
    </section>
  );
}

export function Organized() {
  return (
    <main className="supporter-dashboard-desktop-shell organized-shell">
      <div className="pixl-dashboard organized-dashboard">
        <AthleteIdentity />
        <SeasonSnapshot />
        <EventCards />
      </div>
    </main>
  );
}

export default Organized;
