import { getSupporterGameStage } from './supporter-dashboard-model';

export type GameOnDashboardEvent = {
  id: string;
  type: 'game' | 'practice' | 'meeting';
  date: string;
  time: string;
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
  shareToken?: string;
  type: 'game' | 'practice';
  athleteName: string;
  opponent: string;
  date: string;
  time: string;
  location: string;
  status: 'Draft' | 'Published' | 'Live' | 'Complete';
  isPublished: boolean;
};

function isCardEvent(event: GameOnDashboardEvent | undefined): event is GameOnDashboardEvent & { type: 'game' | 'practice' } {
  return Boolean(event && event.id && (event.type === 'game' || event.type === 'practice'));
}

function entryForEvent(event: GameOnDashboardEvent & { type: 'game' | 'practice' }, athleteName: string, now: Date, shareToken?: string): GameOnDashboardEntry {
  const stage = event.date ? getSupporterGameStage(event, now) : 'upcoming';
  return {
    id: shareToken ? `share:${shareToken}` : `draft:${event.id}`,
    eventId: event.id,
    ...(shareToken ? { shareToken } : {}),
    type: event.type,
    athleteName: athleteName || 'Your athlete',
    opponent: event.type === 'game' ? event.opponent ?? '' : '',
    date: event.date,
    time: event.time,
    location: event.location,
    status: stage === 'completed' ? 'Complete' : stage === 'live' ? 'Live' : shareToken ? 'Published' : 'Draft',
    isPublished: Boolean(shareToken),
  };
}

export function buildGameOnDashboardEntries(
  events: readonly GameOnDashboardEvent[],
  shares: readonly OwnedGameOnShare[],
  athleteName: string,
  now = new Date(),
): GameOnDashboardEntry[] {
  const scheduledById = new Map(events.filter(isCardEvent).map((event) => [event.id, event]));
  const published = shares
    .filter((share) => share.events.length === 1 && isCardEvent(share.events[0]))
    .map((share) => {
      const sharedEvent = share.events[0] as GameOnDashboardEvent & { type: 'game' | 'practice' };
      return entryForEvent(scheduledById.get(sharedEvent.id) ?? sharedEvent, athleteName, now, share.shareToken);
    });
  const publishedEventIds = new Set(published.map((card) => card.eventId));
  const drafts = events
    .filter(isCardEvent)
    .filter((event) => !publishedEventIds.has(event.id))
    .map((event) => entryForEvent(event, athleteName, now));

  const priority = (card: GameOnDashboardEntry) => {
    const event = { ...card, status: card.status === 'Complete' ? 'final' as const : card.status === 'Live' ? 'live' as const : 'upcoming' as const };
    const stage = card.date ? getSupporterGameStage(event, now) : 'upcoming';
    return stage === 'upcoming' ? 0 : stage === 'live' ? 1 : 2;
  };
  return [...published, ...drafts].sort((a, b) => {
    const aPriority = priority(a);
    const bPriority = priority(b);
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aDate = `${a.date || '9999-12-31'}T${a.time || '23:59'}`;
    const bDate = `${b.date || '9999-12-31'}T${b.time || '23:59'}`;
    return aPriority === 2 ? bDate.localeCompare(aDate) : aDate.localeCompare(bDate);
  });
}