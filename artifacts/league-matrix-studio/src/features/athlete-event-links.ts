import type { AthleteInviteEventSummary } from '@workspace/api-client-react';

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