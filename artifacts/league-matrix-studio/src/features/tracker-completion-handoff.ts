export type CompletionHandoffSaveStatus = 'cloud-saved' | 'local-saved';
export const trackerCompletionHandoffEvent = 'pixl-tracker-completion-handoff';

export type TrackerCompletionHandoff = {
  accountId: string;
  gameId: string;
  saveStatus: CompletionHandoffSaveStatus;
  createdAt: number;
};

export type CompletionHandoffStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const handoffKeyPrefix = 'pixlsports-tracker-completion-handoff:';
const handoffMaxAgeMs = 24 * 60 * 60 * 1000;

function getHandoffKey(accountId: string) {
  return `${handoffKeyPrefix}${encodeURIComponent(accountId)}`;
}

export function saveCompletionHandoff(
  storage: CompletionHandoffStorage,
  accountId: string,
  gameId: string,
  saveStatus: CompletionHandoffSaveStatus,
  now = Date.now(),
) {
  if (!accountId || !gameId || !Number.isFinite(now)) {
    throw new Error('A valid account, game, and save time are required for the completion handoff.');
  }
  const handoff: TrackerCompletionHandoff = { accountId, gameId, saveStatus, createdAt: now };
  storage.setItem(getHandoffKey(accountId), JSON.stringify(handoff));
}

export function consumeCompletionHandoff(
  storage: CompletionHandoffStorage,
  accountId: string,
): TrackerCompletionHandoff | null {
  if (!accountId) return null;
  const key = getHandoffKey(accountId);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
    storage.removeItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<TrackerCompletionHandoff> | null;
    const now = Date.now();
    if (
      !value
      || value.accountId !== accountId
      || typeof value.gameId !== 'string'
      || !value.gameId.trim()
      || (value.saveStatus !== 'cloud-saved' && value.saveStatus !== 'local-saved')
      || typeof value.createdAt !== 'number'
      || !Number.isFinite(value.createdAt)
      || value.createdAt > now
      || now - value.createdAt > handoffMaxAgeMs
    ) return null;
    return value as TrackerCompletionHandoff;
  } catch {
    return null;
  }
}