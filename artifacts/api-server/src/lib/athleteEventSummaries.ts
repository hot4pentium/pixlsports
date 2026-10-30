export interface AthleteEventShareRow {
  id: string;
  title: string;
  events: unknown;
}

export interface AthleteTrackerShareRow {
  gameId: string;
  game: unknown;
}

export interface AthleteEventSummary {
  shareToken: string;
  eventId: string;
  title: string;
  date: string;
  time: string;
  type: "game" | "practice";
  status: "upcoming" | "live" | "final";
  opponent: string;
  location: string;
}

function eventFromCard(events: unknown): Record<string, unknown> | null {
  if (!Array.isArray(events) || events.length !== 1) return null;
  const event: unknown = events[0];
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const item = event as Record<string, unknown>;
  return item.type === "game" || item.type === "practice" ? item : null;
}

function validEventDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function gameIdsFromAthleteEventShares(shares: AthleteEventShareRow[]): string[] {
  return [...new Set(shares.flatMap(({ events }) => {
    const event = eventFromCard(events);
    return event?.type === "game" && typeof event.id === "string" && validEventDate(event.date)
      ? [event.id]
      : [];
  }))];
}

export function mapAthleteEventSummaries(
  shares: AthleteEventShareRow[],
  trackerRows: AthleteTrackerShareRow[],
): AthleteEventSummary[] {
  const trackerStatusByGame = new Map<string, string>();
  for (const tracker of trackerRows) {
    const game = tracker.game && typeof tracker.game === "object" && !Array.isArray(tracker.game)
      ? tracker.game as Record<string, unknown>
      : {};
    if (game.status === "final" || game.status === "live") {
      trackerStatusByGame.set(tracker.gameId, game.status);
    }
  }

  return shares.flatMap((share) => {
    const event = eventFromCard(share.events);
    if (!event || typeof event.id !== "string" || !validEventDate(event.date)) return [];

    const type = event.type as "game" | "practice";
    const eventStatus = event.status === "final" || event.status === "live" ? event.status : "upcoming";
    const trackerStatus = type === "game" ? trackerStatusByGame.get(event.id) : undefined;
    const status = eventStatus === "final" || trackerStatus === "final"
      ? "final"
      : eventStatus === "live" || trackerStatus === "live"
        ? "live"
        : "upcoming";

    return [{
      shareToken: share.id,
      eventId: event.id,
      title: share.title,
      date: event.date,
      time: typeof event.time === "string" ? event.time : "",
      type,
      status,
      opponent: typeof event.opponent === "string" ? event.opponent : "",
      location: typeof event.location === "string" ? event.location : "",
    }];
  });
}
