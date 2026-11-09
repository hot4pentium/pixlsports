import type { AthleteInviteEventSummary } from '@workspace/api-client-react';

export function athleteEventTimeDisplay(time: string) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(time.trim());
  if (!match) return time;
  let hour = Number(match[1]);
  if (Number(match[2]) > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return time;
  if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function gameOnHref(shareToken: string) {
  return `/game-on/${encodeURIComponent(shareToken)}`;
}

export function athleteLocalDate(now: Date, timezone: string | null | undefined): string | null {
  if (!timezone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const part = (type: string) => parts.find((value) => value.type === type)?.value;
    const year = part('year');
    const month = part('month');
    const day = part('day');
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

export function hasEventToday(events: AthleteInviteEventSummary[], timezone: string | null | undefined, now = new Date()) {
  const today = athleteLocalDate(now, timezone);
  return Boolean(today && events.some((event) => event.status !== 'final' && event.date === today));
}

export function recentUpcomingAthleteEvents(
  events: AthleteInviteEventSummary[],
  today: string,
  limit = 3,
) {
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (!count) return [];

  const ordered = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => /^\d{4}-\d{2}-\d{2}$/.test(event.date))
    .sort((left, right) => left.event.date.localeCompare(right.event.date) || left.index - right.index);
  const upcoming = ordered.filter(({ event }) => event.date >= today && event.status !== 'final');
  const recent = ordered.filter(({ event }) => event.date < today || event.status === 'final');
  const recentCount = Math.max(0, count - Math.min(count, upcoming.length));
  const selectedRecent = recentCount ? recent.slice(-recentCount) : [];

  return [...selectedRecent, ...upcoming.slice(0, count)]
    .sort((left, right) => left.event.date.localeCompare(right.event.date) || left.index - right.index)
    .map(({ event }) => event);
}