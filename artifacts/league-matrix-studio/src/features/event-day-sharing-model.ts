export interface OwnerGameOnEvent {
  eventId: string;
  shareToken: string;
  title: string;
  date: string;
  time: string;
  type: string;
  status: string;
  opponent: string;
  location: string;
}

export interface OwnerAthletePage {
  inviteToken: string;
  athleteName: string;
  timezone: string | null;
  paused: boolean;
  showHypeCard: boolean;
  events?: readonly OwnerGameOnEvent[];
}

export interface DashboardGameEvent {
  id: string;
  type: string;
  date: string;
  status?: string;
}

export interface EventDaySharingReminder {
  localDate: string;
  timezone: string;
  inviteToken: string;
  athleteName: string;
  events: OwnerGameOnEvent[];
}

export const eventDaySharingDismissalPrefix = 'pixlsports-owner-event-day-sharing';

export function getEventLocalDate(now: Date, timezone: string): string | null {
  if (!Number.isFinite(now.getTime()) || !timezone.trim()) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    const year = part('year');
    const month = part('month');
    const day = part('day');
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

export function getOwnerEventDayReminders(input: {
  invites: readonly OwnerAthletePage[];
  dashboardEvents: readonly DashboardGameEvent[];
  now: Date;
}): EventDaySharingReminder[] {
  const reminders = new Map<string, EventDaySharingReminder>();
  for (const invite of input.invites) {
    if (!invite.inviteToken || invite.paused || !invite.showHypeCard || !invite.timezone) continue;
    const localDate = getEventLocalDate(input.now, invite.timezone);
    if (!localDate) continue;
    for (const event of invite.events ?? []) {
      if (
        !['game', 'practice'].includes(event.type.toLowerCase())
        || !event.eventId
        || !event.shareToken
        || event.date !== localDate
        || isFinalOrInactive(event.status)
      ) continue;
      const source = input.dashboardEvents.find((item) => item.id === event.eventId);
      // A date/type/final mismatch on a known schedule event identifies a stale
      // snapshot (for example, a moved game). If there's no dashboard source,
      // trust the explicit shareToken link: standalone Game On Cards have no
      // schedule event. The current payload can't distinguish those from a
      // deleted scheduled source, so that case remains eligible until the API
      // stops returning the linked share.
      if (
        source
        && (
          source.type !== event.type
          || source.date !== event.date
          || isFinalOrInactive(source.status ?? '')
        )
      ) continue;
      const key = `${invite.inviteToken}:${localDate}`;
      const reminder = reminders.get(key) ?? {
        localDate,
        timezone: invite.timezone,
        inviteToken: invite.inviteToken,
        athleteName: invite.athleteName,
        events: [],
      };
      if (!reminder.events.some((item) => item.eventId === event.eventId)) {
        reminder.events.push(event);
      }
      reminders.set(key, reminder);
    }
  }
  return [...reminders.values()].sort((left, right) => left.localDate.localeCompare(right.localDate));
}

function isFinalOrInactive(status: string): boolean {
  return ['final', 'complete', 'completed', 'deleted', 'moved', 'cancelled', 'canceled']
    .includes(status.trim().toLowerCase());
}

export function getEventDaySharingDismissalKey(ownerId: string, localDate: string): string {
  return `${eventDaySharingDismissalPrefix}:${encodeURIComponent(ownerId)}:${localDate}`;
}

export function hasDismissedEventDaySharing(
  storage: Pick<Storage, 'getItem'>,
  ownerId: string,
  localDate: string,
): boolean {
  try {
    return storage.getItem(getEventDaySharingDismissalKey(ownerId, localDate)) === '1';
  } catch {
    return false;
  }
}

export function dismissEventDaySharing(
  storage: Pick<Storage, 'setItem'>,
  ownerId: string,
  localDates: readonly string[],
): void {
  for (const localDate of new Set(localDates)) {
    try {
      storage.setItem(getEventDaySharingDismissalKey(ownerId, localDate), '1');
    } catch {
      // Keep the reminder dismissible for the current session when storage is unavailable.
    }
  }
}