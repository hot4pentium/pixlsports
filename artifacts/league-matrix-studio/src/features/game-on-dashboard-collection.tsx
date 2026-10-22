import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { trackerCompletionHandoffEvent } from './tracker-completion-handoff';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { Activity, ArrowLeft, ArrowRight, CalendarDays, ClipboardCheck, Clock3, Copy, ExternalLink, MapPin, Plus, Search, Share2, Swords, Trash2, X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogClose, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { buildWorkspaceToolHref } from './workspace-context';
import { copyGameOnCardPublicLink, gameOnCardPublicHref, shareGameOnCardPublicLink } from './game-on-card-links';
import { GAME_ON_COLLECTION_ID } from './game-on-navigation';
import { GameOnInlinePrepChecklist } from './game-on-inline-prep-checklist';
import type { Sport } from './stat-tracker';
import './game-on-dashboard-collection.css';

export type DashboardGameOnCard = {
  id: string;
  eventId?: string;
  shareToken?: string;
  layoutId?: string;
  type: 'game' | 'practice';
  athleteName: string;
  opponent: string;
  date: string;
  time: string;
  location: string;
  status: 'Draft' | 'Published' | 'Starting Soon' | 'Live' | 'Complete';
  isPublished: boolean;
  isUnsavedDraft?: boolean;
  recordedGameId?: string;
};

export type GameOnCardDeleteResult = {
  calendarEventDeleted: boolean;
  calendarEventStatus: 'deleted' | 'not-linked' | 'unverified' | 'not-found' | 'ambiguous';
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
  onDeleteCard?: (card: DashboardGameOnCard) => Promise<GameOnCardDeleteResult>;
  selectedId?: string;
  isActiveShell?: boolean;
  featuredCardId?: string;
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

function CollectionCard({ card, onOpen, onCancelDraft, selected, triggerSelected = false, isDialogCard = false, dialogId, visible, featuredCardId, renderSelectedCard, panel, onOpenPanel, onClosePanel, statTrackerUserId, prepUserId, statTrackerSport, statTrackerAthleteName, statTrackerTeamName, onCompleteScheduledGame, onAnnounceGameCompleted }: {
  card: DashboardGameOnCard;
  onOpen: (id: string, trigger: HTMLButtonElement) => void;
  onCancelDraft?: () => void;
  selected: boolean;
  triggerSelected?: boolean;
  isDialogCard?: boolean;
  dialogId?: string;
  visible: boolean;
  featuredCardId?: string;
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
  const [shareLinkNotice, setShareLinkNotice] = useState('');
  const trackerOpen = panel === 'tracker';
  const prepOpen = panel === 'prep';
  const calendarOpen = panel === 'calendar';
  const panelOpen = panel !== null;
  const trackerPanelId = `panel-inline-tracker-${card.id}-${editorId}`;
  const calendarPanelId = `panel-inline-calendar-${card.id}-${editorId}`;
  const prepPanelId = `panel-inline-prep-${card.id}-${editorId}`;
  const date = dateParts(card.date);
  const practice = card.type === 'practice';
  const isFeatured = card.id === featuredCardId;
  const isUpNext = isFeatured && card.status !== 'Live';
  const isActive = isFeatured && card.status === 'Live';
  const isStartingSoon = isFeatured && card.status === 'Starting Soon';
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
  const statusKey = statusLabel.toLowerCase().replace(/\s+/g, '-');
  const copyEventCardLink = async () => {
    if (!card.shareToken) return;
    const copied = await copyGameOnCardPublicLink(card.shareToken);
    setShareLinkNotice(copied
      ? 'Event Card link copied.'
      : 'Event Card link could not be copied. Open card to copy its address.');
  };
  const shareEventCard = async () => {
    if (!card.shareToken) return;
    setShareLinkNotice('');
    const result = await shareGameOnCardPublicLink(card.shareToken, `${card.athleteName}'s Event Card`);
    if (result === 'shared') setShareLinkNotice('Event Card shared.');
    else if (result === 'copied') setShareLinkNotice('Event Card link copied.');
    else if (result === 'failed') {
      setShareLinkNotice('Event Card link could not be shared or copied. Use Copy link or Open card.');
    }
  };
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
      className={`game-on-collection__card${isDialogCard ? ' game-on-collection__dialog-card' : ''}${card.status === 'Live' ? ' game-on-collection__card--live' : ''}${isUpNext ? ' game-on-collection__card--up-next' : ''}${isActive ? ' game-on-collection__card--active' : ''}${selected ? ' game-on-collection__card--selected game-on-collection__card--expanded' : ''}${calendarOpen ? ' game-on-collection__card--calendar-open' : ''}${trackerOpen ? ' game-on-collection__card--tracker-open' : ''}${prepOpen ? ' game-on-collection__card--prep-open' : ''}`}
      hidden={!visible}
      data-testid={`card-game-on-${card.id}`}
      data-layout-id={card.layoutId ?? card.id}
      data-up-next={isUpNext ? 'true' : 'false'}
      data-featured={isFeatured ? 'true' : 'false'}
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
            aria-label={`${isStartingSoon ? 'Starting soon: ' : isUpNext ? 'Up next: ' : isActive ? 'Active now: ' : ''}${selected ? 'Collapse' : 'Open'} ${card.athleteName ? `${card.athleteName}'s ` : ''}${practice ? 'practice' : 'game'} badge${card.opponent ? `, ${practice ? '' : 'versus '}${card.opponent}` : ''}, ${card.date || 'date to be determined'}, ${displayTime(card.time)}, ${card.location || 'Location TBD'}, ${statusLabel}`}
            aria-haspopup={isDialogCard ? undefined : 'dialog'}
            aria-expanded={renderSelectedCard ? (isDialogCard ? selected : triggerSelected) : undefined}
            aria-controls={isDialogCard ? (hasEditor ? editorId : undefined) : triggerSelected ? dialogId : undefined}
            data-testid={`button-open-game-on-card-${card.id}`}
          >
            <span className="game-on-collection__card-top">
              {isFeatured && !isDialogCard && (
                <span className={`game-on-collection__featured-label${isActive ? ' game-on-collection__featured-label--active' : ''}`}>
                  {isActive ? 'Happening now' : isStartingSoon ? 'Starting soon' : 'Up next'}
                </span>
              )}
              <span className="game-on-collection__kind">
                {practice ? <CalendarDays size={14} aria-hidden="true" /> : <Swords size={14} aria-hidden="true" />}
                {practice ? 'Practice' : 'Game'}
              </span>
              <span className={`game-on-collection__status game-on-collection__status--${statusKey}`} data-status={statusKey} data-testid={`status-game-on-card-${card.id}`}>
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
                aria-label="Cancel this unsaved Event Card"
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
                  card.recordedGameId
                    ? <Link
                        href={`/studio/season-stats?gameId=${encodeURIComponent(card.recordedGameId)}`}
                        className="game-on-collection__action--tracker"
                        aria-label={`View stats for ${card.opponent ? `the game versus ${card.opponent}` : 'this completed game'}`}
                        data-testid={`link-view-card-stats-${card.id}`}
                      >
                        <Activity size={15} aria-hidden="true" />
                        <span>View stats</span>
                      </Link>
                    : <button
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
                {card.shareToken && (
                  <>
                    <button
                      type="button"
                      className="game-on-collection__action--details"
                      onClick={() => void shareEventCard()}
                      aria-label={`Share ${card.athleteName}'s Event Card`}
                      data-testid={`button-share-game-on-card-${card.id}`}
                    >
                      <Share2 size={15} aria-hidden="true" />
                      <span>Share</span>
                    </button>
                    <button
                      type="button"
                      className="game-on-collection__action--details"
                      onClick={() => void copyEventCardLink()}
                      aria-label="Copy Event Card link"
                      data-testid={`button-copy-game-on-card-link-${card.id}`}
                    >
                      <Copy size={15} aria-hidden="true" />
                      <span>Copy link</span>
                    </button>
                    <Link
                      href={gameOnCardPublicHref(card.shareToken)}
                      target="_blank"
                      rel="noreferrer"
                      className="game-on-collection__action--details"
                      aria-label="Open card"
                      data-testid={`link-open-game-on-card-${card.id}`}
                    >
                      <ExternalLink size={15} aria-hidden="true" />
                      <span>Open card</span>
                    </Link>
                  </>
                )}
                {shareLinkNotice && (
                  <p className="basis-full text-xs font-semibold text-current" role="status" aria-live="polite">
                    {shareLinkNotice}
                  </p>
                )}
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
              <Link href={buildWorkspaceToolHref('stats', eventContext)} className="game-on-quick-tracker__primary">Open stat tracker</Link>
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
  onDeleteCard,
  selectedId,
  isActiveShell = true,
  featuredCardId,
  renderSelectedCard,
  statTrackerUserId,
  prepUserId,
  statTrackerSport,
  statTrackerAthleteName,
  statTrackerTeamName,
  onCompleteScheduledGame,
}: GameOnDashboardCollectionProps) {
  const [, setLocation] = useLocation();
  const [openPanel, setOpenPanel] = useState<{ cardId: string; panel: 'calendar' | 'prep' | 'tracker' } | null>(null);
  const [completionAnnouncement, setCompletionAnnouncement] = useState('');
  const [deleteAnnouncement, setDeleteAnnouncement] = useState('');
  const [deleteConfirmationCardId, setDeleteConfirmationCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
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
  const cardCountLabel = (count: number) => `${count} ${count === 1 ? 'Event Card' : 'Event Cards'}`;
  const announceGameCompleted = (opponent: string) => {
    const gameLabel = opponent ? `Game vs ${opponent}` : 'Game';
    setCompletionAnnouncement(`${gameLabel} is complete.`);
  };
  const confirmDeleteCard = async () => {
    if (!selectedCard || !onDeleteCard) return;
    const card = selectedCard;
    setDeletingCardId(card.id);
    setDeleteError('');
    try {
      const result = await onDeleteCard(card);
      setDeleteConfirmationCardId(null);
      const cardLabel = 'Event Card and its public link deleted.';
      const calendarResult = result.calendarEventStatus === 'deleted'
        ? ' Its linked Calendar event was deleted too.'
        : result.calendarEventStatus === 'not-linked'
          ? ' No Calendar event was linked, so the Calendar was left unchanged.'
          : result.calendarEventStatus === 'ambiguous'
            ? ' The Calendar event was left in place because its match was not unique.'
            : result.calendarEventStatus === 'not-found'
              ? ' The Calendar was left unchanged because the linked event was no longer there.'
              : ' The Calendar was left unchanged because ownership or the event match could not be verified.';
      setDeleteAnnouncement(`${cardLabel}${calendarResult}`);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Unable to delete this Event Card. Try again.');
    } finally {
      setDeletingCardId(null);
    }
  };

  useEffect(() => {
    setDeleteConfirmationCardId(null);
    setDeleteError('');
  }, [selectedCard?.id]);

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
    if (panel === 'tracker') {
      const card = cards.find((candidate) => candidate.id === id);
      if (!card || card.type === 'practice') return;
      setOpenPanel(null);
      setLocation(buildWorkspaceToolHref('stats', {
        id: card.eventId ?? card.id.replace(/^(?:share|draft):/, ''),
        type: card.type,
        date: card.date,
        time: card.time,
        location: card.location,
        opponent: card.opponent,
      }));
      return;
    }
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
  useEffect(() => {
    const closeCompletedTracker = () => {
      setOpenPanel(null);
      if (dialogOpen && selectedCard && isActiveShell) onOpen(selectedCard.id);
    };
    window.addEventListener(trackerCompletionHandoffEvent, closeCompletedTracker);
    return () => window.removeEventListener(trackerCompletionHandoffEvent, closeCompletedTracker);
  }, [dialogOpen, selectedCard?.id, isActiveShell, onOpen]);

  return (
    <section ref={setCollectionRef} id={isActiveShell ? GAME_ON_COLLECTION_ID : undefined} className="game-on-collection" aria-labelledby={labelId} data-testid="game-on-dashboard-collection">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="status-game-completion-announcement">
        {completionAnnouncement}
      </p>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="status-game-on-delete-announcement">
        {deleteAnnouncement}
      </p>
      <div className="game-on-collection__inner">
        <div className="game-on-collection__header">
          <div className="game-on-collection__header-copy">
            <p className="game-on-collection__eyebrow"><span className="game-on-collection__eyebrow-line" aria-hidden="true" /> Your season, one card at a time</p>
            <h2 className="game-on-collection__title" id={labelId}>Event Cards</h2>
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
            <Plus size={19} strokeWidth={2.5} aria-hidden="true" /> <span>Add an Event Card</span>
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
            <div className="game-on-collection__search" role="search" aria-label="Search Event Cards">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search Event Cards by opponent, location, or date"
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
              aria-label="Event Cards"
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
                  featuredCardId={featuredCardId}
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
                    Review this Event Card and open its preparation, event details, or stat tracker.
                  </DialogDescription>
                  <DialogClose className="game-on-collection__dialog-close" aria-label="Close Event Card">
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
                    featuredCardId={featuredCardId}
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
                {onDeleteCard && selectedCard.shareToken && !selectedCard.isUnsavedDraft && (
                  <div className="mt-4 border-t border-border/70 pt-4">
                    {deleteConfirmationCardId === selectedCard.id ? (
                      <div role="group" aria-labelledby={`delete-game-on-title-${dialogId}`} data-testid={`confirm-delete-game-on-card-${selectedCard.id}`}>
                        <h3 id={`delete-game-on-title-${dialogId}`} className="text-sm font-bold uppercase tracking-wide text-destructive">
                          Delete this Event Card?
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          This deletes the Event Card and its public link. The Calendar event is removed only if its saved link uniquely matches an event in a Calendar you own; otherwise the Calendar is left unchanged. This can’t be undone.
                        </p>
                        {deleteError && <p className="mt-3 text-sm font-medium text-destructive" role="alert">{deleteError}</p>}
                        <div className="mt-4 flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            className="min-h-10 border border-border px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                            onClick={() => { setDeleteConfirmationCardId(null); setDeleteError(''); }}
                            disabled={deletingCardId === selectedCard.id}
                            data-testid={`button-cancel-delete-game-on-card-${selectedCard.id}`}
                          >
                            Keep card
                          </button>
                          <button
                            type="button"
                            className="inline-flex min-h-10 items-center gap-2 bg-destructive px-4 py-2 text-xs font-bold uppercase tracking-wider text-destructive-foreground disabled:cursor-wait disabled:opacity-50"
                            onClick={() => void confirmDeleteCard()}
                            disabled={deletingCardId === selectedCard.id}
                            data-testid={`button-confirm-delete-game-on-card-${selectedCard.id}`}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            {deletingCardId === selectedCard.id ? 'Deleting…' : 'Delete Event Card'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex min-h-10 items-center gap-2 border border-destructive/40 px-4 py-2 text-xs font-bold uppercase tracking-wider text-destructive transition-colors hover:border-destructive hover:bg-destructive/5"
                        onClick={() => { setDeleteError(''); setDeleteConfirmationCardId(selectedCard.id); }}
                        data-testid={`button-delete-game-on-card-${selectedCard.id}`}
                      >
                        <Trash2 size={14} aria-hidden="true" /> Delete card
                      </button>
                    )}
                  </div>
                )}
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
