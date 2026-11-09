import { isIanaTimezone, scheduledEventStart } from "./timezone";

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
  timezone?: string;
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
  options: { now?: Date; timezone?: string | null; normalizeDisplayStatus?: boolean } = {},
): AthleteEventSummary[] {
  const now = options.now ?? new Date();
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
    let status: AthleteEventSummary["status"] = eventStatus === "final" || trackerStatus === "final"
      ? "final"
      : eventStatus === "live" || trackerStatus === "live"
        ? "live"
        : "upcoming";
    const timezone = isIanaTimezone(event.timezone) ? event.timezone
      : isIanaTimezone(options.timezone) ? options.timezone : undefined;
    const start = timezone && typeof event.time === "string"
      ? scheduledEventStart(event.date, event.time, timezone) : null;
    if (options.normalizeDisplayStatus !== false && status !== "final" && start) {
      // Calendar display only: match the owner's Share/Complete phase without
      // changing a tracker, its score, or its actual finalization state.
      const completeAfter = (type === "game" ? 1 : 3) * 3_600_000;
      status = now.getTime() < start.getTime() ? "upcoming"
        : now.getTime() - start.getTime() >= completeAfter ? "final" : "live";
    } else if (options.normalizeDisplayStatus !== false && status !== "final"
      && now.getTime() - Date.parse(`${event.date}T00:00:00Z`) >= 48 * 3_600_000) {
      // A legacy card with no usable zone/time cannot remain live indefinitely.
      // Two full days are safely past its window in every supported time zone.
      status = "final";
    }

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
      ...(timezone ? { timezone } : {}),
    }];
  });
}
