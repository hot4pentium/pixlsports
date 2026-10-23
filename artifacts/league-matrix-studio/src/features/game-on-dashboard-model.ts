import {
  getSupporterEventElapsedTimeMs,
  getSupporterGameStage,
  isSupporterGameInPregameCaptureWindow,
} from './supporter-dashboard-model';

export type GameOnDashboardEvent = {
  id: string;
  calendarProjectId?: string;
  type: 'game' | 'practice' | 'meeting';
  date: string;
  time: string;
  timezone?: string;
  location: string;
  opponent?: string;
  status?: 'upcoming' | 'live' | 'final';
};

export type OwnedGameOnShare = {
  shareToken: string;
  title: string;
  createdAt: string;
  events: GameOnDashboardEvent[];
};

export type GameOnDashboardEntry = {
  id: string;
  eventId: string;
  calendarProjectId?: string;
  shareToken?: string;
  type: 'game' | 'practice';
  athleteName: string;
  opponent: string;
  date: string;
  time: string;
  timezone?: string;
  location: string;
  status: 'Draft' | 'Published' | 'Starting Soon' | 'Live' | 'Sharing' | 'Complete';
  isPublished: boolean;
};

export type GameOnSuggestedAction = 'prep' | 'tracker' | 'share' | 'stats' | 'none';

export function getSuggestedGameOnAction(
  card: Pick<GameOnDashboardEntry, 'type' | 'status'> & { recordedGameId?: string; shareToken?: string },
): GameOnSuggestedAction {
  if (card.status === 'Complete') return 'none';
  if (card.type === 'practice') return 'prep';
  if (card.status === 'Sharing') return card.shareToken ? 'share' : 'none';
  if (card.status === 'Starting Soon' || card.status === 'Live') return 'tracker';
  if (card.recordedGameId) return 'stats';
  return 'prep';
}

function calendarKey(date: string, time: string) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim());
  if (!match) return '9999-12-31T23:59';
  const day = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const clock = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  return `${day}T${clock ? `${clock[1].padStart(2, '0')}:${clock[2]}` : '23:59'}`;
}

export function sortGameOnCardsByDate<T extends { date: string; time: string }>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => calendarKey(a.date, a.time).localeCompare(calendarKey(b.date, b.time)));
}

export function getFeaturedGameOnCardId(
  cards: readonly Pick<GameOnDashboardEntry, 'id' | 'date' | 'time' | 'timezone' | 'type' | 'status'>[],
  now = new Date(),
): string | undefined {
  const dated = sortGameOnCardsByDate(cards).filter((card) => card.date.trim());
  const stage = (card: typeof dated[number]) => getSupporterGameStage({
    date: card.date,
    time: card.time,
    timezone: card.timezone,
    type: card.type,
    status: card.status === 'Complete' ? 'final' : card.status === 'Live' || card.status === 'Sharing' ? 'live' : 'upcoming',
  }, now, { maxLiveDurationMs: 2 * 60 * 60 * 1000 });
  return dated.find((card) => stage(card) === 'live')?.id
    ?? dated.find((card) => stage(card) === 'upcoming')?.id;
}

export function getNextGameOnDashboardEntry(
  cards: readonly GameOnDashboardEntry[],
  now = new Date(),
): GameOnDashboardEntry | undefined {
  const games = sortGameOnCardsByDate(cards.filter((card) => card.type === 'game' && card.date.trim()));
  const stage = (card: GameOnDashboardEntry) => getSupporterGameStage({
    date: card.date,
    time: card.time,
    timezone: card.timezone,
    type: card.type,
    status: card.status === 'Complete' ? 'final' : card.status === 'Live' || card.status === 'Sharing' ? 'live' : 'upcoming',
  }, now, { maxLiveDurationMs: 2 * 60 * 60 * 1000 });
  return games.find((card) => stage(card) === 'live')
    ?? games.find((card) => stage(card) === 'upcoming');
}

function isCardEvent(event: GameOnDashboardEvent | undefined): event is GameOnDashboardEvent & { type: 'game' | 'practice' } {
  return Boolean(event && event.id && (event.type === 'game' || event.type === 'practice'));
}

function entryForEvent(event: GameOnDashboardEvent & { type: 'game' | 'practice' }, athleteName: string, now: Date, shareToken?: string): GameOnDashboardEntry {
  const elapsed = getSupporterEventElapsedTimeMs(event, now);
  const sharingWindow = event.type === 'game'
    && elapsed !== null
    && elapsed >= 60 * 60 * 1000
    && elapsed < 2 * 60 * 60 * 1000;
  const stage = event.date
    ? getSupporterGameStage(event, now, {
      includePregameCaptureWindow: false,
      maxLiveDurationMs: 2 * 60 * 60 * 1000,
    })
    : 'upcoming';
  const startingSoon = event.date && isSupporterGameInPregameCaptureWindow(event, now);
  return {
    id: shareToken ? `share:${shareToken}` : `draft:${event.id}`,
    eventId: event.id,
    ...(event.calendarProjectId ? { calendarProjectId: event.calendarProjectId } : {}),
    ...(shareToken ? { shareToken } : {}),
    type: event.type,
    athleteName: athleteName || 'Your athlete',
    opponent: event.type === 'game' ? event.opponent ?? '' : '',
    date: event.date,
    time: event.time,
    ...(event.timezone ? { timezone: event.timezone } : {}),
    location: event.location,
    status: sharingWindow
      ? 'Sharing'
      : stage === 'completed'
      ? 'Complete'
      : stage === 'live'
        ? 'Live'
        : startingSoon
          ? 'Starting Soon'
          : shareToken ? 'Published' : 'Draft',
    isPublished: Boolean(shareToken),
  };
}

export function buildGameOnDashboardEntries(
  events: readonly GameOnDashboardEvent[],
  shares: readonly OwnedGameOnShare[],
  athleteName: string,
  now = new Date(),
  completedLocalGames: readonly { date: string; opponent: string }[] = [],
): GameOnDashboardEntry[] {
  const scheduledById = new Map(events.filter(isCardEvent).map((event) => [event.id, event]));
  const published = shares
    .filter((share) => share.events.length === 1 && isCardEvent(share.events[0]))
    .map((share) => {
      const sharedEvent = share.events[0] as GameOnDashboardEvent & { type: 'game' | 'practice' };
      const scheduled = scheduledById.get(sharedEvent.id);
      const card = entryForEvent(scheduled ?? sharedEvent, athleteName, now, share.shareToken);
      // An independent card has no Calendar status. Its inline tracker persists
      // locally, so reflect an ended game when the saved card is reopened.
      if (!scheduled && card.status !== 'Sharing' && sharedEvent.type === 'game' && completedLocalGames.some((game) => (
        game.date === sharedEvent.date
        && game.opponent.trim().toLowerCase() === (sharedEvent.opponent ?? '').trim().toLowerCase()
      ))) card.status = 'Complete';
      return card;
    });
  const publishedEventIds = new Set(published.map((card) => card.eventId));
  const drafts = events
    .filter(isCardEvent)
    .filter((event) => !publishedEventIds.has(event.id))
    .map((event) => entryForEvent(event, athleteName, now));

  return sortGameOnCardsByDate([...published, ...drafts]);
}