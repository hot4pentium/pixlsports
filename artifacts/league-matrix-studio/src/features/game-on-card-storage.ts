export type GameOnCardEvent = {
  id: string;
  calendarProjectId?: string;
  type?: 'game' | 'practice';
  date: string;
  time: string;
  timezone?: string;
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

export type OfflineGameOnCardDraft = {
  id: string;
  sourceEventId: string;
  savedAt: string;
  event: GameOnCardEvent & { calendarProjectId?: string };
};

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;
type StorageRemover = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type GameOnCardStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function gameOnCardStorageKey(userId: string) {
  return `pixlsports-game-on-card:${userId}`;
}

export function gameOnCardStorageListKey(userId: string) {
  return `pixlsports-game-on-cards:${userId}`;
}

export function offlineGameOnCardDraftsStorageKey(userId: string) {
  return `pixlsports-game-on-card-drafts:${userId}`;
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function validatedSavedGameOnCard(value: unknown): SavedGameOnCard | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Partial<SavedGameOnCard>;
  if (
    typeof parsed.shareToken !== 'string'
    || typeof parsed.title !== 'string'
    || typeof parsed.savedAt !== 'string'
    || !parsed.event
    || typeof parsed.event.id !== 'string'
    || typeof parsed.event.date !== 'string'
    || typeof parsed.event.time !== 'string'
    || typeof parsed.event.location !== 'string'
    || typeof parsed.event.opponent !== 'string'
  ) return null;
  if (
    parsed.event.status !== undefined
    && parsed.event.status !== 'upcoming'
    && parsed.event.status !== 'live'
    && parsed.event.status !== 'final'
  ) return null;
  if (parsed.event.type !== undefined && parsed.event.type !== 'game' && parsed.event.type !== 'practice') return null;

  return {
    shareToken: parsed.shareToken,
    title: parsed.title,
    savedAt: parsed.savedAt,
    event: {
      id: parsed.event.id,
      ...(parsed.event.type ? { type: parsed.event.type } : {}),
      date: parsed.event.date,
      time: parsed.event.time,
      ...(typeof parsed.event.timezone === 'string' ? { timezone: parsed.event.timezone } : {}),
      location: parsed.event.location,
      opponent: parsed.event.opponent,
      status: parsed.event.status ?? 'upcoming',
    },
  };
}

function validatedOfflineGameOnCardDraft(value: unknown): OfflineGameOnCardDraft | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Partial<OfflineGameOnCardDraft>;
  const event = parsed.event;
  if (
    typeof parsed.id !== 'string'
    || !parsed.id
    || typeof parsed.sourceEventId !== 'string'
    || typeof parsed.savedAt !== 'string'
    || !event
    || typeof event.id !== 'string'
    || typeof event.date !== 'string'
    || typeof event.time !== 'string'
    || typeof event.location !== 'string'
    || typeof event.opponent !== 'string'
  ) return null;
  if (
    event.status !== undefined
    && event.status !== 'upcoming'
    && event.status !== 'live'
    && event.status !== 'final'
  ) return null;
  if (event.type !== undefined && event.type !== 'game' && event.type !== 'practice') return null;
  if (event.calendarProjectId !== undefined && typeof event.calendarProjectId !== 'string') return null;

  return {
    id: parsed.id,
    sourceEventId: parsed.sourceEventId,
    savedAt: parsed.savedAt,
    event: {
      id: event.id,
      ...(event.type ? { type: event.type } : {}),
      ...(event.calendarProjectId ? { calendarProjectId: event.calendarProjectId } : {}),
      date: event.date,
      time: event.time,
      ...(typeof event.timezone === 'string' ? { timezone: event.timezone } : {}),
      location: event.location,
      opponent: event.opponent,
      status: event.status ?? 'upcoming',
    },
  };
}

export function readOfflineGameOnCardDrafts(
  userId: string,
  storage: StorageReader | undefined = browserStorage(),
): OfflineGameOnCardDraft[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(offlineGameOnCardDraftsStorageKey(userId)) ?? 'null');
    if (!Array.isArray(parsed)) return [];
    const seenIds = new Set<string>();
    return parsed.reduce<OfflineGameOnCardDraft[]>((drafts, record) => {
      const draft = validatedOfflineGameOnCardDraft(record);
      if (draft && !seenIds.has(draft.id)) {
        drafts.push(draft);
        seenIds.add(draft.id);
      }
      return drafts;
    }, []);
  } catch {
    return [];
  }
}

export function upsertOfflineGameOnCardDraft(
  userId: string,
  draft: OfflineGameOnCardDraft,
  storage: GameOnCardStorage | undefined = browserStorage(),
) {
  if (!storage) throw new Error('Event Card draft storage is unavailable.');
  const drafts = readOfflineGameOnCardDrafts(userId, storage);
  const existingIndex = drafts.findIndex((item) => item.id === draft.id);
  if (existingIndex === -1) drafts.push(draft);
  else drafts[existingIndex] = draft;
  storage.setItem(offlineGameOnCardDraftsStorageKey(userId), JSON.stringify(drafts));
}

