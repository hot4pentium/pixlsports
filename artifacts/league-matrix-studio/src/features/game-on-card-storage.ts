export type GameOnCardEvent = {
  id: string;
  date: string;
  time: string;
  location: string;
  opponent: string;
  status: 'upcoming' | 'live' | 'final';
};

export type SavedGameOnCard = {
  shareToken: string;
  event: GameOnCardEvent;
  title: string;
  savedAt: string;
};

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;
type StorageRemover = Pick<Storage, 'getItem' | 'removeItem'>;
type GameOnCardStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function gameOnCardStorageKey(userId: string) {
  return `pixlsports-game-on-card:${userId}`;
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readSavedGameOnCard(
  userId: string,
  storage: StorageReader | undefined = browserStorage(),
): SavedGameOnCard | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(gameOnCardStorageKey(userId)) ?? 'null') as
      | Partial<SavedGameOnCard>
      | null;
    if (
      !parsed
      || typeof parsed.shareToken !== 'string'
      || typeof parsed.title !== 'string'
      || typeof parsed.savedAt !== 'string'
      || !parsed.event
      || typeof parsed.event.id !== 'string'
      || typeof parsed.event.date !== 'string'
      || typeof parsed.event.time !== 'string'
      || typeof parsed.event.location !== 'string'
      || typeof parsed.event.opponent !== 'string'
    ) return null;

    const status = parsed.event.status === 'live' || parsed.event.status === 'final'
      ? parsed.event.status
      : 'upcoming';
    return {
      shareToken: parsed.shareToken,
      title: parsed.title,
      savedAt: parsed.savedAt,
      event: { ...parsed.event, status },
    };
  } catch {
    return null;
  }
}

export function writeSavedGameOnCard(
  userId: string,
  saved: SavedGameOnCard,
  storage: StorageWriter | undefined = browserStorage(),
) {
  if (!storage) throw new Error('Game On Card storage is unavailable.');
  storage.setItem(gameOnCardStorageKey(userId), JSON.stringify(saved));
}

export function removeSavedGameOnCard(
  userId: string,
  expectedShareToken?: string,
  storage: StorageRemover | undefined = browserStorage(),
) {
  if (!storage) return false;
  if (
    expectedShareToken
    && readSavedGameOnCard(userId, storage)?.shareToken !== expectedShareToken
  ) return false;
  storage.removeItem(gameOnCardStorageKey(userId));
  return true;
}

export async function revokeGameOnCardForScheduleEvent(input: {
  userId?: string | null;
  eventId: string;
  revokeShare: (shareToken: string) => Promise<unknown>;
  storage?: GameOnCardStorage;
}) {
  const { userId, eventId, revokeShare, storage } = input;
  if (!userId) return false;
  const saved = readSavedGameOnCard(userId, storage);
  if (!saved || saved.event.id !== eventId) return false;

  await revokeShare(saved.shareToken);
  removeSavedGameOnCard(userId, saved.shareToken, storage);
  return true;
}