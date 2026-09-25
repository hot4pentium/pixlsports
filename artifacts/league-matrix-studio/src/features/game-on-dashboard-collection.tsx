import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent } from 'react';
import { Activity, ArrowLeft, ArrowRight, CalendarDays, ClipboardCheck, Clock3, MapPin, Plus, Swords } from 'lucide-react';
import { buildWorkspaceToolHref } from './workspace-context';
import { GameOnInlineStatTracker } from './game-on-inline-stat-tracker';
import { GameOnInlinePrepChecklist } from './game-on-inline-prep-checklist';
import type { Sport } from './stat-tracker';
import './game-on-dashboard-collection.css';

export type DashboardGameOnCard = {
  id: string;
  eventId?: string;
  type: 'game' | 'practice';
  athleteName: string;
  opponent: string;
  date: string;
  time: string;
  location: string;
  status: 'Draft' | 'Published' | 'Live' | 'Complete';
  isPublished: boolean;
};

type GameOnDashboardCollectionProps = {
  cards: DashboardGameOnCard[];
  onCreate: () => void;
  onOpen: (id: string) => void;
  selectedId?: string;
  renderSelectedCard?: (card: DashboardGameOnCard) => ReactNode;
  statTrackerUserId?: string | null;
  prepUserId?: string | null;
  statTrackerSport?: Sport | null;
  statTrackerAthleteName?: string;
  statTrackerTeamName?: string;
};

function dateParts(value: string) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value.trim());
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return {
        month: new Intl.DateTimeFormat('en', { month: 'short' }).format(date),
        day: String(day),
        weekday: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date),
      };
    }
  }
  return { month: 'Date', day: '—', weekday: value || 'TBD' };
}

function displayTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return value || 'Time TBD';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return value;
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