export function removeOfflineGameOnCardDraft(
  userId: string,
  draftId: string,
  storage: GameOnCardStorage | undefined = browserStorage(),
) {
  if (!storage) return false;
  const drafts = readOfflineGameOnCardDrafts(userId, storage);
  const remaining = drafts.filter((draft) => draft.id !== draftId);
  if (remaining.length === drafts.length) return false;
  const key = offlineGameOnCardDraftsStorageKey(userId);
  if (remaining.length) storage.setItem(key, JSON.stringify(remaining));
  else storage.removeItem(key);
  return true;
}

export function readSavedGameOnCard(
  userId: string,
  storage: StorageReader | undefined = browserStorage(),
): SavedGameOnCard | null {
  if (!storage) return null;
  try {
    return validatedSavedGameOnCard(
      JSON.parse(storage.getItem(gameOnCardStorageKey(userId)) ?? 'null'),
    );
  } catch {
    return null;
  }
}

export function readSavedGameOnCards(
  userId: string,
  storage: StorageReader | undefined = browserStorage(),
): SavedGameOnCard[] {
  if (!storage) return [];
  let list: SavedGameOnCard[] = [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(gameOnCardStorageListKey(userId)) ?? 'null');
    if (Array.isArray(parsed)) {
      const seenTokens = new Set<string>();
      list = parsed.reduce<SavedGameOnCard[]>((cards, record) => {
        const card = validatedSavedGameOnCard(record);
        if (card && !seenTokens.has(card.shareToken)) {
          cards.push(card);
          seenTokens.add(card.shareToken);
        }
        return cards;
      }, []);
    }
  } catch {
    // Ignore a corrupt list without treating any of its contents as cards.
  }

  const legacy = readSavedGameOnCard(userId, storage);
  if (legacy && !list.some((card) => card.shareToken === legacy.shareToken)) {
    list.push(legacy);
  }
  return list;
}

export function writeSavedGameOnCard(
  userId: string,
  saved: SavedGameOnCard,
  storage: StorageWriter | undefined = browserStorage(),
) {
  if (!storage) throw new Error('Event Card storage is unavailable.');
  storage.setItem(gameOnCardStorageKey(userId), JSON.stringify(saved));
}

export function upsertSavedGameOnCard(
  userId: string,
  saved: SavedGameOnCard,
  storage: GameOnCardStorage | undefined = browserStorage(),
) {
  if (!storage) throw new Error('Event Card storage is unavailable.');
  const cards = readSavedGameOnCards(userId, storage);
  const existingIndex = cards.findIndex((card) => card.shareToken === saved.shareToken);
  if (existingIndex === -1) cards.push(saved);
  else cards[existingIndex] = saved;
  storage.setItem(gameOnCardStorageListKey(userId), JSON.stringify(cards));
}

export function removeSavedGameOnCard(
  userId: string,
  expectedShareToken?: string,
  storage: StorageRemover | undefined = browserStorage(),
) {
  if (!storage) return false;
  const legacyKey = gameOnCardStorageKey(userId);
  const listKey = gameOnCardStorageListKey(userId);
  if (expectedShareToken === undefined) {
    const hadLegacy = storage.getItem(legacyKey) !== null;
    const hadList = storage.getItem(listKey) !== null;
    storage.removeItem(legacyKey);
    storage.removeItem(listKey);
    return hadLegacy || hadList;
  }

  let removed = false;
  try {
    const legacy = readSavedGameOnCard(userId, storage);
    if (legacy?.shareToken === expectedShareToken) {
      storage.removeItem(legacyKey);
      removed = true;
    }

    const rawList = storage.getItem(listKey);
    if (rawList !== null) {
      const parsed: unknown = JSON.parse(rawList);
      if (Array.isArray(parsed)) {
        const remaining = parsed.filter((record) => {
          const card = validatedSavedGameOnCard(record);
          if (card?.shareToken === expectedShareToken) {
            removed = true;
            return false;
          }
          return true;
        });
        if (remaining.length !== parsed.length) {
          if (remaining.length) storage.setItem(listKey, JSON.stringify(remaining));
          else storage.removeItem(listKey);
        }
      }
    }
  } catch {
    // Leave data in place if storage is unavailable or corrupt.
  }
  return removed;
}

export async function revokeGameOnCardForScheduleEvent(input: {
  userId?: string | null;
  eventId: string;
  revokeShare: (shareToken: string) => Promise<unknown>;
  linkedShareTokens?: readonly string[];
  storage?: GameOnCardStorage;
}) {
  const { userId, eventId, revokeShare, linkedShareTokens = [], storage } = input;
  if (!userId) return false;
  const linkedTokens = new Set([
    ...readSavedGameOnCards(userId, storage)
      .filter((saved) => saved.event.id === eventId)
      .map((saved) => saved.shareToken),
    ...linkedShareTokens,
  ]);
  if (!linkedTokens.size) return false;

  for (const shareToken of linkedTokens) {
    await revokeShare(shareToken);
    removeSavedGameOnCard(userId, shareToken, storage);
  }
  return true;
}
