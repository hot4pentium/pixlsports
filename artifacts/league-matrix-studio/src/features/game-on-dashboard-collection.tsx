import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { Activity, ArrowLeft, ArrowRight, CalendarDays, ClipboardCheck, Clock3, MapPin, Plus, Search, Swords, X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogClose, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { buildWorkspaceToolHref } from './workspace-context';
import { GameOnInlineStatTracker } from './game-on-inline-stat-tracker';
import { GameOnInlinePrepChecklist } from './game-on-inline-prep-checklist';
import type { Sport } from './stat-tracker';
import './game-on-dashboard-collection.css';

export type DashboardGameOnCard = {
  id: string;
  eventId?: string;
  layoutId?: string;
  type: 'game' | 'practice';
  athleteName: string;
  opponent: string;
  date: string;
  time: string;
  location: string;
  status: 'Draft' | 'Published' | 'Live' | 'Complete';
  isPublished: boolean;
  isUnsavedDraft?: boolean;
};

export type GameOnCardRenderOptions = {
  view: 'details' | 'calendar';
  onOpenPrep: (trigger: HTMLButtonElement) => void;
  onOpenTracker: (trigger: HTMLButtonElement) => void;
};

type GameOnDashboardCollectionProps = {
  cards: DashboardGameOnCard[];
  onCreate: () => void;
  createDisabled?: boolean;
  onOpen: (id: string, trigger?: HTMLButtonElement) => void;
  onCancelDraft?: () => void;
  selectedId?: string;
  isActiveShell?: boolean;
  upNextEventId?: string;
  renderSelectedCard?: (card: DashboardGameOnCard, options: GameOnCardRenderOptions) => ReactNode;
  statTrackerUserId?: string | null;
  prepUserId?: string | null;
  statTrackerSport?: Sport | null;
  statTrackerAthleteName?: string;
  statTrackerTeamName?: string;
  onCompleteScheduledGame?: (eventId: string, completedAt: string) => Promise<void>;
};

function getCardStatus(card: DashboardGameOnCard): DashboardGameOnCard['status'] {
  return card.status === 'Published' && !card.isPublished ? 'Draft' : card.status;
}

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
        weekday: `${new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date)} · ${year}`,
      };
    }
  }
  return { month: 'Date', day: '—', weekday: value || 'TBD' };
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getCardSearchText(card: DashboardGameOnCard) {
  const date = dateParts(card.date);
  const dateMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(card.date.trim());
  const numericDate = dateMatch && date.month !== 'Date'
    ? `${Number(dateMatch[2])}/${Number(dateMatch[3])}/${dateMatch[1]} ${dateMatch[2].padStart(2, '0')}/${dateMatch[3].padStart(2, '0')}/${dateMatch[1]}`
    : '';

  return normalizeSearchText([
    card.opponent,
    card.location,
    card.date,
    date.month === 'Date' ? '' : date.month,
    date.day === '—' ? '' : date.day,
    date.weekday,
    numericDate,
  ].join(' '));
}

function displayTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return value || 'Time TBD';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return value;
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}