function CollectionCard({ card, onOpen, selected, renderSelectedCard, panel, onOpenPanel, onClosePanel, statTrackerUserId, prepUserId, statTrackerSport, statTrackerAthleteName, statTrackerTeamName }: {
  card: DashboardGameOnCard;
  onOpen: (id: string) => void;
  selected: boolean;
  renderSelectedCard?: (card: DashboardGameOnCard) => ReactNode;
  panel: 'prep' | 'tracker' | null;
  onOpenPanel: (id: string, panel: 'prep' | 'tracker', trigger: HTMLButtonElement) => void;
  onClosePanel: () => void;
  statTrackerUserId?: string | null;
  prepUserId?: string | null;
  statTrackerSport?: Sport | null;
  statTrackerAthleteName?: string;
  statTrackerTeamName?: string;
}) {
  const editorId = useId();
  const frontFaceRef = useRef<HTMLDivElement>(null);
  const backFaceRef = useRef<HTMLDivElement>(null);
  const previousPanel = useRef<typeof panel>(null);
  const trackerOpen = panel === 'tracker';
  const prepOpen = panel === 'prep';
  const panelOpen = panel !== null;
  const date = dateParts(card.date);
  const practice = card.type === 'practice';
  const title = practice ? (card.opponent || 'Practice') : (card.opponent ? `vs ${card.opponent}` : 'Game day');
  const eventId = card.eventId ?? card.id.replace(/^(?:share|draft):/, '');
  const eventContext = {
    id: eventId,
    type: card.type,
    date: card.date,
    time: card.time,
    location: card.location,
    opponent: card.opponent,
  };
  const publishedStatus = card.status === 'Published' && card.isPublished;
  const statusLabel = card.status === 'Published' && !card.isPublished ? 'Draft' : card.status;
  const hasEditor = selected && Boolean(renderSelectedCard);
  useLayoutEffect(() => {
    if (frontFaceRef.current) frontFaceRef.current.inert = panelOpen;
    if (backFaceRef.current) backFaceRef.current.inert = !panelOpen;
    if (panel && previousPanel.current !== panel) {
      const heading = panel === 'prep'
        ? backFaceRef.current?.querySelector<HTMLElement>('.game-on-prep__title')
        : backFaceRef.current?.querySelector<HTMLElement>('.game-on-quick-tracker__title');
      if (heading?.getClientRects().length) heading.focus();
    }
    previousPanel.current = panel;
  }, [panel, panelOpen]);

  return (
    <article
      className={`game-on-collection__card${card.status === 'Live' ? ' game-on-collection__card--live' : ''}${selected ? ' game-on-collection__card--selected' : ''}${hasEditor ? ' game-on-collection__card--expanded' : ''}${trackerOpen ? ' game-on-collection__card--tracker-open' : ''}${prepOpen ? ' game-on-collection__card--prep-open' : ''}`}
      data-testid={`card-game-on-${card.id}`}
      data-tracker-open={trackerOpen ? 'true' : 'false'}
      data-prep-open={prepOpen ? 'true' : 'false'}
    >
      <div className="game-on-collection__flip-inner">
        <div ref={frontFaceRef} className="game-on-collection__flip-front" aria-hidden={panelOpen}>
          <button
            type="button"
            className="game-on-collection__summary"
            onClick={() => onOpen(card.id)}
            aria-label={`Open ${card.athleteName ? `${card.athleteName}'s ` : ''}${practice ? 'practice' : 'game'} card${card.opponent ? `, ${practice ? '' : 'versus '}${card.opponent}` : ''}, ${card.date || 'date to be determined'}, ${statusLabel}`}
            aria-expanded={renderSelectedCard ? selected : undefined}
            aria-controls={hasEditor ? editorId : undefined}
            data-testid={`button-open-game-on-card-${card.id}`}
          >
            <span className="game-on-collection__card-top">
              <span className="game-on-collection__kind">
                {practice ? <CalendarDays size={14} aria-hidden="true" /> : <Swords size={14} aria-hidden="true" />}
                {practice ? 'Practice' : 'Game'}
              </span>
              <span className={`game-on-collection__status${card.status === 'Live' ? ' game-on-collection__status--live' : publishedStatus ? ' game-on-collection__status--published' : ''}`} data-testid={`status-game-on-card-${card.id}`}>
                <span className="game-on-collection__status-dot" aria-hidden="true" />
                {statusLabel}
              </span>
            </span>
            <span className="game-on-collection__card-main">
              <span className="game-on-collection__date" aria-label={card.date || 'Date TBD'}>
                <span className="game-on-collection__date-month">{date.month}</span>
                <span className="game-on-collection__date-day">{date.day}</span>
                <span className="game-on-collection__date-weekday">{date.weekday}</span>
              </span>
              <span className="game-on-collection__card-content">
                <span className="game-on-collection__athlete" data-testid={`text-game-on-athlete-${card.id}`}>{card.athleteName || 'Your athlete'}</span>
                <span className="game-on-collection__opponent" data-testid={`text-game-on-opponent-${card.id}`}>{title}</span>
              </span>
            </span>
            <span className="game-on-collection__card-footer">
              <span className="game-on-collection__details">
                <span className="game-on-collection__detail"><Clock3 size={14} aria-hidden="true" /><span>{displayTime(card.time)}</span></span>
                <span className="game-on-collection__detail"><MapPin size={14} aria-hidden="true" /><span>{card.location || 'Location TBD'}</span></span>
              </span>
              <span className="game-on-collection__card-arrow" aria-hidden="true"><ArrowRight size={17} /></span>
            </span>
          </button>
          <div className="game-on-collection__actions" aria-label={`${practice ? 'Practice' : 'Game'} actions`}>
            <button type="button" onClick={() => onOpen(card.id)} data-testid={`button-edit-calendar-${card.id}`}>
              <CalendarDays size={15} aria-hidden="true" /> Edit Calendar details
            </button>
            <button
              type="button"
              onClick={(event) => onOpenPanel(card.id, 'prep', event.currentTarget)}
              aria-expanded={prepOpen}
              aria-controls={prepOpen ? `panel-inline-prep-${card.id}` : undefined}
              data-prep-href={buildWorkspaceToolHref('prep', eventContext)}
              data-testid={`button-open-card-prep-${card.id}`}
            >
              <ClipboardCheck size={15} aria-hidden="true" /> Open Prep
            </button>
            {!practice && (
              <button
                type="button"
                onClick={(event) => onOpenPanel(card.id, 'tracker', event.currentTarget)}
                aria-expanded={trackerOpen}
                aria-controls={`panel-inline-tracker-${card.id}`}
                data-testid={`button-open-stat-tracker-${card.id}`}
              >
                <Activity size={15} aria-hidden="true" /> Open Stat Tracker
              </button>
            )}
          </div>
          {hasEditor && (
            <div className="game-on-collection__editor" id={editorId} data-testid={`panel-game-on-card-${card.id}`}>
              {renderSelectedCard?.(card)}
            </div>
          )}
        </div>

        <div
          ref={backFaceRef}
          className={`game-on-collection__flip-back${prepOpen ? ' game-on-collection__flip-back--prep' : ''}`}
          id={`panel-inline-tracker-${card.id}`}
          aria-hidden={!panelOpen}
          data-testid={`panel-inline-tracker-${card.id}`}
        >
          {prepOpen ? (
            <div id={`panel-inline-prep-${card.id}`} data-testid={`panel-inline-prep-${card.id}`}>
              <GameOnInlinePrepChecklist
                key={`${prepUserId ?? statTrackerUserId ?? 'anonymous'}:${eventId}`}
                event={eventContext}
                userId={prepUserId ?? statTrackerUserId}
                onClose={onClosePanel}
              />
            </div>
          ) : (
            <>
              <button type="button" className="game-on-collection__back-button" onClick={onClosePanel} data-testid={`button-close-stat-tracker-${card.id}`}>
                <ArrowLeft size={15} aria-hidden="true" /> Back to Game On card
              </button>
              {trackerOpen && !practice && (
                <GameOnInlineStatTracker
                  userId={statTrackerUserId}
                  sport={statTrackerSport ?? null}
                  athleteName={statTrackerAthleteName ?? card.athleteName}
                  teamName={statTrackerTeamName ?? ''}
                  eventId={eventId}
                  date={card.date}
                  time={card.time}
                  location={card.location}
                  opponent={card.opponent}
                />
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export function GameOnDashboardCollection({
  cards,
  onCreate,
  onOpen,
  selectedId,
  renderSelectedCard,
  statTrackerUserId,
  prepUserId,
  statTrackerSport,
  statTrackerAthleteName,
  statTrackerTeamName,
}: GameOnDashboardCollectionProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [listOpen, setListOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState<{ cardId: string; panel: 'prep' | 'tracker' } | null>(null);
  const panelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restorePanelFocusRef = useRef(false);
  const [scrollState, setScrollState] = useState({ start: true, end: false });
  const labelId = useId();

  useLayoutEffect(() => {
    if (!openPanel && restorePanelFocusRef.current) {
      restorePanelFocusRef.current = false;
      panelTriggerRef.current?.focus();
    }
  }, [openPanel]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = () => {
      setScrollState({
        start: rail.scrollLeft <= 2,
        end: rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2,
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [cards.length, listOpen, selectedId, openPanel]);

  useEffect(() => {
    if (!selectedId || listOpen) return;
    const selected = railRef.current?.querySelector<HTMLElement>('.game-on-collection__card--selected');
    if (!selected || selected.getClientRects().length === 0) return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    selected.scrollIntoView({ behavior, block: 'nearest', inline: 'nearest' });
  }, [selectedId, cards.length, listOpen]);

  const openCardPanel = (id: string, panel: 'prep' | 'tracker', trigger: HTMLButtonElement) => {
    panelTriggerRef.current = trigger;
    setOpenPanel({ cardId: id, panel });
  };
  const closeCardPanel = () => {
    restorePanelFocusRef.current = true;
    setOpenPanel(null);
  };

  function updateScrollState(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    setScrollState({
      start: element.scrollLeft <= 2,
      end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2,
    });
  }

  function move(direction: -1 | 1) {
    const rail = railRef.current;
    if (!rail) return;
    const card = rail.querySelector<HTMLElement>('.game-on-collection__card');
    const distance = (card?.offsetWidth ?? rail.clientWidth) + 16;
    rail.scrollBy({ left: direction * distance, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function handleRailKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      move(event.key === 'ArrowRight' ? 1 : -1);
    }
  }

  return (
    <section id="game-on-dashboard-collection" className="game-on-collection" aria-labelledby={labelId} data-testid="game-on-dashboard-collection">
      <div className="game-on-collection__inner">
        <div className="game-on-collection__header">
          <div>
            <p className="game-on-collection__eyebrow"><span className="game-on-collection__eyebrow-line" aria-hidden="true" /> Your season, one card at a time</p>
            <h2 className="game-on-collection__title" id={labelId}>Game On</h2>
            <p className="game-on-collection__intro">Everything for the next game or practice, right where you need it.</p>
          </div>
          <button type="button" className="game-on-collection__create" onClick={onCreate} data-testid="button-create-game-on-card">
            <Plus size={19} strokeWidth={2.5} aria-hidden="true" /> Create Game On Card
          </button>
        </div>

        {cards.length === 0 ? (
          <div className="game-on-collection__empty" data-testid="status-game-on-empty">
            <span className="game-on-collection__empty-mark" aria-hidden="true"><CalendarDays size={29} strokeWidth={1.7} /></span>
            <div>
              <h3 className="game-on-collection__empty-title">Your first card starts here.</h3>
              <p className="game-on-collection__empty-copy">Add a game or practice to keep the details close on game day.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="game-on-collection__toolbar">
              <div className="game-on-collection__toolbar-left">
                <span className="game-on-collection__rail-label">{listOpen ? 'All cards' : 'Next in line'}</span>
                <span className="game-on-collection__count">{cards.length} {cards.length === 1 ? 'card' : 'cards'}</span>
              </div>
              {!listOpen && cards.length > 1 && (
                <div className="game-on-collection__controls" aria-label="Carousel controls">
                  <button type="button" className="game-on-collection__nav" onClick={() => move(-1)} disabled={scrollState.start} aria-label="Previous cards" data-testid="button-game-on-previous"><ArrowLeft size={17} aria-hidden="true" /></button>
                  <button type="button" className="game-on-collection__nav" onClick={() => move(1)} disabled={scrollState.end} aria-label="Next cards" data-testid="button-game-on-next"><ArrowRight size={17} aria-hidden="true" /></button>
                </div>
              )}
            </div>
            {listOpen ? (
              <div className="game-on-collection__list" aria-label="All Game On cards" data-testid="list-game-on-cards">
                 {cards.map((card) => (
                   <CollectionCard
                     key={card.id}
                     card={card}
                      onOpen={(id) => { setOpenPanel(null); onOpen(id); }}
                     selected={selectedId === card.id}
                     renderSelectedCard={renderSelectedCard}
                      panel={openPanel?.cardId === card.id ? openPanel.panel : null}
                      onOpenPanel={openCardPanel}
                      onClosePanel={closeCardPanel}
                     statTrackerUserId={statTrackerUserId}
                      prepUserId={prepUserId}
                     statTrackerSport={statTrackerSport}
                     statTrackerAthleteName={statTrackerAthleteName}
                     statTrackerTeamName={statTrackerTeamName}
                   />
                 ))}
              </div>
            ) : (
              <div className="game-on-collection__rail" ref={railRef} onScroll={updateScrollState} onKeyDown={handleRailKeyDown} tabIndex={0} role="region" aria-label="Game On cards, scroll horizontally to see more" data-testid="carousel-game-on-cards">
                 {cards.map((card) => (
                   <CollectionCard
                     key={card.id}
                     card={card}
                      onOpen={(id) => { setOpenPanel(null); onOpen(id); }}
                     selected={selectedId === card.id}
                     renderSelectedCard={renderSelectedCard}
                      panel={openPanel?.cardId === card.id ? openPanel.panel : null}
                      onOpenPanel={openCardPanel}
                      onClosePanel={closeCardPanel}
                     statTrackerUserId={statTrackerUserId}
                      prepUserId={prepUserId}
                     statTrackerSport={statTrackerSport}
                     statTrackerAthleteName={statTrackerAthleteName}
                     statTrackerTeamName={statTrackerTeamName}
                   />
                 ))}
              </div>
            )}
            <div className="game-on-collection__bottom">
              <p className="game-on-collection__hint">{listOpen ? 'Upcoming first, with the rest of the season close by.' : 'Swipe or use the arrows to see more.'}</p>
              <button type="button" className="game-on-collection__view" onClick={() => setListOpen((open) => !open)} aria-expanded={listOpen} data-testid="button-game-on-view-all">
                {listOpen ? 'Back to carousel' : 'View all cards'} <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}