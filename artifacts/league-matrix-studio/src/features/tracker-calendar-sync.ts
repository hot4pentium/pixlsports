export const trackerCalendarSyncEvent = 'pixl-tracker-calendar-sync';

export type PendingTrackerCalendarSync = {
  eventId: string;
  gameId: string;
  completedAt: string;
};

const prefix = 'pixl-tracker-calendar-sync-pending:';
const keyFor = (accountId: string) => `${prefix}${encodeURIComponent(accountId)}`;

export function readPendingTrackerCalendarSync(storage: Pick<Storage, 'getItem'>, accountId: string): PendingTrackerCalendarSync[] {
  if (!accountId) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(keyFor(accountId)) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is PendingTrackerCalendarSync => (
      entry !== null && typeof entry === 'object'
      && typeof entry.eventId === 'string' && entry.eventId.length > 0
      && typeof entry.gameId === 'string' && entry.gameId.length > 0
      && typeof entry.completedAt === 'string' && Number.isFinite(Date.parse(entry.completedAt))
    ));
  } catch {
    return [];
  }
}

export function savePendingTrackerCalendarSync(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  accountId: string,
  pending: PendingTrackerCalendarSync,
) {
  const existing = readPendingTrackerCalendarSync(storage, accountId).filter((item) => item.gameId !== pending.gameId);
  storage.setItem(keyFor(accountId), JSON.stringify([...existing, pending]));
}

export function clearPendingTrackerCalendarSync(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  accountId: string,
  gameId: string,
) {
  storage.setItem(keyFor(accountId), JSON.stringify(
    readPendingTrackerCalendarSync(storage, accountId).filter((item) => item.gameId !== gameId),
  ));
}