function CollectionCard({ card, onOpen, onCancelDraft, selected, triggerSelected = false, isDialogCard = false, dialogId, visible, upNextEventId, renderSelectedCard, panel, onOpenPanel, onClosePanel, statTrackerUserId, prepUserId, statTrackerSport, statTrackerAthleteName, statTrackerTeamName, onCompleteScheduledGame, onAnnounceGameCompleted }: {
  card: DashboardGameOnCard;
  onOpen: (id: string, trigger: HTMLButtonElement) => void;
  onCancelDraft?: () => void;
  selected: boolean;
  triggerSelected?: boolean;
  isDialogCard?: boolean;
  dialogId?: string;
  visible: boolean;
  upNextEventId?: string;
  renderSelectedCard?: (card: DashboardGameOnCard, options: GameOnCardRenderOptions) => ReactNode;
  panel: 'calendar' | 'prep' | 'tracker' | null;
  onOpenPanel: (id: string, panel: 'calendar' | 'prep' | 'tracker', trigger: HTMLButtonElement) => void;
  onClosePanel: () => void;
  statTrackerUserId?: string | null;
  prepUserId?: string | null;
  statTrackerSport?: Sport | null;
  statTrackerAthleteName?: string;
  statTrackerTeamName?: string;
  onCompleteScheduledGame?: (eventId: string, completedAt: string) => Promise<void>;
  onAnnounceGameCompleted: (opponent: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const editorId = useId();
  const frontFaceRef = useRef<HTMLDivElement>(null);
  const backFaceRef = useRef<HTMLDivElement>(null);
  const previousPanel = useRef<typeof panel>(null);
  const trackerOpen = panel === 'tracker';
  const prepOpen = panel === 'prep';
  const calendarOpen = panel === 'calendar';
  const panelOpen = panel !== null;
  const trackerPanelId = `panel-inline-tracker-${card.id}-${editorId}`;
  const calendarPanelId = `panel-inline-calendar-${card.id}-${editorId}`;
  const prepPanelId = `panel-inline-prep-${card.id}-${editorId}`;
  const date = dateParts(card.date);
  const practice = card.type === 'practice';
  const isUpNext = Boolean(upNextEventId && card.eventId === upNextEventId);
  const title = practice ? (card.opponent || 'Practice') : (card.opponent ? `vs ${card.opponent}` : 'Game day');
  const calendarEventId = card.eventId;
  const eventId = card.eventId ?? card.id.replace(/^(?:share|draft):/, '');
  const eventContext = {
    id: eventId,
    type: card.type,
    date: card.date,
    time: card.time,
    location: card.location,
    opponent: card.opponent,
  };
  const handleGameEnded = calendarEventId && onCompleteScheduledGame
    ? async (completedAt: string) => {
      await onCompleteScheduledGame(calendarEventId, completedAt);
      onAnnounceGameCompleted(card.opponent);
    }
    : undefined;
  const statusLabel = getCardStatus(card);
  const hasEditor = selected && card.isUnsavedDraft && !panelOpen && Boolean(renderSelectedCard);
  const hasDetails = selected && !card.isUnsavedDraft && Boolean(renderSelectedCard);
  useLayoutEffect(() => {
    if (frontFaceRef.current) frontFaceRef.current.inert = panelOpen;
    if (backFaceRef.current) backFaceRef.current.inert = !panelOpen;
    if (panel && previousPanel.current !== panel) {
      const heading = panel === 'prep'
        ? backFaceRef.current?.querySelector<HTMLElement>('.game-on-prep__title')
        : panel === 'calendar'
          ? backFaceRef.current?.querySelector<HTMLElement>('.game-on-inline__section h3')
          : backFaceRef.current?.querySelector<HTMLElement>('.game-on-quick-tracker__title');
      if (heading?.getClientRects().length) heading.focus();
    }
    previousPanel.current = panel;
  }, [panel, panelOpen]);

  return (
    <motion.article
      layout={!isDialogCard && !reduceMotion}
      layoutId={isDialogCard || reduceMotion ? undefined : `game-on-card-${card.layoutId ?? card.id}`}
      transition={{ layout: { type: 'spring', stiffness: 260, damping: 30 } }}
      className={`game-on-collection__card${isDialogCard ? ' game-on-collection__dialog-card' : ''}${card.status === 'Live' ? ' game-on-collection__card--live' : ''}${isUpNext ? ' game-on-collection__card--up-next' : ''}${selected ? ' game-on-collection__card--selected game-on-collection__card--expanded' : ''}${calendarOpen ? ' game-on-collection__card--calendar-open' : ''}${trackerOpen ? ' game-on-collection__card--tracker-open' : ''}${prepOpen ? ' game-on-collection__card--prep-open' : ''}`}
      hidden={!visible}
      data-testid={`card-game-on-${card.id}`}
      data-layout-id={card.layoutId ?? card.id}
      data-up-next={isUpNext ? 'true' : 'false'}
      data-tracker-open={trackerOpen ? 'true' : 'false'}
      data-prep-open={prepOpen ? 'true' : 'false'}
      data-calendar-open={calendarOpen ? 'true' : 'false'}
      data-details-open={calendarOpen ? 'true' : 'false'}
      role="listitem"
    >
      <div className="game-on-collection__flip-inner">
        <div ref={frontFaceRef} className="game-on-collection__flip-front" aria-hidden={panelOpen}>
          <button
            type="button"
            className="game-on-collection__summary"
            onClick={(event) => onOpen(card.id, event.currentTarget)}
            aria-label={`${isUpNext ? 'Up next: ' : ''}${selected ? 'Collapse' : 'Open'} ${card.athleteName ? `${card.athleteName}'s ` : ''}${practice ? 'practice' : 'game'} badge${card.opponent ? `, ${practice ? '' : 'versus '}${card.opponent}` : ''}, ${card.date || 'date to be determined'}, ${displayTime(card.time)}, ${card.location || 'Location TBD'}, ${statusLabel}`}
            aria-haspopup={isDialogCard ? undefined : 'dialog'}
            aria-expanded={renderSelectedCard ? (isDialogCard ? selected : triggerSelected) : undefined}
            aria-controls={isDialogCard ? (hasEditor ? editorId : undefined) : triggerSelected ? dialogId : undefined}
            data-testid={`button-open-game-on-card-${card.id}`}
          >
            <span className="game-on-collection__card-top">
              <span className="game-on-collection__kind">
                {practice ? <CalendarDays size={14} aria-hidden="true" /> : <Swords size={14} aria-hidden="true" />}
                {practice ? 'Practice' : 'Game'}
              </span>
              <span className={`game-on-collection__status game-on-collection__status--${statusLabel.toLowerCase()}`} data-status={statusLabel.toLowerCase()} data-testid={`status-game-on-card-${card.id}`}>
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
              <span className="game-on-collection__time" data-testid={`text-game-on-card-time-${card.id}`}>
                <Clock3 size={12} aria-hidden="true" />
                <span>{displayTime(card.time)}</span>
              </span>
              <span hidden={!selected} className="game-on-collection__card-content">
                <span className="game-on-collection__athlete" data-testid={`text-game-on-athlete-${card.id}`}>{card.athleteName || 'Your athlete'}</span>
                <span className="game-on-collection__opponent" data-testid={`text-game-on-opponent-${card.id}`}>{title}</span>
              </span>
            </span>
            <span hidden={!selected} className="game-on-collection__card-footer">
              <span className="game-on-collection__details">
                <span className="game-on-collection__detail"><Clock3 size={14} aria-hidden="true" /><span className="game-on-collection__detail-label">Time</span><span className="game-on-collection__detail-value">{displayTime(card.time)}</span></span>
                <span className="game-on-collection__detail"><MapPin size={14} aria-hidden="true" /><span className="game-on-collection__detail-label">Location</span><span className="game-on-collection__detail-value">{card.location || 'Location TBD'}</span></span>
              </span>
              <span className="game-on-collection__card-arrow" aria-hidden="true"><ArrowRight size={17} /></span>
            </span>
          </button>
          <div className={`game-on-collection__actions${practice ? ' game-on-collection__actions--practice' : ''}`} aria-label={`${practice ? 'Practice' : 'Game'} badge actions`} hidden={!selected}>
            {card.isUnsavedDraft && (
              <button
                type="button"
                onClick={onCancelDraft}
                className="game-on-collection__cancel-draft"
                aria-label="Cancel this unsaved Game On card"
                data-testid={`button-cancel-game-on-draft-${card.id}`}
              >
                <X size={15} aria-hidden="true" /> Cancel draft
              </button>
            )}
            {!card.isUnsavedDraft && (
              <>
                <button
                  type="button"
                  className="game-on-collection__action--prep"
                  onClick={(event) => onOpenPanel(card.id, 'prep', event.currentTarget)}
                  aria-label="Open Prep"
                  aria-expanded={prepOpen}
                  aria-controls={prepOpen ? prepPanelId : undefined}
                  data-prep-href={buildWorkspaceToolHref('prep', eventContext)}
                  data-testid={`button-open-card-prep-${card.id}`}
                >
                  <ClipboardCheck size={15} aria-hidden="true" />
                  <span>Prep</span>
                </button>
                {!practice && (
                  <button
                    type="button"
                    className="game-on-collection__action--tracker"
                    onClick={(event) => onOpenPanel(card.id, 'tracker', event.currentTarget)}
                    aria-label="Open Stat Tracker"
                    aria-expanded={trackerOpen}
                    aria-controls={trackerPanelId}
                    data-testid={`button-open-stat-tracker-${card.id}`}
                  >
                    <Activity size={15} aria-hidden="true" />
                    <span>Stat Tracker</span>
                  </button>
                )}
                <button
                  type="button"
                  className="game-on-collection__action--details"
                  onClick={(event) => onOpenPanel(card.id, 'calendar', event.currentTarget)}
                  aria-label="Details: edit event"
                  aria-expanded={calendarOpen}
                  aria-controls={calendarOpen ? calendarPanelId : undefined}
                  data-testid={`button-edit-calendar-${card.id}`}
                >
                  <CalendarDays size={15} aria-hidden="true" />
                  <span>Details</span>
                </button>
              </>
            )}
          </div>
          {hasEditor && (
            <div className="game-on-collection__editor" id={editorId} data-testid={`panel-game-on-card-${card.id}`}>
              {renderSelectedCard?.(card, {
                view: 'details',
                onOpenPrep: (trigger) => onOpenPanel(card.id, 'prep', trigger),
                onOpenTracker: (trigger) => onOpenPanel(card.id, 'tracker', trigger),
              })}
            </div>
          )}
        </div>

        <div
          ref={backFaceRef}
          className={`game-on-collection__flip-back${prepOpen ? ' game-on-collection__flip-back--prep' : ''}`}
          id={trackerPanelId}
          aria-hidden={!panelOpen}
          data-testid={`panel-inline-tracker-${card.id}`}
        >
          {hasDetails && (
            <div id={calendarPanelId} data-testid={`panel-inline-calendar-${card.id}`} hidden={!calendarOpen}>
              <button type="button" className="game-on-collection__back-button" onClick={onClosePanel} data-testid={`button-close-calendar-editor-${card.id}`}>
                <ArrowLeft size={15} aria-hidden="true" /> Back to badge
              </button>
              {renderSelectedCard?.(card, {
                view: 'calendar',
                onOpenPrep: (trigger) => onOpenPanel(card.id, 'prep', trigger),
                onOpenTracker: (trigger) => onOpenPanel(card.id, 'tracker', trigger),
              })}
            </div>
          )}
          {prepOpen && (
            <div id={prepPanelId} data-testid={`panel-inline-prep-${card.id}`}>
              <GameOnInlinePrepChecklist
                key={`${prepUserId ?? statTrackerUserId ?? 'anonymous'}:${eventId}`}
                event={eventContext}
                userId={prepUserId ?? statTrackerUserId}
                onClose={onClosePanel}
              />
            </div>
          )}
          {trackerOpen && !practice && (
            <>
              <button type="button" className="game-on-collection__back-button" onClick={onClosePanel} data-testid={`button-close-stat-tracker-${card.id}`}>
                <ArrowLeft size={15} aria-hidden="true" /> Back to badge
              </button>
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
                onGameEnded={handleGameEnded}
              />
            </>
          )}
        </div>
      </div>
    </motion.article>
  );
}

export function GameOnDashboardCollection({
  cards,
  onCreate,
  createDisabled = false,
  onOpen,
  onCancelDraft,
  selectedId,
  isActiveShell = true,
  upNextEventId,
  renderSelectedCard,
  statTrackerUserId,
  prepUserId,
  statTrackerSport,
  statTrackerAthleteName,
  statTrackerTeamName,
  onCompleteScheduledGame,
}: GameOnDashboardCollectionProps) {
  const [openPanel, setOpenPanel] = useState<{ cardId: string; panel: 'calendar' | 'prep' | 'tracker' } | null>(null);
  const [completionAnnouncement, setCompletionAnnouncement] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const collectionRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const panelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedCardTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedCardLayoutIdRef = useRef<string | null>(null);
  const restorePanelFocusRef = useRef(false);
  const labelId = useId();
  const layoutGroupId = useId();
  const dialogId = useId();
  const setCollectionRef = useCallback((element: HTMLElement | null) => {
    collectionRef.current = element;
    if (element) {
      setPortalContainer((element.closest('.supporter-dashboard-mobile-shell, .supporter-dashboard-desktop-shell') as HTMLElement | null) ?? document.body);
    }
  }, []);
  const searchTerms = normalizeSearchText(searchQuery).split(' ').filter(Boolean);
  const matchesSearch = (card: DashboardGameOnCard) => {
    const cardSearchText = getCardSearchText(card);
    return searchTerms.every((term) => cardSearchText.includes(term));
  };
  const visibleCards = cards.filter(matchesSearch);
  const hasSearchQuery = searchTerms.length > 0;
  const selectedCard = cards.find((card) => card.id === selectedId);
  const dialogOpen = Boolean(isActiveShell && selectedCard);
  const cardCountLabel = (count: number) => `${count} ${count === 1 ? 'card' : 'cards'}`;
  const announceGameCompleted = (opponent: string) => {
    const gameLabel = opponent ? `Game vs ${opponent}` : 'Game';
    setCompletionAnnouncement(`${gameLabel} is complete.`);
  };

  useLayoutEffect(() => {
    if (!openPanel && restorePanelFocusRef.current) {
      restorePanelFocusRef.current = false;
      panelTriggerRef.current?.focus();
    }
  }, [openPanel]);
  useLayoutEffect(() => {
    if (!dialogOpen || !selectedCard) return;
    selectedCardLayoutIdRef.current = selectedCard.layoutId ?? selectedCard.id;
    if (selectedCardTriggerRef.current?.isConnected) return;
    const trigger = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-testid^="button-open-game-on-card-"]') ?? [])
      .find((button) => button.dataset.testid === `button-open-game-on-card-${selectedCard.id}`);
    selectedCardTriggerRef.current = trigger ?? null;
  }, [dialogOpen, selectedCard]);
  useLayoutEffect(() => {
    if (!openPanel || selectedId === openPanel.cardId) return;
    restorePanelFocusRef.current = false;
    panelTriggerRef.current = null;
    setOpenPanel(null);
  }, [openPanel, selectedId]);

  const openCardPanel = (id: string, panel: 'calendar' | 'prep' | 'tracker', trigger: HTMLButtonElement) => {
    const frontAction = trigger.closest('.game-on-collection__flip-back')
      ?.closest('.game-on-collection__card')
      ?.querySelector<HTMLButtonElement>(`.game-on-collection__action--${panel === 'calendar' ? 'details' : panel}`);
    panelTriggerRef.current = frontAction ?? trigger;
    setOpenPanel({ cardId: id, panel });
  };
  const openCollectionCard = (id: string, trigger: HTMLButtonElement) => {
    if (selectedId !== id || !dialogOpen) {
      selectedCardTriggerRef.current = trigger;
      selectedCardLayoutIdRef.current = trigger.closest<HTMLElement>('.game-on-collection__card')?.dataset.layoutId ?? null;
    }
    onOpen(id, trigger);
  };
  const restoreCardFocus = (event: Event) => {
    event.preventDefault();
    if (!isActiveShell) {
      selectedCardTriggerRef.current = null;
      selectedCardLayoutIdRef.current = null;
      return;
    }
    const gridTriggers = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-testid^="button-open-game-on-card-"]') ?? []);
    const selectedTrigger = selectedCardTriggerRef.current?.isConnected && selectedCardTriggerRef.current.getClientRects().length > 0
      ? selectedCardTriggerRef.current
      : gridTriggers.find((button) => button.dataset.testid === `button-open-game-on-card-${selectedId}` && button.getClientRects().length > 0)
        ?? gridTriggers.find((button) => button.closest<HTMLElement>('.game-on-collection__card')?.dataset.layoutId === selectedCardLayoutIdRef.current && button.getClientRects().length > 0);
    const firstVisibleTrigger = gridTriggers.find((button) => button.getClientRects().length > 0);
    const collectionFallback = collectionRef.current?.querySelector<HTMLElement>(
      '[data-testid="button-clear-game-on-search-empty"], [data-testid="input-search-game-on-cards"], [data-testid="button-create-game-on-card"]',
    );
    const trigger = selectedTrigger ?? firstVisibleTrigger ?? collectionFallback;
    trigger?.focus();
    selectedCardTriggerRef.current = null;
    selectedCardLayoutIdRef.current = null;
  };
  const closeCardPanel = () => {
    restorePanelFocusRef.current = true;
    setOpenPanel(null);
  };

  return (
    <section ref={setCollectionRef} id="game-on-dashboard-collection" className="game-on-collection" aria-labelledby={labelId} data-testid="game-on-dashboard-collection">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="status-game-completion-announcement">
        {completionAnnouncement}
      </p>
      <div className="game-on-collection__inner">
        <div className="game-on-collection__header">
          <div>
            <p className="game-on-collection__eyebrow"><span className="game-on-collection__eyebrow-line" aria-hidden="true" /> Your season, one card at a time</p>
            <h2 className="game-on-collection__title" id={labelId}>Game On</h2>
            <p className="game-on-collection__intro">Everything for the next game or practice, right where you need it.</p>
          </div>
          <button
            type="button"
            className="game-on-collection__create"
            onClick={onCreate}
            disabled={createDisabled}
            title={createDisabled ? 'Finish or cancel your current draft before adding another.' : undefined}
            data-testid="button-create-game-on-card"
          >
            <Plus size={19} strokeWidth={2.5} aria-hidden="true" /> Add Game On Card
          </button>
        </div>

        {cards.length === 0 && (
          <div className="game-on-collection__empty" data-testid="status-game-on-empty">
            <span className="game-on-collection__empty-mark" aria-hidden="true"><CalendarDays size={29} strokeWidth={1.7} /></span>
            <div>
              <h3 className="game-on-collection__empty-title">Your first card starts here.</h3>
              <p className="game-on-collection__empty-copy">Add a game or practice to keep the details close on game day.</p>
            </div>
          </div>
        )}
        {cards.length > 0 && (
          <div className="game-on-collection__toolbar">
            <div className="game-on-collection__toolbar-left">
              <span className="game-on-collection__rail-label">Your cards</span>
              <span
                className="game-on-collection__count"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                data-testid="status-game-on-card-count"
              >
                Showing {visibleCards.length} of {cardCountLabel(cards.length)}
              </span>
            </div>
            <div className="game-on-collection__search" role="search" aria-label="Search Game On cards">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search Game On cards by opponent, location, or date"
                placeholder="Opponent, location, or date"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                data-testid="input-search-game-on-cards"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear card search"
                  onClick={() => setSearchQuery('')}
                  data-testid="button-clear-game-on-search"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        )}
        {hasSearchQuery && visibleCards.length === 0 && (
          <div className="game-on-collection__empty game-on-collection__empty--filtered" data-testid="status-game-on-filter-empty">
            <div>
              <h3 className="game-on-collection__empty-title">No cards match your search.</h3>
              <p className="game-on-collection__empty-copy">
                Try another opponent, location, or date, or clear your search to see the matching cards again.
              </p>
            </div>
            <button
              type="button"
              className="game-on-collection__reset-filter"
              onClick={() => setSearchQuery('')}
              data-testid="button-clear-game-on-search-empty"
            >
              Clear search
            </button>
          </div>
        )}
        <LayoutGroup id={layoutGroupId}>
          {cards.length > 0 && (
            <div
              ref={gridRef}
              className="game-on-collection__grid"
              role="list"
              aria-label="Game On cards"
              data-testid="grid-game-on-cards"
              hidden={visibleCards.length === 0}
            >
              {cards.map((card) => (
                <CollectionCard
                  key={card.layoutId ?? card.id}
                  card={card}
                  onOpen={(id, trigger) => { setOpenPanel(null); openCollectionCard(id, trigger); }}
                  onCancelDraft={onCancelDraft}
                  selected={false}
                  triggerSelected={dialogOpen && selectedId === card.id}
                  dialogId={`game-on-card-dialog-${dialogId}`}
                  visible={matchesSearch(card)}
                  upNextEventId={upNextEventId}
                  renderSelectedCard={renderSelectedCard}
                  panel={null}
                  onOpenPanel={() => {}}
                  onClosePanel={closeCardPanel}
                  statTrackerUserId={statTrackerUserId}
                  prepUserId={prepUserId}
                  statTrackerSport={statTrackerSport}
                  statTrackerAthleteName={statTrackerAthleteName}
                  statTrackerTeamName={statTrackerTeamName}
                  onCompleteScheduledGame={onCompleteScheduledGame}
                  onAnnounceGameCompleted={announceGameCompleted}
                />
              ))}
            </div>
          )}
        </LayoutGroup>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            if (!open && selectedCard && isActiveShell) {
              setOpenPanel(null);
              onOpen(selectedCard.id);
            }
          }}
        >
          {selectedCard && (
            <DialogPortal container={portalContainer ?? undefined}>
              <DialogOverlay className="game-on-collection__dialog-overlay" />
              <DialogPrimitive.Content
                id={`game-on-card-dialog-${dialogId}`}
                className="game-on-collection__dialog-content"
                aria-describedby={`game-on-card-dialog-description-${dialogId}`}
                data-testid={`dialog-game-on-card-${selectedCard.id}`}
                onCloseAutoFocus={restoreCardFocus}
              >
                <div className="game-on-collection__dialog-heading">
                  <DialogTitle className="game-on-collection__dialog-title">
                    {selectedCard.type === 'practice'
                      ? `${selectedCard.athleteName || 'Your athlete'}’s practice`
                      : `Game${selectedCard.opponent ? ` vs ${selectedCard.opponent}` : ''}`}
                  </DialogTitle>
                  <DialogDescription id={`game-on-card-dialog-description-${dialogId}`} className="sr-only">
                    Review this Game On card and open its preparation, event details, or stat tracker.
                  </DialogDescription>
                  <DialogClose className="game-on-collection__dialog-close" aria-label="Close Game On card">
                    <X size={18} aria-hidden="true" />
                  </DialogClose>
                </div>
                <div className="game-on-collection__dialog-card-wrap">
                  <CollectionCard
                    key={`dialog-${selectedCard.layoutId ?? selectedCard.id}`}
                    card={selectedCard}
                    onOpen={(id, trigger) => { setOpenPanel(null); openCollectionCard(id, trigger); }}
                    onCancelDraft={onCancelDraft}
                    selected
                    isDialogCard
                    visible
                    upNextEventId={upNextEventId}
                    panel={openPanel?.cardId === selectedCard.id ? openPanel.panel : null}
                    onOpenPanel={openCardPanel}
                    onClosePanel={closeCardPanel}
                    statTrackerUserId={statTrackerUserId}
                    prepUserId={prepUserId}
                    statTrackerSport={statTrackerSport}
                    statTrackerAthleteName={statTrackerAthleteName}
                    statTrackerTeamName={statTrackerTeamName}
                    onCompleteScheduledGame={onCompleteScheduledGame}
                    onAnnounceGameCompleted={announceGameCompleted}
                    renderSelectedCard={renderSelectedCard}
                  />
                </div>
              </DialogPrimitive.Content>
            </DialogPortal>
          )}
        </Dialog>
        {visibleCards.length > 0 && (
          <div className="game-on-collection__bottom">
            <p className="game-on-collection__hint">Tap a card to open its badge and choose a tool.</p>
          </div>
        )}
      </div>
    </section>
  );
}